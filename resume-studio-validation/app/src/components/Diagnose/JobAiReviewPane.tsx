import { useStudioComponentSkins } from '../../studio-theme/StudioThemeProvider';
import { buttonSkin } from '../../studio-theme/componentSkins';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ResumeDocument} from '../../schema/resumeSchema';
import type {RequirementClause} from '../../lib/jobRequirements';
import {apiClient,localErrorMessage} from '../../lib/apiClient';
import {AiTaskReceiptView,receivedAiTask,failedAiTask,type AiTaskReceipt} from './AiTaskReceiptView';
import {assertAiPreviewSettings,describeAiRequest,requestByokCompletionWithReceipt,validateByokBaseUrl,type AiCompletionResult,type ByokAiSettings} from '../../lib/byokAiClient';
import {collectJobAiEvidence,prepareJobAiReview,parseJobAiReview,JOB_AI_ASSESSMENTS,JOB_AI_MAX_CLAUSES,JOB_AI_MAX_EVIDENCE,jobRewriteTargets,createJobRewriteDraft,type PreparedJobAiReview,type JobAiRow,type JobRewriteDraft} from '../../lib/jobAiReview';
import {ResumeAiAssistantPane,type AiTextReviewActions,type JobReviewApplyGuard} from './ResumeAiAssistantPane';

type Props={document:ResumeDocument;slug:string;source:string;clauses:readonly RequirementClause[];disabled:boolean;onReview:(clauseId:string)=>void;rewriteActions:AiTextReviewActions;jobApplyGuard:JobReviewApplyGuard};
type Basis=Pick<Props,'document'|'slug'|'source'|'clauses'>;
type Pending={basis:Basis;settings:ByokAiSettings;prepared:PreparedJobAiReview};
type Result={request:Pending;rows:JobAiRow[]};
const sameSettings=(a:ByokAiSettings,b:ByokAiSettings)=>JSON.stringify(a)===JSON.stringify(b);
const shortAssessment={supported:'支持线索',partial:'部分线索',gap:'未见依据',uncertain:'待核实','not-requirement':'非条件线索'} as const;
const priorityHints={mandatory:'硬条件线索',preferred:'优先条件线索',unknown:'条件类型待判定','not-requirement':'非条件线索'} as const;
const priorityOrder={mandatory:0,unknown:1,preferred:2,'not-requirement':3} as const;
function actionRows(rows:readonly JobAiRow[]){
  return rows.filter(r=>['gap','partial','uncertain'].includes(r.reviewAssessment)).sort((a,b)=>priorityOrder[a.clause.priorityHint]-priorityOrder[b.clause.priorityHint]);
}
export function JobAiReviewPane(props:Props){
  const skins=useStudioComponentSkins();
  const {document,slug,source,clauses}=props;
  const evidence=useMemo(()=>collectJobAiEvidence(document),[document]);
  const [clauseIds,setClauseIds]=useState<string[]>([]),[evidenceIds,setEvidenceIds]=useState<string[]>([]);
  const [settings,setSettings]=useState<ByokAiSettings|null>(null);
  const [pending,setPending]=useState<Pending|null>(null);
  const [result,setResult]=useState<Result|null>(null);
  const [rewrite,setRewrite]=useState<{draft:JobRewriteDraft;request:Pending}|null>(null);
  const rewriteElement=useRef<HTMLElement|null>(null);
  useEffect(()=>{if(rewrite)rewriteElement.current?.scrollIntoView({block:'start'});},[rewrite]);
  const [attempt,setAttempt]=useState<{basis:Basis;value:AiTaskReceipt}|null>(null);
  const [busy,setBusy]=useState<'load'|'send'|null>(null);
  const [error,setError]=useState('');
  const mounted=useRef(false),active=useRef(false),abort=useRef<AbortController|null>(null);
  const latest=useRef(props);latest.current=props;
  const current=(b:Basis)=>mounted.current&&latest.current.document===b.document&&latest.current.slug===b.slug&&latest.current.source===b.source&&latest.current.clauses===b.clauses;
  const basis=():Basis=>({document,slug,source,clauses});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();};},[]);
  useEffect(()=>{abort.current?.abort();setClauseIds([]);setEvidenceIds([]);setSettings(null);setPending(null);setResult(null);setAttempt(null);setRewrite(null);setError('');},[document,slug,source,clauses]);
  const clear=()=>{setPending(null);setResult(null);setAttempt(null);setRewrite(null);setError('');};
  const locked=!!busy||props.disabled||!!rewrite;
  const load=async()=>{
    if(active.current||props.disabled)return;
    const b=basis();active.current=true;setBusy('load');clear();setSettings(null);
    try{const s=await apiClient.getAiSettings();if(current(b))setSettings(s);}
    catch(e){if(current(b))setError(localErrorMessage(e,'读取已保存模型失败'));}
    finally{active.current=false;if(mounted.current)setBusy(null);}
  };
  const prepare=()=>{
    if(active.current||locked||!settings)return;clear();
    try{
      const prepared=prepareJobAiReview({document,source,clauseIds,evidenceIds});
      assertAiPreviewSettings(settings,prepared.options);
      setPending({basis:basis(),settings,prepared});
    }catch(e){setError(localErrorMessage(e,'准备岗位 AI 分析失败'));}
  };
  const send=async()=>{
    if(!pending||active.current||locked)return;
    const req=pending;setPending(null);setResult(null);setError('');
    if(!current(req.basis)){setError('岗位原文或简历已变化，请重新预览。');return;}
    const ctrl=new AbortController();abort.current=ctrl;active.current=true;setBusy('send');setAttempt(null);
    let reply:AiCompletionResult|undefined;
    try{
      const saved=await apiClient.getAiSettings();
      if(!sameSettings(saved,req.settings))throw new Error('已保存模型档案发生变化，请重新读取并预览。');
      if(ctrl.signal.aborted||!current(req.basis))return;
      reply=await requestByokCompletionWithReceipt({...req.prepared.options,settings:req.settings,signal:ctrl.signal});
      if(ctrl.signal.aborted||!current(req.basis))return;
      const after=await apiClient.getAiSettings();
      if(!sameSettings(after,req.settings))throw new Error('模型档案已变化，旧分析未展示。');
      if(ctrl.signal.aborted||!current(req.basis))return;
      setResult({request:req,rows:parseJobAiReview(reply.text,req.prepared)});setAttempt({basis:req.basis,value:receivedAiTask(reply)});
    }catch(e){if(!ctrl.signal.aborted&&current(req.basis)){setAttempt({basis:req.basis,value:failedAiTask(reply,e)});setError(localErrorMessage(e,'岗位 AI 分析失败'));}}
    finally{if(ctrl.signal.aborted&&current(req.basis))setAttempt({basis:req.basis,value:{status:'cancelled'}});abort.current=null;active.current=false;if(mounted.current)setBusy(null);}
  };
  const choose=(id:string,checked:boolean,kind:'clause'|'evidence')=>{
    clear();const setter=kind==='clause'?setClauseIds:setEvidenceIds;
    setter(old=>checked?[...old,id]:old.filter(x=>x!==id));
  };
  const openRewrite=(row:JobAiRow,blockKey:string)=>{
    if(locked||!result||!current(result.request.basis)||!result.rows.includes(row))return;
    try{setError('');setRewrite({draft:createJobRewriteDraft(document,source,row,blockKey),request:result.request});}
    catch(e){setError(localErrorMessage(e,'无法准备岗位定向改写'));}
  };
  if(!window.resumeDesktop?.ai)return null;
  return <details aria-label="岗位 AI 证据分析" className="space-y-2 rounded-lg border border-teal-200 bg-white p-3 text-[11px] text-slate-800 studio-ui-info-border studio-ui-surface studio-ui-primary">
    <summary data-studio-control="true" className="cursor-pointer font-bold text-teal-900 studio-ui-info">AI 岗位证据分析 · 只读建议（展开）</summary>
    <p>逐条对比公告条件和你明确选择的可见简历自述，给出逐字引用、缺口和待补材料。不作资格判定，不自动保存人工核对、不修改简历。本批不发送基本信息、独立事实库、附件或母库。</p>
    <div className="flex flex-wrap items-center gap-2"><button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={locked} onClick={()=>void load()} className="rounded border px-2 py-1 studio-ui-border">读取已保存岗位 AI 模型</button><span>{settings?(settings.enabled?settings.providerLabel+' · '+settings.model:'模型尚未启用，请前往 AI 润色设置'):'尚未读取模型'}</span></div>
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2"><strong>岗位条款 {clauseIds.length}/{clauses.length}（每批最多{JOB_AI_MAX_CLAUSES}）</strong><button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={locked||clauses.length>JOB_AI_MAX_CLAUSES} onClick={()=>{clear();setClauseIds(clauses.map(c=>c.id));}} className="rounded border px-2 py-1 studio-ui-border">选择全部条款</button><button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={locked} onClick={()=>{clear();setClauseIds([]);}} className="rounded border px-2 py-1 studio-ui-border">清空条款</button></div>
      {clauses.length>JOB_AI_MAX_CLAUSES&&<p>条款超过单批上限，请自行分批选择，未自动截断。</p>}
      <div className="max-h-40 space-y-1 overflow-auto rounded border bg-slate-50 p-2 studio-ui-raised studio-ui-border">{clauses.map(c=><label key={c.id} className="flex items-start gap-1"><input data-studio-control="true" type="checkbox" aria-label={'AI 条款 '+c.quote} disabled={locked||(!clauseIds.includes(c.id)&&clauseIds.length>=JOB_AI_MAX_CLAUSES)} checked={clauseIds.includes(c.id)} onChange={e=>choose(c.id,e.target.checked,'clause')}/><span>第 {c.line} 行 · {c.quote}</span></label>)}</div>
      <div className="flex flex-wrap items-center gap-2"><strong>可见简历自述 {evidenceIds.length}/{evidence.length}（每批最多{JOB_AI_MAX_EVIDENCE}）</strong><button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={locked||evidence.length>JOB_AI_MAX_EVIDENCE||!evidence.length} onClick={()=>{clear();setEvidenceIds(evidence.map(e=>e.id));}} className="rounded border px-2 py-1 studio-ui-border">选择全部可见自述</button><button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={locked} onClick={()=>{clear();setEvidenceIds([]);}} className="rounded border px-2 py-1 studio-ui-border">清空自述</button></div>
      <div className="max-h-44 space-y-1 overflow-auto rounded border bg-slate-50 p-2 studio-ui-raised studio-ui-border">{evidence.map(e=><label key={e.id} className="block rounded bg-white p-1 studio-ui-surface"><span className="flex items-start gap-1 font-semibold"><input data-studio-control="true" type="checkbox" aria-label={'AI 自述 '+e.label} disabled={locked||(!evidenceIds.includes(e.id)&&evidenceIds.length>=JOB_AI_MAX_EVIDENCE)} checked={evidenceIds.includes(e.id)} onChange={event=>choose(e.id,event.target.checked,'evidence')}/>{e.label}</span><span className="block whitespace-pre-wrap break-words">{e.text}</span></label>)}</div>
    </div>
    <div className="flex items-center gap-2"><button {...buttonSkin(skins,'primary')} data-studio-control="true" type="button" disabled={locked||!settings?.enabled||!clauseIds.length||!evidenceIds.length} onClick={prepare} className="rounded bg-teal-700 px-2 py-1 font-semibold text-white disabled:opacity-40 studio-ui-fill studio-ui-on-fill">预览岗位 AI 分析</button>{busy==='send'&&<button {...buttonSkin(skins)} data-studio-control="true" type="button" onClick={()=>abort.current?.abort()} className="rounded border px-2 py-1 studio-ui-border">取消岗位 AI 分析</button>}</div>
    {busy&&<p role="status">{busy==='load'?'读取本地模型档案…':'等待模型分析…'}</p>}
    {attempt&&current(attempt.basis)&&<AiTaskReceiptView label="岗位 AI 调用回执" attempt={attempt.value}/>}
    {error&&<p role="alert" className="rounded bg-red-50 p-2 text-red-800 studio-ui-error-surface studio-ui-error">{error}</p>}
    {pending&&current(pending.basis)&&<section aria-label="岗位 AI 发送预览" className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2 studio-ui-warning-border studio-ui-warning-surface">
      <strong>岗位 AI 发送前确认（尚未调用模型）</strong><p className="break-all">{pending.settings.providerLabel} · {pending.settings.model} · {validateByokBaseUrl(pending.settings.baseUrl).baseUrl}/chat/completions</p>
      <p>{describeAiRequest(pending.settings,pending.prepared.options)}</p><p>以下是实际消息，仍需检查自述与公告中的其他敏感信息。未发送事实库、档案及附件；引用只针对本次文字。</p>
      <div className="max-h-64 space-y-2 overflow-auto rounded bg-white p-2 studio-ui-surface"><pre className="whitespace-pre-wrap break-words">{pending.prepared.options.systemPrompt}</pre><pre className="whitespace-pre-wrap break-words">{pending.prepared.options.userPrompt}</pre></div>
      <div className="flex gap-2"><button {...buttonSkin(skins,'primary')} data-studio-control="true" type="button" disabled={locked} onClick={()=>void send()} className="rounded bg-teal-700 px-2 py-1 text-white studio-ui-fill studio-ui-on-fill">确认发送岗位 AI 分析</button><button {...buttonSkin(skins)} data-studio-control="true" type="button" onClick={()=>setPending(null)} className="rounded border px-2 py-1 studio-ui-border">取消岗位发送</button></div>
    </section>}
    {result&&current(result.request.basis)&&<section aria-label="岗位 AI 分析结果" className="space-y-2 rounded border border-teal-200 bg-teal-50/50 p-2 studio-ui-info-border studio-ui-info-surface">
      <strong>AI 建议 · {result.rows.length} 条（未经人工核对）</strong><div className="flex flex-wrap gap-1">{Object.entries(shortAssessment).map(([key,label])=><span key={key} className="rounded border bg-white px-1.5 py-1 studio-ui-surface studio-ui-border">{label} {result.rows.filter(r=>r.reviewAssessment===key).length}</span>)}</div>
      <p>逐字引用仅证明文字存在，不证明事实真实或满足招聘条件。未选中的自述、事实库和完整公告可能改变判断。请回到下方人工核对逐项确认。</p>
      <section aria-label="岗位待补材料清单" className="space-y-1 rounded border border-amber-200 bg-amber-50 p-2 studio-ui-warning-border studio-ui-warning-surface">
        <strong>待补材料与待核实项 · {actionRows(result.rows).length} 条</strong>
        <p className="text-slate-600 studio-ui-muted">按本地条件类型线索排列，仅供安排核对顺序；不是资格结论。</p>
        {actionRows(result.rows).length===0&&<p>本批没有模型标记的待补项；不代表招聘条件已满足。</p>}
        {actionRows(result.rows).map(r=><div key={r.clause.id} className="rounded border bg-white p-1.5 studio-ui-surface studio-ui-border" data-clause-id={r.clause.id}>
          <p className="font-semibold">{priorityHints[r.clause.priorityHint]} · {r.clause.quote}</p>
          {r.reviewAssessment!==r.assessment&&<p>· 核对引文的完整否定、角色及范围限定。</p>}
          {r.missing.map((m,j)=><p key={j} className="break-words">· {m}</p>)}
          <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={locked} onClick={()=>props.onReview(r.clause.id)} className="rounded border px-2 py-1 studio-ui-border">核对此项原文</button>
        </div>)}
      </section>
      {result.rows.map((r,i)=>{const targets=jobRewriteTargets(document,r);return <article key={r.clause.id} aria-label={'岗位 AI 建议 '+(i+1)} data-model-assessment={r.assessment} data-review-assessment={r.reviewAssessment} className="space-y-1 rounded border bg-white p-2 studio-ui-surface studio-ui-border">
        <p className="font-semibold">第 {r.clause.line} 行 · {r.clause.quote}</p><p className="text-slate-600 studio-ui-muted">本地提示：{priorityHints[r.clause.priorityHint]}（未经人工判定）</p>
        <p className="font-semibold text-teal-900 studio-ui-info">模型建议：{JOB_AI_ASSESSMENTS[r.assessment]}</p>{r.reviewAssessment!==r.assessment&&<p className="rounded bg-amber-100 p-1 font-semibold text-amber-900 studio-ui-warning-surface studio-ui-warning">本地提醒：引文可能截掉否定或角色限定，本条只计入待核实，不计入支持线索。请核对完整原文。</p>}
        <p className="whitespace-pre-wrap break-words">模型理由（未验证）：{r.reason}</p>
        {r.citations.map((c,j)=><div key={j} className="rounded bg-slate-50 p-1 studio-ui-raised"><p>逐字自述引用 · {c.evidence.label}</p><blockquote className="whitespace-pre-wrap break-words">{c.quote}</blockquote><details className="rounded border p-1 studio-ui-border"><summary data-studio-control="true" className="cursor-pointer">引文上下文（发送版本，节选；出现 {c.occurrences} 次）</summary><p className="whitespace-pre-wrap break-words">{c.context}</p></details>{c.caution&&<p className="text-amber-800 studio-ui-warning">来源含可能的否定、角色或范围限定，请核对上下文。{c.qualifierClipped&&<span className="block whitespace-pre-wrap">{c.context}</span>}</p>}</div>)}
        {!!r.missing.length&&<div><p className="font-semibold">待补／待核实</p>{r.missing.map((m,j)=><p key={j}>· {m}</p>)}</div>}
        <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={locked} onClick={()=>props.onReview(r.clause.id)} className="rounded border px-2 py-1 studio-ui-border">定位到人工核对</button>
        {targets.map(t=><button {...buttonSkin(skins)} data-studio-control="true" type="button" key={t.blockKey} disabled={locked} onClick={()=>openRewrite(r,t.blockKey)} className="block rounded border border-teal-300 px-2 py-1 text-teal-800 studio-ui-info-border studio-ui-info">准备本段定向改写 · {t.label}</button>)}
        {!targets.length&&r.reviewAssessment!=='not-requirement'&&<p className="text-slate-600 studio-ui-muted">{['gap','uncertain'].includes(r.reviewAssessment)?'先核对缺口或完整依据；本条不提供改写入口。':'本条没有当前可改写正文的逐字依据；学历、证书、标题等固定字段请人工核对，不通过正文补资质。'}</p>}
      </article>})}
    </section>}
    {rewrite&&current(rewrite.request.basis)&&<section ref={rewriteElement} aria-label="岗位定向改写工作区" className="space-y-2 rounded border-2 border-teal-300 bg-teal-50 p-2 studio-ui-info-border studio-ui-info-surface">
      <div className="flex items-start justify-between gap-2"><strong>岗位定向改写 · 独立任务</strong><button {...buttonSkin(skins)} data-studio-control="true" type="button" onClick={()=>setRewrite(null)} className="shrink-0 rounded border px-2 py-1 studio-ui-border">关闭定向改写</button></div>
      <p>仅准备本条公告与本段正文。原模型理由、缺口与核对审批不继承；不新增事实、资质或经历。采纳后简历变化，当前岗位核对会话将失效，请先归档需要保留的人工核对。</p>
      <ResumeAiAssistantPane {...props.rewriteActions} document={document} slug={slug} settings={rewrite.request.settings} jdText={rewrite.draft.clause.quote} jobScope={rewrite.draft} jobApplyGuard={props.jobApplyGuard} assertSettings={assertAiPreviewSettings}/>
    </section>}
  </details>;
}
