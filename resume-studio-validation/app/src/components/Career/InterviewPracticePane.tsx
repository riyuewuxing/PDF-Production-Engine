import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import type {ResumeDocument} from '../../schema/resumeSchema';
import {JobReviewArchiveSchema} from '../../schema/applicationSchema';
import {careerLedger} from '../../lib/careerLedgerSession';
import {visibleBasicValue} from '../../lib/aiContext';
import {interviewRole,preparePracticeQuestions,practiceHistory,type PreparedPractice} from '../../lib/interviewPractice';
import {localErrorMessage} from '../../lib/apiClient';

export function InterviewPracticePane({document,slug}:{document:ResumeDocument;slug:string}){
  const ledger=useSyncExternalStore(careerLedger.subscribe,careerLedger.getSnapshot);
  const [role,setRole]=useState('');
  const [archiveId,setArchiveId]=useState('');
  const archives=(ledger.data.jobReviews??[]).filter(a=>a.docId===document.id&&a.slug===slug);
  const archiveText=archiveId?JSON.stringify(archives.find(a=>a.id===archiveId)??null):'';
  const target=interviewRole(document,role);
  const basis=useMemo(()=>({document,slug,target,archiveText}),[document,slug,target,archiveText]);
  const [prepared,setPrepared]=useState<{basis:typeof basis;rows:PreparedPractice[];error?:string}|null>(null);
  useEffect(()=>{
    let alive=true;
    void (async()=>{
      try{
        const archive=basis.archiveText?JobReviewArchiveSchema.parse(JSON.parse(basis.archiveText)):undefined;
        const rows=await preparePracticeQuestions(basis.document,basis.slug,basis.target,archive);
        if(alive)setPrepared({basis,rows});
      }catch(e){if(alive)setPrepared({basis,rows:[],error:localErrorMessage(e,'无法核对面试练习依据')});}
    })();
    return()=>{alive=false;};
  },[basis]);
  const current=prepared?.basis===basis?prepared:null;
  const rows=current?.rows??[];
  const {history,legacy}=practiceHistory(ledger.data.interviewAnswers,document.id,slug,rows);
  const editable=!!current&&!current.error&&ledger.ready&&!ledger.loading;
  const answered=rows.filter(q=>ledger.data.interviewAnswers[q.answerKey]?.trim()).length;
  const write=(key:string,answer:string)=>{
    if(!editable||!rows.some(q=>q.answerKey===key))return;
    careerLedger.update(data=>({...data,interviewAnswers:{...data.interviewAnswers,[key]:answer}}));
  };
  return <section aria-label="本地面试练习" className="space-y-3">
    <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50 p-3">
      <strong className="text-teal-900">面试练习 · 本地生成，不调用 AI</strong>
      <label className="block">练习目标岗位<input aria-label="面试练习目标岗位" value={role} onChange={e=>setRole(e.target.value)} placeholder={visibleBasicValue(document,'title')||'目标岗位'} className="mt-1 w-full rounded border bg-white p-1.5"/></label>
      <p className="text-slate-600">当前目标：{target}。与自荐信目标独立；题目是练习建议，并非真实面试必问。只使用当前可见自述或明确选中的历史核对档案，不补造事实。</p>
      <label className="block">练习依据<select aria-label="面试练习依据" value={archiveId} onChange={e=>setArchiveId(e.target.value)} className="mt-1 w-full rounded border bg-white p-1.5">
        <option value="">当前可见简历自述</option>
        {archiveId&&!archives.some(a=>a.id===archiveId)&&<option value={archiveId}>所选历史档案已不存在</option>}
        {archives.map(a=><option key={a.id} value={a.id}>历史岗位核对 · {a.createdAt.slice(0,10)} · {a.rows.length}条 · {a.source.slice(0,45)}</option>)}
      </select></label>
      {!!archiveId&&<p className="rounded bg-amber-50 p-2 text-amber-900">使用历史档案原文和当时人工标记，不重新认定当前资格，不读取旧事实 ID 对应的当前事实；请回到岗位核对重新校验最新依据。当前输入岗位名仅用于区分练习草稿。</p>}
      <p role="status">{!current?'正在校验草稿依据…':current.error?'依据未通过校验':`已记录 ${answered}/${rows.length} 道练习；${ledger.error?'保存失败，草稿保留':ledger.dirty||ledger.saving?'正在等待台账保存':'以当前已读取台账为准'}`}</p>
    </div>
    {current?.error&&<p role="alert" className="rounded bg-red-50 p-2 text-red-800">{current.error}</p>}
    {current&&!current.error&&!rows.length&&<p>当前依据没有可练习的条件条款。</p>}
    {rows.map((q,i)=><article key={q.answerKey} aria-label={'面试练习题 '+(i+1)} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <p className="font-semibold"><span className="mr-1 rounded bg-teal-50 px-1 text-teal-800">Q{i+1} · {q.category}</span>{q.question}</p>
      <p className="text-slate-600">练习意图：{q.intent}</p>
      {q.historical&&<div className="rounded border border-amber-200 bg-amber-50 p-2"><strong>{q.historical.status}（历史记录）</strong><p>{q.historical.createdAt.slice(0,10)} · {q.historical.location}</p>{q.historical.note&&<p className="whitespace-pre-wrap break-words">当时人工备注：{q.historical.note}</p>}</div>}
      {q.sources.map(s=><details key={s.id} open={q.historical?true:undefined} className="rounded bg-slate-50 p-2"><summary className="cursor-pointer font-semibold">{q.historical?'历史条款原文':'当前可见自述 · '+s.label}</summary><p className="mt-1 whitespace-pre-wrap break-words">{s.text}</p><p className="text-slate-600">{q.historical?'历史公告节选，不是候选人事实。':'本人自述，非独立证明；请核对主体、时间及限定。'}</p></details>)}
      <ul className="list-disc space-y-0.5 pl-4 text-slate-600">{q.starHints.map((hint,j)=><li key={j}>{hint}</li>)}</ul>
      <textarea aria-label={'面试答案 '+(i+1)} rows={3} data-native-undo="true" disabled={!editable} value={ledger.data.interviewAnswers[q.answerKey]??''} onChange={e=>write(q.answerKey,e.target.value)} placeholder="填写本人核对的 STAR 提纲或逐字稿；无依据处保留待核实。" className="w-full rounded border bg-slate-50 p-2 text-slate-900"/>
    </article>)}
    {!!(history.length||legacy.length)&&<details aria-label="面试历史草稿" className="space-y-2 rounded border border-amber-200 bg-amber-50 p-2"><summary className="cursor-pointer font-semibold">历史／旧版草稿 · {history.length+legacy.length} 条（不自动套用）</summary>
      <p>更换岗位、依据或简历内容后，原草稿保留。旧版编号未绑定经历或文档身份，不推断其所属问题；请核对后手动复制需要的内容。</p>
      <div className="max-h-72 space-y-2 overflow-auto">
      {history.map(h=><article key={h.key} className="rounded border bg-white p-2"><strong>{h.meta.role} · {h.meta.question}</strong><textarea aria-label="历史面试答案" readOnly rows={3} value={h.answer} className="w-full rounded border p-1"/></article>)}
      {legacy.map(h=><article key={h.key} className="rounded border bg-white p-2"><strong>旧版未绑定 · {h.key.slice(slug.length+1)}</strong><textarea aria-label="旧版面试答案" readOnly rows={3} value={h.answer} className="w-full rounded border p-1"/></article>)}
      </div>
    </details>}
  </section>;
}
