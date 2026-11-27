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
  const [form, setForm] = useState<PdfImportDraft | null>(draft);
  const [busy, setBusy] = useState(false);
  const confirming = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(draft);
    setError(null);
  }, [draft]);

  if (!form) return null;

  const updateField = <K extends keyof PdfImportDraft>(key: K, val: PdfImportDraft[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: val } : prev));
  };

  const needsUnclassifiedDecision = Boolean(form.unclassifiedText?.trim()) && form.keepUnclassified===undefined;
  const handleConfirm = async () => {
    if (confirming.current || needsUnclassifiedDecision) return;
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
  const sourceLabel = form.sourceKind === 'text' ? 'TXT / Markdown' : 'PDF';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={form.sourceKind === 'text' ? 'TXT / Markdown 简历解析导入确认' : '旧版 PDF 简历解析导入确认'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
      onClick={cancel}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-white text-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <FileText size={15} className="text-teal-600" /> 本地离线 {sourceLabel} 解析导入确认
            </h2>
            <p className="text-[11px] text-slate-500">
              本地启发式提取，所有字段均为待核对候选，并非事实验证。Markdown 仅识别常见二级章节、三级经历标题；原文件不变。确认后另建独立版本。
            </p>
          </div>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            aria-label="关闭导入弹窗"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 text-xs md:grid-cols-2">
          {error && (
            <div className="col-span-full rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              {error}
            </div>
          )}

          {/* Left: Editable parsed blocks */}
          <fieldset disabled={busy} className="min-w-0 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700">新版本标题</span>
                <input
                  type="text"
                  data-native-undo="true"
                  value={form.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  className="rounded border border-slate-200 px-2 py-1.5 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700">姓名</span>
                <input
                  type="text"
                  data-native-undo="true"
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  className="rounded border border-slate-200 px-2 py-1.5 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700">意向岗位</span>
                <input
                  type="text"
                  data-native-undo="true"
                  value={form.jobTitle}
                  onChange={(e) => updateField('jobTitle', e.target.value)}
                  className="rounded border border-slate-200 px-2 py-1.5 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700">电话</span>
                <input
                  type="text"
                  data-native-undo="true"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  className="rounded border border-slate-200 px-2 py-1.5 text-slate-900"
                />
              </label>
              {([
                ['email','邮箱'], ['location','所在地'], ['birthDate','出生日期'], ['employmentStatus','状态（可留空）']
              ] as const).map(([key,label]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="font-semibold text-slate-700">{label}</span>
                  <input type="text" data-native-undo="true" value={form[key] ?? ''} onChange={e=>updateField(key,e.target.value)} className="rounded border border-slate-200 px-2 py-1.5 text-slate-900" />
                </label>
              ))}
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-semibold text-slate-700">教育经历（{form.markdownHeadings ? '### 标题分条，其余作正文' : '首行作学校抬头，其余作列表'}）</span>
              <textarea
                rows={3}
                data-native-undo="true"
                value={form.educationText}
                onChange={(e) => updateField('educationText', e.target.value)}
                className="rounded border border-slate-200 p-2 text-slate-900"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-semibold text-slate-700">工作 / 实习经历</span>
              <textarea
                rows={3}
                data-native-undo="true"
                value={form.experienceText}
                onChange={(e) => updateField('experienceText', e.target.value)}
                className="rounded border border-slate-200 p-2 text-slate-900"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-semibold text-slate-700">项目经历</span>
              <textarea
                rows={3}
                data-native-undo="true"
                value={form.projectsText}
                onChange={(e) => updateField('projectsText', e.target.value)}
                className="rounded border border-slate-200 p-2 text-slate-900"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700">专业技能</span>
                <textarea
                  rows={3}
                  data-native-undo="true"
                  value={form.skillsText}
                  onChange={(e) => updateField('skillsText', e.target.value)}
                  className="rounded border border-slate-200 p-2 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700">自我评价</span>
                <textarea
                  rows={3}
                  data-native-undo="true"
                  value={form.selfEvaluationText}
                  onChange={(e) => updateField('selfEvaluationText', e.target.value)}
                  className="rounded border border-slate-200 p-2 text-slate-900"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-slate-700">荣誉奖项（逐行）</span>
              <textarea rows={3} data-native-undo="true" value={form.honorsText} onChange={e=>updateField('honorsText',e.target.value)} className="rounded border border-slate-200 p-2 text-slate-900" />
            </label>
            {Boolean(form.unclassifiedText?.trim()) && <div className="space-y-1 rounded border border-amber-200 bg-amber-50 p-2">
              <p className="font-semibold text-amber-900">未分类或重复原文（必须明确选择处理方式）</p>
              <label className="flex items-start gap-2"><input type="radio" name="import-unclassified" checked={form.keepUnclassified===true} onChange={()=>updateField('keepUnclassified',true)} />保留为禁用栏目（可能含个人信息或重复字段；原生备份包含该栏目）</label>
              <label className="flex items-start gap-2"><input type="radio" name="import-unclassified" checked={form.keepUnclassified===false} onChange={()=>updateField('keepUnclassified',false)} />不保留未分类原文</label>
              <textarea aria-label="未分类原文" rows={3} data-native-undo="true" value={form.unclassifiedText ?? ''} onChange={e=>updateField('unclassifiedText',e.target.value)} className="w-full rounded border border-slate-200 p-2" />
              <p>选择不保留时，此栏不会写入新版本，原文件不变。可将需要的内容手动放到上方栏目。</p>
            </div>}
          </fieldset>

          {/* Right: Raw extracted lines for verification */}
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-slate-700">{sourceLabel} 原文提取对照</span>
            <pre className="max-h-[60vh] flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-sans text-[11px] leading-relaxed text-slate-700">
              {form.rawText || '（未检测到可提取的文本）'}
            </pre>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs">
          {needsUnclassifiedDecision && <p role="status" className="mr-auto text-amber-800">请先选择未分类原文的处理方式。</p>}
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || needsUnclassifiedDecision}
            onClick={() => void handleConfirm()}
            className="inline-flex items-center gap-1.5 rounded bg-teal-600 px-3.5 py-1.5 font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
          >
            <Check size={13} /> {busy ? '创建中...' : '创建为新简历版本'}
          </button>
        </div>
      </div>
    </div>
  );
}
