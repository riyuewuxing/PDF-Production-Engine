import {
  BookMarked,
  Check,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Download,
  FileJson,
  FileText,
  History,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, localErrorMessage } from '../../lib/apiClient';
import {
  type PdfImportDraft,
  extractAndParsePdfResume,
  parseResumeTextFile,
  RESUME_IMPORT_PDF_MAX_BYTES,
  RESUME_IMPORT_TEXT_MAX_BYTES,
} from '../../lib/pdfResumeImporter';
import type { ResumeDocument, ResumeSummary } from '../../schema/resumeSchema';
import type { ResumeSnapshotMeta } from '../../server/localFsApi';
import { PdfImportModal } from './PdfImportModal';
import { RecycleBinPanel } from './RecycleBinPanel';
import {WorkspaceBackupPane} from './WorkspaceBackupPane';
import { WriteLockPanel } from './WriteLockPanel';
import { isJsonResumeFormat } from '../../lib/jsonResumeAdapter';

interface VersionAndMasterPaneProps {
  activeSlug: string;
  activeDoc: ResumeDocument;
  summaries: ResumeSummary[];
  masterSummary: ResumeSummary | null;
  onSwitchVersion: (slug: string) => void;
  onCreateVersion: (title: string, sourceSlug?: string) => Promise<void>;
  onRenameVersion: (newTitle: string) => void;
  onDeleteVersion: (slug: string) => Promise<void>;
  onImportJson: (rawJson: unknown, fallbackTitle: string) => Promise<void>;
  onOpenMasterMerge: () => void;
  onRestoreSnapshot: (snapshotId:string) => Promise<void>;
  onRestoreTrash: (id:string,revision:string,asCopy:boolean) => Promise<void>;
  onFlushBeforeMutation: () => Promise<void>;
  getCurrentRevision: () => string;
}

function formatSnapshotTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function VersionAndMasterPane({
  activeSlug,
  activeDoc,
  summaries,
  masterSummary,
  onSwitchVersion,
  onCreateVersion,
  onRenameVersion,
  onDeleteVersion,
  onImportJson,
  onOpenMasterMerge,
  onRestoreSnapshot,
  onRestoreTrash,
  onFlushBeforeMutation,
  getCurrentRevision,
}: VersionAndMasterPaneProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const parsingImport = useRef(false);
  const [newTitleDraft, setNewTitleDraft] = useState('');
  const [cloneSource, setCloneSource] = useState<'current' | 'master'>('current');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfDraft, setPdfDraft] = useState<PdfImportDraft | null>(null);

  const [snapshotsOpen, setSnapshotsOpen] = useState(true);
  const [snapshotState,setSnapshotState]=useState<{slug:string;items:ResumeSnapshotMeta[];unreadableCount:number|null;error:string|null}|null>(null);
  const snapshotView=snapshotState?.slug===activeSlug?snapshotState:null;
  const snapshots=snapshotView?.items??[];
  const snapshotSlug=useRef(activeSlug);snapshotSlug.current=activeSlug;
  const snapshotRequest=useRef(0);
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);

  const refreshSnapshots = useCallback(async () => {
    if(!activeSlug||snapshotSlug.current!==activeSlug)return;
    const seq=++snapshotRequest.current;
    try {
      const inventory=await apiClient.listSnapshotInventory(activeSlug);
      if(seq===snapshotRequest.current&&snapshotSlug.current===activeSlug)setSnapshotState({slug:activeSlug,...inventory,error:null});
    } catch(err) {
      if(seq===snapshotRequest.current&&snapshotSlug.current===activeSlug)setSnapshotState({slug:activeSlug,items:[],unreadableCount:null,error:localErrorMessage(err,'无法读取历史快照。')});
    }
  }, [activeSlug]);

  useEffect(() => {
    void refreshSnapshots();
  }, [refreshSnapshots, activeDoc.updatedAt]);
  useEffect(()=>setSnapshotStatus(null),[activeSlug]);

  const handleCreateManualSnapshot = async () => {
    if (!activeSlug) return;
    setBusy(true);
    setError(null);
    try {
      await onFlushBeforeMutation();
      await apiClient.createSnapshot(activeSlug, '手动创建快照', getCurrentRevision());
      await refreshSnapshots();
      setSnapshotStatus('已创建本地时间机器快照');
      setTimeout(() => setSnapshotStatus(null), 2600);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建快照失败');
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreSnapshot = async (snapshot: ResumeSnapshotMeta) => {
    if (!activeSlug) return;
    if (
      !window.confirm(
        `确定回滚至「${formatSnapshotTime(snapshot.createdAt)} · ${snapshot.reason}」吗？\n系统会先自动备份当前状态以防误操作。`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRestoreSnapshot(snapshot.id);
      await refreshSnapshots();
      setSnapshotStatus('已回滚至选定历史快照（同时保留回滚前备份）');
      setTimeout(() => setSnapshotStatus(null), 3200);
    } catch (err) {
      setError(err instanceof Error ? err.message : '回滚历史快照失败');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    const title = newTitleDraft.trim() || `${activeDoc.title}（新岗位）`;
    setBusy(true);
    setError(null);
    try {
      await onCreateVersion(title, cloneSource === 'master' ? 'master' : activeSlug);
      setNewTitleDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建新版本失败');
    } finally {
      setBusy(false);
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([`${JSON.stringify(activeDoc, null, 2)}\n`], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSlug || 'resume'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if(isJsonResumeFormat(parsed)&&!window.confirm('标准 JSON Resume 仅交换内容；样式、隐藏内容及附件不是完整备份，未知栏目可能位于扩展元数据中。是否导入为新版本？'))return;
      const baseTitle = file.name.replace(/\.json$/i, '') || '导入简历';
      await onImportJson(parsed, baseTitle);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入 JSON 失败，请检查文件格式');
    } finally {
      setBusy(false);
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  };

  const handleTextualImport = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'pdf'|'text') => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || parsingImport.current || busy || pdfDraft) return;
    parsingImport.current = true;
    setError(null);
    setBusy(true);
    try {
      const limit = kind === 'pdf' ? RESUME_IMPORT_PDF_MAX_BYTES : RESUME_IMPORT_TEXT_MAX_BYTES;
      if (file.size > limit) throw new Error(kind === 'pdf' ? 'PDF 文件超过 20 MiB 上限。' : '文本文件超过 1 MiB 上限。');
      const buffer = await file.arrayBuffer();
      const draft = kind === 'pdf' ? await extractAndParsePdfResume(buffer, file.name) : parseResumeTextFile(buffer, file.name);
      setPdfDraft(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : '本地导入解析失败。');
    } finally {
      parsingImport.current = false;
      setBusy(false);
    }
  };

  const handleDelete = async (slug: string, title: string) => {
    if (slug === 'master') return;
    if (!window.confirm(`将简历版本“${title}”移入本地回收站？可在回收站恢复，已投递记录不受影响。`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onDeleteVersion(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <div className="text-xs font-bold text-slate-900">版本与母库管理</div>
        <div className="text-[11px] text-slate-500">管理不同岗位版本、母库合并与本地历史快照</div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-xs">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-2.5 text-red-700">{error}</div>
        )}

        {/* Active Version Title */}
        <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="text-[11px] font-medium text-slate-500">当前编辑版本</div>
          {isRenaming ? (
            <div className="mt-1.5 flex items-center gap-1">
              <input
                type="text"
                autoFocus
                data-native-undo="true"
                aria-label="版本标题"
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const trimmed = renameDraft.trim();
                    if (trimmed) onRenameVersion(trimmed);
                    setIsRenaming(false);
                  }
                  if (e.key === 'Escape') setIsRenaming(false);
                }}
                className="min-w-0 flex-1 rounded border border-slate-400 bg-white px-2 py-1 text-xs text-slate-900"
              />
              <button
                type="button"
                aria-label="确认重命名"
                onClick={() => {
                  const trimmed = renameDraft.trim();
                  if (trimmed) onRenameVersion(trimmed);
                  setIsRenaming(false);
                }}
                className="rounded bg-slate-900 p-1 text-white"
              >
                <Check size={12} />
              </button>
              <button
                type="button"
                aria-label="取消重命名"
                onClick={() => setIsRenaming(false)}
                className="rounded border border-slate-200 bg-white p-1 text-slate-600"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-bold text-slate-900">{activeDoc.title}</span>
              <button
                type="button"
                onClick={() => {
                  setRenameDraft(activeDoc.title);
                  setIsRenaming(true);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
              >
                <Pencil size={11} /> 重命名
              </button>
            </div>
          )}
        </section>

        {/* Master Bank Actions */}
        {activeSlug !== 'master' && (
          <section>
            <button
              type="button"
              disabled={busy}
              onClick={onOpenMasterMerge}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-teal-600 bg-teal-50 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
            >
              <BookMarked size={14} /> 从母库 (master.json) 挑选经历合并到当前版本
            </button>
          </section>
        )}

        {/* Saved Versions List */}
        <section>
          <div className="mb-2 font-semibold text-slate-800">本地简历文件列表</div>
          <div className="space-y-1.5">
            {summaries.map((item) => {
              const isCurrent = item.slug === activeSlug;
              return (
                <div
                  key={item.slug}
                  className={`flex items-center justify-between gap-2 rounded-md border p-2.5 ${
                    isCurrent ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSwitchVersion(item.slug)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                      data/resumes/{item.slug}.json
                    </div>
                  </button>
                  {(summaries.length > 1 || masterSummary) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDelete(item.slug, item.title)}
                      aria-label={`删除${item.title}`}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}

            {masterSummary && (
              <div
                className={`flex items-center justify-between gap-2 rounded-md border p-2.5 ${
                  activeSlug === 'master'
                    ? 'border-amber-600 bg-amber-50/70'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSwitchVersion('master')}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate font-semibold text-slate-900">
                    母库：{masterSummary.title}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-400">data/master.json</div>
                </button>
              </div>
            )}
          </div>
        </section>

        <RecycleBinPanel onRestore={onRestoreTrash} refreshKey={summaries.length} />
        <WriteLockPanel/>
        <WorkspaceBackupPane onFlush={onFlushBeforeMutation}/>

        {/* Local Disk Time Machine Snapshots */}
        <section className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSnapshotsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 font-semibold text-slate-800"
            >
              {snapshotsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <History size={13} className="text-teal-700" />
              <span>历史快照回滚 {snapshotView?.error?'（检查失败）':!snapshotView?'（检查中）':`(${snapshots.length}/15)`}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCreateManualSnapshot()}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              手动创建快照
            </button>
          </div>

          {snapshotStatus && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
              {snapshotStatus}
            </div>
          )}

          {snapshotView?.error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">历史快照检查失败：{snapshotView.error} 未确认磁盘历史记录数量。</p>}
          {!snapshotView?.error&&typeof snapshotView?.unreadableCount==='number'&&snapshotView.unreadableCount>0&&<p role="alert" className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">有 {snapshotView.unreadableCount} 份异常快照，原文件保留，不计入 15 份有效快照上限。请在本地核对原件或备份。</p>}
          {snapshotView&&!snapshotView.error&&snapshotView.unreadableCount===null&&<p className="text-[11px] text-slate-600">当前桥接版本无法检查异常快照数量。</p>}
          {snapshotsOpen && (
            <div className="space-y-1.5">
              {!snapshotView ? <p className="text-[11px] text-slate-500">正在检查磁盘快照…</p> : snapshotView.error ? null : snapshots.length === 0 ? (
                <div className="rounded border border-dashed border-slate-200 bg-white p-3 text-center text-[11px] text-slate-400">
                  暂无磁盘快照。导出 PDF/DOCX、母库合并或点击右上角“手动创建快照”时将自动留存（最多滚动保留 15 份）。
                </div>
              ) : (
                snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-semibold text-slate-700">
                          {formatSnapshotTime(snap.createdAt)}
                        </span>
                        <span className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                          {snap.reason}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-slate-400">
                        模板：{snap.templateId} · 约 {snap.charCount} 字
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRestoreSnapshot(snap)}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-teal-200 bg-teal-50 px-2 py-1 text-[10px] font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-40"
                    >
                      <RotateCcw size={10} /> 回滚
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* Create / Clone New Version */}
        <section className="rounded-lg border border-slate-200 p-3 space-y-2.5">
          <div className="font-semibold text-slate-800">新建 / 复制新岗位版本</div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setCloneSource('current')}
              className={`flex-1 rounded border py-1 font-medium ${
                cloneSource === 'current'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 text-slate-700'
              }`}
            >
              基于当前版本
            </button>
            {masterSummary && (
              <button
                type="button"
                onClick={() => setCloneSource('master')}
                className={`flex-1 rounded border py-1 font-medium ${
                  cloneSource === 'master'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 text-slate-700'
                }`}
              >
                从母库派生
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              data-native-undo="true"
              value={newTitleDraft}
              onChange={(e) => setNewTitleDraft(e.target.value)}
              placeholder="输入新岗位名称，如：物理教研员"
              className="min-w-0 flex-1 rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCreate()}
              className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-900 px-2.5 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              <CopyPlus size={13} /> 创建
            </button>
          </div>
        </section>

        {/* Import / Export JSON & Legacy PDF */}
        <section className="space-y-2 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <FileJson size={14} /> 导入简历与本地备份
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFile}
            className="hidden"
          />
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={e=>void handleTextualImport(e,'pdf')}
            className="hidden"
          />
          <input ref={textInputRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={e=>void handleTextualImport(e,'text')} className="hidden" />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy || Boolean(pdfDraft)}
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 rounded border border-slate-200 bg-white py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              <Upload size={13} /> 导入 JSON
            </button>
            <button
              type="button"
              disabled={busy || Boolean(pdfDraft)}
              onClick={() => pdfInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 rounded border border-teal-200 bg-teal-50 py-1.5 font-medium text-teal-800 hover:bg-teal-100"
            >
              <FileText size={13} /> 从旧 PDF 导入
            </button>
            <button type="button" disabled={busy || Boolean(pdfDraft)} onClick={()=>textInputRef.current?.click()} className="col-span-2 rounded border border-slate-200 bg-white py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">从 TXT / Markdown 导入</button>
          </div>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-slate-200 bg-white py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download size={13} /> 导出备份 JSON
          </button>
        </section>
      </div>

      <PdfImportModal
        draft={pdfDraft}
        onCancel={() => setPdfDraft(null)}
        onCreateVersion={async (doc) => {
          await onImportJson(doc, doc.title);
          setPdfDraft(null);
        }}
      />
    </div>
  );
}
