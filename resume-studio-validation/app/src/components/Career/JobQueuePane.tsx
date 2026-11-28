import { useStudioComponentSkins } from '../../studio-theme/StudioThemeProvider';
import { buttonSkin } from '../../studio-theme/componentSkins';
import {useStudioThemeId} from '../../studio-theme/StudioThemeProvider';
import {surfaceStyle} from '../../studio-theme/surfaces';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {apiClient,localErrorMessage} from '../../lib/apiClient';
import {careerLedger} from '../../lib/careerLedgerSession';
import {jobQueueBindingMatches,jobQueueDocumentHash,prepareJobQueueTask} from '../../lib/jobQueueBinding';
import {sameJobReviewDocument} from '../../lib/jobRequirements';
import {verifyQueueWorkflowOpen} from '../../lib/jobQueueWorkflow';
import {parsePracticeKey} from '../../lib/interviewPractice';
import {JobQueueWorkflowPane} from './JobQueueWorkflowPane';
import {JobQueueSchema,MAX_JOB_QUEUE_TASKS,MAX_JOB_QUEUE_JD_CHARS,MAX_JOB_QUEUE_ATTEMPTS,type JobQueueTask,type JobQueueCommand,type JobQueueOpenResult} from '../../schema/applicationSchema';
import type {ResumeDocument} from '../../schema/resumeSchema';

type Candidate={task:JobQueueTask;title:string;revision:string;source:ResumeDocument};
type Check={id:string;revision:string;status:'same'|'stale'|'unavailable';at:string};
type Job={controller:AbortController;cancel:()=>void};
const field='w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-900 disabled:opacity-60 studio-ui-border studio-ui-surface studio-ui-primary';
const button='rounded border border-slate-300 bg-white px-2 py-1.5 font-medium text-slate-700 disabled:opacity-40 studio-ui-border studio-ui-surface studio-ui-primary';
function assertQueue(tasks:JobQueueTask[]){
  const result=JobQueueSchema.safeParse(tasks);
  if(!result.success)throw Error(result.error.issues[0]?.message||'岗位队列校验失败。');
}

const stateLabels:Record<JobQueueTask['status'],string>={pending:'待处理',running:'准备尝试未结算',paused:'已暂停',canceled:'已取消',failed:'准备失败',prepared:'本地准备完成'};
const failureLabels={ 'local-error':'本地解析或写入前核验失败','source-changed':'绑定简历发生变化或超出读取上限','invalid-source':'岗位原文无可核对条款或超过80条，请分批登记新任务。','timeout':'执行超时','interrupted':'中断后已显式恢复为失败' };
/** The renderer requests explicit commands only; no worker or AI request here. */
export function JobQueuePane({activeSlug,activeDoc,redacted}:{activeSlug:string;activeDoc:ResumeDocument;redacted:boolean}){
  const skins=useStudioComponentSkins();
  const themeId=useStudioThemeId();
  const ledger=useSyncExternalStore(careerLedger.subscribe,careerLedger.getSnapshot);
  const tasks=ledger.data.jobQueue??[];
  const ready=ledger.ready&&!ledger.loading&&!ledger.saving&&!ledger.dirty&&!ledger.error&&typeof ledger.data.revision==='string'&&/^[a-f0-9]{64}$/.test(ledger.data.revision);
  const [company,setCompany]=useState(''),[role,setRole]=useState(''),[jd,setJd]=useState('');
  const [candidate,setCandidate]=useState<Candidate|null>(null);
  const [workflowCandidate,setWorkflowCandidate]=useState<JobQueueOpenResult|null>(null);
  const [opened,setOpened]=useState<{reply:JobQueueOpenResult;active:ResumeDocument}|null>(null);
  const [check,setCheck]=useState<Check|null>(null);
  const [busy,setBusy]=useState<'prepare'|'check'|'save'|'execute'|null>(null);
  const [message,setMessage]=useState<{error:boolean;text:string}|null>(null);
  const [pollUnavailable,setPollUnavailable]=useState(false),[clock,setClock]=useState(Date.now);
  const readRef=useRef<Job|null>(null),writeRef=useRef(false),mounted=useRef(false);
  const scope=useRef({activeSlug,activeDoc,redacted,revision:ledger.data.revision});
  scope.current={activeSlug,activeDoc,redacted,revision:ledger.data.revision};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;readRef.current?.cancel();};},[]);
  useEffect(()=>{readRef.current?.cancel();setCandidate(null);setWorkflowCandidate(null);setCheck(null);if(!writeRef.current)setMessage(null);},[activeSlug,activeDoc,redacted,ledger.data.revision]);
  useEffect(()=>{setOpened(null);},[activeSlug,activeDoc,redacted]);
  const supportsExecution=!!window.resumeDesktop?.applications?.commandJobQueue;
  const supportsWorkflow=!!window.resumeDesktop?.applications?.openPreparedJobQueue;
  const hasRunning=tasks.some(t=>t.status==='running');
  // Read-only refresh of acknowledged disk state while this panel is visible.
  // Never overwrite a dirty draft, start work, or auto-retry on restart.
  useEffect(()=>{
    setClock(Date.now());
    setPollUnavailable(false);
    if(!supportsExecution||!hasRunning||redacted)return;
    let live=true;
    const tick=()=>{
      setClock(Date.now());
      if(!writeRef.current&&!readRef.current)void careerLedger.refreshQueue().then(result=>{
        if(live&&result!=='skipped')setPollUnavailable(result==='unavailable');
      });
    };
    const timer=setInterval(tick,1000);
    return()=>{live=false;clearInterval(timer);};
  },[supportsExecution,hasRunning,redacted]);
  const isReady=(revision:string)=>{
    const now=careerLedger.getSnapshot();
    return now.ready&&!now.loading&&!now.saving&&!now.dirty&&!now.error&&now.data.revision===revision;
  };
  const runRead=async<T,>(kind:'prepare'|'check',revision:string,work:(signal:AbortSignal)=>Promise<T>):Promise<T>=>{
    if(readRef.current||writeRef.current)throw Error('已有操作进行中。');
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined,rejectWait:((error:Error)=>void)|undefined;
    const cancel=(reason='已取消读取。')=>{controller.abort();rejectWait?.(Error(reason));};
    const job={controller,cancel};readRef.current=job;setBusy(kind);
    const start=scope.current;
    try{
      const result=await Promise.race([new Promise<never>((_resolve,reject)=>{rejectWait=reject;timer=setTimeout(()=>cancel('读取超过10秒，未继续等待。'),10000);}),work(controller.signal)]);
      if(!mounted.current||controller.signal.aborted||scope.current.activeSlug!==start.activeSlug||scope.current.activeDoc!==start.activeDoc||scope.current.redacted||!isReady(revision))throw Error('当前简历或台账已变化，请重新核对。');
      return result;
    }finally{
      if(timer!==undefined)clearTimeout(timer);
      if(readRef.current===job)readRef.current=null;
      if(mounted.current)setBusy(null);
    }
  };
  const prepare=async()=>{
    if(!ready||redacted||readRef.current||writeRef.current||!ledger.data.revision)return;
    setMessage(null);setCandidate(null);setCheck(null);
    if(!company.trim()||!role.trim()||company.trim().length>200||role.trim().length>200||!jd.trim()||jd.length>MAX_JOB_QUEUE_JD_CHARS){
      setMessage({error:true,text:'请填写单位、岗位和完整岗位原文（单位/岗位各最多200字，原文最多20000字）。'});return;
    }
    const revision=ledger.data.revision,source=scope.current;
    try{
      const result=await runRead('prepare',revision,async signal=>{
        const doc=await apiClient.getResume(source.activeSlug,signal);
        // Renderer can retain a previous timestamp after auto-save. Compare the
        // actual current content, then use the authoritative disk revision.
        if(!sameJobReviewDocument(doc,source.activeDoc))throw Error('当前编辑与磁盘版本不同，请先完成保存或重载后再登记。');
        const task=await prepareJobQueueTask({id:crypto.randomUUID(),company,role,jdText:jd,slug:source.activeSlug,createdAt:new Date().toISOString()},doc);
        assertQueue([...tasks,task]);
        return {task,title:doc.title,revision,source:source.activeDoc};
      });
      if(mounted.current&&!scope.current.redacted)setCandidate(result);
    }catch(err){if(mounted.current&&!scope.current.redacted)setMessage({error:true,text:localErrorMessage(err,'读取岗位绑定失败')});}
  };
  const confirm=async()=>{
    if(!candidate||redacted||!ready||readRef.current||writeRef.current||!isReady(candidate.revision))return;
    const {task,revision}=candidate;
    if(task.slug!==activeSlug||task.docId!==activeDoc.id||candidate.source!==activeDoc){setCandidate(null);setMessage({error:true,text:'当前简历已变化，请重新核对绑定。'});return;}
    writeRef.current=true;setBusy('save');setMessage(null);setCandidate(null);setCheck(null);
    try{
      const current=careerLedger.getSnapshot();
      assertQueue([...(current.data.jobQueue??[]),task]);
      if(!isReady(revision))throw Error('台账已变化，请重新核对。');
      if(!careerLedger.update(data=>({...data,jobQueue:[...(data.jobQueue??[]),task]})))throw Error('台账未准备好，未登记。');
      await careerLedger.flush();
      const now=careerLedger.getSnapshot();
      const saved=now.data.jobQueue?.find(t=>t.id===task.id);
      if(now.dirty||now.error||!saved||JSON.stringify(saved)!==JSON.stringify(task))throw Error('未收到完整任务的保存回执，请刷新磁盘台账核对。');
      if(mounted.current&&!scope.current.redacted){
        setCompany('');setRole('');setJd('');
        setMessage({error:false,text:'岗位任务已保存到本地台账；尚未运行。'});
      }
    }catch(err){if(mounted.current&&!scope.current.redacted)setMessage({error:true,text:localErrorMessage(err,'岗位任务保存失败，查看台账草稿状态。')});}
    finally{writeRef.current=false;if(mounted.current)setBusy(null);}
  };
  const verify=async(task:JobQueueTask)=>{
    if(!ready||redacted||readRef.current||writeRef.current||!ledger.data.revision)return;
    const revision=ledger.data.revision;
    setMessage(null);setCheck(null);setCandidate(null);
    try{
      const matches=await runRead('check',revision,async signal=>{
        const doc=await apiClient.getResume(task.slug,signal);
        return jobQueueBindingMatches(task,doc,await jobQueueDocumentHash(doc));
      });
      if(mounted.current&&!scope.current.redacted)setCheck({id:task.id,revision,status:matches?'same':'stale',at:new Date().toISOString()});
    }catch(err){
      if(mounted.current&&!scope.current.redacted&&isReady(revision)){
        setCheck({id:task.id,revision,status:'unavailable',at:new Date().toISOString()});
        setMessage({error:true,text:localErrorMessage(err,'无法核验绑定版本')});
      }
    }
  };
  const execute=async(task:JobQueueTask,action:JobQueueCommand['action'])=>{
    if(!supportsExecution||!ready||redacted||readRef.current||writeRef.current||candidate||workflowCandidate||!ledger.data.revision||!isReady(ledger.data.revision))return;
    writeRef.current=true;setBusy('execute');setMessage(null);setCheck(null);
    const watchdog=setTimeout(()=>{if(mounted.current&&!scope.current.redacted)setMessage({error:true,text:'等待任务回执超过10秒；结果未确认，不会自动重试。请勿重复提交。'});},10000);
    try{
      await careerLedger.controlQueue({taskId:task.id,ledgerRevision:ledger.data.revision,action});
      if(mounted.current&&!scope.current.redacted)setMessage({error:false,text:'任务操作已获本地台账回执。当前状态以任务列表为准。'});
    }catch(err){if(mounted.current&&!scope.current.redacted)setMessage({error:true,text:localErrorMessage(err,'任务操作未确认，请刷新磁盘台账。')});}
    finally{clearTimeout(watchdog);writeRef.current=false;if(mounted.current)setBusy(null);}
  };
  const openWorkflow=async(task:JobQueueTask,confirm=false)=>{
    if(!supportsWorkflow||!ready||redacted||candidate||readRef.current||writeRef.current||!ledger.data.revision||task.status!=='prepared'||task.slug!==activeSlug||task.docId!==activeDoc.id)return;
    const revision=ledger.data.revision,source=activeDoc;
    if(confirm&&(!workflowCandidate||workflowCandidate.ledgerRevision!==revision||JSON.stringify(workflowCandidate.task)!==JSON.stringify(task)))return;
    setMessage(null);setCheck(null);setWorkflowCandidate(null);
    try{
      const reply=await runRead('check',revision,async()=>verifyQueueWorkflowOpen(await apiClient.openPreparedJobQueue({taskId:task.id,ledgerRevision:revision}),task,revision,activeSlug,source));
      if(mounted.current&&!scope.current.redacted){if(confirm)setOpened({reply,active:source});else setWorkflowCandidate(reply);}
    }catch(e){if(mounted.current&&!scope.current.redacted)setMessage({error:true,text:localErrorMessage(e,'岗位流程绑定核验失败')});}
  };
  if(redacted)return <p data-studio-region="job-queue-redacted" data-studio-surface="panel" data-studio-theme={themeId} style={surfaceStyle(themeId,'panel')} className="rounded border bg-slate-50 p-3 text-slate-700 studio-ui-raised studio-ui-primary studio-ui-border">脱敏预览开启时隐藏岗位队列原文和登记操作。</p>;
  if(opened&&opened.active===activeDoc&&opened.reply.task.slug===activeSlug&&JSON.stringify(tasks.find(t=>t.id===opened.reply.task.id))===JSON.stringify(opened.reply.task))return <JobQueueWorkflowPane key={opened.reply.task.id} opened={opened.reply} activeDoc={activeDoc} onExit={()=>setOpened(null)}/>;
  const locked=!ready||busy!==null||!!workflowCandidate;
  return <section data-studio-region="job-queue" data-studio-surface="panel" data-studio-theme={themeId} style={surfaceStyle(themeId,'panel')} aria-label="本地岗位任务队列" className="space-y-3">
    <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 space-y-1 studio-ui-selected-border studio-ui-selected studio-ui-selected-text">
      <h3 className="font-bold text-teal-900 studio-ui-selected-text">本地岗位任务队列</h3>
      <p className="text-slate-700 studio-ui-primary">逐岗位登记，绑定已保存的简历版本。显式开始后只做本地原文条款准备与版本核验；不会自动运行 AI、修改简历、生成投递记录或发送材料。</p>
      <p className="text-[10px] text-slate-600 studio-ui-muted">已登记 {tasks.length}/{MAX_JOB_QUEUE_TASKS} · 原文每项最多 {MAX_JOB_QUEUE_JD_CHARS} 字 · 队列为本地台账的一部分；备份与恢复沿用台账机制。</p>
    </div>
    {!supportsExecution&&<p className="text-slate-600 studio-ui-muted">执行控制仅支持已升级的桌面工作台；当前仍可登记和核验。</p>}
    {pollUnavailable&&<p role="status" className="text-amber-800 studio-ui-warning">自动状态读取未确认；当前为上次确认的台账状态，可手动刷新。执行不会因此自动重试。</p>}
    {!ready&&<p role="status" className="text-amber-800 studio-ui-warning">请先完成台账保存或重新读取磁盘台账，再进行登记和核验。</p>}
    <div className="rounded-lg border border-slate-200 p-3 space-y-2 studio-ui-border">
      <h4 className="font-semibold">登记新岗位</h4>
      <p className="break-words text-[11px] text-slate-600 studio-ui-muted">当前简历：{activeDoc.title} · {activeSlug}。未确认表单离开此页不保存。</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1">单位<input data-studio-control="true" aria-label="队列单位" className={field} value={company} disabled={locked||!!candidate} onChange={e=>setCompany(e.target.value)}/></label>
        <label className="space-y-1">岗位<input data-studio-control="true" aria-label="队列岗位" className={field} value={role} disabled={locked||!!candidate} onChange={e=>setRole(e.target.value)}/></label>
      </div>
      <label className="block space-y-1">岗位原文（保留输入原样）<textarea data-studio-control="true" aria-label="队列岗位原文" className={field+' min-h-28 resize-y'} value={jd} disabled={locked||!!candidate} onChange={e=>setJd(e.target.value)}/></label>
      <p className="text-[10px] text-slate-500 studio-ui-muted">{jd.length}/{MAX_JOB_QUEUE_JD_CHARS} 字</p>
      {!candidate&&<button {...buttonSkin(skins,'primary')} data-studio-control="true" type="button" className={button} disabled={locked||tasks.length>=MAX_JOB_QUEUE_TASKS} onClick={()=>void prepare()}>核对任务绑定</button>}
      {candidate&&<div role="region" aria-label="确认岗位任务绑定" className="rounded border border-teal-300 bg-teal-50 p-2 space-y-2 studio-ui-selected-border studio-ui-selected studio-ui-selected-text">
        <p className="font-semibold break-words">确认登记：{candidate.task.company} · {candidate.task.role}</p>
        <p className="break-words">磁盘简历：{candidate.title} · {candidate.task.slug}</p>
        <p className="break-all text-[10px]">版本：{candidate.task.documentRevision}</p>
        <p className="break-all text-[10px]">文档 SHA-256：{candidate.task.documentSha256}</p>
        <p className="text-[10px]">原文 {candidate.task.jdText.length} 字；确认后固定绑定，不会自动替换为其他版本。</p>
        <div className="flex flex-wrap gap-2"><button {...buttonSkin(skins,'primary')} data-studio-control="true" type="button" disabled={locked} onClick={()=>void confirm()} className="rounded bg-teal-700 px-3 py-1.5 text-white disabled:opacity-40 studio-ui-fill studio-ui-on-fill">确认登记岗位任务</button><button {...buttonSkin(skins)} data-studio-control="true" type="button" className={button} onClick={()=>setCandidate(null)}>取消本次登记</button></div>
      </div>}
      {busy&&<p role="status">{busy==='prepare'?'读取磁盘绑定…':busy==='check'?'核验绑定…':busy==='execute'?'等待任务台账确认…':'保存台账…'}{(busy==='prepare'||busy==='check')&&<button {...buttonSkin(skins)} data-studio-control="true" type="button" className={button+' ml-2'} onClick={()=>readRef.current?.cancel()}>取消读取</button>}</p>}
      {workflowCandidate&&<div role="region" aria-label="确认固定岗位流程" className="rounded border border-teal-300 bg-teal-50 p-2 space-y-2 studio-ui-selected-border studio-ui-selected studio-ui-selected-text">
        <p className="font-semibold break-words">确认进入：{workflowCandidate.task.company} · {workflowCandidate.task.role}</p><p>绑定简历：{workflowCandidate.document.title} · {workflowCandidate.task.slug}</p>
        <p>本地准备回执 {workflowCandidate.task.execution?.result?.clauseCount} 条。仅加载此岗位材料流程，不修改当前简历，不发送材料。</p>
        <button {...buttonSkin(skins,'primary')} data-studio-control="true" type="button" className={button} disabled={!ready||busy!==null} onClick={()=>void openWorkflow(workflowCandidate.task,true)}>确认进入该岗位流程</button> <button {...buttonSkin(skins)} data-studio-control="true" type="button" className={button} onClick={()=>setWorkflowCandidate(null)}>取消进入流程</button>
      </div>}
      {message&&<p role={message.error?'alert':'status'} className={'break-words '+(message.error?'text-red-700 studio-ui-error':'text-teal-800 studio-ui-selected-text')}>{message.text}</p>}
    </div>
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">已登记任务</h4><button {...buttonSkin(skins)} data-studio-control="true" type="button" className={button} disabled={ledger.dirty||ledger.saving||ledger.loading||busy!==null||!!candidate} onClick={()=>void careerLedger.load().catch(()=>{})}>刷新岗位队列</button></div>
      {!tasks.length&&<p className="text-slate-500 studio-ui-muted">暂无待处理岗位。</p>}
      {tasks.map(task=>{
        const status=check?.id===task.id&&check.revision===ledger.data.revision?check:null;
        return <article key={task.id} aria-label={'岗位任务 '+task.company+' '+task.role} className="rounded-lg border border-slate-200 p-3 space-y-2 studio-ui-border">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h5 className="font-semibold break-words">{task.company} · {task.role}</h5><p className="text-[10px] break-all text-slate-600 studio-ui-muted">{task.slug} · {task.documentRevision}</p></div><span className="rounded bg-slate-100 px-2 py-1 studio-ui-raised">{ledger.dirty?'待保存草稿':stateLabels[task.status]}</span></div>
          <details><summary data-studio-control="true" className="cursor-pointer text-slate-700 studio-ui-primary">查看岗位原文（{task.jdText.length} 字）与绑定详情</summary><pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-sans text-[11px] studio-ui-raised">{task.jdText}</pre><p className="mt-1 break-all text-[10px]">任务 ID：{task.id}</p><p className="break-all text-[10px]">SHA-256：{task.documentSha256}</p></details>
          <div className="flex flex-wrap items-center gap-2"><button {...buttonSkin(skins)} data-studio-control="true" type="button" aria-label={'核验岗位绑定 '+task.company+' '+task.role} className={button} disabled={locked||!!candidate} onClick={()=>void verify(task)}>核验绑定</button><span className={status?.status==='same'?'text-teal-700 studio-ui-selected-text':status?'text-amber-800 studio-ui-warning':'text-slate-500 studio-ui-muted'}>{status?.status==='same'?'绑定一致（核验时）':status?.status==='stale'?'版本已变化，原任务不得沿用':status?.status==='unavailable'?'绑定不可核验，不得沿用':'未核验当前版本'}</span></div>
          {status&&<p className="text-[10px] text-slate-500 studio-ui-muted">核验时间 {status.at}；不会自动更新任务或启动操作。</p>}
          {task.execution&&<div className="rounded bg-slate-50 p-2 text-[11px] break-words studio-ui-raised">
            <p>执行尝试 {task.execution.attempts}/{MAX_JOB_QUEUE_ATTEMPTS} · {task.execution.updatedAt}</p>
            {task.execution.deadlineAt&&<>
              <p>本地准备期限：{task.execution.deadlineAt}</p>
              <p className="text-slate-600 studio-ui-muted">这是台账未结算状态，不保证进程仍在运行；重启不会自动继续。</p>
              <p className="text-amber-800 studio-ui-warning">{clock>=Date.parse(task.execution.deadlineAt)?'期限已过，可显式恢复为失败。':'期限内可暂停或取消。'}不会自动重试。</p>
            </>}
            {task.execution.failure&&<p role="status" className="text-amber-800 studio-ui-warning">{failureLabels[task.execution.failure]}</p>}
            {task.execution.result&&<p className="text-teal-800 studio-ui-selected-text">本地候选条款 {task.execution.result.clauseCount} 条；尚未人工核对，不代表符合招聘条件。后续使用前仍需核验绑定版本。</p>}
          </div>}
          {task.status==='prepared'&&<div className="space-y-1 rounded bg-teal-50 p-2 studio-ui-selected studio-ui-selected-text">
            <button {...buttonSkin(skins)} data-studio-control="true" type="button" aria-label={'核对岗位流程 '+task.company+' '+task.role} className={button} disabled={!supportsWorkflow||locked||!!candidate||task.slug!==activeSlug||task.docId!==activeDoc.id} onClick={()=>void openWorkflow(task)}>核对并进入岗位流程</button>
            {(task.slug!==activeSlug||task.docId!==activeDoc.id)&&<p>请先在顶部切换到绑定简历；不自动切换或保存其他版本。</p>}
            {!supportsWorkflow&&<p>需要升级桌面桥接才可进入流程。</p>}
            <details><summary data-studio-control="true">该岗位已保存历史（只读，不代表当前依据）</summary>
              {(ledger.data.jobReviews??[]).filter(a=>a.queueTaskId===task.id).map(a=><p key={a.id}>核对档案：{a.createdAt} · {a.rows.length} 条人工记录；{a.rows.map(r=>r.clauseId+' '+r.review.outcome).join('；')}</p>)}
              {ledger.data.coverLetters.filter(l=>l.queueTaskId===task.id).map(l=><details key={l.id}><summary data-studio-control="true">自荐信：{l.title}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{l.bodyText}</pre></details>)}
              {Object.entries(ledger.data.interviewAnswers).filter(([key])=>parsePracticeKey(key)?.queueTaskId===task.id).map(([key,answer])=><details key={key}><summary data-studio-control="true">历史练习：{parsePracticeKey(key)?.question}</summary><p className="whitespace-pre-wrap">{answer}</p></details>)}
              {ledger.data.applications.filter(a=>a.queueTaskId===task.id).map(a=><p key={a.id}>投递台账：{a.status} · {a.snapshotId}（到投递追踪复盘）</p>)}
            </details>
          </div>}
          {supportsExecution&&<div className="flex flex-wrap gap-2">
            {task.status==='pending'&&<button {...buttonSkin(skins,'primary')} data-studio-control="true" type="button" aria-label={'开始岗位 '+task.company+' '+task.role} className={button} disabled={locked||!!candidate||hasRunning} onClick={()=>void execute(task,'start')}>开始本地准备</button>}
            {(task.status==='paused'||task.status==='failed')&&<button {...buttonSkin(skins,'primary')} data-studio-control="true" type="button" aria-label={'重试岗位 '+task.company+' '+task.role} className={button} disabled={locked||!!candidate||hasRunning||task.execution?.failure==='invalid-source'||(task.execution?.attempts??0)>=MAX_JOB_QUEUE_ATTEMPTS} onClick={()=>void execute(task,'retry')}>{task.status==='paused'?'继续准备（新尝试）':'重试准备'}</button>}
            {task.status==='running'&&<><button {...buttonSkin(skins)} data-studio-control="true" type="button" aria-label={'暂停岗位 '+task.company+' '+task.role} className={button} disabled={locked||!!candidate} onClick={()=>void execute(task,'pause')}>暂停</button>
              <button {...buttonSkin(skins,'danger')} data-studio-control="true" type="button" aria-label={'恢复中断岗位 '+task.company+' '+task.role} className={button} disabled={locked||!!candidate||!task.execution?.deadlineAt||clock<Date.parse(task.execution.deadlineAt)} onClick={()=>void execute(task,'recover')}>恢复中断为失败</button></>}
            {task.status!=='canceled'&&task.status!=='prepared'&&<button {...buttonSkin(skins,'danger')} data-studio-control="true" type="button" aria-label={'取消岗位 '+task.company+' '+task.role} className={button+' text-red-700 studio-ui-error'} disabled={locked||!!candidate} onClick={()=>void execute(task,'cancel')}>取消任务（保留记录）</button>}
          </div>}
        </article>;
      })}
    </div>
  </section>;
}
