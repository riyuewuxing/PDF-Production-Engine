import { useStudioComponentSkins } from '../../studio-theme/StudioThemeProvider';
import { fieldSkin, iconSkin, buttonSkin } from '../../studio-theme/componentSkins';
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
import type { StudioThemeId } from '../../studio-theme/presets';
import { surfaceStyle } from '../../studio-theme/surfaces';
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
import { VersionCompareModal } from './VersionCompareModal';
import { parseDocxResume, RESUME_IMPORT_DOCX_MAX_BYTES } from '../../lib/docxResumeImporter';
import { RecycleBinPanel } from './RecycleBinPanel';
import {WorkspaceBackupPane} from './WorkspaceBackupPane';
import { WriteLockPanel } from './WriteLockPanel';
import { isJsonResumeFormat } from '../../lib/jsonResumeAdapter';

interface VersionAndMasterPaneProps {
  studioThemeId?: StudioThemeId;
  activeSlug: string;
  comparisonDisabled?: boolean;
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

/** Bound browser/Chromium file reads, including slow removable or network-backed paths. */
function readImportFile(file:File,signal:AbortSignal):Promise<ArrayBuffer> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new Error('本地导入解析已取消。'));return;}
    const reader=new FileReader();
    let timer:ReturnType<typeof setTimeout>;
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reader.onload=null;reader.onerror=null;reader.onabort=null;};
    const fail=(message:string)=>{cleanup();try{if(reader.readyState===FileReader.LOADING)reader.abort();}catch{/* already stopped */}reject(new Error(message));};
    const cancel=()=>fail('本地导入解析已取消。');
    timer=setTimeout(()=>fail('读取本地文件超过 10 秒，已请求停止。'),10_000);
    signal.addEventListener('abort',cancel,{once:true});
    reader.onload=()=>{const result=reader.result;cleanup();if(result instanceof ArrayBuffer)resolve(result);else reject(new Error('无法读取本地文件。'));};
    reader.onerror=()=>fail('无法读取本地文件。');
    reader.onabort=()=>fail('本地导入解析已取消。');
    try{reader.readAsArrayBuffer(file);}catch{fail('无法读取本地文件。');}
  });
}

function formatSnapshotTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function VersionAndMasterPane({
  studioThemeId = 'classic',
  activeSlug,
  comparisonDisabled=false,
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
  const skins=useStudioComponentSkins();
  const importInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);
  const parsingImport = useRef<AbortController|null>(null);
  const [parsingTextualImport, setParsingTextualImport] = useState(false);
  const importMounted=useRef(false);
  useEffect(()=>{importMounted.current=true;return()=>{importMounted.current=false;parsingImport.current?.abort();};},[]);
  const [newTitleDraft, setNewTitleDraft] = useState('');
  const [cloneSource, setCloneSource] = useState<'current' | 'master'>('current');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfDraft, setPdfDraft] = useState<PdfImportDraft | null>(null);
  const [comparison,setComparison]=useState<{slug:string;snapshotId?:string}|null>(null);
  useEffect(()=>{setComparison(null);},[activeSlug,comparisonDisabled]);

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

  const handleTextualImport = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'pdf'|'text'|'docx') => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || parsingImport.current || busy || pdfDraft) return;
    const controller = new AbortController();
    parsingImport.current = controller;
    setParsingTextualImport(true);
    setError(null);
    setBusy(true);
    try {
      const limit = kind === 'pdf' ? RESUME_IMPORT_PDF_MAX_BYTES : kind === 'docx' ? RESUME_IMPORT_DOCX_MAX_BYTES : RESUME_IMPORT_TEXT_MAX_BYTES;
      if (file.size > limit) throw new Error(kind === 'pdf' ? 'PDF 文件超过 20 MiB 上限。' : kind === 'docx' ? 'DOCX 文件超过 20 MiB 上限。' : '文本文件超过 1 MiB 上限。');
      const buffer = await readImportFile(file,controller.signal);
      if(controller.signal.aborted)throw new Error('本地导入解析已取消。');
      const draft = kind === 'pdf' ? await extractAndParsePdfResume(buffer, file.name,controller.signal) : kind === 'docx' ? await parseDocxResume(buffer,file.name,controller.signal) : parseResumeTextFile(buffer, file.name);
      if(importMounted.current&&!controller.signal.aborted)setPdfDraft(draft);
    } catch (err) {
      if(importMounted.current)setError(err instanceof Error ? err.message : '本地导入解析失败。');
    } finally {
      if(parsingImport.current===controller)parsingImport.current=null;
      if(importMounted.current){setParsingTextualImport(false);setBusy(false);}
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
    <div className="flex h-full flex-col bg-white studio-ui-surface">
      <div data-studio-region="versions-header" data-studio-surface="panel" data-studio-theme={studioThemeId} style={surfaceStyle(studioThemeId, 'panel')} className="border-b border-slate-200 studio-ui-border px-4 py-2.5">
        <div className="text-xs font-bold text-slate-900 studio-ui-primary">版本与母库管理</div>
        <div className="text-[11px] text-slate-500 studio-ui-muted">管理不同岗位版本、母库合并与本地历史快照</div>
      </div>

      <div data-studio-region="versions-body" data-studio-surface="panel" data-studio-theme={studioThemeId} style={surfaceStyle(studioThemeId, 'panel')} className="flex-1 space-y-5 overflow-y-auto p-4 text-xs">
        {error && (
          <div className="rounded border border-red-200 studio-ui-error-border bg-red-50 studio-ui-error-surface p-2.5 text-red-700 studio-ui-error">{error}</div>
        )}

        {/* Active Version Title */}
        <section className="rounded-lg border border-slate-200 studio-ui-border bg-slate-50/60 studio-ui-raised p-3">
          <div className="text-[11px] font-medium text-slate-500 studio-ui-muted">当前编辑版本</div>
          {isRenaming ? (
            <div className="mt-1.5 flex items-center gap-1">
              <input {...fieldSkin(skins,'text')} data-studio-control="true"
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
                className="min-w-0 flex-1 rounded border border-slate-400 studio-ui-border bg-white studio-ui-surface px-2 py-1 text-xs text-slate-900 studio-ui-primary"
              />
              <button {...iconSkin(skins,'primary')} data-studio-control="true"
                type="button"
                aria-label="确认重命名"
                onClick={() => {
                  const trimmed = renameDraft.trim();
                  if (trimmed) onRenameVersion(trimmed);
                  setIsRenaming(false);
                }}
                className="rounded bg-slate-900 studio-ui-fill p-1 text-white studio-ui-on-fill"
              >
                <Check size={12} />
              </button>
              <button {...iconSkin(skins)} data-studio-control="true"
                type="button"
                aria-label="取消重命名"
                onClick={() => setIsRenaming(false)}
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface p-1 text-slate-600 studio-ui-muted"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-bold text-slate-900 studio-ui-primary">{activeDoc.title}</span>
              <button {...buttonSkin(skins)} data-studio-control="true"
                type="button"
                onClick={() => {
                  setRenameDraft(activeDoc.title);
                  setIsRenaming(true);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1 text-[11px] text-slate-600 studio-ui-muted hover:bg-slate-50 studio-ui-hover"
              >
                <Pencil size={11} /> 重命名
              </button>
            </div>
          )}
        </section>

        <section className="space-y-1">
          <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={busy||comparisonDisabled||Boolean(pdfDraft)} onClick={()=>setComparison({slug:activeSlug})} className="w-full rounded-lg border border-teal-600 studio-ui-selected-border bg-teal-50 studio-ui-selected py-2 font-semibold text-teal-800 studio-ui-selected-text disabled:opacity-50">对比版本 / 历史快照</button>
          {comparisonDisabled&&<p className="text-[11px] text-slate-600 studio-ui-muted">脱敏预览开启时禁止查看原始版本差异。</p>}
        </section>

        {/* Master Bank Actions */}
        {activeSlug !== 'master' && (
          <section>
            <button {...buttonSkin(skins,'primary')} data-studio-control="true"
              type="button"
              disabled={busy}
              onClick={onOpenMasterMerge}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-teal-600 studio-ui-selected-border bg-teal-50 studio-ui-selected py-2 text-xs font-semibold text-teal-800 studio-ui-selected-text hover:bg-teal-100 studio-ui-selected-hover disabled:opacity-50"
            >
              <BookMarked size={14} /> 从母库 (master.json) 挑选经历合并到当前版本
            </button>
          </section>
        )}

        {/* Saved Versions List */}
        <section>
          <div className="mb-2 font-semibold text-slate-800 studio-ui-primary">本地简历文件列表</div>
          <div className="space-y-1.5">
            {summaries.map((item) => {
              const isCurrent = item.slug === activeSlug;
              return (
                <div
                  key={item.slug}
                  className={`flex items-center justify-between gap-2 rounded-md border p-2.5 ${
                    isCurrent ? 'border-slate-900 studio-ui-selected-border bg-slate-50 studio-ui-selected' : 'border-slate-200 studio-ui-border bg-white studio-ui-surface hover:bg-slate-50 studio-ui-hover'
                  }`}
                >
                  <button data-studio-control="true"
                    type="button"
                    onClick={() => onSwitchVersion(item.slug)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate font-semibold text-slate-900 studio-ui-primary">{item.title}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400 studio-ui-muted">
                      data/resumes/{item.slug}.json
                    </div>
                  </button>
                  {(summaries.length > 1 || masterSummary) && (
                    <button {...iconSkin(skins,'danger')} data-studio-control="true"
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDelete(item.slug, item.title)}
                      aria-label={`删除${item.title}`}
                      className="rounded p-1 text-slate-400 studio-ui-muted hover:bg-red-50 studio-ui-error-hover hover:text-red-600 studio-ui-error-hover-text"
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
                    ? 'border-amber-600 studio-ui-warning-border bg-amber-50/70 studio-ui-warning-surface'
                    : 'border-slate-200 studio-ui-border bg-white studio-ui-surface hover:bg-slate-50 studio-ui-hover'
                }`}
              >
                <button data-studio-control="true"
                  type="button"
                  onClick={() => onSwitchVersion('master')}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate font-semibold text-slate-900 studio-ui-primary">
                    母库：{masterSummary.title}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-400 studio-ui-muted">data/master.json</div>
                </button>
              </div>
            )}
          </div>
        </section>

        <RecycleBinPanel onRestore={onRestoreTrash} refreshKey={summaries.length} />
        <WriteLockPanel/>
        <WorkspaceBackupPane onFlush={onFlushBeforeMutation}/>

        {/* Local Disk Time Machine Snapshots */}
        <section className="rounded-lg border border-slate-200 studio-ui-border bg-slate-50/50 studio-ui-raised p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <button data-studio-control="true"
              type="button"
              onClick={() => setSnapshotsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 font-semibold text-slate-800 studio-ui-primary"
            >
              {snapshotsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <History size={13} className="text-teal-700 studio-ui-selected-text" />
              <span>历史快照回滚 {snapshotView?.error?'（检查失败）':!snapshotView?'（检查中）':`(${snapshots.length}/15)`}</span>
            </button>
            <button {...buttonSkin(skins,'primary')} data-studio-control="true"
              type="button"
              disabled={busy}
              onClick={() => void handleCreateManualSnapshot()}
              className="rounded border border-slate-300 studio-ui-border bg-white studio-ui-surface px-2 py-1 text-[11px] font-medium text-slate-700 studio-ui-primary hover:bg-slate-100 studio-ui-hover disabled:opacity-40"
            >
              手动创建快照
            </button>
          </div>

          {snapshotStatus && (
            <div className="rounded border border-emerald-200 studio-ui-success-border bg-emerald-50 studio-ui-success-surface px-2 py-1 text-[11px] text-emerald-700 studio-ui-success">
              {snapshotStatus}
            </div>
          )}

          {snapshotView?.error&&<p role="alert" className="rounded border border-red-200 studio-ui-error-border bg-red-50 studio-ui-error-surface p-2 text-[11px] text-red-800 studio-ui-error">历史快照检查失败：{snapshotView.error} 未确认磁盘历史记录数量。</p>}
          {!snapshotView?.error&&typeof snapshotView?.unreadableCount==='number'&&snapshotView.unreadableCount>0&&<p role="alert" className="rounded border border-amber-200 studio-ui-warning-border bg-amber-50 studio-ui-warning-surface p-2 text-[11px] text-amber-900 studio-ui-warning">有 {snapshotView.unreadableCount} 份异常快照，原文件保留，不计入 15 份有效快照上限。请在本地核对原件或备份。</p>}
          {snapshotView&&!snapshotView.error&&snapshotView.unreadableCount===null&&<p className="text-[11px] text-slate-600 studio-ui-muted">当前桥接版本无法检查异常快照数量。</p>}
          {snapshotsOpen && (
            <div className="space-y-1.5">
              {!snapshotView ? <p className="text-[11px] text-slate-500 studio-ui-muted">正在检查磁盘快照…</p> : snapshotView.error ? null : snapshots.length === 0 ? (
                <div className="rounded border border-dashed border-slate-200 studio-ui-border bg-white studio-ui-surface p-3 text-center text-[11px] text-slate-400 studio-ui-muted">
                  暂无磁盘快照。导出 PDF/DOCX、母库合并或点击右上角“手动创建快照”时将自动留存（最多滚动保留 15 份）。
                </div>
              ) : (
                snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="flex items-center justify-between gap-2 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-semibold text-slate-700 studio-ui-primary">
                          {formatSnapshotTime(snap.createdAt)}
                        </span>
                        <span className="truncate rounded bg-slate-100 studio-ui-raised px-1.5 py-0.5 text-[10px] text-slate-600 studio-ui-muted">
                          {snap.reason}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-slate-400 studio-ui-muted">
                        模板：{snap.templateId} · 约 {snap.charCount} 字
                      </div>
                    </div>
                    <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={busy||comparisonDisabled||Boolean(pdfDraft)} onClick={()=>setComparison({slug:activeSlug,snapshotId:snap.id})} aria-label={'对比历史快照 '+formatSnapshotTime(snap.createdAt)} className="shrink-0 rounded border border-slate-300 studio-ui-border px-2 py-1 text-[10px] font-semibold text-slate-700 studio-ui-primary disabled:opacity-50">对比</button>
                    <button {...buttonSkin(skins,'primary')} data-studio-control="true"
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRestoreSnapshot(snap)}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-teal-200 studio-ui-selected-border bg-teal-50 studio-ui-selected px-2 py-1 text-[10px] font-semibold text-teal-800 studio-ui-selected-text hover:bg-teal-100 studio-ui-selected-hover disabled:opacity-40"
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
        <section className="rounded-lg border border-slate-200 studio-ui-border p-3 space-y-2.5">
          <div className="font-semibold text-slate-800 studio-ui-primary">新建 / 复制新岗位版本</div>
          <div className="flex gap-1.5">
            <button data-studio-control="true"
              type="button"
              onClick={() => setCloneSource('current')}
              className={`flex-1 rounded border py-1 font-medium ${
                cloneSource === 'current'
                  ? 'border-slate-900 studio-ui-selected-border bg-slate-900 studio-ui-fill text-white studio-ui-on-fill'
                  : 'border-slate-200 studio-ui-border text-slate-700 studio-ui-primary'
              }`}
            >
              基于当前版本
            </button>
            {masterSummary && (
              <button data-studio-control="true"
                type="button"
                onClick={() => setCloneSource('master')}
                className={`flex-1 rounded border py-1 font-medium ${
                  cloneSource === 'master'
                    ? 'border-slate-900 studio-ui-selected-border bg-slate-900 studio-ui-fill text-white studio-ui-on-fill'
                    : 'border-slate-200 studio-ui-border text-slate-700 studio-ui-primary'
                }`}
              >
                从母库派生
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <input {...fieldSkin(skins,'text')} data-studio-control="true"
              type="text"
              data-native-undo="true"
              value={newTitleDraft}
              onChange={(e) => setNewTitleDraft(e.target.value)}
              placeholder="输入新岗位名称，如：物理教研员"
              className="min-w-0 flex-1 rounded border border-slate-200 studio-ui-border px-2.5 py-1.5 text-xs text-slate-900 studio-ui-primary focus:border-slate-500 studio-ui-focus-border focus:outline-none"
            />
            <button {...buttonSkin(skins,'primary')} data-studio-control="true"
              type="button"
              disabled={busy}
              onClick={() => void handleCreate()}
              className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-900 studio-ui-fill px-2.5 py-1.5 font-medium text-white studio-ui-on-fill hover:bg-slate-800 studio-ui-fill-hover disabled:opacity-40"
            >
              <CopyPlus size={13} /> 创建
            </button>
          </div>
        </section>

        {/* Import / Export JSON & Legacy PDF */}
        <section className="space-y-2 border-t border-slate-100 studio-ui-divider pt-3">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800 studio-ui-primary">
            <FileJson size={14} /> 导入简历与本地备份
          </div>
          <input data-studio-control="true"
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFile}
            className="hidden"
          />
          <input data-studio-control="true"
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={e=>void handleTextualImport(e,'pdf')}
            className="hidden"
          />
          <input data-studio-control="true" ref={textInputRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={e=>void handleTextualImport(e,'text')} className="hidden" />
          <input data-studio-control="true" ref={docxInputRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>void handleTextualImport(e,'docx')} className="hidden" />
          <div className="grid grid-cols-2 gap-2">
            <button {...buttonSkin(skins)} data-studio-control="true"
              type="button"
              disabled={busy || Boolean(pdfDraft)}
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface py-1.5 font-medium text-slate-700 studio-ui-primary hover:bg-slate-50 studio-ui-hover"
            >
              <Upload size={13} /> 导入 JSON
            </button>
            <button {...buttonSkin(skins)} data-studio-control="true"
              type="button"
              disabled={busy || Boolean(pdfDraft)}
              onClick={() => pdfInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 rounded border border-teal-200 studio-ui-selected-border bg-teal-50 studio-ui-selected py-1.5 font-medium text-teal-800 studio-ui-selected-text hover:bg-teal-100 studio-ui-selected-hover"
            >
              <FileText size={13} /> 从旧 PDF 导入
            </button>
            <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={busy || Boolean(pdfDraft)} onClick={()=>textInputRef.current?.click()} className="col-span-2 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface py-1.5 font-medium text-slate-700 studio-ui-primary hover:bg-slate-50 studio-ui-hover disabled:opacity-40">从 TXT / Markdown 导入</button>
            <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={busy || Boolean(pdfDraft)} onClick={()=>docxInputRef.current?.click()} className="col-span-2 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface py-1.5 font-medium text-slate-700 studio-ui-primary hover:bg-slate-50 studio-ui-hover disabled:opacity-40">从 DOCX 导入</button>
          </div>
          {parsingTextualImport && <button {...buttonSkin(skins)} data-studio-control="true" type="button" onClick={()=>parsingImport.current?.abort()} className="w-full rounded border border-amber-300 studio-ui-warning-border bg-amber-50 studio-ui-warning-surface py-1.5 text-amber-900 studio-ui-warning">取消本地解析</button>}
          <button {...buttonSkin(skins)} data-studio-control="true"
            type="button"
            onClick={handleExportJson}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface py-1.5 font-medium text-slate-700 studio-ui-primary hover:bg-slate-50 studio-ui-hover"
          >
            <Download size={13} /> 导出备份 JSON
          </button>
        </section>
      </div>

      {comparison?.slug===activeSlug&&!comparisonDisabled&&<VersionCompareModal key={activeSlug} activeSlug={activeSlug} activeDoc={activeDoc} summaries={summaries} masterSummary={masterSummary} snapshots={snapshots} initialSnapshotId={comparison.snapshotId} onClose={()=>setComparison(null)}/>}
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
