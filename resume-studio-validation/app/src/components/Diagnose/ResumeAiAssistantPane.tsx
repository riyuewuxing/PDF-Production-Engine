import {useEffect,useMemo,useRef,useState} from 'react';
import {BookOpen,ClipboardList,Sparkles} from 'lucide-react';
import type {ResumeDocument} from '../../schema/resumeSchema';
import {apiClient,localErrorMessage} from '../../lib/apiClient';
import {collectEditableBlocks} from '../../lib/resumeBlocks';
import {assertAiPreviewSettings,requestByokCompletionWithReceipt,describeAiRequest,validateByokBaseUrl,type ByokAiSettings,type AiCompletionResult} from '../../lib/byokAiClient';
import {ASSISTANT_MODES,prepareAssistantTask,parseAssistantReply,type AssistantMode,type PreparedAssistantTask} from '../../lib/aiAssistant';
import {formatProposalDiagnostics} from '../../lib/aiTailor';
import {AiTaskReceiptView,receivedAiTask,failedAiTask,type AiTaskReceipt} from './AiTaskReceiptView';
import {AI_TOOL_CATALOG,AI_SKILL_VERSION} from '../../lib/aiSkills';
import {buildTextPatchEnvelope,previewTextPatch} from '../../lib/aiTextPatch';
import {scanScopedProposalWarnings,type TailorBlockProposal} from '../../lib/aiTailor';
import {PRIVACY_PLACEHOLDER,isShareableFact} from '../../lib/aiContext';
import type {FactBank,FactRecord} from '../../schema/factBankSchema';
import {assertFreshFactSelection,loadLocalFactBank,prepareFactSelection} from '../../lib/factSelection';
import {FactBankPane} from './FactBankPane';
import {renderAiComparison,type AiPdfComparison} from '../../lib/aiPdfComparison';
import {AiPdfComparisonView} from './AiPdfComparisonView';
import {WORKFLOW_ACTIONS,createWorkflowSession,isWorkflowCurrent,workflowDocumentContent,workflowStepGoal,beginWorkflowStep,finishWorkflowStep,completeWorkflow,type WorkflowSession} from '../../lib/aiWorkflow';
import type {JobRewriteDraft} from '../../lib/jobAiReview';
export type AiTextReviewActions={overflowPx:number;onFlushBeforeApply:()=>Promise<void>;getCurrentRevision:()=>string;onImmediateChange:(next:ResumeDocument)=>void};
type Props=AiTextReviewActions&{document:ResumeDocument;slug:string;settings:ByokAiSettings;jdText:string;assertSettings:(settings:ByokAiSettings)=>void;jobScope?:JobRewriteDraft};
type Basis={document:ResumeDocument;slug:string;settings:ByokAiSettings;goal:string;mode:AssistantMode;keys:string[];jdText?:string;overflowPx:number;requestId:string;records:FactRecord[];bankRevision:string|null;jobScope?:JobRewriteDraft};
type Pending={basis:Basis;prepared:PreparedAssistantTask};
type Result={request:Pending;reply:ReturnType<typeof parseAssistantReply>};
export function ResumeAiAssistantPane(props:Props){
  const blocks=useMemo(()=>collectEditableBlocks(props.document),[props.document]);
  const [mode,setMode]=useState<AssistantMode>(props.jobScope?'co-create':'ask');
  const [workflow,setWorkflow]=useState<WorkflowSession|null>(null);
  const [workflowBusy,setWorkflowBusy]=useState(false);
  const workflowMoveRef=useRef(false);
  const workflowRef=useRef<WorkflowSession|null>(null);workflowRef.current=workflow;
  const [goal,setGoal]=useState(props.jobScope?.goal??'');
  const [keys,setKeys]=useState<string[]>(()=>props.jobScope?[props.jobScope.blockKey]:blocks.slice(0,1).map(b=>b.key));
  const [includeJd,setIncludeJd]=useState(!!props.jobScope);
  const [bank,setBank]=useState<FactBank|null>(null);
  const [factIds,setFactIds]=useState<string[]>([]);
  const [factsBusy,setFactsBusy]=useState(false);
  const [pending,setPending]=useState<Pending|null>(null);
  const [result,setResult]=useState<Result|null>(null);
  const [attempt,setAttempt]=useState<{basis:Basis;value:AiTaskReceipt}|null>(null);
  const [accepted,setAccepted]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [applying,setApplying]=useState(false);
  const [rendering,setRendering]=useState(false);
  const [review,setReview]=useState<{ids:string;next:ResumeDocument;comparison:AiPdfComparison}|null>(null);
  const [pdfConfirmed,setPdfConfirmed]=useState(false);
  const renderAbort=useRef<AbortController|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const abortRef=useRef<AbortController|null>(null);
  const activeBasis=useRef<Basis|null>(null);
  const applyRef=useRef(false);
  const mounted=useRef(false);
  const current=useRef({props,mode,goal,keys,includeJd,bank,factIds,workflow});current.current={props,mode,goal,keys,includeJd,bank,factIds,workflow};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abortRef.current?.abort();renderAbort.current?.abort();};},[]);
  useEffect(()=>{setKeys(prev=>prev.filter(k=>blocks.some(b=>b.key===k)));},[blocks]);
  useEffect(()=>{setFactIds(prev=>prev.filter(id=>bank?.records.some(r=>r.id===id&&keys.includes(r.blockKey)&&isShareableFact(props.document,r))));},[bank,keys,props.document]);
  const isCurrent=(b:Basis)=>{
    const c=current.current;
    return mounted.current&&c.props.document===b.document&&c.props.slug===b.slug&&c.props.settings===b.settings&&c.props.jobScope===b.jobScope&&c.mode===b.mode&&c.goal===b.goal&&JSON.stringify(c.keys)===JSON.stringify(b.keys)&&(c.includeJd?c.props.jdText:undefined)===b.jdText&&c.props.overflowPx===b.overflowPx&&JSON.stringify(c.factIds)===JSON.stringify(b.records.map(r=>r.id))&&(!b.records.length||c.bank?.revision===b.bankRevision);
  };
  const assertFactsFresh=async(b:Basis)=>{
    if(b.jobScope){
      if(JSON.stringify(await apiClient.getAiSettings())!==JSON.stringify(b.settings))throw new Error('岗位定向改写的已保存模型档案已变化，请重新分析并准备。');
      if(!isCurrent(b))throw new Error('岗位条款或目标正文已变化。');
    }
    if(!b.records.length)return;
    await assertFreshFactSelection(b.document,{records:b.records,binding:b.bankRevision?{slug:b.slug,docId:b.document.id,bankRevision:b.bankRevision,ids:b.records.map(r=>r.id),selectedKeys:b.keys}:undefined},loadLocalFactBank);
    if(!isCurrent(b))throw new Error('事实选择或简历已变化。');
  };
  const reset=()=>{setPending(null);setResult(null);setAttempt(null);setAccepted([]);setReview(null);setPdfConfirmed(false);setNotice(null);setError(null);};
  useEffect(()=>{
    if(activeBasis.current&&!isCurrent(activeBasis.current))abortRef.current?.abort();
    if(pending&&!isCurrent(pending.basis))setPending(null);
    if(attempt&&!isCurrent(attempt.basis))setAttempt(null);
    if(result&&!isCurrent(result.request.basis)){setResult(null);setAccepted([]);setReview(null);setPdfConfirmed(false);renderAbort.current?.abort();}
  },[props.document,props.slug,props.settings,props.jdText,props.overflowPx,props.jobScope,mode,goal,keys,includeJd,bank,factIds]);
  const workflowCurrent=workflow?isWorkflowCurrent(workflow,props.document,props.slug,props.settings,props.jdText):false;
  const canPrepare=(!workflow||workflow.stage==='active')&&(!workflow||workflowCurrent);
  const moveWorkflow=async()=>{
    const session=workflowRef.current;
    if(!session||workflowMoveRef.current||workflowBusy||busy||applying||rendering||factsBusy||session.stage!=='ready')return;
    workflowMoveRef.current=true;setWorkflowBusy(true);setError(null);
    try{
      const p=current.current.props;
      if(!isWorkflowCurrent(session,p.document,p.slug,p.settings,p.jdText))throw new Error('简历、岗位或模型已变化，分步计划已过期。');
      await p.onFlushBeforeApply();
      const disk=await apiClient.getResume(session.slug),latest=current.current.props;
      if(!mounted.current||workflowRef.current!==session||!isWorkflowCurrent(session,latest.document,latest.slug,latest.settings,latest.jdText)||workflowDocumentContent(disk)!==session.expectedContent)
        throw new Error('磁盘简历与已批准的步骤结果不一致，停止分步任务。');
      reset();setFactIds([]);
      if(session.index===session.steps.length){
        setWorkflow(completeWorkflow(session));setNotice('已核对本地保存，分步任务结束。');return;
      }
      const step=session.steps[session.index]!;
      setWorkflow(beginWorkflowStep(session));setMode('co-create');setGoal(workflowStepGoal(session));setKeys([...step.keys]);setIncludeJd(session.jdText!==undefined);
    }catch(err){if(mounted.current)setError(localErrorMessage(err,'无法进入下一步'));}
    finally{workflowMoveRef.current=false;if(mounted.current)setWorkflowBusy(false);}
  };
  const skipWorkflow=()=>{
    if(!workflow||workflow.stage!=='active'||!workflowCurrent||!window.confirm('跳过此步骤，不修改简历，继续下一步？'))return;
    setWorkflow(finishWorkflowStep(workflow,props.document,'skipped'));setFactIds([]);reset();
  };
  const prepare=()=>{
    if(busy||applying||factsBusy||workflowBusy||!canPrepare)return;reset();
    try{
      props.assertSettings(props.settings);
      const scope=props.jobScope;
      if(scope&&(mode!=='co-create'||goal!==scope.goal||keys.length!==1||keys[0]!==scope.blockKey||!includeJd||props.jdText!==scope.clause.quote||factIds.length))throw new Error('岗位定向改写范围已变化，请重新准备。');
      const selection=prepareFactSelection(props.document,props.slug,keys,bank,factIds);
      const records=selection.records;
      const basis:Basis={document:props.document,slug:props.slug,settings:props.settings,mode,goal,keys:[...keys],jdText:includeJd?props.jdText:undefined,overflowPx:props.overflowPx,requestId:crypto.randomUUID(),records,bankRevision:bank?.revision??null,jobScope:scope};
      const prepared=prepareAssistantTask(basis);
      if(selection.binding)prepared.options.factBinding=selection.binding;
      assertAiPreviewSettings(props.settings,prepared.options);setPending({basis,prepared});
    }catch(err){setError(localErrorMessage(err,'无法准备 AI 任务'));}
  };
  const send=async()=>{
    if(!pending||abortRef.current||applyRef.current||factsBusy||rendering)return;
    const req=pending;setPending(null);
    if(!isCurrent(req.basis)){setError('任务范围或模型已经变化，请重新预览。');return;}
    const ctrl=new AbortController();abortRef.current=ctrl;activeBasis.current=req.basis;setBusy(true);setError(null);setAttempt(null);
    let response:AiCompletionResult|undefined;
    try{
      await assertFactsFresh(req.basis);
      if(ctrl.signal.aborted||!isCurrent(req.basis))return;
      response=await requestByokCompletionWithReceipt({...req.prepared.options,settings:req.basis.settings,signal:ctrl.signal});
      if(ctrl.signal.aborted)return;
      if(!isCurrent(req.basis))throw new Error('任务目标或简历已变化，旧结果未采纳。');
      await assertFactsFresh(req.basis);
      if(ctrl.signal.aborted||!isCurrent(req.basis))return;
      const reply=parseAssistantReply(response.text,req.prepared);setResult({request:req,reply});setAccepted([]);
      setAttempt({basis:req.basis,value:reply.kind==='proposals'&&!reply.proposals.length?failedAiTask(response):receivedAiTask(response)});
      if(reply.kind==='workflow')setWorkflow(createWorkflowSession({document:req.basis.document,slug:req.basis.slug,settings:req.basis.settings,goal:req.basis.goal,jdText:req.basis.jdText,steps:reply.steps}));
      if(reply.kind==='proposals'&&!reply.proposals.length)setNotice('未返回可用正文提案；不代表简历已达到目标。');
    }catch(err){if(isCurrent(req.basis)&&!ctrl.signal.aborted){setAttempt({basis:req.basis,value:failedAiTask(response,err)});setError(localErrorMessage(err,'AI 任务失败'));}}
    finally{if(abortRef.current===ctrl){if(ctrl.signal.aborted&&isCurrent(req.basis))setAttempt({basis:req.basis,value:{status:'cancelled'}});abortRef.current=null;activeBasis.current=null;if(mounted.current)setBusy(false);}}
  };
  const toggle=(p:TailorBlockProposal,checked:boolean)=>{
    if(p.suggestedText.includes(PRIVACY_PLACEHOLDER))return;
    setReview(null);setPdfConfirmed(false);
    setAccepted(prev=>checked?[...new Set([...prev,p.id])]:prev.filter(id=>id!==p.id));
  };
  const renderReview=async()=>{
    if(!result||result.reply.kind!=='proposals'||renderAbort.current||applyRef.current||busy||factsBusy||!accepted.length)return;
    const {request,reply}=result;
    setReview(null);setPdfConfirmed(false);setError(null);
    if(!isCurrent(request.basis)){setError('简历或任务范围已变化，禁止试渲染旧提案。');return;}
    const controller=new AbortController();renderAbort.current=controller;setRendering(true);
    try{await assertFactsFresh(request.basis);
      if(controller.signal.aborted)return;
      const selected=reply.proposals.filter(p=>accepted.includes(p.id));
      const envelope=await buildTextPatchEnvelope({document:props.document,slug:props.slug,baseRevision:'local-preview-only',sourceRequestId:request.basis.requestId,candidates:selected});
      const next=await previewTextPatch({document:props.document,slug:props.slug,revision:'local-preview-only',envelope});
      const comparison=await renderAiComparison(props.document,next,false,controller.signal);
      if(controller.signal.aborted)return;
      await assertFactsFresh(request.basis);
      if(controller.signal.aborted)return;
      if(!isCurrent(request.basis))throw new Error('原简历已变化，试渲染结果作废。');
      setReview({ids:JSON.stringify([...accepted].sort()),next,comparison});
    }catch(err){if(mounted.current&&!controller.signal.aborted)setError(localErrorMessage(err,'正文 PDF 对照失败'));}
    finally{renderAbort.current=null;if(mounted.current)setRendering(false);}
  };
  const apply=async()=>{
    if(!result||result.reply.kind!=='proposals'||applyRef.current||busy||rendering||factsBusy||!accepted.length||!review||!pdfConfirmed||review.comparison.blockers.length||review.ids!==JSON.stringify([...accepted].sort()))return;
    const {request,reply}=result;
    if(!isCurrent(request.basis)){setError('简历或任务范围已变化，禁止应用旧提案。');return;}
    if(props.slug==='master'&&!window.confirm('当前目标是母库。确认在创建本地快照后应用已逐项核对的正文修改？'))return;
    const selected=reply.proposals.filter(p=>accepted.includes(p.id));
    const session=workflowRef.current;
    if(session&&(!isWorkflowCurrent(session,props.document,props.slug,props.settings,props.jdText)||session.stage!=='active')){setError('分步计划已过期。');return;}
    applyRef.current=true;setApplying(true);setError(null);
    try{
      await assertFactsFresh(request.basis).catch(err=>{setReview(null);setPdfConfirmed(false);throw err;});
      for(const p of selected){
        const warnings=scanScopedProposalWarnings(p.suggestedText,p.blockKey,request.prepared.sourceMap,p.factIds);
        if(JSON.stringify(warnings)!==JSON.stringify(p.factWarnings))throw new Error('提案事实警告变化，请重新审核。');
      }
      await props.onFlushBeforeApply();
      if(!isCurrent(request.basis))throw new Error('简历已变化，未应用修改。');
      const revision=props.getCurrentRevision();
      const envelope=await buildTextPatchEnvelope({document:props.document,slug:props.slug,baseRevision:revision,sourceRequestId:request.basis.requestId,candidates:selected});
      const next=await previewTextPatch({document:props.document,slug:props.slug,revision,envelope});
      if(JSON.stringify(next)!==JSON.stringify(review.next))throw new Error('候选已变化，请重新试渲染。');
      if(!isCurrent(request.basis)||props.getCurrentRevision()!==revision)throw new Error('简历版本已变化。');
      await apiClient.createSnapshot(props.slug,request.basis.jobScope?'岗位定向改写前快照':'AI 协作任务前快照',revision);
      await assertFactsFresh(request.basis).catch(err=>{setReview(null);setPdfConfirmed(false);throw err;});
      if(!isCurrent(request.basis)||props.getCurrentRevision()!==revision)throw new Error('简历版本已变化。');
      props.onImmediateChange(next);setResult(null);setAttempt(null);setAccepted([]);setReview(null);setPdfConfirmed(false);setFactIds([]);
      if(session)setWorkflow(finishWorkflowStep(session,next,'applied'));
      setNotice('已应用 '+selected.length+' 条已核对正文提案，可使用 Ctrl+Z 撤回。');
    }catch(err){if(mounted.current)setError(localErrorMessage(err,'提案应用失败'));}
    finally{applyRef.current=false;if(mounted.current)setApplying(false);}
  };
  const locked=busy||applying||rendering||factsBusy||workflowBusy;
  const taskControlsLocked=locked||!!workflow;
  return <section aria-label="简历 AI 自由任务" className="space-y-3 rounded-lg border border-teal-200 bg-white p-3 text-[11px] text-slate-800">
    <div className="flex items-center gap-1.5 font-bold text-teal-900"><Sparkles size={14}/>AI 协作任务 · {AI_SKILL_VERSION}</div>
    <p>从实际可见段落、事实来源和当前排版测量构建上下文。模型没有磁盘写入权限。问答和计划永远不修改简历。</p>
    {props.jobScope?<div aria-label="岗位定向改写范围" className="space-y-1 rounded border border-teal-200 bg-teal-50 p-2"><strong>仅一个正文段落 · {props.jobScope.label}</strong><p className="whitespace-pre-wrap">第 {props.jobScope.clause.line} 行 · {props.jobScope.clause.quote}</p><p>{props.jobScope.goal}</p><p className="text-slate-600">仅本条 JD 与本段自述，不外发其他条款、独立事实库或其他段落。先预览，另行确认发送；后续仍需核对事实与真实 PDF。</p></div>:<>
    <div className="grid grid-cols-2 gap-1">{Object.entries(ASSISTANT_MODES).map(([id,label])=><button key={id} type="button" disabled={taskControlsLocked} onClick={()=>{setMode(id as AssistantMode);setFactIds([]);reset();}} className={'rounded border px-1.5 py-1.5 '+(mode===id?'border-teal-700 bg-teal-700 text-white':'bg-slate-50 text-slate-700')}>{label}</button>)}</div>
    <label className="block font-semibold">任务目标<textarea aria-label="AI 自由任务目标" rows={3} disabled={taskControlsLocked} value={goal} onChange={e=>{setGoal(e.target.value);setFactIds([]);reset();}} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal" placeholder="例如：保留科研事实，精简冗余语言；检查教师岗位表达是否明确。"/></label>
    <div className="rounded border border-slate-200 bg-slate-50 p-2 space-y-1">
      <div className="flex items-center justify-between gap-1"><span className="font-semibold">发送段落（{keys.length}/{blocks.length}）</span><button type="button" disabled={taskControlsLocked} onClick={()=>{setKeys(blocks.map(b=>b.key));reset();}} className="text-teal-700">全选可见段落</button><button type="button" disabled={taskControlsLocked} onClick={()=>{setKeys([]);reset();}} className="text-slate-600">清空</button></div>
      <div className="max-h-36 overflow-auto space-y-1">{blocks.map(b=><label key={b.key} className="flex items-start gap-1"><input type="checkbox" disabled={taskControlsLocked} checked={keys.includes(b.key)} onChange={e=>{setKeys(prev=>e.target.checked?[...prev,b.key]:prev.filter(k=>k!==b.key));reset();}}/><span>{b.label}</span></label>)}</div>
      <label className="flex items-center gap-1"><input type="checkbox" disabled={taskControlsLocked} checked={includeJd} onChange={e=>{setIncludeJd(e.target.checked);setFactIds([]);reset();}}/>同时发送当前岗位 JD（默认关闭）</label>
    </div>
    </>}
    {workflow&&<section aria-label="受控分步工作" className="rounded border border-teal-300 bg-teal-50 p-2 space-y-2">
      <div className="font-bold">受控分步工作 · {workflow.index}/{workflow.steps.length} 步已处理</div>
      <p>每一步重新读取本地简历，事实需重新选择，发送、正文核对与 PDF 审批均单独确认。模型不会自动进入下一步。</p>
      {workflow.steps.map((s,i)=><div key={s.id} className="rounded border bg-white p-1.5 break-words">
        <div className="font-semibold">{i+1}. {WORKFLOW_ACTIONS[s.action]} · {workflow.outcomes[i]==='applied'?'已采纳':workflow.outcomes[i]==='skipped'?'已跳过':i===workflow.index&&workflow.stage==='active'?'当前步骤':'待处理'}</div>
        <div>{s.keys.map(k=>blocks.find(b=>b.key===k)?.label||'已失效段落').join('、')}</div><div className="text-slate-600">{s.reason}</div>
      </div>)}
      {!workflowCurrent&&workflow.stage!=='done'&&<p className="text-amber-800">当前内容或配置尚未匹配计划基线；不可继续旧步骤。</p>}
      <div className="flex flex-wrap gap-2">
        {workflow.stage==='ready'&&<button type="button" disabled={locked||!workflowCurrent} onClick={()=>void moveWorkflow()} className="rounded bg-teal-700 px-2 py-1 text-white disabled:opacity-50">{workflow.index===workflow.steps.length?'核对保存并结束分步任务':'准备第 '+(workflow.index+1)+' 步'}</button>}
        {workflow.stage==='active'&&<button type="button" disabled={locked||!workflowCurrent} onClick={skipWorkflow} className="rounded border px-2 py-1">跳过当前步骤</button>}
        {workflow.stage==='done'&&<span className="font-semibold text-teal-800">已核对磁盘保存</span>}
        <button type="button" disabled={locked} onClick={()=>{setWorkflow(null);setFactIds([]);setMode('ask');setGoal(workflow.originalGoal);reset();}} className="rounded border px-2 py-1">{workflow.stage==='done'?'关闭分步记录':'结束本次分步工作'}</button>
      </div>
    </section>}
    {!props.jobScope&&<FactBankPane key={props.slug+':'+props.document.id} document={props.document} slug={props.slug} blocks={blocks} keys={keys} bank={bank} selected={factIds} locked={locked} onBank={b=>{setBank(b);setFactIds([]);reset();}} onSelected={ids=>{setFactIds(ids);reset();}} onBusy={setFactsBusy} onFlush={props.onFlushBeforeApply} getRevision={props.getCurrentRevision}/>}
    <details className="rounded border border-slate-200 p-2"><summary className="cursor-pointer font-semibold"><BookOpen size={12} className="inline"/> 本地工具权限说明</summary>{AI_TOOL_CATALOG.map(tool=><div key={tool.name} className="mt-1"><span className="font-mono text-teal-800">{tool.name}</span> · {tool.description}</div>)}</details>
    <button type="button" disabled={locked||!goal.trim()||!canPrepare} onClick={prepare} className="rounded bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50">预览 AI 自由任务</button>
    {busy&&<div className="flex items-center justify-between"><span>正在运行模型任务…</span><button type="button" onClick={()=>abortRef.current?.abort()} className="rounded border px-2 py-1">取消自由任务</button></div>}
    {error&&<div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</div>}
    {notice&&<div role="status" className="rounded bg-teal-50 p-2 text-teal-800">{notice}</div>}
    {attempt&&isCurrent(attempt.basis)&&<AiTaskReceiptView label="自由任务调用回执" attempt={attempt.value}/>}

    {pending&&<section aria-label="自由任务发送预览" className="rounded border border-amber-300 bg-amber-50 p-2 space-y-2">
      <div className="font-bold">自由任务发送前确认</div><div className="break-all">{pending.basis.settings.providerLabel} · {pending.basis.settings.model} · {validateByokBaseUrl(pending.basis.settings.baseUrl).baseUrl}/chat/completions</div><p>{describeAiRequest(pending.basis.settings,pending.prepared.options)}</p>
      {pending.basis.records.length>0&&<div aria-label="本次外发事实清单" className="max-h-40 overflow-auto space-y-1 rounded border border-amber-200 bg-white p-2"><div className="font-semibold">本次明确外发 {pending.basis.records.length} 条本人确认事实（证据位置不外发）</div>{pending.prepared.blocks.flatMap(b=>pending.prepared.sourceMap[b.key]??[]).filter(s=>s.scope==='record').map(s=><div key={s.id} className="border-t pt-1"><div className="font-mono text-teal-800">{s.id} · 本人确认</div><div className="whitespace-pre-wrap break-words">{s.facts}</div></div>)}</div>}
      <div className="max-h-64 overflow-auto rounded bg-white p-2 space-y-1"><pre className="whitespace-pre-wrap break-words">{pending.prepared.options.systemPrompt}</pre><pre className="whitespace-pre-wrap break-words">{pending.prepared.options.userPrompt}</pre></div>
      <div className="flex gap-1"><button type="button" disabled={locked} onClick={()=>void send()} className="rounded bg-teal-700 px-2 py-1 text-white">确认发送自由任务</button><button type="button" onClick={()=>setPending(null)} className="rounded border px-2 py-1">取消预览</button></div>
    </section>}
    {result&&result.reply.kind==='text'&&<div className="space-y-2 rounded border border-slate-200 p-2"><div className="flex items-center gap-1 font-bold"><ClipboardList size={13}/>模型建议（不修改正文）</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{result.reply.text}</pre><p className="text-slate-500">模型分析不是独立事实证明。</p></div>}
    {result&&result.reply.kind==='proposals'&&<div className="space-y-2" aria-label="自由任务正文提案"><p aria-label="提案筛选说明" className="break-words rounded bg-amber-50 p-2 text-amber-900">{formatProposalDiagnostics(result.reply.diagnostics)}</p>
      {result.reply.proposals.map(p=><article key={p.id} className="rounded border border-slate-200 p-2 space-y-1"><div className="font-semibold">{p.label}</div><p>{p.reason}</p><p className="text-slate-500">事实引用：{p.factIds.join('、')||'无'}</p>{p.factIds.map(id=>{const index=/^record-(\d+)$/.exec(id);const record=index&&result.request.prepared.sourceMap[p.blockKey]?.some(s=>s.id===id&&s.scope==='record')?result.request.basis.records[Number(index[1])-1]:undefined;return record?<div key={id} className="rounded bg-amber-50 p-1 break-words">本地事实 {id}：{record.assertion}<div>本地证据：{record.evidenceRef}（本人确认，非独立验证）</div></div>:null;})}<div className="max-h-40 overflow-auto space-y-1"><pre className="whitespace-pre-wrap break-words rounded bg-slate-100 p-1.5">{p.originalText}</pre><pre className="whitespace-pre-wrap break-words rounded bg-emerald-50 p-1.5">{p.suggestedText}</pre></div>{p.factWarnings.map((w,i)=><p key={i} className="text-amber-800">{w.message}</p>)}<label className="flex items-start gap-1"><input type="checkbox" disabled={locked||p.suggestedText.includes(PRIVACY_PLACEHOLDER)} checked={accepted.includes(p.id)} onChange={e=>toggle(p,e.target.checked)}/>已核对本条原文、事实及候选正文，批准应用</label></article>)}
      <button type="button" disabled={locked||!accepted.length} onClick={()=>void renderReview()} className="rounded border border-teal-300 px-3 py-1.5 text-teal-800 disabled:opacity-50">试渲染已选正文提案</button>
      {rendering&&<div className="flex justify-between"><span>正在本地渲染前后 PDF…</span><button type="button" onClick={()=>renderAbort.current?.abort()} className="rounded border px-2 py-1">取消正文试渲染</button></div>}
      {review&&<><AiPdfComparisonView comparison={review.comparison}/><label className="flex items-start gap-2"><input type="checkbox" disabled={locked||!!review.comparison.blockers.length} checked={pdfConfirmed} onChange={e=>setPdfConfirmed(e.target.checked)}/>已检查正文修改后的真实 PDF 页面，确认应用当前选择。</label></>}
      <button type="button" disabled={locked||!accepted.length||!review||!pdfConfirmed||!!review.comparison.blockers.length||review.ids!==JSON.stringify([...accepted].sort())} onClick={()=>void apply()} className="rounded bg-teal-700 px-3 py-1.5 text-white disabled:opacity-50">应用已核对提案（{accepted.length}）</button>
    </div>}
  </section>;
}
