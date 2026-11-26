import {useState,useEffect} from 'react';
import {createPortal} from 'react-dom';
import type {AiPdfComparison} from '../../lib/aiPdfComparison';
export function AiPdfComparisonView({comparison}:{comparison:AiPdfComparison}){
  const [page,setPage]=useState(1);
  const [full,setFull]=useState(false);
  const [enlarged,setEnlarged]=useState<'原版'|'候选'|null>(null);
  useEffect(()=>{setPage(1);setFull(false);},[comparison]);
  useEffect(()=>{if(!full)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setFull(false);}};window.addEventListener('keydown',escape,true);return()=>window.removeEventListener('keydown',escape,true);},[full]);
  const {original,candidate,blockers,warnings}=comparison;
  const max=Math.max(original.audit.pages,candidate.audit.pages);
  return <section aria-label="真实 PDF 前后对照" className="space-y-2 rounded border border-teal-200 bg-white p-2 text-[11px]">
    <div className="font-bold text-teal-900">真实 PDF 前后对照（本地试渲染）</div>
    <p className="text-slate-600">直接读取两份原生 A4 PDF；未保存、未发送模型。机读评分仅为本地启发式检查。</p>
    <table className="w-full text-left"><thead><tr className="border-b"><th>指标</th><th>原版</th><th>候选</th></tr></thead><tbody>
      {([['实际页数',original.audit.pages,candidate.audit.pages],['提取字符',original.audit.characters,candidate.audit.characters],['机读评分',original.audit.atsScore,candidate.audit.atsScore],['未匹配段落/实体',original.audit.missingLabels.length,candidate.audit.missingLabels.length],['越界文字位置',original.audit.outsideSpans,candidate.audit.outsideSpans]] as const).map(([label,a,b])=><tr key={label} className="border-b border-slate-100"><td className="py-1">{label}</td><td>{a}</td><td>{b}</td></tr>)}
    </tbody></table>
    <div className="flex items-center justify-between"><button type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded border px-2 py-1 disabled:opacity-40">上一页</button><span>第 {page}/{max} 页</span><button type="button" disabled={page>=max} onClick={()=>setPage(p=>p+1)} className="rounded border px-2 py-1 disabled:opacity-40">下一页</button></div>
    <div className="grid grid-cols-2 gap-2 rounded bg-slate-100 p-1">
      {[{label:'原版',image:original.images[page-1]},{label:'候选',image:candidate.images[page-1]}].map(p=><div key={p.label} className="min-w-0"><div className="text-center font-semibold">{p.label}</div>{p.image?<img alt={p.label+' PDF 第'+page+'页'} src={p.image} className="w-full border border-slate-300 bg-white"/>:<div className="p-3 text-center text-slate-500">无此页</div>}</div>)}
    </div>
    <button type="button" onClick={()=>setFull(true)} className="w-full rounded border border-teal-400 bg-teal-50 px-2 py-1.5 font-semibold text-teal-900">展开全屏 PDF 对照</button>
    {full&&createPortal(<div role="dialog" aria-modal="true" aria-label="全屏 PDF 对照" className="fixed inset-0 z-[1000] flex flex-col bg-slate-900 text-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 p-3 text-sm"><div><strong>真实 PDF 双页对照</strong><span className="ml-3 text-slate-300">原版 {original.audit.pages} 页 · 候选 {candidate.audit.pages} 页</span></div><div className="flex items-center gap-3"><button type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded border border-slate-500 px-3 py-1 disabled:opacity-40">上一页</button><span>第 {page}/{max} 页</span><button type="button" disabled={page>=max} onClick={()=>setPage(p=>p+1)} className="rounded border border-slate-500 px-3 py-1 disabled:opacity-40">下一页</button><button type="button" autoFocus onClick={()=>setFull(false)} className="rounded bg-teal-700 px-3 py-1">关闭全屏对照</button></div></header>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden p-3">{[{label:'原版',image:original.images[page-1]},{label:'候选',image:candidate.images[page-1]}].map(p=><div key={p.label} className="flex min-h-0 min-w-0 flex-col"><div className="pb-2 text-center text-sm font-semibold">{p.label}</div><div className="min-h-0 flex-1 overflow-auto rounded bg-slate-800 p-2">{p.image?<img alt={p.label+' 全屏 PDF 第'+page+'页'} src={p.image} className="mx-auto block w-full max-w-[744px] bg-white"/>:<div className="p-8 text-center text-slate-300">无此页</div>}</div></div>)}</div>
      <footer className="border-t border-slate-700 px-4 py-2 text-xs text-slate-300">实际 PDF 图像 · 本地审阅 · 不会写入文件或发送模型 · Esc 返回</footer>
    </div>,document.body)}
    <div className="flex gap-2"><button type="button" onClick={()=>setEnlarged(enlarged==='原版'?null:'原版')} className="rounded border px-2 py-1">放大原版</button><button type="button" onClick={()=>setEnlarged(enlarged==='候选'?null:'候选')} className="rounded border px-2 py-1">放大候选</button></div>
    {enlarged&&<div className="max-h-[70vh] overflow-auto border bg-slate-100"><img alt={enlarged+' 放大 PDF'} src={(enlarged==='原版'?original.images:candidate.images)[page-1]} className="max-w-none w-[744px]"/></div>}
    {blockers.length?<div role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-red-800"><strong>禁止应用</strong>{blockers.map(w=><p key={w}>{w}</p>)}</div>:<p className="rounded bg-teal-50 p-2 text-teal-800">通过本地机械门禁，仍需人工逐页核对。</p>}
    {warnings.map(w=><p key={w} className="text-amber-800">{w}</p>)}
    {!!candidate.audit.missingLabels.length&&<details><summary>候选未匹配内容（本地）</summary>{candidate.audit.missingLabels.map(l=><p key={l}>{l}</p>)}</details>}
  </section>;
}
