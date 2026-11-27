import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {apiClient,localErrorMessage} from '../../lib/apiClient';
import {careerLedger} from '../../lib/careerLedgerSession';
import {jobQueueBindingMatches,jobQueueDocumentHash,prepareJobQueueTask} from '../../lib/jobQueueBinding';
import {sameJobReviewDocument} from '../../lib/jobRequirements';
import {JobQueueSchema,MAX_JOB_QUEUE_TASKS,MAX_JOB_QUEUE_JD_CHARS,type JobQueueTask} from '../../schema/applicationSchema';
import type {ResumeDocument} from '../../schema/resumeSchema';

type Candidate={task:JobQueueTask;title:string;revision:string;source:ResumeDocument};
type Check={id:string;revision:string;status:'same'|'stale'|'unavailable';at:string};
type Job={controller:AbortController;cancel:()=>void};
const field='w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-900 disabled:opacity-60';
const button='rounded border border-slate-300 bg-white px-2 py-1.5 font-medium text-slate-700 disabled:opacity-40';
function assertQueue(tasks:JobQueueTask[]){
  const result=JobQueueSchema.safeParse(tasks);
  if(!result.success)throw Error(result.error.issues[0]?.message||'岗位队列校验失败。');
}

/** No scheduler, AI call, resume write, or application status mutation here. */
export function JobQueuePane({activeSlug,activeDoc,redacted}:{activeSlug:string;activeDoc:ResumeDocument;redacted:boolean}){
  const ledger=useSyncExternalStore(careerLedger.subscribe,careerLedger.getSnapshot);
  const tasks=ledger.data.jobQueue??[];
  const ready=ledger.ready&&!ledger.loading&&!ledger.saving&&!ledger.dirty&&!ledger.error&&typeof ledger.data.revision==='string'&&/^[a-f0-9]{64}$/.test(ledger.data.revision);
  const [company,setCompany]=useState(''),[role,setRole]=useState(''),[jd,setJd]=useState('');
  const [candidate,setCandidate]=useState<Candidate|null>(null);
  const [check,setCheck]=useState<Check|null>(null);
  const [busy,setBusy]=useState<'prepare'|'check'|'save'|null>(null);
  const [message,setMessage]=useState<{error:boolean;text:string}|null>(null);
  const readRef=useRef<Job|null>(null),writeRef=useRef(false),mounted=useRef(false);
  const scope=useRef({activeSlug,activeDoc,redacted,revision:ledger.data.revision});
  scope.current={activeSlug,activeDoc,redacted,revision:ledger.data.revision};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;readRef.current?.cancel();};},[]);
  useEffect(()=>{readRef.current?.cancel();setCandidate(null);setCheck(null);if(!writeRef.current)setMessage(null);},[activeSlug,activeDoc,redacted,ledger.data.revision]);
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
  if(redacted)return <p className="rounded border bg-slate-50 p-3 text-slate-700">脱敏预览开启时隐藏岗位队列原文和登记操作。</p>;
  const locked=!ready||busy!==null;
  return <section aria-label="本地岗位任务队列" className="space-y-3">
    <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 space-y-1">
      <h3 className="font-bold text-teal-900">本地岗位任务队列</h3>
      <p className="text-slate-700">逐岗位登记，绑定当前已保存的简历版本。仅保存待处理任务，不会自动运行 AI、修改简历、生成投递记录或发送材料。</p>
      <p className="text-[10px] text-slate-600">已登记 {tasks.length}/{MAX_JOB_QUEUE_TASKS} · 原文每项最多 {MAX_JOB_QUEUE_JD_CHARS} 字 · 队列为本地台账的一部分；备份与恢复沿用台账机制。</p>
    </div>
    {!ready&&<p role="status" className="text-amber-800">请先完成台账保存或重新读取磁盘台账，再进行登记和核验。</p>}
    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
      <h4 className="font-semibold">登记新岗位</h4>
      <p className="break-words text-[11px] text-slate-600">当前简历：{activeDoc.title} · {activeSlug}。未确认表单离开此页不保存。</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1">单位<input aria-label="队列单位" className={field} value={company} disabled={locked||!!candidate} onChange={e=>setCompany(e.target.value)}/></label>
        <label className="space-y-1">岗位<input aria-label="队列岗位" className={field} value={role} disabled={locked||!!candidate} onChange={e=>setRole(e.target.value)}/></label>
      </div>
      <label className="block space-y-1">岗位原文（保留输入原样）<textarea aria-label="队列岗位原文" className={field+' min-h-28 resize-y'} value={jd} disabled={locked||!!candidate} onChange={e=>setJd(e.target.value)}/></label>
      <p className="text-[10px] text-slate-500">{jd.length}/{MAX_JOB_QUEUE_JD_CHARS} 字</p>
      {!candidate&&<button type="button" className={button} disabled={locked||tasks.length>=MAX_JOB_QUEUE_TASKS} onClick={()=>void prepare()}>核对任务绑定</button>}
      {candidate&&<div role="region" aria-label="确认岗位任务绑定" className="rounded border border-teal-300 bg-teal-50 p-2 space-y-2">
        <p className="font-semibold break-words">确认登记：{candidate.task.company} · {candidate.task.role}</p>
        <p className="break-words">磁盘简历：{candidate.title} · {candidate.task.slug}</p>
        <p className="break-all text-[10px]">版本：{candidate.task.documentRevision}</p>
        <p className="break-all text-[10px]">文档 SHA-256：{candidate.task.documentSha256}</p>
        <p className="text-[10px]">原文 {candidate.task.jdText.length} 字；确认后固定绑定，不会自动替换为其他版本。</p>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={locked} onClick={()=>void confirm()} className="rounded bg-teal-700 px-3 py-1.5 text-white disabled:opacity-40">确认登记岗位任务</button><button type="button" className={button} onClick={()=>setCandidate(null)}>取消本次登记</button></div>
      </div>}
      {busy&&<p role="status">{busy==='prepare'?'读取磁盘绑定…':busy==='check'?'核验绑定…':'保存台账…'}{busy!=='save'&&<button type="button" className={button+' ml-2'} onClick={()=>readRef.current?.cancel()}>取消读取</button>}</p>}
      {message&&<p role={message.error?'alert':'status'} className={'break-words '+(message.error?'text-red-700':'text-teal-800')}>{message.text}</p>}
    </div>
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">已登记任务</h4><button type="button" className={button} disabled={locked||!!candidate} onClick={()=>void careerLedger.load().catch(()=>{})}>刷新岗位队列</button></div>
      {!tasks.length&&<p className="text-slate-500">暂无待处理岗位。</p>}
      {tasks.map(task=>{
        const status=check?.id===task.id&&check.revision===ledger.data.revision?check:null;
        return <article key={task.id} aria-label={'岗位任务 '+task.company+' '+task.role} className="rounded-lg border border-slate-200 p-3 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h5 className="font-semibold break-words">{task.company} · {task.role}</h5><p className="text-[10px] break-all text-slate-600">{task.slug} · {task.documentRevision}</p></div><span className="rounded bg-slate-100 px-2 py-1">{ledger.dirty?'待保存草稿':'待处理'}</span></div>
          <details><summary className="cursor-pointer text-slate-700">查看岗位原文（{task.jdText.length} 字）与绑定详情</summary><pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-sans text-[11px]">{task.jdText}</pre><p className="mt-1 break-all text-[10px]">任务 ID：{task.id}</p><p className="break-all text-[10px]">SHA-256：{task.documentSha256}</p></details>
          <div className="flex flex-wrap items-center gap-2"><button type="button" aria-label={'核验岗位绑定 '+task.company+' '+task.role} className={button} disabled={locked||!!candidate} onClick={()=>void verify(task)}>核验绑定</button><span className={status?.status==='same'?'text-teal-700':status?'text-amber-800':'text-slate-500'}>{status?.status==='same'?'绑定一致（核验时）':status?.status==='stale'?'版本已变化，原任务不得沿用':status?.status==='unavailable'?'绑定不可核验，不得沿用':'未核验当前版本'}</span></div>
          {status&&<p className="text-[10px] text-slate-500">核验时间 {status.at}；不会自动更新任务或启动操作。</p>}
        </article>;
      })}
    </div>
  </section>;
}
