import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, RefreshCw, X } from 'lucide-react';
import {samePdfReceipt,type ApplicationSnapshotLink,type JobApplication } from '../../schema/applicationSchema';
import type { ResumeDocument, ResumeSummary } from '../../schema/resumeSchema';
import type { ResumeSnapshotMeta } from '../../server/localFsApi';
import { apiClient, localErrorMessage } from '../../lib/apiClient';
import { compareResumeDocuments, type ComparisonCategory, type ComparisonKind, type ComparisonValue, type ResumeComparison } from '../../lib/resumeComparison';

type Target={key:string;label:string;slug:string;docId:string;kind:'disk'|'snapshot'|'memory';snapshot?:ResumeSnapshotMeta};
type Loaded={key:string;targetDocId:string;targetSnapshotTime?:string;baselineTitle:string;baselineTime:string;targetTitle:string;targetTime:string;capturedAt:string;diff:ResumeComparison};
export type ApplicationReviewSource=Pick<JobApplication,'id'|'snapshotId'|'resumeSlug'|'company'|'role'|'exportedFilePath'|'atsScore'|'pdfReceipt'>&{ledgerRevision:string};
type Props={applicationReview?:ApplicationReviewSource;activeSlug:string;activeDoc:ResumeDocument;summaries:ResumeSummary[];masterSummary:ResumeSummary|null;snapshots:ResumeSnapshotMeta[];initialSnapshotId?:string;onClose:()=>void};
const CATEGORIES=[['all','全部'],['content','内容'],['structure','结构'],['style','样式']] as const;
const KINDS:Record<ComparisonKind,string>={added:'对照新增',removed:'对照移除',modified:'差异',ambiguous:'身份歧义'};
const KIND_COLORS:Record<ComparisonKind,string>={added:'bg-emerald-50 text-emerald-800',removed:'bg-rose-50 text-rose-800',modified:'bg-sky-50 text-sky-800',ambiguous:'bg-amber-50 text-amber-900'};
const PAGE=24;
function showTime(iso:string){const n=new Date(iso);return Number.isNaN(n.getTime())?iso:n.toLocaleString('zh-CN',{hour12:false});}
function Value({value,reveal}:{value:ComparisonValue|null;reveal:boolean}){
  if(!value)return <span className="text-slate-400">（不存在）</span>;
  return <div className="min-w-0 space-y-1">
    {value.hidden&&<span className="inline-block rounded bg-amber-100 px-1.5 text-[10px] text-amber-900">隐藏 / 禁用或未确认</span>}
    <pre tabIndex={(!value.hidden||reveal)&&value.text.length>200?0:undefined} className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-sans text-xs">{value.hidden&&!reveal?'（已遮蔽）':value.text===''?'（空值）':value.text}</pre>
  </div>;
}

export function VersionCompareModal({activeSlug,activeDoc,summaries,masterSummary,snapshots,initialSnapshotId,onClose,applicationReview}:Props){
  const [targetKey,setTargetKey]=useState(applicationReview?'memory:'+activeSlug:initialSnapshotId?'snapshot:'+initialSnapshotId:'disk:'+activeSlug);
  const [result,setResult]=useState<Loaded|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [reveal,setReveal]=useState(false);
  const [category,setCategory]=useState<'all'|ComparisonCategory>('all');
  const [kind,setKind]=useState<'all'|ComparisonKind>('all');
  const [page,setPage]=useState(0);
  const request=useRef<{controller:AbortController;cancel:()=>void}|null>(null);
  const scroll=useRef<HTMLDivElement>(null);
  const first=useRef<HTMLSelectElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  const targets:Target[]=[];
  const seen=new Set<string>();
  if(applicationReview)targets.push({key:'memory:'+activeSlug,label:'当前内存稿：'+activeDoc.title+(activeSlug===applicationReview.resumeSlug?'（关联版本）':'（非原关联版本）'),slug:activeSlug,docId:activeDoc.id,kind:'memory'});
  for(const item of [...(masterSummary?[masterSummary]:[]),...summaries]){
    if(seen.has(item.slug))continue;seen.add(item.slug);
    targets.push({key:'disk:'+item.slug,label:(item.slug==='master'?'母库：':'磁盘版本：')+item.title+(item.slug===activeSlug?'（当前版本的磁盘副本）':'')+(applicationReview?.resumeSlug===item.slug?'（原关联标识）':''),slug:item.slug,docId:item.id,kind:'disk'});
  }
  if(!seen.has(activeSlug)){const fallback:Target={key:'disk:'+activeSlug,label:'当前版本的磁盘副本',slug:activeSlug,docId:activeDoc.id,kind:'disk'};if(applicationReview)targets.push(fallback);else targets.unshift(fallback);}
  for(const snap of applicationReview?[]:snapshots)if(snap.slug===activeSlug)targets.push({key:'snapshot:'+snap.id,label:'历史快照：'+showTime(snap.createdAt)+' · '+snap.reason,slug:activeSlug,docId:activeDoc.id,kind:'snapshot',snapshot:snap});
  const target=targets.find(x=>x.key===targetKey);
  const cancelRead=()=>{const old=request.current;request.current=null;old?.cancel();setBusy(false);};
  useEffect(()=>{
    const original=document.activeElement instanceof HTMLElement?document.activeElement:null;
    first.current?.focus();
    return ()=>{const old=request.current;request.current=null;old?.cancel();if(original?.isConnected)original.focus();};
  },[]);
  const close=()=>{cancelRead();onClose();};
  const resetFilters=()=>{setCategory('all');setKind('all');setPage(0);setReveal(false);};
  const changeTarget=(key:string)=>{cancelRead();setTargetKey(key);setResult(null);setError(null);resetFilters();};
  const read=async()=>{
    if(!target||request.current)return;
    let basis:ResumeDocument;try{basis=structuredClone(activeDoc);}catch{setResult(null);setError('无法冻结当前内存稿，未读取对照文件。');return;}
    const selected=target,capturedAt=new Date().toISOString(),sealed=applicationReview;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    let rejectPending:((err:Error)=>void)|undefined;
    const cancel=()=>{controller.abort();rejectPending?.(new Error('已取消对照。'));};
    const token={controller,cancel};request.current=token;
    setBusy(true);setError(null);setResult(null);resetFilters();
    try{
      const loadTarget=async()=>{
        if(selected.kind==='memory')return {document:basis,time:basis.updatedAt};
        if(selected.kind==='snapshot'){
          if(!selected.snapshot)throw new Error('快照已不可用，请重新选择。');
          const rec=await apiClient.getSnapshotForComparison(selected.slug,selected.snapshot.id,controller.signal);
          if(rec.meta.id!==selected.snapshot.id||rec.meta.slug!==selected.slug||rec.meta.createdAt!==selected.snapshot.createdAt||rec.document.id!==basis.id)throw new Error('快照或文档身份已变化，请重新选择。');
          return {document:rec.document,time:rec.meta.createdAt};
        }
        const doc=await apiClient.getResume(selected.slug,controller.signal);
        if(doc.id!==selected.docId||(selected.slug===activeSlug&&doc.id!==basis.id))throw new Error('磁盘版本身份已变化，请刷新版本列表后重试。');
        return {document:doc,time:doc.updatedAt};
      };
      const load=async()=>{
        if(!sealed)return {left:{document:basis,time:basis.updatedAt},right:await loadTarget()};
        const link:ApplicationSnapshotLink={applicationId:sealed.id,snapshotId:sealed.snapshotId,ledgerRevision:sealed.ledgerRevision};
        const rec=await apiClient.getLinkedApplicationSnapshot(link,controller.signal);
        const canonical=sealed.snapshotId.replace(/\.json$/i,'');
        if(rec.meta.id!==canonical||rec.meta.applicationId!==sealed.id||rec.meta.resumeSlug!==sealed.resumeSlug||rec.meta.exportedFilePath!==sealed.exportedFilePath||rec.meta.atsScore!==sealed.atsScore||!samePdfReceipt(rec.meta.pdfReceipt,sealed.pdfReceipt)||rec.meta.title!==rec.document.title||rec.meta.templateId!==rec.document.templateId||!Number.isFinite(Date.parse(rec.meta.createdAt)))throw new Error('永久快照关联身份校验失败，未显示原稿。');
        if(controller.signal.aborted)throw new Error('已取消对照。');
        return {left:{document:rec.document,time:rec.meta.createdAt},right:await loadTarget()};
      };
      const fetched=await Promise.race([load(),new Promise<never>((_,reject)=>{rejectPending=reject;timer=setTimeout(()=>{controller.abort();reject(new Error('读取对照文件超过 10 秒，已停止等待结果。'));},10_000);})]);
      if(request.current!==token||controller.signal.aborted)return;
      const diff=compareResumeDocuments(fetched.left.document,fetched.right.document);
      if(request.current!==token)return;
      setResult({key:selected.key,targetDocId:fetched.right.document.id,targetSnapshotTime:selected.snapshot?.createdAt,baselineTitle:fetched.left.document.title,baselineTime:fetched.left.time,targetTitle:fetched.right.document.title,targetTime:fetched.right.time,capturedAt,diff});
    }catch(err){if(request.current===token)setError(localErrorMessage(err,'读取或计算差异失败。'));}
    finally{if(timer!==undefined)clearTimeout(timer);if(request.current===token){request.current=null;setBusy(false);}}
  };
  const shown=result?.key===targetKey&&target&&result.targetDocId===target.docId&&result.targetSnapshotTime===target.snapshot?.createdAt?result:null;
  const filtered=shown?.diff.rows.filter(r=>(category==='all'||r.category===category)&&(kind==='all'||r.kind===kind))??[];
  const pageCount=Math.max(1,Math.ceil(filtered.length/PAGE)),actualPage=Math.min(page,pageCount-1);
  const changePage=(next:number)=>{setPage(next);scroll.current?.scrollTo({top:0});};
  return <div role="dialog" aria-modal="true" aria-label={applicationReview?"永久投递快照只读复盘":"只读版本差异对照"} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3" onClick={close}
    onKeyDown={e=>{e.stopPropagation();if((e.ctrlKey||e.metaKey)&&['s','k','z','y'].includes(e.key.toLowerCase()))e.preventDefault();if(e.key==='Escape'){close();}if(e.key==='Tab'){
      const focusable=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter(el=>el.getClientRects().length>0);
      const firstEl=focusable[0],lastEl=focusable.at(-1);
      if(e.shiftKey&&document.activeElement===firstEl){e.preventDefault();lastEl?.focus();}
      else if(!e.shiftKey&&document.activeElement===lastEl){e.preventDefault();firstEl?.focus();}
    }}}>
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-300 bg-white text-slate-900 shadow-xl" onClick={e=>e.stopPropagation()}>
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div><h2 className="flex items-center gap-2 text-sm font-bold"><ArrowLeftRight size={16} className="text-teal-700"/>{applicationReview?"永久投递快照只读复盘":"只读版本差异对照"}</h2>
          <p className="mt-1 text-[11px] text-slate-600">{applicationReview?'基准为台账关联、身份核验通过的永久原稿；对照为当前内存稿（可能尚未保存）或本地磁盘版本。差异方向：封存原稿 → 对照稿。只读，不恢复、不保存、不调用 AI。':'基准为点击读取时的当前内存稿（可能尚未保存），对照为读取到的本地磁盘版本或快照。不会切换、保存、合并、回滚或调用 AI。'}</p>
        </div>
        <button ref={closeRef} type="button" onClick={close} aria-label="关闭版本对照" className="rounded p-1 hover:bg-slate-100"><X size={17}/></button>
      </header>
      <div className="space-y-2 border-b border-slate-200 px-4 py-3 text-xs">
        {applicationReview&&<div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-[11px] text-indigo-950">
          <div className="font-semibold break-all">{applicationReview.company} · {applicationReview.role||'未填写岗位'}</div>
          <div>台账关联版本：<span className="font-mono break-all">{applicationReview.resumeSlug}</span>；{applicationReview.pdfReceipt?'已封存 PDF 字节凭证，本次文档对照不读取 PDF 文件。':applicationReview.exportedFilePath?'记录有 PDF 路径，但本次不读取或核验 PDF 字节。':'没有关联 PDF 路径。'} 本复盘不是已发送/送达证明。</div>
          {!seen.has(applicationReview.resumeSlug)&&applicationReview.resumeSlug!==activeSlug&&<div className="text-amber-900">关联版本不在当前可用列表；仍可对照其他版本，不自动恢复原版本。</div>}
          {target&&target.slug!==applicationReview.resumeSlug&&<div className="text-amber-900">对照稿不是台账原关联版本；差异不等于同一份简历的修改历史。</div>}
        </div>}
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1"><span className="mb-1 block font-semibold">对照来源</span>
            <select ref={first} aria-label="对照来源" value={targetKey} onChange={e=>changeTarget(e.target.value)} className="w-full rounded border border-slate-300 bg-white p-2">
              {!target&&<option value={targetKey}>此前选择的来源已不可用</option>}
              {targets.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <button type="button" disabled={!target||busy} onClick={()=>void read()} className="inline-flex items-center gap-1 rounded bg-teal-700 px-3 py-2 font-semibold text-white disabled:opacity-50"><RefreshCw size={13}/>{busy?'读取中…':'读取并对比'}</button>
          {busy&&<button type="button" onClick={()=>{cancelRead();setError('已取消本次读取，不显示迟到结果。');}} className="rounded border border-slate-300 px-3 py-2">取消读取</button>}
        </div>
        {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
        {shown&&<>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded bg-slate-50 p-2"><div className="font-semibold text-slate-600">左 · 冻结基准（{applicationReview?'永久投递原稿':'内存稿'}）</div><div className="break-all font-semibold">{shown.baselineTitle}</div><div className="text-[10px] text-slate-600">{applicationReview?'封存时间':'文档更新时间'}：{showTime(shown.baselineTime)}</div></div>
            <div className="min-w-0 rounded bg-teal-50 p-2"><div className="font-semibold text-teal-800">右 · 冻结对照（{target?.kind==='snapshot'?'历史快照':target?.kind==='memory'?'内存稿':'磁盘版本'}）</div><div className="break-all font-semibold">{shown.targetTitle}</div><div className="text-[10px] text-slate-600">{target?.kind==='snapshot'?'快照创建时间':'文档更新时间'}：{showTime(shown.targetTime)}</div></div>
          </div>
          <p className="text-[10px] text-slate-600">{applicationReview?'本次复盘开始于':'基准抓取于'} {showTime(shown.capturedAt)}。结果固定为本次读取的两份文档，之后的编辑或外部磁盘变化不会自动更新；需要时重新读取。</p>
          <div className="flex flex-wrap gap-1.5" aria-label="差异统计">
            {Object.entries(shown.diff.counts).map(([k,n])=><span key={k} className={'rounded px-2 py-1 '+KIND_COLORS[k as ComparisonKind]}>{KINDS[k as ComparisonKind]} {n}</span>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" aria-label="差异分类">{CATEGORIES.map(([key,label])=><button type="button" aria-pressed={category===key} key={key} onClick={()=>{setCategory(key);changePage(0);}} className={'rounded border px-2 py-1 '+(category===key?'border-slate-900 bg-slate-900 text-white':'border-slate-300')}>{label}</button>)}</div>
            <label className="flex items-center gap-1">类型<select aria-label="差异类型" value={kind} onChange={e=>{setKind(e.target.value as typeof kind);changePage(0);}} className="rounded border border-slate-300 p-1"><option value="all">全部类型</option>{Object.entries(KINDS).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label>
            {shown.diff.hiddenFieldCount>0&&<label className="flex items-center gap-1 text-amber-900"><input type="checkbox" checked={reveal} onChange={e=>setReveal(e.target.checked)}/>显示隐藏原值（含个人信息）</label>}
          </div>
        </>}
      </div>
      <div ref={scroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs" data-version-compare-scroll="true">
        {!shown?<p className="rounded border border-dashed border-slate-300 p-4 text-slate-600">选择来源后点击“读取并对比”。{applicationReview?'读取前将重新检查磁盘台账版本和快照身份；关联不一致时不展示原稿。 ':''}只比较存储字段和结构，不读取照片或 logo 文件、不比较图片字节及 PDF 像素。文档 ID、创建/更新时间和编辑焦点不计入差异。</p>:<>
          {shown.diff.warnings.length>0&&<div className="space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-amber-950">{shown.diff.warnings.map(w=><p key={w}>{w}</p>)}</div>}
          {shown.diff.hiddenFieldCount>0&&<p className="text-amber-900">{shown.diff.hiddenFieldCount} 个差异字段涉及隐藏/禁用或无法确认可见性的值。{reveal?'当前已明确显示原值；关闭或重新读取时恢复遮蔽。':'原值默认遮蔽；只统计差异，不代表导出可见性。'}</p>}
          {!filtered.length&&<p role="status" className="rounded border border-dashed border-slate-300 p-4 text-slate-600">{shown.diff.rows.length?'当前筛选无差异。':'所比较的存储内容、结构和样式字段没有差异。'}</p>}
          {filtered.slice(actualPage*PAGE,(actualPage+1)*PAGE).map(row=><article key={row.key} data-comparison-row={row.kind} data-comparison-category={row.category} className="overflow-hidden rounded-lg border border-slate-200">
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-2"><span className={'rounded px-1.5 py-0.5 font-semibold '+KIND_COLORS[row.kind]}>{KINDS[row.kind]}</span><strong>{row.group} · {row.label}</strong>
              {(row.beforePosition!==null||row.afterPosition!==null)&&<span className="text-slate-600">位置：{row.beforePosition??'—'} → {row.afterPosition??'—'}</span>}
            </div>
            <div className="divide-y divide-slate-100">{row.fields.map((field,i)=><div key={i} className="px-3 py-2">
              <div className="mb-1 font-semibold text-slate-600">{field.label}{field.referenceChanged?'（引用发生变化，未读取资产）':''}</div>
              <div className="grid grid-cols-2 gap-2"><div className="min-w-0 rounded bg-slate-50 p-2" data-compare-side="before"><span className="mb-1 block text-[10px] text-slate-500">基准</span><Value value={field.before} reveal={reveal}/></div><div className="min-w-0 rounded bg-teal-50/70 p-2" data-compare-side="after"><span className="mb-1 block text-[10px] text-teal-800">对照</span><Value value={field.after} reveal={reveal}/></div></div>
            </div>)}</div>
          </article>)}
        </>}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs">
        {shown?<div className="flex items-center gap-2"><span>当前筛选 {filtered.length} 条 · {actualPage+1}/{pageCount} 页</span><button type="button" disabled={actualPage===0} onClick={()=>changePage(actualPage-1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">上一页</button><button type="button" disabled={actualPage+1>=pageCount} onClick={()=>changePage(actualPage+1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">下一页</button></div>:<span>所有比较均为只读。</span>}
        <button type="button" onClick={close} className="rounded border border-slate-300 bg-white px-3 py-1.5">关闭对照</button>
      </footer>
    </div>
  </div>;
}
