import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {JobAiReviewPane} from './JobAiReviewPane';
import type {AiTextReviewActions,JobReviewApplyGuard} from './ResumeAiAssistantPane';
import {resumeRevision,type ResumeDocument} from '../../schema/resumeSchema';
import {ApplicationsStoreSchema,JobReviewArchiveSchema,MAX_JOB_REVIEW_ARCHIVES,type JobReviewArchive,type JobQueueTask} from '../../schema/applicationSchema';
import {jobPdfPageForRange,sameJobPdfOrigin,type JobPdfOrigin} from '../../schema/jobPdfSourceSchema';
import {careerLedger} from '../../lib/careerLedgerSession';
import type {FactBank} from '../../schema/factBankSchema';
import {loadLocalFactBank} from '../../lib/factSelection';
import {apiClient,isDesktopMode,localErrorMessage} from '../../lib/apiClient';
import {splitJobRequirements,collectLocalJobEvidence,evidenceKeywordHints,blankRequirementReview,validateRequirementReview,jobReviewBasisHash,sameJobReviewDocument,restoreArchivedJobReview,type RequirementClause,type RequirementReview,type RequirementPriority,type RequirementOutcome} from '../../lib/jobRequirements';

const priorityLabel:Record<RequirementPriority,string>={unknown:'待判定',mandatory:'硬条件',preferred:'优先条件','not-requirement':'非招聘条件'};
const outcomeLabel:Record<RequirementOutcome,string>={unchecked:'待核对',supported:'本人核对：已有自述依据',gap:'本人标记：存在缺口'};
function historicalClauses(a:JobReviewArchive){try{return new Map(splitJobRequirements(a.source).map(c=>[c.id,c]));}catch{return new Map<string,RequirementClause>();}}
type Props={document:ResumeDocument;slug:string;jdText:string;pdfOrigin?:JobPdfOrigin;onJdTextChange:(next:string,origin?:JobPdfOrigin)=>void;onFlush:()=>Promise<void>;getRevision:()=>string;rewriteActions?:AiTextReviewActions;queueTask?:JobQueueTask};
type Session={source:string;pdfOrigin?:JobPdfOrigin;doc:ResumeDocument;slug:string;clauses:RequirementClause[]};
export function JobRequirementsPane({document,slug,jdText,pdfOrigin,onJdTextChange,onFlush,getRevision,rewriteActions,queueTask}:Props){
  const desktop=isDesktopMode();
  const ledger=useSyncExternalStore(careerLedger.subscribe,careerLedger.getSnapshot);
  const [applicationId,setApplicationId]=useState('');
  const [showAllArchives,setShowAllArchives]=useState(false);
  const canUseLedger=desktop&&ledger.ready&&!ledger.dirty&&!ledger.saving&&!ledger.loading&&!ledger.error;
  const scopeArchives=(ledger.data.jobReviews??[]).filter(a=>a.queueTaskId===queueTask?.id);
  const archives=scopeArchives.filter(a=>a.slug===slug&&a.docId===document.id);
  const visibleArchives=showAllArchives&&!queueTask?scopeArchives:archives;
  const eligibleApplications=ledger.data.applications.filter(a=>a.queueTaskId===queueTask?.id&&a.resumeSlug===slug&&a.jdText===jdText&&!!a.snapshotId);
  useEffect(()=>{if(desktop&&!queueTask)void careerLedger.load().catch(()=>{});},[desktop,queueTask]);
  const [session,setSession]=useState<Session|null>(null);
  const [bank,setBank]=useState<FactBank|null>(null);
  const [reviews,setReviews]=useState<Record<string,RequirementReview>>({});
  const [active,setActive]=useState('');
  const [draft,setDraft]=useState<RequirementReview>(blankRequirementReview);
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [checkedAt,setCheckedAt]=useState('');
  const guard=useRef(false),mounted=useRef(false);
  const latest=useRef({document,slug,jdText,pdfOrigin});latest.current={document,slug,jdText,pdfOrigin};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setSession(null);setBank(null);setReviews({});setActive('');setDraft(blankRequirementReview());setQuery('');setNotice('');setError('');setCheckedAt('');setApplicationId('');},[document,slug,jdText,pdfOrigin]);
  const current=!!session&&session.source===jdText&&session.doc===document&&session.slug===slug&&sameJobPdfOrigin(session.pdfOrigin,pdfOrigin);
  const clause=current?session.clauses.find(c=>c.id===active):undefined;
  const evidence=useMemo(()=>collectLocalJobEvidence(document,bank),[document,bank]);
  const filtered=useMemo(()=>{
    if(!clause)return [];
    const q=query.trim().toLocaleLowerCase();
    return evidence.map(e=>({e,hints:evidenceKeywordHints(clause,e)}))
      .filter(({e})=>!q||[e.label,e.text,e.reference].filter(Boolean).join(' ').toLocaleLowerCase().includes(q)||draft.evidenceIds.includes(e.id))
      .sort((a,b)=>Number(draft.evidenceIds.includes(b.e.id))-Number(draft.evidenceIds.includes(a.e.id))||b.hints.length-a.hints.length);
  },[clause,evidence,query,draft.evidenceIds]);
  const task=async(work:()=>Promise<void>)=>{
    if(guard.current)return;
    guard.current=true;setBusy(true);setError('');setNotice('');
    try{await work();}catch(e){if(mounted.current)setError(localErrorMessage(e,'本地岗位核对失败'));}
    finally{guard.current=false;if(mounted.current)setBusy(false);}
  };
  const stillCurrent=(s:Session)=>mounted.current&&latest.current.document===s.doc&&latest.current.jdText===s.source&&latest.current.slug===s.slug&&sameJobPdfOrigin(latest.current.pdfOrigin,s.pdfOrigin);
  const analyze=()=>{
    if(guard.current)return;
    try{const clauses=splitJobRequirements(jdText);setSession({source:jdText,pdfOrigin,doc:document,slug,clauses});setBank(null);setReviews({});setDraft(blankRequirementReview());setActive(clauses[0]?.id??'');setQuery('');setCheckedAt('');setError('');setNotice('已按原文分段，尚未作资格判断。');}
    catch(e){setSession(null);setError(localErrorMessage(e,'岗位原文无法分析'));}
  };
  const load=()=>{
    if(!session||!current)return;
    const s=session;
    void task(async()=>{
      let fresh:FactBank;
      try{fresh=await loadLocalFactBank();}catch(e){if(stillCurrent(s)){setBank(null);setReviews({});setDraft(blankRequirementReview());setCheckedAt('');}throw e;}
      if(!stillCurrent(s))return;
      const changed=!!bank&&bank.revision!==fresh.revision;
      if(changed){setReviews({});setDraft(blankRequirementReview());}
      setBank(fresh);setCheckedAt(new Date().toLocaleString());
      setNotice(changed?'事实库版本已变化，旧核对记录已清空。':'已加载本地有效原始事实，尚未自动选中任何依据。');
    });
  };
  const select=(id:string)=>{setActive(id);setDraft(reviews[id]??blankRequirementReview());setQuery('');setNotice('');setError('');};
  const save=()=>{
    if(!session||!current||!clause)return;
    const s=session,c=clause,proposed=draft;
    void task(async()=>{
      if(bank){
        let fresh:FactBank;
        try{fresh=await loadLocalFactBank();}
        catch(e){if(stillCurrent(s)){setBank(null);setReviews({});setDraft(blankRequirementReview());setCheckedAt('');}throw e;}
        if(!stillCurrent(s))return;
        if(fresh.revision!==bank.revision){setBank(fresh);setReviews({});setDraft(blankRequirementReview());setCheckedAt(new Date().toLocaleString());throw new Error('事实库版本已变化，旧核对记录已清空，请重新选择依据。');}
        setCheckedAt(new Date().toLocaleString());
      }
      const approved=validateRequirementReview(proposed,evidence);
      if(!stillCurrent(s))return;
      setReviews(old=>({...old,[c.id]:approved}));setDraft(approved);setNotice('已记录该条人工核对结果（仅本次会话，不修改简历）。');
    });
  };
  const requireLedger=()=>{
    const state=careerLedger.getSnapshot();
    if(!desktop||!state.ready||state.loading||state.saving||state.dirty||state.error)throw new Error('本地投递台账尚未就绪，请先处理保存或重载。');
    return state.data;
  };
  const readDiskBasis=async(s:Session,wantsFacts:boolean)=>{
    if(!desktop||!s.slug)throw new Error('本地档案仅支持桌面工作台。');
    await onFlush();
    if(!stillCurrent(s))throw new Error('岗位原文或当前简历已变化。');
    const revision=getRevision(),doc=await apiClient.getResume(s.slug);
    if(resumeRevision(doc)!==revision||!sameJobReviewDocument(s.doc,doc))throw new Error('磁盘简历与当前编辑版本不一致，请重载后重新核对。');
    const fresh=wantsFacts?await loadLocalFactBank():null;
    if(!stillCurrent(s)||getRevision()!==revision)throw new Error('核对期间简历或岗位已变化。');
    return {doc,revision,fresh};
  };
  const commitArchive=()=>{
    if(!session||!current||!Object.keys(reviews).length)return;
    const s=session,selected=applicationId,records=reviews,oldBank=bank;
    void task(async()=>{
      const before=requireLedger();
      if((before.jobReviews??[]).length>=MAX_JOB_REVIEW_ARCHIVES)throw new Error('本地岗位核对档案已达40份，请明确删除不需要的旧档案。');
      const {doc,revision,fresh}=await readDiskBasis(s,!!oldBank);
      const hash=await jobReviewBasisHash(doc,fresh,s.source,s.pdfOrigin);
      if((oldBank?.revision??null)!==(fresh?.revision??null)||await jobReviewBasisHash(s.doc,oldBank,s.source,s.pdfOrigin)!==hash){
        if(stillCurrent(s)){setBank(fresh);setReviews({});setDraft(blankRequirementReview());setCheckedAt('');}
        throw new Error('核对依据已变化，旧核对记录已清空，请重新核对。');
      }
      const linked=selected?before.applications.find(a=>a.id===selected):undefined;
      if(selected){
        if(!linked||linked.queueTaskId!==queueTask?.id||!linked.snapshotId||linked.resumeSlug!==s.slug||linked.jdText!==s.source)throw new Error('投递记录与岗位原文或版本不一致，未关联。');
        const snap=await apiClient.getApplicationSnapshot(linked.snapshotId);
        if(snap.meta.queueTaskId!==queueTask?.id||snap.meta.applicationId!==linked.id||snap.meta.resumeSlug!==s.slug||!sameJobReviewDocument(snap.document,doc))throw new Error('永久投递快照与当前简历内容不一致，不能关联。');
      }
      const archive=JobReviewArchiveSchema.parse({reviewVersion:1,...(queueTask?{queueTaskId:queueTask.id}:{}),id:crypto.randomUUID(),slug:s.slug,docId:doc.id,documentRevision:revision,factRevision:fresh?.revision??null,basisHash:hash,source:s.source,pdfOrigin:s.pdfOrigin,createdAt:new Date().toISOString(),applicationId:linked?.id??null,snapshotId:linked?.snapshotId??null,rows:Object.entries(records).map(([clauseId,review])=>({clauseId,review}))});
      await restoreArchivedJobReview(archive,doc,fresh,revision);
      if(!stillCurrent(s)||getRevision()!==revision||requireLedger().revision!==before.revision)throw new Error('岗位、简历或台账已变化，未保存档案。');
      const proposed=[archive,...(before.jobReviews??[])];
      if(!ApplicationsStoreSchema.safeParse({...before,jobReviews:proposed}).success)throw new Error('岗位核对档案达到容量限制或数据无效，未写入。');
      if(!careerLedger.update(d=>({...d,jobReviews:proposed})))throw new Error('台账忙，未保存档案。');
      await careerLedger.flush();
      const confirmed=careerLedger.getSnapshot();
      if(confirmed.dirty||!confirmed.data.jobReviews?.some(a=>a.id===archive.id))throw new Error('档案尚未获得磁盘保存确认。');
      if(stillCurrent(s))setNotice('已确认保存本地岗位核对档案'+(linked?'，并关联已核对的永久投递快照。':'（未关联投递）。'));
    });
  };
  const restoreArchive=(archive:JobReviewArchive)=>{
    if(archive.queueTaskId!==queueTask?.id||archive.source!==jdText||archive.slug!==slug||archive.docId!==document.id||!sameJobPdfOrigin(archive.pdfOrigin,pdfOrigin))return;
    const s:Session={source:jdText,pdfOrigin,doc:document,slug,clauses:[]};
    void task(async()=>{
      requireLedger();
      // Clear the active session before trying to restore, never leave a failed historical review displayed as current.
      setSession(null);setBank(null);setReviews({});setDraft(blankRequirementReview());setActive('');setCheckedAt('');
      const {doc,revision,fresh}=await readDiskBasis(s,archive.factRevision!==null);
      const disk=await apiClient.getApplications();
      if(!disk.jobReviews?.some(a=>a.id===archive.id&&JSON.stringify(a)===JSON.stringify(archive)))throw new Error('磁盘档案已经变化或被删除，请刷新档案。');
      const restored=await restoreArchivedJobReview(archive,doc,fresh,revision);
      if(!stillCurrent(s)||getRevision()!==revision)return;
      const clauses=splitJobRequirements(s.source),first=clauses.find(c=>restored[c.id])?.id??'';
      setSession({...s,clauses});setBank(fresh);setReviews(restored);setActive(first);setDraft(restored[first]??blankRequirementReview());setQuery('');
      setCheckedAt(fresh?new Date().toLocaleString():'');
      setNotice('已重新校验版本、原文与依据并恢复本地核对档案。');
    });
  };
  const deleteArchive=(archive:JobReviewArchive)=>{
    if(!window.confirm('删除这份本地岗位核对档案？不会删除简历、事实、投递记录或永久快照。'))return;
    void task(async()=>{
      requireLedger();
      if(!careerLedger.update(d=>({...d,jobReviews:(d.jobReviews??[]).filter(a=>a.id!==archive.id)})))throw new Error('台账忙，未删除档案。');
      await careerLedger.flush();
      if(careerLedger.getSnapshot().dirty||careerLedger.getSnapshot().data.jobReviews?.some(a=>a.id===archive.id))throw new Error('删除尚未获得磁盘确认。');
      if(mounted.current)setNotice('已删除本地岗位核对档案。');
    });
  };
  const toggle=(id:string,on:boolean)=>setDraft(d=>({...d,evidenceIds:on?[...d.evidenceIds,id]:d.evidenceIds.filter(x=>x!==id)}));
  const totals=Object.values(reviews);
  // The asynchronous apply operation must not discard a newer manual-review draft or an in-flight archive operation.
  const manualBasis=useRef({current,reviews,draft,active});manualBasis.current={current,reviews,draft,active};
  const manualSignature=()=>JSON.stringify([manualBasis.current.reviews,manualBasis.current.active,manualBasis.current.draft]);
  const jobApplyGuard:JobReviewApplyGuard={
    confirm:()=>{
      const m=manualBasis.current;
      if(!mounted.current||!m.current||guard.current)return null;
      const count=Object.keys(m.reviews).length,dirtyDraft=JSON.stringify(m.draft)!==JSON.stringify(m.reviews[m.active]??blankRequirementReview());
      if((count||dirtyDraft)&&!window.confirm('采纳正文后，本次岗位核对会话将失效（'+count+' 条已记录；'+(dirtyDraft?'另有未记录草稿':'无额外草稿')+'）。已归档历史不受影响；如需保留，请先取消并保存本地核对档案。确认继续？'))return null;
      return manualSignature();
    },
    isCurrent:token=>mounted.current&&manualBasis.current.current&&!guard.current&&manualSignature()===token,
  };
  return <section aria-label="岗位原文与证据核对" className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-xs break-words">
    <div className="font-bold text-indigo-900">岗位原文与证据核对（离线）</div>
    <p>按原文行、分号和句号列出候选条款，保留原文位置。关键词只是检索线索，不是资格判定；复合条件、例外、专业目录与公告上下文须人工核对。</p>
    <p>只读当前可见简历自述和明确加载的有效原始事实（含仅本地记录），不读附件正文、不联网、不修改简历。跨版本关联事实暂不参与此项核对。</p>
    <button type="button" disabled={busy||!jdText.trim()} onClick={analyze} className="rounded bg-indigo-700 px-2 py-1 text-white disabled:opacity-40">分析岗位原文</button>
    {error&&<div role="alert" className="rounded bg-red-50 p-2 text-red-800">{error}</div>}
    {notice&&<div role="status" className="text-teal-800">{notice}</div>}
    {desktop&&<div className="space-y-2 rounded border border-indigo-200 bg-white p-2" aria-label="本地岗位核对档案">
      <div className="font-semibold">本地核对档案 · 当前简历 {archives.length} 份 / 全部 {(ledger.data.jobReviews??[]).length}/{MAX_JOB_REVIEW_ARCHIVES}</div>
      <p>历史档案不会自动成为当前结论；恢复时重新校验原文、版本、事实和内容。仅本地保存，不进入模型请求。</p>
      {!canUseLedger&&<p className="text-amber-800">{ledger.error||'台账尚未就绪或存在未保存草稿。'} 请在投递台账处理保存、重试或重载。</p>}
      <button type="button" disabled={busy||ledger.loading||ledger.saving||ledger.dirty} onClick={()=>void task(async()=>{await careerLedger.load();setNotice('已读取本地核对档案。');})} className="rounded border px-2 py-1">刷新本地核对档案</button>
      {!queueTask&&<label className="flex items-center gap-1"><input type="checkbox" checked={showAllArchives} disabled={busy} onChange={e=>setShowAllArchives(e.target.checked)}/>显示全部简历版本的历史档案</label>}
      {queueTask&&<p>仅显示当前岗位任务的核对档案，不会载入其他岗位的原文或记录。</p>}
      {visibleArchives.map(a=>{const clauses=historicalClauses(a);return <div key={a.id} className="space-y-1 rounded border p-2">
        <div className="font-medium">{new Date(a.createdAt).toLocaleString()} · {a.rows.length} 条人工核对 · {a.slug===slug&&a.docId===document.id?'当前简历':a.slug+'（其他版本）'}</div>
        {a.pdfOrigin&&<p className="text-indigo-800">PDF 提取来源：{a.pdfOrigin.fileName} · 第 {a.pdfOrigin.pages.map(p=>p.page).join('、')} 页 / 共 {a.pdfOrigin.totalPages} 页（历史选择）</p>}
        <p className="whitespace-pre-wrap">{a.source.slice(0,180)}{a.source.length>180?'…':''}</p>
        <p className="text-slate-600">{a.applicationId?'历史关联投递及永久快照':'未关联投递'} · {a.factRevision?'绑定独立事实库':'仅简历自述'}</p>
        <details className="rounded bg-slate-50 p-2" aria-label="历史岗位核对内容">
          <summary className="cursor-pointer font-medium">查看历史核对内容（非当前结论）</summary>
          <div className="max-h-60 space-y-2 overflow-auto pt-2">
            <p className="whitespace-pre-wrap">{a.source}</p>
            {a.rows.map(({clauseId,review})=>{const clause=clauses.get(clauseId);const page=clause?jobPdfPageForRange(a.pdfOrigin,clause.start,clause.end):undefined;return <div key={clauseId} className="rounded border bg-white p-2"><div className="font-semibold">{priorityLabel[review.priority]} · {outcomeLabel[review.outcome]}</div><p className="whitespace-pre-wrap">{page!==undefined?'PDF 第 '+page+' 页 · ':''}{clause?.quote??'历史条款位置无法核实'}</p><p className="whitespace-pre-wrap text-slate-600">历史选择 {review.evidenceIds.length} 条依据（不代表当前有效） · {review.note}</p></div>})}
          </div>
        </details>
        <div className="flex flex-wrap gap-1">
          {!queueTask&&<button type="button" disabled={busy||!canUseLedger||a.slug!==slug||a.docId!==document.id} onClick={()=>onJdTextChange(a.source,a.pdfOrigin)} className="rounded border px-2 py-1">载入档案原文</button>}
          <button type="button" disabled={busy||!canUseLedger||a.source!==jdText||!sameJobPdfOrigin(a.pdfOrigin,pdfOrigin)||a.slug!==slug||a.docId!==document.id} onClick={()=>restoreArchive(a)} className="rounded border px-2 py-1">恢复档案核对</button>
          <button type="button" disabled={busy||!canUseLedger} onClick={()=>deleteArchive(a)} className="rounded border px-2 py-1 text-red-700">删除核对档案</button>
        </div>
      </div>})}
    </div>}
    {current&&<>
      {!queueTask&&rewriteActions&&<JobAiReviewPane document={document} slug={slug} source={session.source} clauses={session.clauses} disabled={busy} rewriteActions={rewriteActions} jobApplyGuard={jobApplyGuard} onReview={id=>{select(id);requestAnimationFrame(()=>window.document.querySelector('[aria-label="岗位条款原文"]')?.scrollIntoView({block:'center'}));}}/>}
      <div className="flex flex-wrap gap-2 text-slate-700"><span>候选 {session.clauses.length} 条</span><span>已记录 {totals.length} 条</span><span>本人标记硬条件 {totals.filter(r=>r.priority==='mandatory').length}</span><span>自述支持 {totals.filter(r=>r.outcome==='supported').length}</span><span>缺口 {totals.filter(r=>r.outcome==='gap').length}</span></div>
      <button type="button" disabled={busy||!window.resumeDesktop?.facts} onClick={load} className="rounded border bg-white px-2 py-1">加载 / 刷新岗位事实依据</button>
      <div className="text-slate-600">{bank?'本地事实版本已读取：'+checkedAt:'尚未加载独立事实库，仅显示简历自述。'} 事实库变化后请刷新；保存核对结果时再次校验已加载的版本。</div>
      <label className="block">选择候选条款<select aria-label="岗位候选条款" disabled={busy} value={active} onChange={e=>select(e.target.value)} className="mt-1 w-full rounded border bg-white p-1.5">
        {session.clauses.map((c,i)=>{const page=jobPdfPageForRange(pdfOrigin,c.start,c.end);return <option key={c.id} value={c.id}>{i+1}. {page!==undefined?'PDF 第 '+page+' 页 · 提取文本':''}第 {c.line} 行 · {c.quote.slice(0,68)}{reviews[c.id]?' · 已记录':''}</option>})}
      </select></label>
      {clause&&<div className="space-y-2 rounded border border-indigo-200 bg-white p-2">
        <div className="font-semibold">原文定位：{jobPdfPageForRange(pdfOrigin,clause.start,clause.end)!==undefined&&<span aria-label="公告 PDF 页码">PDF 第 {jobPdfPageForRange(pdfOrigin,clause.start,clause.end)} 页 · 确认提取文本</span>}第 {clause.line} 行 · 字符区间 [{clause.start}, {clause.end})</div>
        <blockquote aria-label="岗位条款原文" className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-900">{clause.quote}</blockquote>
        <p>类别线索：{clause.categories.join(' / ')} · 规则提示：{priorityLabel[clause.priorityHint]}（未自动采纳）</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label>本人判定条件类型<select aria-label="岗位条件类型" disabled={busy} value={draft.priority} onChange={e=>{const priority=e.target.value as RequirementPriority;setDraft(d=>priority==='not-requirement'?{...d,priority,outcome:'unchecked',evidenceIds:[]}:{...d,priority});}} className="mt-1 w-full rounded border p-1.5">{Object.entries(priorityLabel).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
          <label>本人核对结果<select aria-label="岗位核对结果" disabled={busy||draft.priority==='not-requirement'} value={draft.outcome} onChange={e=>setDraft(d=>({...d,outcome:e.target.value as RequirementOutcome}))} className="mt-1 w-full rounded border p-1.5">{Object.entries(outcomeLabel).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
        </div>
        {draft.priority!=='not-requirement'&&<>
          <label className="block">本地依据搜索<input aria-label="搜索岗位依据" disabled={busy} value={query} onChange={e=>setQuery(e.target.value)} placeholder="学校、证书、经历或来源" className="mt-1 w-full rounded border p-1.5"/></label>
          <div className="text-slate-600">本次选择 {draft.evidenceIds.length}/5；词语相同也可能是否定或无关陈述。必须阅读原文。</div>
          <div aria-label="岗位本地依据列表" className="max-h-52 space-y-1 overflow-auto">
            {!filtered.length&&<p>无匹配本地依据，仍可标记待核对或缺口。</p>}
            {filtered.map(({e,hints})=><label key={e.id} className="block rounded border p-2">
              <span className="flex items-start gap-1 font-semibold"><input type="checkbox" aria-label={'岗位依据 '+e.label+' '+e.text.slice(0,100)} disabled={busy||(!draft.evidenceIds.includes(e.id)&&draft.evidenceIds.length>=5)} checked={draft.evidenceIds.includes(e.id)} onChange={event=>toggle(e.id,event.target.checked)}/>{e.kind==='fact'?'本人确认事实（非独立鉴真）':'简历自述'} · {e.label}</span>
              <span className="block whitespace-pre-wrap">{e.text}</span>
              {!!e.reference&&<span className="block text-slate-600">本地来源：{e.reference}</span>}
              {!!hints.length&&<span className="block text-indigo-800">文字线索：{hints.join('、')}</span>}
            </label>)}
          </div>
        </>}
        <label className="block">核对说明（选填）<textarea aria-label="岗位核对说明" rows={2} maxLength={500} disabled={busy} value={draft.note} onChange={e=>setDraft(d=>({...d,note:e.target.value}))} className="mt-1 w-full rounded border p-1.5"/></label>
        <button type="button" disabled={busy||(draft.outcome==='supported'&&!draft.evidenceIds.length)} onClick={save} className="rounded bg-indigo-700 px-2 py-1 text-white disabled:opacity-40">记录本条人工核对</button>
      </div>}
      <div className="space-y-1" aria-label="岗位核对记录">
        {session.clauses.filter(c=>reviews[c.id]).map(c=>{const review=reviews[c.id]!;return <button type="button" key={c.id} disabled={busy} onClick={()=>select(c.id)} className="block w-full rounded border bg-white p-2 text-left">
          <span className="font-semibold">{priorityLabel[review.priority]} · {outcomeLabel[review.outcome]}</span><span className="block whitespace-pre-wrap">{jobPdfPageForRange(pdfOrigin,c.start,c.end)!==undefined?'PDF 第 '+jobPdfPageForRange(pdfOrigin,c.start,c.end)+' 页 · 确认提取文本': ''}第 {c.line} 行：{c.quote}</span><span className="block text-slate-600">{review.evidenceIds.length} 条本地依据 · {review.note}</span>
        </button>;})}
      </div>
      {desktop&&<div className="space-y-1 rounded border bg-white p-2">
        <label className="block">可选：关联已有永久投递快照<select aria-label="关联岗位核对投递" disabled={busy||!canUseLedger} value={applicationId} onChange={e=>setApplicationId(e.target.value)} className="mt-1 w-full rounded border p-1.5">
          <option value="">不关联投递</option>
          {eligibleApplications.map(a=><option key={a.id} value={a.id}>{a.company} · {a.role} · {a.appliedDate}</option>)}
        </select></label>
        <p className="text-slate-600">只列出同一简历、原文完全一致且已有永久快照的投递；保存时还会核对快照内容。不会创建或发送投递。</p>
        <button type="button" disabled={busy||!canUseLedger||!totals.length} onClick={commitArchive} className="rounded bg-indigo-700 px-2 py-1 text-white disabled:opacity-40">保存本次核对到本地</button>
      </div>}
      <p className="text-slate-600">逐条记录先保存在本次会话；修改 JD、切换简历、离页或重新分析会清空会话结果。明确保存的历史档案保留，非招聘资格结论。</p>
    </>}
  </section>;
}
