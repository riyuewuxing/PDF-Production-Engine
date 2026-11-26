import {useEffect,useMemo,useRef,useState} from 'react';
import type {ResumeDocument} from '../../schema/resumeSchema';
import type {FactBank} from '../../schema/factBankSchema';
import {loadLocalFactBank} from '../../lib/factSelection';
import {localErrorMessage} from '../../lib/apiClient';
import {splitJobRequirements,collectLocalJobEvidence,evidenceKeywordHints,blankRequirementReview,validateRequirementReview,type RequirementClause,type RequirementReview,type RequirementPriority,type RequirementOutcome} from '../../lib/jobRequirements';

const priorityLabel:Record<RequirementPriority,string>={unknown:'待判定',mandatory:'硬条件',preferred:'优先条件','not-requirement':'非招聘条件'};
const outcomeLabel:Record<RequirementOutcome,string>={unchecked:'待核对',supported:'本人核对：已有自述依据',gap:'本人标记：存在缺口'};
type Props={document:ResumeDocument;slug:string;jdText:string};
type Session={source:string;doc:ResumeDocument;slug:string;clauses:RequirementClause[]};
export function JobRequirementsPane({document,slug,jdText}:Props){
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
  const latest=useRef({document,slug,jdText});latest.current={document,slug,jdText};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setSession(null);setBank(null);setReviews({});setActive('');setDraft(blankRequirementReview());setQuery('');setNotice('');setError('');setCheckedAt('');},[document,slug,jdText]);
  const current=!!session&&session.source===jdText&&session.doc===document&&session.slug===slug;
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
  const stillCurrent=(s:Session)=>mounted.current&&latest.current.document===s.doc&&latest.current.jdText===s.source&&latest.current.slug===s.slug;
  const analyze=()=>{
    if(guard.current)return;
    try{const clauses=splitJobRequirements(jdText);setSession({source:jdText,doc:document,slug,clauses});setBank(null);setReviews({});setDraft(blankRequirementReview());setActive(clauses[0]?.id??'');setQuery('');setCheckedAt('');setError('');setNotice('已按原文分段，尚未作资格判断。');}
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
  const toggle=(id:string,on:boolean)=>setDraft(d=>({...d,evidenceIds:on?[...d.evidenceIds,id]:d.evidenceIds.filter(x=>x!==id)}));
  const totals=Object.values(reviews);
  return <section aria-label="岗位原文与证据核对" className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-xs break-words">
    <div className="font-bold text-indigo-900">岗位原文与证据核对（离线）</div>
    <p>按原文行、分号和句号列出候选条款，保留原文位置。关键词只是检索线索，不是资格判定；复合条件、例外、专业目录与公告上下文须人工核对。</p>
    <p>只读当前可见简历自述和明确加载的有效原始事实（含仅本地记录），不读附件正文、不联网、不修改简历。跨版本关联事实暂不参与此项核对。</p>
    <button type="button" disabled={busy||!jdText.trim()} onClick={analyze} className="rounded bg-indigo-700 px-2 py-1 text-white disabled:opacity-40">分析岗位原文</button>
    {error&&<div role="alert" className="rounded bg-red-50 p-2 text-red-800">{error}</div>}
    {notice&&<div role="status" className="text-teal-800">{notice}</div>}
    {current&&<>
      <div className="flex flex-wrap gap-2 text-slate-700"><span>候选 {session.clauses.length} 条</span><span>已记录 {totals.length} 条</span><span>本人标记硬条件 {totals.filter(r=>r.priority==='mandatory').length}</span><span>自述支持 {totals.filter(r=>r.outcome==='supported').length}</span><span>缺口 {totals.filter(r=>r.outcome==='gap').length}</span></div>
      <button type="button" disabled={busy||!window.resumeDesktop?.facts} onClick={load} className="rounded border bg-white px-2 py-1">加载 / 刷新岗位事实依据</button>
      <div className="text-slate-600">{bank?'本地事实版本已读取：'+checkedAt:'尚未加载独立事实库，仅显示简历自述。'} 事实库变化后请刷新；保存核对结果时再次校验已加载的版本。</div>
      <label className="block">选择候选条款<select aria-label="岗位候选条款" disabled={busy} value={active} onChange={e=>select(e.target.value)} className="mt-1 w-full rounded border bg-white p-1.5">
        {session.clauses.map((c,i)=><option key={c.id} value={c.id}>{i+1}. 第 {c.line} 行 · {c.quote.slice(0,68)}{reviews[c.id]?' · 已记录':''}</option>)}
      </select></label>
      {clause&&<div className="space-y-2 rounded border border-indigo-200 bg-white p-2">
        <div className="font-semibold">原文定位：第 {clause.line} 行 · 字符区间 [{clause.start}, {clause.end})</div>
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
          <span className="font-semibold">{priorityLabel[review.priority]} · {outcomeLabel[review.outcome]}</span><span className="block whitespace-pre-wrap">第 {c.line} 行：{c.quote}</span><span className="block text-slate-600">{review.evidenceIds.length} 条本地依据 · {review.note}</span>
        </button>;})}
      </div>
      <p className="text-slate-600">结果为本次会话人工核对记录，非招聘资格结论；修改 JD、切换简历、离开此页或重新分析会清空，不会自动投递。</p>
    </>}
  </section>;
}
