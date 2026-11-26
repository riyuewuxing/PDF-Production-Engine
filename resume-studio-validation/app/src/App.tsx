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
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useResumeExport } from './hooks/useResumeExport';
import { useResumePersistence } from './hooks/useResumePersistence';
import { apiClient, isDesktopMode } from './lib/apiClient';
import { fitResumeToSinglePage } from './lib/pageFit';
import { parseCustomRedactionTerms, redactResumeDocument } from './lib/privacyRedactor';
import { switchDocumentLocale } from './lib/resumeLocale';
import type { GlobalSettings, ResumeDocument, TemplateId } from './schema/resumeSchema';
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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isMasterMergeOpen, setIsMasterMergeOpen] = useState(false);
  const [isRedacted, setIsRedacted] = useState(false);
  const [isRedactionPopoverOpen, setIsRedactionPopoverOpen] = useState(false);
  const [redactionTermsInput, setRedactionTermsInput] = useState('');
  const [jdText, setJdText] = useState('');
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
    refreshListAndLoad,
    flushPendingSave,
    scheduleAutoSave,
    handleSwitchVersion,
    handleCreateVersion,
    handleDeleteVersion,
    handleImportJson,
    markSavedFromSnapshot,
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
    handleExportFormat,
  } = useResumeExport({
    activeSlug,
    activeDocRef,
    flushPendingSave,
    isRedacted,
    redactionTermsInput,
  });

  clearExportFeedbackRef.current = () => {
    setExportStatus(null);
    setLastExportedPdfSnapshot(null);
  };

  const handleDocumentChange = useCallback(
    (nextDoc: ResumeDocument, options?: { immediate?: boolean }) => {
      activeDocRef.current = nextDoc;
      setHistoryDoc(nextDoc, options);
      scheduleAutoSave(nextDoc);
    },
    [activeDocRef, scheduleAutoSave, setHistoryDoc],
  );

  const handleImmediateChange = useCallback(
    (nextDoc: ResumeDocument) => handleDocumentChange(nextDoc, { immediate: true }),
    [handleDocumentChange],
  );

  const handleUndo = useCallback(() => {
    const restored = undoHistoryDoc();
    if (!restored) return;
    activeDocRef.current = restored;
    setFitFeedback(null);
    scheduleAutoSave(restored);
  }, [activeDocRef, scheduleAutoSave, undoHistoryDoc]);

  const handleRedo = useCallback(() => {
    const restored = redoHistoryDoc();
    if (!restored) return;
    activeDocRef.current = restored;
    setFitFeedback(null);
    scheduleAutoSave(restored);
  }, [activeDocRef, redoHistoryDoc, scheduleAutoSave]);

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

  const toggleCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen((prev) => !prev);
  }, []);

  useGlobalShortcuts({
    hasActiveDoc: Boolean(activeDoc),
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
    if (!beforeDoc || isFitting || !measureOverflowRef.current) return;
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
  }, [activeDocRef, commitBatch, isFitting, previewSilent, scheduleAutoSave]);

  const handlePreviewSelectSection = useCallback((sectionId: string) => {
    setActiveTab('edit');
    setFocusSectionRequest((prev) => ({ id: sectionId, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleSnapshotRestored = useCallback(
    (restoredDoc: ResumeDocument) => {
      markSavedFromSnapshot(restoredDoc);
      setFitFeedback(null);
    },
    [markSavedFromSnapshot],
  );

  const handleMasterMergeCommit = useCallback(
    async (mergedDoc: ResumeDocument) => {
      if (activeSlug && activeSlug !== 'master') {
        try {
          await flushPendingSave();
          await apiClient.createSnapshot(activeSlug, '母库合并前自动快照');
        } catch {
          // Do not block user's merge if snapshot creation is unsupported in mocked environment
        }
      }
      handleImmediateChange(mergedDoc);
    },
    [activeSlug, flushPendingSave, handleImmediateChange],
  );

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
      <div className="flex h-screen items-center justify-center bg-[#11161f] p-6">
        <div className="max-w-md rounded-lg border border-red-500/40 bg-slate-900 p-6 text-center text-slate-100 shadow-xl">
          <AlertCircle size={28} className="mx-auto text-red-400" />
          <h1 className="mt-3 text-base font-semibold">无法加载本地简历</h1>
          <p className="mt-1 text-sm text-slate-400">{loadError ?? 'data/ 目录中暂无可用简历'}</p>
          <button
            type="button"
            onClick={() => void refreshListAndLoad()}
            className="mt-4 rounded bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-500"
          >
            重试加载
          </button>
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
    <div className="studio-shell flex h-screen flex-col overflow-hidden bg-[#11161f] text-slate-900">
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
        onSwitchVersion={(slug) => void handleSwitchVersion(slug)}
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
          <TemplateGallery activeDocument={activeDoc} onSelectTemplate={handleSelectTemplate} />
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
                  onSwitchVersion={(slug) => void handleSwitchVersion(slug)}
                  onCreateVersion={handleCreateVersion}
                  onRenameVersion={handleRenameVersion}
                  onDeleteVersion={handleDeleteVersion}
                  onImportJson={handleImportJson}
                  onOpenMasterMerge={() => setIsMasterMergeOpen(true)}
                  onSnapshotRestored={handleSnapshotRestored}
                />
              )}
              {activeTab === 'diagnose' && (
                <DiagnoseAndMatchPane
                  key={activeSlug}
                  document={activeDoc}
                  activeSlug={activeSlug}
                  overflowPx={overflowPx}
                  jdText={jdText}
                  onJdTextChange={setJdText}
                  onAtsScoreChange={setLastAtsScore}
                  onJumpToSection={handlePreviewSelectSection}
                  onImmediateChange={handleImmediateChange}
                  onFlushBeforeApply={flushPendingSave}
                />
              )}
              {activeTab === 'career' && (
                <JobCareerPane
                  activeSlug={activeSlug}
                  activeDoc={activeDoc}
                  summaries={summaries}
                  refreshKey={applicationsRefreshKey}
                  onSwitchToResumeForEdit={(slug) => {
                    void handleSwitchVersion(slug).then(() => setActiveTab('edit'));
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
        onSwitchVersion={(slug) => void handleSwitchVersion(slug)}
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
