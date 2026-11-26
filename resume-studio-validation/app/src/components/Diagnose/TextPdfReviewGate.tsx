import {AiPdfComparisonView} from './AiPdfComparisonView';
import type {useTextPdfReview} from '../../hooks/useTextPdfReview';
export function TextPdfReviewGate({gate,disabled,label}:{gate:ReturnType<typeof useTextPdfReview>;disabled:boolean;label:string}){
  return <div className="space-y-2 rounded border border-teal-200 bg-white p-2">
    <p className="text-[11px] text-slate-600">仅审核已选正文。先本地试渲染实际 PDF，再批准应用；修改选择或原文将使旧对照失效。</p>
    <button type="button" disabled={disabled||gate.busy} onClick={()=>void gate.render()} className="rounded border border-teal-300 px-2 py-1 text-teal-800 disabled:opacity-50">{label}</button>
    {gate.busy&&<div className="flex justify-between"><span>本地 PDF 试渲染中…</span><button type="button" onClick={gate.cancel} className="rounded border px-2 py-1">取消试渲染</button></div>}
    {gate.error&&<p role="alert" className="rounded bg-red-50 p-2 text-red-800">{gate.error}</p>}
    {gate.review&&<><AiPdfComparisonView comparison={gate.review.comparison}/><label className="flex items-start gap-2"><input type="checkbox" disabled={disabled||!!gate.review.comparison.blockers.length} checked={gate.confirmed} onChange={e=>gate.setConfirmed(e.target.checked)}/>我已检查真实 PDF 前后页面，批准当前正文候选。</label></>}
  </div>;
}
