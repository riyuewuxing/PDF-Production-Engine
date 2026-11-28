import {useState,useEffect,useRef,useLayoutEffect} from 'react';
import {createPortal} from 'react-dom';
import {useStudioThemeId} from '../../studio-theme/StudioThemeProvider';
import {surfaceStyle} from '../../studio-theme/surfaces';
import type {AiPdfComparison} from '../../lib/aiPdfComparison';
export function AiPdfComparisonView({comparison}:{comparison:AiPdfComparison}){
  const themeId=useStudioThemeId();
  const [page,setPage]=useState(1);
  const [full,setFull]=useState(false);
  const openerRef=useRef<HTMLButtonElement>(null);
  const dialogRef=useRef<HTMLDivElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  const [enlarged,setEnlarged]=useState<'原版'|'候选'|null>(null);
  useEffect(()=>{setPage(1);setFull(false);},[comparison]);
  useLayoutEffect(()=>{
    const dialog=dialogRef.current;
    if(!full||!dialog)return;
    const opener=openerRef.current;
    const controls=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(el=>el.tabIndex>=0&&el.getClientRects().length>0);
    const focusInitial=()=> (closeRef.current??controls()[0]??dialog).focus({preventScroll:true});
    focusInitial();
    const onKey=(e:KeyboardEvent)=>{
      if(e.isComposing||e.keyCode===229)return;
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&['k','s'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();return;}
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setFull(false);return;}
      if(e.key!=='Tab')return;
      // Explicitly cycle only current enabled controls, including keyboard-scrollable paper regions.
      const items=controls(),active=document.activeElement,index=items.indexOf(active as HTMLElement);
      e.preventDefault();e.stopPropagation();
      if(!items.length){dialog.focus({preventScroll:true});return;}
      const next=index<0?(e.shiftKey?items.length-1:0):(index+(e.shiftKey?-1:1)+items.length)%items.length;
      items[next]?.focus({preventScroll:true});
    };
    const onFocus=(e:FocusEvent)=>{if(e.target instanceof Node&&!dialog.contains(e.target))focusInitial();};
    document.addEventListener('keydown',onKey,true);
    document.addEventListener('focusin',onFocus);
    return()=>{
      document.removeEventListener('keydown',onKey,true);
      document.removeEventListener('focusin',onFocus);
      if(opener?.isConnected)opener.focus({preventScroll:true});
    };
  },[full]);
  const {original,candidate,blockers,warnings}=comparison;
  const max=Math.max(original.audit.pages,candidate.audit.pages);
  return <section aria-label="真实 PDF 前后对照" className="space-y-2 rounded border border-teal-200 bg-white p-2 text-[11px] studio-ui-info-border studio-ui-surface">
    <div className="font-bold text-teal-900 studio-ui-info">真实 PDF 前后对照（本地试渲染）</div>
    <p className="text-slate-600 studio-ui-muted">直接读取两份原生 A4 PDF；未保存、未发送模型。机读评分仅为本地启发式检查。</p>
    <table className="w-full text-left"><thead><tr className="border-b studio-ui-border"><th>指标</th><th>原版</th><th>候选</th></tr></thead><tbody>
      {([['实际页数',original.audit.pages,candidate.audit.pages],['提取字符',original.audit.characters,candidate.audit.characters],['机读评分',original.audit.atsScore,candidate.audit.atsScore],['未匹配段落/实体',original.audit.missingLabels.length,candidate.audit.missingLabels.length],['越界文字位置',original.audit.outsideSpans,candidate.audit.outsideSpans]] as const).map(([label,a,b])=><tr key={label} className="border-b border-slate-100 studio-ui-border"><td className="py-1">{label}</td><td>{a}</td><td>{b}</td></tr>)}
    </tbody></table>
    <div className="flex items-center justify-between"><button data-studio-control="true" type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded border px-2 py-1 disabled:opacity-40 studio-ui-border">上一页</button><span>第 {page}/{max} 页</span><button data-studio-control="true" type="button" disabled={page>=max} onClick={()=>setPage(p=>p+1)} className="rounded border px-2 py-1 disabled:opacity-40 studio-ui-border">下一页</button></div>
    <div className="grid grid-cols-2 gap-2 rounded bg-slate-100 p-1 studio-ui-raised">
      {[{label:'原版',image:original.images[page-1]},{label:'候选',image:candidate.images[page-1]}].map(p=><div key={p.label} className="min-w-0"><div className="text-center font-semibold">{p.label}</div>{p.image?<img alt={p.label+' PDF 第'+page+'页'} src={p.image} className="w-full border border-slate-300 bg-white"/>:<div className="p-3 text-center text-slate-500 studio-ui-muted">无此页</div>}</div>)}
    </div>
    <button data-studio-control="true" type="button" ref={openerRef} onClick={()=>setFull(true)} className="w-full rounded border border-teal-400 bg-teal-50 px-2 py-1.5 font-semibold text-teal-900 studio-ui-info-border studio-ui-info-surface studio-ui-info">展开全屏 PDF 对照</button>
    {full&&createPortal(<div ref={dialogRef} tabIndex={-1} data-studio-surface="panel" data-studio-theme={themeId} data-studio-region="ai-pdf-portal" style={surfaceStyle(themeId,'panel')} role="dialog" aria-modal="true" aria-label="全屏 PDF 对照" className="fixed inset-0 z-[1000] flex flex-col bg-slate-900 text-white studio-ui-surface studio-ui-primary">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 p-3 text-sm studio-ui-border"><div><strong>真实 PDF 双页对照</strong><span className="ml-3 text-slate-300 studio-ui-muted">原版 {original.audit.pages} 页 · 候选 {candidate.audit.pages} 页</span></div><div className="flex items-center gap-3"><button data-studio-control="true" type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded border border-slate-500 px-3 py-1 disabled:opacity-40 studio-ui-border">上一页</button><span>第 {page}/{max} 页</span><button data-studio-control="true" type="button" disabled={page>=max} onClick={()=>setPage(p=>p+1)} className="rounded border border-slate-500 px-3 py-1 disabled:opacity-40 studio-ui-border">下一页</button><button data-studio-control="true" type="button" ref={closeRef} onClick={()=>setFull(false)} className="rounded bg-teal-700 px-3 py-1 studio-ui-fill">关闭全屏对照</button></div></header>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden p-3">{[{label:'原版',image:original.images[page-1]},{label:'候选',image:candidate.images[page-1]}].map(p=><div key={p.label} className="flex min-h-0 min-w-0 flex-col"><div className="pb-2 text-center text-sm font-semibold">{p.label}</div><div data-studio-control="true" role="region" aria-label={p.label+" PDF 滚动区域"} tabIndex={0} className="min-h-0 flex-1 overflow-auto rounded bg-slate-800 p-2 studio-ui-raised">{p.image?<img alt={p.label+' 全屏 PDF 第'+page+'页'} src={p.image} className="mx-auto block w-full max-w-[744px] bg-white"/>:<div className="p-8 text-center text-slate-300 studio-ui-muted">无此页</div>}</div></div>)}</div>
      <footer className="border-t border-slate-700 px-4 py-2 text-xs text-slate-300 studio-ui-border studio-ui-muted">实际 PDF 图像 · 本地审阅 · 不会写入文件或发送模型 · Esc 返回</footer>
    </div>,document.body)}
    <div className="flex gap-2"><button data-studio-control="true" type="button" onClick={()=>setEnlarged(enlarged==='原版'?null:'原版')} className="rounded border px-2 py-1 studio-ui-border">放大原版</button><button data-studio-control="true" type="button" onClick={()=>setEnlarged(enlarged==='候选'?null:'候选')} className="rounded border px-2 py-1 studio-ui-border">放大候选</button></div>
    {enlarged&&<div className="max-h-[70vh] overflow-auto border bg-slate-100 studio-ui-raised studio-ui-border"><img alt={enlarged+' 放大 PDF'} src={(enlarged==='原版'?original.images:candidate.images)[page-1]} className="max-w-none w-[744px]"/></div>}
    {blockers.length?<div role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-red-800 studio-ui-error-border studio-ui-error-surface studio-ui-error"><strong>禁止应用</strong>{blockers.map(w=><p key={w}>{w}</p>)}</div>:<p className="rounded bg-teal-50 p-2 text-teal-800 studio-ui-info-surface studio-ui-info">通过本地机械门禁，仍需人工逐页核对。</p>}
    {warnings.map(w=><p key={w} className="text-amber-800 studio-ui-warning">{w}</p>)}
    {!!candidate.audit.missingLabels.length&&<details><summary data-studio-control="true">候选未匹配内容（本地）</summary>{candidate.audit.missingLabels.map(l=><p key={l}>{l}</p>)}</details>}
  </section>;
}
