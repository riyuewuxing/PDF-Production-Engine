import { useStudioComponentSkins } from '../../studio-theme/StudioThemeProvider';
import { buttonSkin } from '../../studio-theme/componentSkins';
import {AiPdfComparisonView} from './AiPdfComparisonView';
import type {useTextPdfReview} from '../../hooks/useTextPdfReview';
export function TextPdfReviewGate({gate,disabled,label}:{gate:ReturnType<typeof useTextPdfReview>;disabled:boolean;label:string}){
  const skins=useStudioComponentSkins();
  return <div className="space-y-2 rounded border border-teal-200 bg-white p-2 studio-ui-info-border studio-ui-surface">
    <p className="text-[11px] text-slate-600 studio-ui-muted">仅审核已选正文。先本地试渲染实际 PDF，再批准应用；修改选择或原文将使旧对照失效。</p>
    <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={disabled||gate.busy} onClick={()=>void gate.render()} className="rounded border border-teal-300 px-2 py-1 text-teal-800 disabled:opacity-50 studio-ui-info-border studio-ui-info">{label}</button>
    {gate.busy&&<div className="flex justify-between"><span>本地 PDF 试渲染中…</span><button {...buttonSkin(skins)} data-studio-control="true" type="button" onClick={gate.cancel} className="rounded border px-2 py-1 studio-ui-border">取消试渲染</button></div>}
    {gate.error&&<p role="alert" className="rounded bg-red-50 p-2 text-red-800 studio-ui-error-surface studio-ui-error">{gate.error}</p>}
    {gate.review&&<><AiPdfComparisonView comparison={gate.review.comparison}/><label className="flex items-start gap-2"><input data-studio-control="true" type="checkbox" disabled={disabled||!!gate.review.comparison.blockers.length} checked={gate.confirmed} onChange={e=>gate.setConfirmed(e.target.checked)}/>我已检查真实 PDF 前后页面，批准当前正文候选。</label></>}
  </div>;
}
