import {useEffect,useRef,useState} from 'react';
import {extractTokensFromPdfArrayBuffer,renderJobNoticePdfPage} from '../../lib/pdfResumeImporter';
import {detectColumnLayout,reconstructPageLinesColumnAware,reconstructLinesFromTextItems} from '../../lib/pdfTextLayout';
import {prepareJobPdfSource,type JobPdfDraft} from '../../lib/jobPdfSource';
import {MAX_JOB_PDF_BYTES,MAX_JOB_PDF_PAGES,type JobPdfOrigin} from '../../schema/jobPdfSourceSchema';

type Props={jdText:string;origin?:JobPdfOrigin;onConfirm:(text:string,origin:JobPdfOrigin)=>void};
const textError=(err:unknown)=>err instanceof Error?err.message:'公告 PDF 处理失败。';
export function JobNoticePdfPane({jdText,origin,onConfirm}:Props){
  const [draft,setDraft]=useState<JobPdfDraft|null>(null);
  const [selected,setSelected]=useState<number[]>([]);
  const [page,setPage]=useState(1);
  const [reviewed,setReviewed]=useState<number[]>([]);
  const [image,setImage]=useState('');
  const [zoom,setZoom]=useState(150);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const bytes=useRef<Uint8Array|null>(null),task=useRef<AbortController|null>(null),alive=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;task.current?.abort();bytes.current=null;};},[]);
  const run=async(work:(signal:AbortSignal)=>Promise<void>)=>{
    if(task.current)return;
    const ctl=new AbortController();task.current=ctl;setBusy(true);setError('');
    let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;ctl.abort();},30000);
    try{await work(ctl.signal);}
    catch(e){if(alive.current)setError(timedOut?'公告处理超过30秒，已请求取消；原 JD 未改变。':ctl.signal.aborted?'已取消公告处理；原 JD 未改变。':textError(e));}
    finally{clearTimeout(timeout);if(task.current===ctl)task.current=null;if(alive.current)setBusy(false);}
  };
  const pick=(file:File|undefined)=>{
    if(!file||task.current)return;
    setDraft(null);setSelected([]);setReviewed([]);setImage('');setConfirmed(false);bytes.current=null;
    void run(async signal=>{
      if(!/\.pdf$/i.test(file.name)||file.size<=0||file.size>MAX_JOB_PDF_BYTES)throw new Error('请选择非空、最多10 MB的本地 PDF。');
      const data=new Uint8Array(await file.arrayBuffer());
      if(!new TextDecoder().decode(data.subarray(0,1024)).includes('%PDF-'))throw new Error('文件没有有效 PDF 文件头。');
      const digest=await crypto.subtle.digest('SHA-256',data);
      const sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      const pages=await extractTokensFromPdfArrayBuffer(data,MAX_JOB_PDF_PAGES,signal,{maxPageTokens:3000,maxTotalTokens:18000,maxTotalChars:200000});
      if(signal.aborted||!alive.current)throw new Error('已取消。');
      const extracted=pages.map((p,i)=>{const hasColumns=!!detectColumnLayout(p);return {page:i+1,text:(hasColumns?reconstructPageLinesColumnAware(p):reconstructLinesFromTextItems(p.tokens)).join('\n'),hasColumns};});
      bytes.current=data;setDraft({fileName:file.name,sha256,pages:extracted});setSelected(extracted.map(p=>p.page));setPage(1);
    });
  };
  const preview=()=>{
    const data=bytes.current,n=page;if(!data||!draft)return;
    setImage('');
    void run(async signal=>{const png=await renderJobNoticePdfPage(data,n,MAX_JOB_PDF_PAGES,signal);if(signal.aborted||!alive.current)throw new Error('已取消。');setImage(png);});
  };
  const current=draft?.pages.find(p=>p.page===page);
  const usable=(p:JobPdfDraft['pages'][number])=>!!p.text.trim()&&!p.text.includes('\uFFFD');
  const selectedPages=draft?.pages.filter(p=>selected.includes(p.page))??[];
  let prepared:ReturnType<typeof prepareJobPdfSource>|undefined,validation='';
  if(draft){try{prepared=prepareJobPdfSource(draft,selected);}catch(e){validation=textError(e);}}
  const canConfirm=!!prepared&&selectedPages.every(p=>reviewed.includes(p.page))&&confirmed&&!busy;
  const missingReview=selectedPages.filter(p=>!reviewed.includes(p.page)).map(p=>p.page);
  return <section aria-label="招聘公告 PDF 本地导入" className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/50 p-3 text-xs break-words">
    <div className="font-bold text-teal-900">招聘公告 PDF 本地导入</div>
    <p>离线提取可选文本，按实际 PDF 页序对照原件；表格、分栏、乱码、图片中的文字可能遗漏或错序。无 OCR，不联网，不自动判断资格。</p>
    {origin&&<p aria-label="当前公告来源" className="rounded bg-white p-2 text-teal-900">当前来源：{origin.fileName} · 第 {origin.pages.map(p=>p.page).join('、')} 页 / 共 {origin.totalPages} 页。手工编辑 JD 会取消页码来源绑定。</p>}
    <input type="file" accept=".pdf,application/pdf" aria-label="选择本地招聘公告 PDF" disabled={busy} onChange={e=>{pick(e.target.files?.[0]);e.target.value='';}} className="w-full rounded border bg-white p-1"/>
    {busy&&<div role="status">正在本地处理公告… <button type="button" onClick={()=>task.current?.abort()} className="rounded border bg-white px-2 py-1">取消公告处理</button></div>}
    {error&&<p role="alert" className="rounded bg-red-50 p-2 text-red-800">{error}</p>}
    {draft&&<>
      <p className="font-medium">{draft.fileName} · 共 {draft.pages.length} 页 · 已选 {selected.length} 页</p>
      <div className="flex max-h-28 flex-wrap gap-1 overflow-auto" aria-label="公告导入页选择">
        {draft.pages.map(p=><label key={p.page} className="flex items-center gap-1 rounded border bg-white p-1"><input type="checkbox" aria-label={'导入 PDF 第 '+p.page+' 页'} disabled={busy} checked={selected.includes(p.page)} onChange={e=>{setSelected(old=>e.target.checked?[...old,p.page]:old.filter(n=>n!==p.page));setConfirmed(false);}}/>第 {p.page} 页{!usable(p)?'（无可靠文本）':reviewed.includes(p.page)?' ✓':''}</label>)}
      </div>
      {selected.length<draft.pages.length&&<p className="text-amber-800">本次仅导入所选页，其余页不参与核对；未导入页可能含必要条件。</p>}
      <label className="block">原件对照页<select aria-label="公告原件对照页" value={page} disabled={busy} onChange={e=>{setPage(Number(e.target.value));setImage('');}} className="mt-1 w-full rounded border bg-white p-1">{draft.pages.map(p=><option key={p.page} value={p.page}>PDF 第 {p.page} 页</option>)}</select></label>
      {current&&<>
        {current.hasColumns&&<p className="text-amber-800">检测到可能分栏，请特别核对阅读顺序与表格行列。</p>}
        <pre aria-label="公告逐页提取文本" className="max-h-44 overflow-auto whitespace-pre-wrap rounded border bg-white p-2 font-sans">{current.text||'未检测到可选文本，可能是扫描或图片页。'}</pre>
        <button type="button" disabled={busy} onClick={preview} className="rounded border bg-white px-2 py-1">渲染本页 PDF 原件</button>
        {image&&<div className="min-w-0 space-y-1">
          <label className="flex items-center gap-2">原件显示比例<select aria-label="公告原件显示比例" value={zoom} onChange={e=>setZoom(Number(e.target.value))} className="rounded border bg-white p-1">{[100,150,200,300].map(n=><option key={n} value={n}>{n}%</option>)}</select></label>
          <div aria-label="公告原件滚动预览" className="max-h-96 w-full overflow-auto rounded border bg-white"><img alt={'公告 PDF 第 '+page+' 页实际渲染'} src={image} style={{width:zoom+'%',maxWidth:'none',height:'auto'}} className="block"/></div>
          <p className="text-slate-600">可放大并横向、纵向滚动，若表格或小字仍无法可靠核对，请直接查看本地原 PDF。</p>
        </div>}
        <label className="flex items-start gap-1"><input type="checkbox" aria-label={'确认已对照 PDF 第 '+page+' 页'} disabled={busy||!image||!usable(current)} checked={reviewed.includes(page)} onChange={e=>{setReviewed(old=>e.target.checked?[...old,page]:old.filter(n=>n!==page));setConfirmed(false);}}/>本人已对照本页原件，确认提取文字和阅读顺序可供核对（不是官方鉴真）。</label>
      </>}
      {validation&&<p className="text-amber-800">{validation}</p>}
      {missingReview.length>0&&<p className="text-slate-600">待对照原件：第 {missingReview.join('、')} 页。</p>}
      <label className="flex items-start gap-1"><input type="checkbox" aria-label="确认公告所选页和替换 JD" disabled={busy||!prepared} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>确认所选页及遗漏风险，并{jdText?'替换当前 JD（会清空当前未保存核对）':'载入 JD'}。</label>
      <div className="flex flex-wrap gap-1">
        <button type="button" disabled={!canConfirm} onClick={()=>{if(!prepared||!canConfirm)return;onConfirm(prepared.source,prepared.origin);setDraft(null);setSelected([]);setReviewed([]);setImage('');bytes.current=null;setConfirmed(false);}} className="rounded bg-teal-700 px-2 py-1 text-white disabled:opacity-40">确认导入所选公告页</button>
        <button type="button" disabled={busy} onClick={()=>{setDraft(null);setSelected([]);setReviewed([]);setImage('');setConfirmed(false);setError('');bytes.current=null;}} className="rounded border bg-white px-2 py-1">放弃公告导入</button>
      </div>
    </>}
    <p className="text-slate-600">仅保存人工确认的提取文本、文件名、文件摘要及页码区间；不会复制原 PDF 到台账。请自行保留原件。</p>
  </section>;
}
