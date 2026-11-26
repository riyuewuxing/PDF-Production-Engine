import { CheckSquare, Loader2, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { MasterMergeSelection, mergeMasterItemsIntoResume } from '../../lib/masterMerge';
import type { ResumeDocument } from '../../schema/resumeSchema';

interface MasterMergeModalProps {
  isOpen: boolean;
  currentDoc: ResumeDocument;
  onMerge: (nextDoc: ResumeDocument) => void;
  onClose: () => void;
}

export function MasterMergeModal({
  isOpen,
  currentDoc,
  onMerge,
  onClose,
}: MasterMergeModalProps) {
  const [masterDoc, setMasterDoc] = useState<ResumeDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedEdu, setSelectedEdu] = useState<string[]>([]);
  const [selectedExp, setSelectedExp] = useState<string[]>([]);
  const [selectedProj, setSelectedProj] = useState<string[]>([]);
  const [selectedCustom, setSelectedCustom] = useState<Record<string, string[]>>({});
  const [skillMode, setSkillMode] = useState<'append' | 'replace' | null>(null);
  const [evalMode, setEvalMode] = useState<'append' | 'replace' | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedEdu([]);
    setSelectedExp([]);
    setSelectedProj([]);
    setSelectedCustom({});
    setSkillMode(null);
    setEvalMode(null);

    apiClient
      .getResume('master')
      .then((doc) => {
        if (!cancelled) setMasterDoc(doc);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载母库 master.json 失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleId = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const handleConfirmMerge = () => {
    if (!masterDoc) return;
    const selection: MasterMergeSelection = {
      educationIds: selectedEdu,
      experienceIds: selectedExp,
      projectIds: selectedProj,
      customItems: selectedCustom,
      includeSkillContent: skillMode,
      includeSelfEvaluation: evalMode,
    };
    const nextDoc = mergeMasterItemsIntoResume(currentDoc, masterDoc, selection);
    onMerge(nextDoc);
    onClose();
  };

  const totalSelected =
    selectedEdu.length +
    selectedExp.length +
    selectedProj.length +
    Object.values(selectedCustom).reduce((sum, arr) => sum + arr.length, 0) +
    (skillMode ? 1 : 0) +
    (evalMode ? 1 : 0);

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="从母库挑选经历"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 className="text-base font-bold text-slate-900">从母库 (master.json) 挑选合并条目</h2>
            <p className="text-xs text-slate-500">勾选需要引入当前岗位的经历条目，合并后可继续针对本岗位微调</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭母库挑选弹窗"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-12 text-sm text-slate-500">
              <Loader2 size={16} className="mr-2 animate-spin" /> 正在读取 master.json...
            </div>
          )}

          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {error}
            </div>
          )}

          {masterDoc && !loading && (
            <>
              {/* Education */}
              {masterDoc.education.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold text-slate-700">教育经历</h3>
                  <div className="space-y-1.5">
                    {masterDoc.education.map((edu) => {
                      const checked = selectedEdu.includes(edu.id);
                      return (
                        <button
                          key={edu.id}
                          type="button"
                          onClick={() => setSelectedEdu((prev) => toggleId(prev, edu.id))}
                          className={`flex w-full items-center gap-2.5 rounded border p-2.5 text-left text-xs ${
                            checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {checked ? <CheckSquare size={15} className="text-slate-900" /> : <Square size={15} className="text-slate-400" />}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900">
                              {edu.school} · {edu.major}（{edu.degree}）
                            </div>
                            <div className="text-slate-500">{[edu.startDate, edu.endDate].filter(Boolean).join(' - ')}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Experience */}
              {masterDoc.experience.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold text-slate-700">工作/实习经历</h3>
                  <div className="space-y-1.5">
                    {masterDoc.experience.map((exp) => {
                      const checked = selectedExp.includes(exp.id);
                      return (
                        <button
                          key={exp.id}
                          type="button"
                          onClick={() => setSelectedExp((prev) => toggleId(prev, exp.id))}
                          className={`flex w-full items-center gap-2.5 rounded border p-2.5 text-left text-xs ${
                            checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {checked ? <CheckSquare size={15} className="text-slate-900" /> : <Square size={15} className="text-slate-400" />}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900">
                              {exp.company} · {exp.position}
                            </div>
                            <div className="text-slate-500">{[exp.startDate, exp.endDate].filter(Boolean).join(' - ')}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Projects */}
              {masterDoc.projects.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold text-slate-700">项目经历</h3>
                  <div className="space-y-1.5">
                    {masterDoc.projects.map((proj) => {
                      const checked = selectedProj.includes(proj.id);
                      return (
                        <button
                          key={proj.id}
                          type="button"
                          onClick={() => setSelectedProj((prev) => toggleId(prev, proj.id))}
                          className={`flex w-full items-center gap-2.5 rounded border p-2.5 text-left text-xs ${
                            checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {checked ? <CheckSquare size={15} className="text-slate-900" /> : <Square size={15} className="text-slate-400" />}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900">{proj.name}</div>
                            <div className="text-slate-500">
                              {proj.role} {proj.date ? `· ${proj.date}` : ''}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom Sections */}
              {Object.entries(masterDoc.customData).map(([secId, items]) => {
                if (items.length === 0) return null;
                const secTitle = masterDoc.menuSections.find((s) => s.id === secId)?.title ?? secId;
                const currentPicked = selectedCustom[secId] ?? [];
                return (
                  <div key={secId}>
                    <h3 className="mb-2 text-xs font-bold text-slate-700">{secTitle}</h3>
                    <div className="space-y-1.5">
                      {items.map((item) => {
                        const checked = currentPicked.includes(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() =>
                              setSelectedCustom((prev) => ({
                                ...prev,
                                [secId]: toggleId(prev[secId] ?? [], item.id),
                              }))
                            }
                            className={`flex w-full items-center gap-2.5 rounded border p-2.5 text-left text-xs ${
                              checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {checked ? <CheckSquare size={15} className="text-slate-900" /> : <Square size={15} className="text-slate-400" />}
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-slate-900">{item.title}</div>
                              {item.dateRange && <div className="text-slate-500">{item.dateRange}</div>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Rich text sections */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {masterDoc.skillContent.trim() && (
                  <div className="rounded border border-slate-200 p-3 text-xs">
                    <div className="font-semibold text-slate-800">专业技能文案</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSkillMode((m) => (m === 'append' ? null : 'append'))}
                        className={`rounded border px-2 py-1 ${
                          skillMode === 'append' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        追加到当前
                      </button>
                      <button
                        type="button"
                        onClick={() => setSkillMode((m) => (m === 'replace' ? null : 'replace'))}
                        className={`rounded border px-2 py-1 ${
                          skillMode === 'replace' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        覆盖当前
                      </button>
                    </div>
                  </div>
                )}

                {masterDoc.selfEvaluationContent.trim() && (
                  <div className="rounded border border-slate-200 p-3 text-xs">
                    <div className="font-semibold text-slate-800">自我评价文案</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEvalMode((m) => (m === 'append' ? null : 'append'))}
                        className={`rounded border px-2 py-1 ${
                          evalMode === 'append' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        追加到当前
                      </button>
                      <button
                        type="button"
                        onClick={() => setEvalMode((m) => (m === 'replace' ? null : 'replace'))}
                        className={`rounded border px-2 py-1 ${
                          evalMode === 'replace' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        覆盖当前
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <span className="text-xs text-slate-500">已选择 {totalSelected} 项</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={totalSelected === 0}
              onClick={handleConfirmMerge}
              className="rounded bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              合并选中条目到当前简历
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
