import { useStudioComponentSkins } from '../../studio-theme/StudioThemeProvider';
import { iconSkin, buttonSkin } from '../../studio-theme/componentSkins';
import {useStudioThemeId} from '../../studio-theme/StudioThemeProvider';
import {surfaceStyle} from '../../studio-theme/surfaces';
import { Check, FileText, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  type PdfImportDraft,
  buildResumeDocumentFromPdfDraft,
} from '../../lib/pdfResumeImporter';
import type { ResumeDocument } from '../../schema/resumeSchema';

export function PdfImportModal({
  draft,
  onCancel,
  onCreateVersion,
}: {
  draft: PdfImportDraft | null;
  onCancel: () => void;
  onCreateVersion: (doc: ResumeDocument) => Promise<void>;
}) {
  const skins=useStudioComponentSkins();
  const themeId=useStudioThemeId();
  const [form, setForm] = useState<PdfImportDraft | null>(draft);
  const [busy, setBusy] = useState(false);
  const [docxReviewed,setDocxReviewed] = useState(false);
  const confirming = useRef(false);
  const scopeRef=useRef<HTMLDivElement>(null);
  const fieldsRef=useRef<HTMLFieldSetElement>(null);
  const unknownRef=useRef<HTMLDivElement>(null);
  const sourceRef=useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(draft);
    setDocxReviewed(false);
    setError(null);
  }, [draft]);

  if (!form) return null;

  const updateField = <K extends keyof PdfImportDraft>(key: K, val: PdfImportDraft[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: val } : prev));
  };

  const needsUnclassifiedDecision = Boolean(form.unclassifiedText?.trim()) && form.keepUnclassified===undefined;
  const needsDocxReview = form.sourceKind === 'docx' && !docxReviewed;
  const handleConfirm = async () => {
    if (confirming.current || needsUnclassifiedDecision || needsDocxReview) return;
    confirming.current = true;
    setBusy(true);
    setError(null);
    try {
      const doc = buildResumeDocumentFromPdfDraft(form);
      await onCreateVersion(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入创建新版本失败');
    } finally {
      confirming.current = false;
      setBusy(false);
    }
  };

  const cancel = () => { if (!confirming.current) onCancel(); };
  const jump=(target:HTMLElement|null)=>{target?.focus({preventScroll:true});target?.scrollIntoView({block:'start',behavior:'auto'});};
  const sourceLabel = form.sourceKind === 'docx' ? 'DOCX' : form.sourceKind === 'text' ? 'TXT / Markdown' : 'PDF';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={form.sourceKind === 'pdf' || !form.sourceKind ? '旧版 PDF 简历解析导入确认' : sourceLabel+' 简历解析导入确认'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
      onClick={cancel}
    >
      <div
        data-studio-region="resume-import-dialog" data-studio-surface="panel" data-studio-theme={themeId} style={surfaceStyle(themeId,'panel')} className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-white text-slate-900 shadow-2xl studio-ui-border studio-ui-surface studio-ui-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 studio-ui-border">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 studio-ui-primary">
              <FileText size={15} className="text-teal-600 studio-ui-info" /> 本地离线 {sourceLabel} 解析导入确认
            </h2>
            <p className="text-[11px] text-slate-500 studio-ui-muted">
              本地启发式提取，所有字段均为待核对候选，并非事实验证。{form.sourceKind==='docx'?'仅提取正文文字及可识别标题，不复刻 Word 版式。':'Markdown 仅识别常见二级章节、三级经历标题。'} 原文件不变。确认后另建独立版本。
            </p>
          </div>
          <button {...iconSkin(skins)} data-studio-control="true"
            type="button"
            onClick={cancel}
            disabled={busy}
            aria-label="关闭导入弹窗"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 studio-ui-muted studio-ui-hover studio-ui-hover-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div data-import-review-scroll="true" className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 text-xs md:grid-cols-2">
          {error && (
            <div className="col-span-full rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700 studio-ui-error-border studio-ui-error-surface studio-ui-error">
              {error}
            </div>
          )}

          {form.sourceKind==='docx' && <div ref={scopeRef} tabIndex={-1} data-import-review-scope="true" className="col-span-full space-y-1 rounded border border-amber-300 bg-amber-50 p-2 text-amber-950 studio-ui-warning-border studio-ui-warning-surface studio-ui-warning">
            <p className="font-semibold">DOCX 文字导入范围（请与原始 Word 文件核对）</p>
            <ul className="list-disc pl-5">{(form.importWarnings??[]).map((warning,i)=><li key={i}>{warning}</li>)}</ul>
            <label className="flex items-start gap-2"><input data-studio-control="true" type="checkbox" checked={docxReviewed} disabled={busy} onChange={e=>setDocxReviewed(e.target.checked)} />我已了解提取范围及未导入部分，并核对正文候选内容。</label>
          </div>}
          {/* Left: Editable parsed blocks */}
          <fieldset ref={fieldsRef} tabIndex={-1} data-import-review-fields="true" disabled={busy} className="min-w-0 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700 studio-ui-primary">新版本标题</span>
                <input data-studio-control="true"
                  type="text"
                  data-native-undo="true"
                  value={form.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  className="rounded border border-slate-200 px-2 py-1.5 text-slate-900 studio-ui-border studio-ui-primary"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700 studio-ui-primary">姓名</span>
                <input data-studio-control="true"
                  type="text"
                  data-native-undo="true"
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  className="rounded border border-slate-200 px-2 py-1.5 text-slate-900 studio-ui-border studio-ui-primary"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700 studio-ui-primary">意向岗位</span>
                <input data-studio-control="true"
                  type="text"
                  data-native-undo="true"
                  value={form.jobTitle}
                  onChange={(e) => updateField('jobTitle', e.target.value)}
                  className="rounded border border-slate-200 px-2 py-1.5 text-slate-900 studio-ui-border studio-ui-primary"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700 studio-ui-primary">电话</span>
                <input data-studio-control="true"
                  type="text"
                  data-native-undo="true"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  className="rounded border border-slate-200 px-2 py-1.5 text-slate-900 studio-ui-border studio-ui-primary"
                />
              </label>
              {([
                ['email','邮箱'], ['location','所在地'], ['birthDate','出生日期'], ['employmentStatus','状态（可留空）']
              ] as const).map(([key,label]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="font-semibold text-slate-700 studio-ui-primary">{label}</span>
                  <input data-studio-control="true" type="text" data-native-undo="true" value={form[key] ?? ''} onChange={e=>updateField(key,e.target.value)} className="rounded border border-slate-200 px-2 py-1.5 text-slate-900 studio-ui-border studio-ui-primary" />
                </label>
              ))}
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-semibold text-slate-700 studio-ui-primary">教育经历（{form.markdownHeadings ? '### 标题分条，其余作正文' : '首行作学校抬头，其余作列表'}）</span>
              <textarea data-studio-control="true"
                rows={3}
                data-native-undo="true"
                value={form.educationText}
                onChange={(e) => updateField('educationText', e.target.value)}
                className="rounded border border-slate-200 p-2 text-slate-900 studio-ui-border studio-ui-primary"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-semibold text-slate-700 studio-ui-primary">工作 / 实习经历</span>
              <textarea data-studio-control="true"
                rows={3}
                data-native-undo="true"
                value={form.experienceText}
                onChange={(e) => updateField('experienceText', e.target.value)}
                className="rounded border border-slate-200 p-2 text-slate-900 studio-ui-border studio-ui-primary"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-semibold text-slate-700 studio-ui-primary">项目经历</span>
              <textarea data-studio-control="true"
                rows={3}
                data-native-undo="true"
                value={form.projectsText}
                onChange={(e) => updateField('projectsText', e.target.value)}
                className="rounded border border-slate-200 p-2 text-slate-900 studio-ui-border studio-ui-primary"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700 studio-ui-primary">专业技能</span>
                <textarea data-studio-control="true"
                  rows={3}
                  data-native-undo="true"
                  value={form.skillsText}
                  onChange={(e) => updateField('skillsText', e.target.value)}
                  className="rounded border border-slate-200 p-2 text-slate-900 studio-ui-border studio-ui-primary"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700 studio-ui-primary">自我评价</span>
                <textarea data-studio-control="true"
                  rows={3}
                  data-native-undo="true"
                  value={form.selfEvaluationText}
                  onChange={(e) => updateField('selfEvaluationText', e.target.value)}
                  className="rounded border border-slate-200 p-2 text-slate-900 studio-ui-border studio-ui-primary"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-slate-700 studio-ui-primary">荣誉奖项（逐行）</span>
              <textarea data-studio-control="true" rows={3} data-native-undo="true" value={form.honorsText} onChange={e=>updateField('honorsText',e.target.value)} className="rounded border border-slate-200 p-2 text-slate-900 studio-ui-border studio-ui-primary" />
            </label>
            {Boolean(form.unclassifiedText?.trim()) && <div ref={unknownRef} tabIndex={-1} data-import-review-unclassified="true" className="space-y-1 rounded border border-amber-200 bg-amber-50 p-2 studio-ui-warning-border studio-ui-warning-surface">
              <p className="font-semibold text-amber-900 studio-ui-warning">未分类或重复原文（必须明确选择处理方式）</p>
              <label className="flex items-start gap-2"><input data-studio-control="true" type="radio" name="import-unclassified" checked={form.keepUnclassified===true} onChange={()=>updateField('keepUnclassified',true)} />保留为禁用栏目（可能含个人信息或重复字段；原生备份包含该栏目）</label>
              <label className="flex items-start gap-2"><input data-studio-control="true" type="radio" name="import-unclassified" checked={form.keepUnclassified===false} onChange={()=>updateField('keepUnclassified',false)} />不保留未分类原文</label>
              <textarea data-studio-control="true" aria-label="未分类原文" rows={3} data-native-undo="true" value={form.unclassifiedText ?? ''} onChange={e=>updateField('unclassifiedText',e.target.value)} className="w-full rounded border border-slate-200 p-2 studio-ui-border" />
              <p>选择不保留时，此栏不会写入新版本，原文件不变。可将需要的内容手动放到上方栏目。</p>
            </div>}
          </fieldset>

          {/* Right: Raw extracted lines for verification */}
          <div ref={sourceRef} tabIndex={-1} role="region" aria-label="原文提取对照" data-import-review-source="true" className="flex min-w-0 flex-col gap-1.5 md:sticky md:top-0 md:self-start">
            <span className="font-semibold text-slate-700 studio-ui-primary">{sourceLabel} {form.sourceKind==='docx'?'正文文字提取对照（非原版式）':'原文提取对照'}</span>
            <pre className="max-h-[48vh] min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-sans text-[11px] leading-relaxed text-slate-700 studio-ui-border studio-ui-raised studio-ui-primary">
              {form.rawText || '（未检测到可提取的文本）'}
            </pre>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs studio-ui-border studio-ui-raised">
          {(needsUnclassifiedDecision || needsDocxReview) && <p role="status" className="mr-auto text-amber-800 studio-ui-warning">{needsDocxReview?'请先确认 DOCX 提取范围。 ':''}{needsUnclassifiedDecision?'请先选择未分类原文的处理方式。':''}</p>}
          <button {...buttonSkin(skins)} data-studio-control="true" type="button" onClick={()=>jump(fieldsRef.current)} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 md:hidden studio-ui-border studio-ui-surface studio-ui-primary">定位字段</button>
          <button {...buttonSkin(skins)} data-studio-control="true" type="button" onClick={()=>jump(sourceRef.current)} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 studio-ui-border studio-ui-surface studio-ui-primary">定位原文</button>
          {(needsUnclassifiedDecision||needsDocxReview)&&<button {...buttonSkin(skins)} data-studio-control="true" type="button" onClick={()=>jump(needsDocxReview?scopeRef.current:unknownRef.current)} className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-900 studio-ui-warning-border studio-ui-warning-surface studio-ui-warning">定位待确认</button>}
          <button {...buttonSkin(skins)} data-studio-control="true"
            type="button"
            onClick={cancel}
            disabled={busy}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100 studio-ui-border studio-ui-surface studio-ui-primary studio-ui-hover"
          >
            取消
          </button>
          <button {...buttonSkin(skins,'primary')} data-studio-control="true"
            type="button"
            disabled={busy || needsUnclassifiedDecision || needsDocxReview}
            onClick={() => void handleConfirm()}
            className="inline-flex items-center gap-1.5 rounded bg-teal-600 px-3.5 py-1.5 font-semibold text-white hover:bg-teal-500 disabled:opacity-50 studio-ui-fill studio-ui-on-fill studio-ui-fill-hover"
          >
            <Check size={13} /> {busy ? '创建中...' : '创建为新简历版本'}
          </button>
        </div>
      </div>
    </div>
  );
}
