import { Check, FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(draft);
    setError(null);
  }, [draft]);

  if (!form) return null;

  const updateField = <K extends keyof PdfImportDraft>(key: K, val: PdfImportDraft[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: val } : prev));
  };

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const doc = buildResumeDocumentFromPdfDraft(form);
      await onCreateVersion(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入创建新版本失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="旧版 PDF 简历解析导入确认"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-white text-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <FileText size={15} className="text-teal-600" /> 本地离线 PDF 解析导入确认
            </h2>
            <p className="text-[11px] text-slate-500">
              纯本地解析提取，可先校准分块内容后另建为独立版本（绝不覆盖现有简历）
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="关闭 PDF 导入弹窗"
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
          <div className="space-y-2.5">
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
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-semibold text-slate-700">教育经历（首行作学校抬头，其余作列表）</span>
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
          </div>

          {/* Right: Raw extracted PDF lines for verification */}
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-slate-700">PDF 原文坐标行序提取对照</span>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-sans text-[11px] leading-relaxed text-slate-700">
              {form.rawText || '（未在 PDF 中检测到可选文本层，可能为纯扫描图片 PDF）'}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
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
