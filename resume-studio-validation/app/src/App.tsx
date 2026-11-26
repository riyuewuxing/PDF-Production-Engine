import {
  AlertCircle,
  BookOpen,
  BriefcaseBusiness,
  LayoutGrid,
  Loader2,
  Palette,
  PenLine,
  Stethoscope,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { JobCareerPane } from './components/Career/JobCareerPane';
import { QuickLogApplicationModal } from './components/Career/QuickLogApplicationModal';
import {
  CommandPaletteModal,
  type StudioNavTab,
} from './components/Common/CommandPaletteModal';
import { StudioHeader } from './components/Common/StudioHeader';
import { DiagnoseAndMatchPane } from './components/Diagnose/DiagnoseAndMatchPane';
import { ResumeEditorPane } from './components/Editor/ResumeEditorPane';
import { A4PreviewPane } from './components/Preview/A4PreviewPane';
import { StyleAndColorPane } from './components/Style/StyleAndColorPane';
import { TemplateGallery } from './components/Templates/TemplateGallery';
import { MasterMergeModal } from './components/Versions/MasterMergeModal';
import { VersionAndMasterPane } from './components/Versions/VersionAndMasterPane';
import { RecycleBinPanel } from './components/Versions/RecycleBinPanel';
import { WriteLockPanel } from './components/Versions/WriteLockPanel';
import { RecoveryDraftPanel } from './components/Versions/RecoveryDraftPanel';
import { WorkspaceBackupPane } from './components/Versions/WorkspaceBackupPane';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useResumeExport } from './hooks/useResumeExport';
import { useResumePersistence } from './hooks/useResumePersistence';
import { apiClient, isDesktopMode } from './lib/apiClient';
import { fitResumeToSinglePage } from './lib/pageFit';
import { parseCustomRedactionTerms, redactResumeDocument } from './lib/privacyRedactor';
import { switchDocumentLocale } from './lib/resumeLocale';
import type { GlobalSettings, ResumeDocument, TemplateId } from './schema/resumeSchema';
import type {JobPdfOrigin} from './schema/jobPdfSourceSchema';
import { TEMPLATE_REGISTRY } from './templates/registry';

function buildDefaultGlobalSettings(doc: ResumeDocument): GlobalSettings {
  const meta = TEMPLATE_REGISTRY.find((t) => t.id === doc.templateId);
  const defaultFont =
    meta?.id === 'classic-serif' || meta?.id === 'harvard-academic' ? 'serif' : 'sans';
  return {
    ...doc.globalSettings,
    baseFontSize: 13,
    pagePadding: 28,
    paragraphSpacing: 10,
    lineHeight: 1.32,
    sectionSpacing: 16,
    headerSize: 15,
    subheaderSize: 13,
    useIconMode: true,
    themeColor: meta?.recommendedColor ?? '#167883',
    paperBackground: '#ffffff',
    surfaceStyle: 'solid',
    headingStyle: 'auto',
    fontFamily: defaultFont,
    customFontFamily: '',
    letterSpacing: 0,
    headingWeight: 'bold',
    tabularNums: true,
    showPageGuide: true,
    avoidItemSplit: true,
    autoCjkSpacing: false,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<StudioNavTab>('edit');
  const [workspaceContext,setWorkspaceContext]=useState<{folder:string;restored:boolean}|null>(null);
  useEffect(()=>{let alive=true;void window.resumeDesktop?.workspaceBackup?.context?.().then(v=>{if(alive)setWorkspaceContext(v);}).catch(()=>{});return()=>{alive=false;};},[]);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isMasterMergeOpen, setIsMasterMergeOpen] = useState(false);
  const [isRedacted, setIsRedacted] = useState(false);
  const [isRedactionPopoverOpen, setIsRedactionPopoverOpen] = useState(false);
  const [redactionTermsInput, setRedactionTermsInput] = useState('');
  const [jobSource,setJobSource]=useState<{text:string;pdfOrigin?:JobPdfOrigin}>({text:''});
  const jdText=jobSource.text;
  const setJdText=useCallback((next:string,pdfOrigin?:JobPdfOrigin)=>setJobSource({text:next,pdfOrigin}),[]);
  const [lastAtsScore, setLastAtsScore] = useState<number | null>(null);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState(false);
  const [applicationsRefreshKey, setApplicationsRefreshKey] = useState(0);
  const [overflowPx, setOverflowPx] = useState(0);
  const [focusSectionRequest, setFocusSectionRequest] = useState<{ id: string; seq: number } | null>(null);
  const [isFitting, setIsFitting] = useState(false);
  const [fitFeedback, setFitFeedback] = useState<{ type: 'ok' | 'warn'; text: string } | null>(null);

  const measureOverflowRef = useRef<(() => number) | null>(null);
  const clearExportFeedbackRef = useRef<(() => void) | null>(null);

  const {
    summaries,
    masterSummary,
    listIssues,
    activeSlug,
    activeDoc,
    activeDocRef,
    history: {
      set: setHistoryDoc,
      previewSilent,
      commitBatch,
      undo: undoHistoryDoc,
      redo: redoHistoryDoc,
      canUndo,
      canRedo,
      undoCount,
      redoCount,
    },
    loading,
    loadError,
    saveState,
    saveError,
    recoveryError,
    refreshListAndLoad,
    flushPendingSave,
    scheduleAutoSave,
    handleSwitchVersion,
    handleCreateVersion,
    handleDeleteVersion,
    handleImportJson,
    handleRestoreSnapshot,
    handleRestoreTrash,
    versionTransitioning,
    canEditCurrent,
    getCurrentRevision,
    reloadActiveFromDisk,
    ensureCurrentQueued,
  } = useResumePersistence({
    onVersionChanged: () => {
      setFitFeedback(null);
      clearExportFeedbackRef.current?.();
    },
  });

  const {
    isExportMenuOpen,
    setIsExportMenuOpen,
    isExporting,
    exportStatus,
    setExportStatus,
    lastExportedPdfSnapshot,
    setLastExportedPdfSnapshot,
    invalidateExportFeedback,
    handleExportFormat,
  } = useResumeExport({
    activeSlug,
    activeDocRef,
    flushPendingSave,
    isRedacted,
    redactionTermsInput,
  });

  clearExportFeedbackRef.current = () => {
    invalidateExportFeedback();
    setIsQuickLogOpen(false);
  };

  const handleDocumentChange = useCallback(
    (nextDoc: ResumeDocument, options?: { immediate?: boolean }) => {
      if(!canEditCurrent()||!activeDocRef.current||activeDocRef.current.id!==nextDoc.id)throw new Error('当前版本已变化或正在处理版本操作，未应用旧编辑。');
      activeDocRef.current = nextDoc;
      setHistoryDoc(nextDoc, options);
      scheduleAutoSave(nextDoc);
    },
    [activeDocRef, canEditCurrent, scheduleAutoSave, setHistoryDoc],
  );

  const handleImmediateChange = useCallback(
    (nextDoc: ResumeDocument) => handleDocumentChange(nextDoc, { immediate: true }),
    [handleDocumentChange],
  );

  const handleUndo = useCallback(() => {
    if(!canEditCurrent())return;
    const restored = undoHistoryDoc();
    if (!restored) return;
    activeDocRef.current = restored;
    setFitFeedback(null);
    scheduleAutoSave(restored);
  }, [activeDocRef, canEditCurrent, scheduleAutoSave, undoHistoryDoc]);

  const handleRedo = useCallback(() => {
    if(!canEditCurrent())return;
    const restored = redoHistoryDoc();
    if (!restored) return;
    activeDocRef.current = restored;
    setFitFeedback(null);
    scheduleAutoSave(restored);
  }, [activeDocRef, canEditCurrent, redoHistoryDoc, scheduleAutoSave]);

  const handleManualSave = useCallback(async () => {
    if (!ensureCurrentQueued()) return;
    try {
      await flushPendingSave();
      setFitFeedback({ type: 'ok', text: '已立即保存当前简历至本地硬盘。' });
      setTimeout(() => {
        setFitFeedback((curr) =>
          curr?.text === '已立即保存当前简历至本地硬盘。' ? null : curr,
        );
      }, 2200);
    } catch {
      // Save error handled in saveState / saveError
    }
  }, [ensureCurrentQueued, flushPendingSave]);

  const handleSafeSwitchVersion = useCallback(async (slug:string):Promise<boolean> => {
    try { await handleSwitchVersion(slug); return true; }
    catch(err) {
      setFitFeedback({type:'warn',text:err instanceof Error?err.message:'无法切换版本，当前编辑已保留。'});
      return false;
    }
  },[handleSwitchVersion]);

  const handleBackupDraft = useCallback(async () => {
    const draft=activeDocRef.current;
    if(!draft)return;
    try {
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      const result=await apiClient.saveTextFile({
        defaultFileName:`${activeSlug||'resume'}-未保存草稿-${stamp}.json`,
        content:JSON.stringify(draft,null,2)+'\n',
        extension:'json',filterName:'JSON 草稿',dialogTitle:'另存未保存简历草稿',
        mimeType:'application/json;charset=utf-8',saveAs:true,
      });
      if(!result.canceled)setFitFeedback({type:'ok',text:result.filePath?'草稿已另存：'+result.filePath:'已发起本地草稿下载；请确认文件保存成功。'});
    }catch(err){setFitFeedback({type:'warn',text:err instanceof Error?err.message:'草稿备份失败。'});}
  },[activeDocRef,activeSlug]);

  const handleReloadDraft = useCallback(async () => {
    if(!window.confirm('重载将放弃当前未保存编辑。请先另存草稿；确认放弃并重新读取磁盘版本吗？'))return;
    try{await reloadActiveFromDisk();}
    catch(err){setFitFeedback({type:'warn',text:err instanceof Error?err.message:'重载失败，未丢弃草稿。'});}
  },[reloadActiveFromDisk]);

  const toggleCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen((prev) => !prev);
  }, []);

  useGlobalShortcuts({
    hasActiveDoc: Boolean(activeDoc) && !loading && !versionTransitioning && !isFitting,
    onManualSave: handleManualSave,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onToggleCommandPalette: toggleCommandPalette,
  });

  const handleSettingsChange = useCallback(
    (nextSettings: GlobalSettings) => {
      const latest = activeDocRef.current;
      if (!latest) return;
      setFitFeedback(null);
      handleDocumentChange({ ...latest, globalSettings: nextSettings });
    },
    [activeDocRef, handleDocumentChange],
  );

  const handleSelectTemplate = useCallback(
    (templateId: TemplateId, recommendedColor?: string) => {
      const latest = activeDocRef.current;
      if (!latest) return;
      setFitFeedback(null);
      handleImmediateChange({
        ...latest,
        templateId,
        globalSettings: recommendedColor
          ? { ...latest.globalSettings, themeColor: recommendedColor }
          : latest.globalSettings,
      });
      setActiveTab('edit');
    },
    [activeDocRef, handleImmediateChange],
  );

  const handleRenameVersion = useCallback(
    (newTitle: string) => {
      const latest = activeDocRef.current;
      if (!latest) return;
      handleDocumentChange({ ...latest, title: newTitle });
    },
    [activeDocRef, handleDocumentChange],
  );

  const handleFitOnePage = useCallback(async () => {
    const beforeDoc = activeDocRef.current;
    if (!beforeDoc || isFitting || !canEditCurrent() || !measureOverflowRef.current) return;
    setIsFitting(true);
    setFitFeedback(null);
    try {
      const result = await fitResumeToSinglePage(beforeDoc.globalSettings, async (candidate) => {
        const nextPreview: ResumeDocument = { ...beforeDoc, globalSettings: candidate };
        activeDocRef.current = nextPreview;
        previewSilent(nextPreview);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return measureOverflowRef.current ? measureOverflowRef.current() : 0;
      });
      if (result.stepsTaken > 0) {
        const finalDoc: ResumeDocument = { ...beforeDoc, globalSettings: result.settings };
        activeDocRef.current = finalDoc;
        commitBatch(beforeDoc, finalDoc);
        scheduleAutoSave(finalDoc);
      } else {
        activeDocRef.current = beforeDoc;
        previewSilent(beforeDoc);
      }
      setFitFeedback({ type: result.fitted ? 'ok' : 'warn', text: result.message });
    } finally {
      setIsFitting(false);
    }
  }, [activeDocRef, canEditCurrent, commitBatch, isFitting, previewSilent, scheduleAutoSave]);

  const handlePreviewSelectSection = useCallback((sectionId: string) => {
    setActiveTab('edit');
    setFocusSectionRequest((prev) => ({ id: sectionId, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleMasterMergeCommit = useCallback(
    async (mergedDoc: ResumeDocument) => {
      const basis = activeDocRef.current;
      if (!activeSlug || !basis || basis.id !== mergedDoc.id || activeSlug === 'master') return;
      try {
        await flushPendingSave();
        if (activeDocRef.current !== basis) throw new Error('简历已变化，请重新选择合并内容。');
        await apiClient.createSnapshot(activeSlug, '母库合并前自动快照', getCurrentRevision());
        if (activeDocRef.current !== basis) throw new Error('简历已变化，请重新选择合并内容。');
        handleImmediateChange(mergedDoc);
      } catch(err) {
        setFitFeedback({type:'warn',text:err instanceof Error?err.message:'母库合并前备份失败，未应用修改。'});
      }
    },
    [activeSlug, activeDocRef, flushPendingSave, getCurrentRevision, handleImmediateChange],
  );

  useEffect(()=>{
    if(workspaceContext?.restored&&!loading&&!loadError&&activeDoc&&activeSlug)void window.resumeDesktop?.workspaceBackup?.editorReady?.(activeSlug,activeDoc.id).catch(()=>{});
  },[workspaceContext,loading,loadError,activeSlug,activeDoc?.id]);

  const parsedRedactionTerms = useMemo(
    () => parseCustomRedactionTerms(redactionTermsInput),
    [redactionTermsInput],
  );

  const previewDoc = useMemo(() => {
    if (!activeDoc) return null;
    if (!isRedacted) return activeDoc;
    return redactResumeDocument(activeDoc, {
      hideName: true,
      maskPhone: true,
      maskEmail: true,
      hidePhoto: true,
      customTerms: parsedRedactionTerms,
    });
  }, [activeDoc, isRedacted, parsedRedactionTerms]);

  const resumeListWarning = listIssues.length > 0 && (
    <details aria-label="简历文件读取异常" className="no-print shrink-0 border-b border-amber-300 bg-amber-50 px-3 py-2 text-left text-xs text-amber-950">
      <summary className="cursor-pointer font-semibold">有 {listIssues.length} 份简历文件无法读取，检查未删除或覆盖原文件。</summary>
      <p className="mt-1">仍可使用正常简历；请先保留异常文件，在本地核对或从备份恢复后重新启动。</p>
      <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-5">
        {listIssues.map(issue=><li className="break-all" key={issue.slug}>{issue.slug}.json：{{CORRUPTED_JSON:'JSON 损坏',SCHEMA_INVALID:'数据格式不符合规范',UNSAFE_ENTRY:'不是普通文件',UNREADABLE:'无法读取'}[issue.reason]}</li>)}
      </ul>
    </details>
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#11161f] text-sm text-slate-300">
        <Loader2 size={18} className="mr-2 animate-spin text-teal-400" />
        正在加载本地简历工作台...
      </div>
    );
  }

  if (loadError || !activeDoc) {
    return (
      <div className="flex h-screen overflow-y-auto bg-[#11161f] p-6">
        <div className="m-auto w-full max-w-xl shrink-0 rounded-lg border border-red-500/40 bg-slate-900 p-6 text-center text-slate-100 shadow-xl">
          <AlertCircle size={28} className="mx-auto text-red-400" />
          <h1 className="mt-3 text-base font-semibold">无法加载本地简历</h1>
          <p className="mt-1 text-sm text-slate-400">{loadError ?? 'data/ 目录中暂无可用简历'}</p>
          <button
            type="button"
            disabled={versionTransitioning}
            onClick={() => void refreshListAndLoad()}
            className="mt-4 rounded bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-500"
          >
            重试加载
          </button>
          <div className="mt-4 space-y-2">{resumeListWarning}<RecoveryDraftPanel onImport={handleImportJson}/><RecycleBinPanel onRestore={handleRestoreTrash}/><WriteLockPanel/>
            {window.resumeDesktop?.workspaceBackup&&<details aria-label="启动异常时的备份恢复" className="rounded-lg border border-teal-300 bg-white p-3 text-left text-slate-800">
              <summary className="cursor-pointer text-sm font-semibold text-teal-800">从已有备份恢复或打开独立工作区</summary>
              <div className="mt-2"><WorkspaceBackupPane onFlush={flushPendingSave} recoveryOnly/></div>
            </details>}
          </div>
        </div>
      </div>
    );
  }

  const desktop = isDesktopMode();
  const navItems: Array<{ id: StudioNavTab; label: string; icon: typeof PenLine }> = [
    { id: 'edit', label: '内容编辑', icon: PenLine },
    { id: 'templates', label: `模板库(${TEMPLATE_REGISTRY.length})`, icon: LayoutGrid },
    { id: 'style', label: '样式底色', icon: Palette },
    { id: 'versions', label: '版本母库', icon: BookOpen },
    { id: 'diagnose', label: '诊断优化', icon: Stethoscope },
    { id: 'career', label: '求职面试', icon: BriefcaseBusiness },
  ];

  return (
    <div className="studio-shell relative flex h-screen flex-col overflow-hidden bg-[#11161f] text-slate-900" inert={versionTransitioning||isFitting} aria-busy={versionTransitioning||isFitting}>
      {(versionTransitioning||isFitting)&&<div className="no-print absolute inset-0 z-[100] flex items-center justify-center bg-slate-900/35"><div className="rounded-lg bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-lg">{versionTransitioning?'正在安全处理版本，请稍候…':'正在测量页面排版…'}</div></div>}
      <StudioHeader
        activeSlug={activeSlug}
        activeTab={activeTab}
        summaries={summaries}
        masterSummary={masterSummary}
        saveState={saveState}
        saveError={saveError}
        canUndo={canUndo}
        canRedo={canRedo}
        undoCount={undoCount}
        redoCount={redoCount}
        isRedacted={isRedacted}
        isRedactionPopoverOpen={isRedactionPopoverOpen}
        redactionTermsInput={redactionTermsInput}
        isFitting={isFitting}
        isExporting={isExporting}
        isExportMenuOpen={isExportMenuOpen}
        desktop={desktop}
        onSwitchVersion={(slug) => void handleSafeSwitchVersion(slug)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onManualSave={() => void handleManualSave()}
        onBackToEdit={() => setActiveTab('edit')}
        onToggleRedacted={() => setIsRedacted((v) => !v)}
        onSetRedacted={setIsRedacted}
        onToggleRedactionPopover={() => setIsRedactionPopoverOpen((v) => !v)}
        onCloseRedactionPopover={() => setIsRedactionPopoverOpen(false)}
        onRedactionTermsChange={setRedactionTermsInput}
        onFitOnePage={() => void handleFitOnePage()}
        onToggleExportMenu={() => setIsExportMenuOpen((v) => !v)}
        onExportFormat={(format, saveAs) => void handleExportFormat(format, saveAs)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />
      {workspaceContext?.restored&&<div aria-label="独立恢复工作区标识" className="no-print flex shrink-0 flex-wrap items-center gap-x-2 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"><strong className="shrink-0">独立恢复工作区</strong><span className="min-w-0 break-all">{workspaceContext.folder}</span><span>编辑仅写入此副本；原工作区不受影响。</span></div>}
      {resumeListWarning}
      <RecoveryDraftPanel onImport={handleImportJson}/>
      {recoveryError&&<div role="alert" className="no-print shrink-0 bg-amber-50 px-3 py-1 text-xs text-amber-900">{recoveryError}</div>}
      {saveState==='error' && (
        <div role="alert" className="no-print flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-red-300 bg-red-50 px-4 py-2 text-xs text-red-900">
          <div className="min-w-0 flex-1 break-words">{saveError || '保存失败。'} 当前编辑仍在内存中；可以先另存草稿，不会覆盖原简历。</div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={()=>void handleBackupDraft()} className="rounded border border-red-300 bg-white px-2.5 py-1 font-semibold">另存未保存草稿</button>
            <button type="button" onClick={()=>void handleReloadDraft()} className="rounded border border-red-300 bg-white px-2.5 py-1">重载磁盘版本</button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 min-h-0 flex-1">
        <nav
          aria-label="主导航"
          className="no-print flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-slate-800 bg-[#0d1118] py-3"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition ${
                  active
                    ? 'bg-teal-600/20 text-teal-300 ring-1 ring-teal-500/40'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                }`}
              >
                <Icon size={17} />
                <span className="leading-tight text-center">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {activeTab === 'templates' ? (
          <TemplateGallery activeDocument={previewDoc ?? activeDoc} onSelectTemplate={handleSelectTemplate} />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
            <aside className="no-print h-full w-full shrink-0 border-r border-slate-200 bg-white lg:w-[430px]">
              {activeTab === 'edit' && (
                <ResumeEditorPane
                  document={activeDoc}
                  onChange={handleDocumentChange}
                  onImmediateChange={handleImmediateChange}
                  focusSectionRequest={focusSectionRequest}
                />
              )}
              {activeTab === 'style' && (
                <StyleAndColorPane
                  settings={activeDoc.globalSettings}
                  templateMeta={TEMPLATE_REGISTRY.find((t) => t.id === activeDoc.templateId)}
                  onChange={handleSettingsChange}
                  onSwitchLocale={(nextLocale) =>
                    handleImmediateChange(switchDocumentLocale(activeDoc, nextLocale))
                  }
                  onResetToDefault={() =>
                    handleImmediateChange({
                      ...activeDoc,
                      globalSettings: buildDefaultGlobalSettings(activeDoc),
                    })
                  }
                />
              )}
              {activeTab === 'versions' && (
                <VersionAndMasterPane
                  activeSlug={activeSlug}
                  activeDoc={activeDoc}
                  summaries={summaries}
                  masterSummary={masterSummary}
                  onSwitchVersion={(slug) => void handleSafeSwitchVersion(slug)}
                  onCreateVersion={handleCreateVersion}
                  onRenameVersion={handleRenameVersion}
                  onDeleteVersion={handleDeleteVersion}
                  onImportJson={handleImportJson}
                  onOpenMasterMerge={() => setIsMasterMergeOpen(true)}
                  onRestoreSnapshot={handleRestoreSnapshot}
                  onRestoreTrash={handleRestoreTrash}
                  onFlushBeforeMutation={flushPendingSave}
                  getCurrentRevision={getCurrentRevision}
                />
              )}
              {activeTab === 'diagnose' && (
                <DiagnoseAndMatchPane
                  key={activeSlug}
                  document={activeDoc}
                  activeSlug={activeSlug}
                  overflowPx={overflowPx}
                  jdText={jdText}
                  jdPdfOrigin={jobSource.pdfOrigin}
                  onJdTextChange={setJdText}
                  onAtsScoreChange={setLastAtsScore}
                  onJumpToSection={handlePreviewSelectSection}
                  onImmediateChange={handleImmediateChange}
                  onFlushBeforeApply={flushPendingSave}
                  getCurrentRevision={getCurrentRevision}
                />
              )}
              {activeTab === 'career' && (
                <JobCareerPane
                  activeSlug={activeSlug}
                  activeDoc={activeDoc}
                  summaries={summaries}
                  refreshKey={applicationsRefreshKey}
                  onSwitchToResumeForEdit={(slug) => {
                    void handleSafeSwitchVersion(slug).then(ok => {if(ok)setActiveTab('edit');});
                  }}
                  onCloneSnapshot={async (doc, suggestedTitle) => {
                    await handleImportJson(doc, suggestedTitle);
                    setActiveTab('edit');
                  }}
                  onExportStatus={setExportStatus}
                />
              )}
            </aside>

            <A4PreviewPane
              document={previewDoc ?? activeDoc}
              highlightedSectionId={focusSectionRequest?.id}
              onSelectSection={handlePreviewSelectSection}
              onUpdateSettings={handleSettingsChange}
              measureRef={measureOverflowRef}
              onOverflowChange={setOverflowPx}
              fitFeedback={fitFeedback}
              exportStatus={exportStatus}
              canLogApplication={Boolean(
                lastExportedPdfSnapshot &&
                  !lastExportedPdfSnapshot.isRedacted &&
                  exportStatus?.type === 'ok' &&
                  exportStatus.filePath &&
                  exportStatus.filePath === lastExportedPdfSnapshot.filePath,
              )}
              onOpenQuickLog={() => setIsQuickLogOpen(true)}
              isRedacted={isRedacted}
              onDisableRedaction={() => setIsRedacted(false)}
            />
          </div>
        )}
      </div>

      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        activeTab={activeTab}
        activeSlug={activeSlug}
        activeTemplateId={activeDoc.templateId}
        activeLocale={activeDoc.globalSettings.locale}
        isRedacted={isRedacted}
        summaries={summaries}
        masterSummary={masterSummary}
        onSelectTab={setActiveTab}
        onSwitchVersion={(slug) => void handleSafeSwitchVersion(slug)}
        onSelectTemplate={handleSelectTemplate}
        onExportFormat={(format) => void handleExportFormat(format, false)}
        onFitOnePage={() => void handleFitOnePage()}
        onToggleRedacted={() => setIsRedacted((v) => !v)}
        onToggleLocale={() => {
          const next = activeDoc.globalSettings.locale === 'zh-CN' ? 'en-US' : 'zh-CN';
          handleImmediateChange(switchDocumentLocale(activeDoc, next));
        }}
      />

      <QuickLogApplicationModal
        isOpen={isQuickLogOpen}
        snapshot={lastExportedPdfSnapshot}
        defaultJdText={jdText}
        defaultAtsScore={lastAtsScore}
        onClose={() => setIsQuickLogOpen(false)}
        onLogged={(entry) => {
          setApplicationsRefreshKey((k) => k + 1);
          setFitFeedback({
            type: 'ok',
            text: `已记入投递「${entry.company} · ${entry.role}」并永久封存原稿快照。`,
          });
        }}
      />

      <MasterMergeModal
        isOpen={isMasterMergeOpen}
        currentDoc={activeDoc}
        onMerge={(merged) => void handleMasterMergeCommit(merged)}
        onClose={() => setIsMasterMergeOpen(false)}
      />
    </div>
  );
}
