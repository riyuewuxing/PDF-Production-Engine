import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../lib/apiClient';
import { cleanResumeRichText } from '../lib/htmlToMarkdown';
import { useHistoryState } from '../lib/useHistoryState';
import { resumeRevision, type ResumeDocument, type ResumeSummary } from '../schema/resumeSchema';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export function useResumePersistence(options?: {
  onVersionChanged?: () => void;
}) {
  const [summaries, setSummaries] = useState<ResumeSummary[]>([]);
  const [masterSummary, setMasterSummary] = useState<ResumeSummary | null>(null);
  const [activeSlug, setActiveSlug] = useState<string>('');
  const history = useHistoryState<ResumeDocument>(null);
  const { reset: resetHistory } = history;
  const activeDoc = history.value;

  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSeqRef = useRef(0);
  const switchGenerationRef = useRef(0);
  const versionTransitionRef = useRef(false);
  const revisionsRef = useRef(new Map<string, Pick<ResumeDocument, 'id' | 'updatedAt'>>());
  const activeDocRef = useRef<ResumeDocument | null>(null);
  activeDocRef.current = activeDoc;
  const pendingSaveRef = useRef<{ slug: string; doc: ResumeDocument } | null>(null);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const onVersionChangedRef = useRef(options?.onVersionChanged);
  onVersionChangedRef.current = options?.onVersionChanged;

  const persistDocument = useCallback(async (slug: string, docToSave: ResumeDocument) => {
    const seq = ++saveSeqRef.current;
    setSaveState('saving');
    setSaveError(null);
    try {
      const revision = revisionsRef.current.get(slug);
      if (!revision || revision.id !== docToSave.id) throw new Error('当前编辑缺少有效版本基线，请重新打开简历。');
      const saved = await apiClient.saveResume(slug, { ...docToSave, updatedAt: revision.updatedAt });
      revisionsRef.current.set(slug, { id: saved.id, updatedAt: saved.updatedAt });
      if (seq === saveSeqRef.current && !pendingSaveRef.current) {
        setSaveState('saved');
      }
      setSummaries((prev) =>
        prev.map((item) =>
          item.slug === slug
            ? {
                ...item,
                title: saved.title,
                templateId: saved.templateId,
                updatedAt: saved.updatedAt,
              }
            : item,
        ),
      );
      if (slug === 'master') {
        setMasterSummary((prev) =>
          prev
            ? { ...prev, title: saved.title, templateId: saved.templateId, updatedAt: saved.updatedAt }
            : prev,
        );
      }
    } catch (err) {
      if (seq === saveSeqRef.current) {
        setSaveState('error');
        setSaveError(err instanceof Error ? err.message : '自动保存失败');
      }
      throw err;
    }
  }, []);

  const flushPendingSave = useCallback(async (): Promise<void> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    // Concurrent flush callers must also wait for any batch started by another caller.
    while (true) {
      if (inFlightSaveRef.current) {
        await inFlightSaveRef.current;
        continue;
      }
      const batch = pendingSaveRef.current;
      if (!batch) return;
      pendingSaveRef.current = null;
      const promise = persistDocument(batch.slug, batch.doc);
      inFlightSaveRef.current = promise;
      try {
        await promise;
      } catch (err) {
        // A failed save must remain retryable. Never replace a newer queued edit.
        if (!pendingSaveRef.current) pendingSaveRef.current = batch;
        throw err;
      } finally {
        if (inFlightSaveRef.current === promise) {
          inFlightSaveRef.current = null;
        }
      }
    }
  }, [persistDocument]);

  const refreshListAndLoad = useCallback(
    async (preferredSlug?: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const list = await apiClient.listResumes();
        setMasterSummary(list.master);
        setSummaries(list.resumes);
        revisionsRef.current = new Map([...(list.master ? [list.master] : []), ...list.resumes]
          .map(item => [item.slug, { id: item.id, updatedAt: item.updatedAt }]));

        const targetSlug =
          preferredSlug ??
          list.resumes.find((r) => r.slug === 'synthetic-job')?.slug ??
          list.resumes[0]?.slug ??
          (list.master ? 'master' : '');

        if (!targetSlug) {
          setActiveSlug('');
          resetHistory(null);
          return;
        }

        const rawDoc = await apiClient.getResume(targetSlug);
        const doc = cleanResumeRichText(rawDoc);
        revisionsRef.current.set(targetSlug, { id: rawDoc.id, updatedAt: rawDoc.updatedAt });
        setActiveSlug(targetSlug);
        activeDocRef.current = doc;
        resetHistory(doc);
        pendingSaveRef.current = null;
        setSaveState('saved');
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : '加载简历失败');
      } finally {
        setLoading(false);
      }
    },
    [resetHistory],
  );

  useEffect(() => {
    void refreshListAndLoad();
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [refreshListAndLoad]);

  useEffect(() => {
    const lifecycle = window.resumeDesktop?.lifecycle;
    if (!lifecycle) return;
    const unsubscribe = lifecycle.onBeforeClose((requestId) => {
      void flushPendingSave().then(
        () => lifecycle.confirmCloseReady(requestId, true),
        () => lifecycle.confirmCloseReady(requestId, false),
      );
    });
    return unsubscribe;
  }, [flushPendingSave]);

  const scheduleAutoSave = useCallback(
    (nextDoc: ResumeDocument) => {
      if (!activeSlug) return;
      pendingSaveRef.current = { slug: activeSlug, doc: nextDoc };
      setSaveState('dirty');
      setSaveError(null);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        void flushPendingSave().catch(() => {
          // Handled in saveState
        });
      }, 500);
    },
    [activeSlug, flushPendingSave],
  );

  const handleSwitchVersion = useCallback(
    async (targetSlug: string) => {
      if (!targetSlug || targetSlug === activeSlug || versionTransitionRef.current) return;
      const generation = ++switchGenerationRef.current;
      await flushPendingSave();
      const rawDoc = await apiClient.getResume(targetSlug);
      // A new edit can arrive while reading another version. Persist it before switching.
      await flushPendingSave();
      if (generation !== switchGenerationRef.current || versionTransitionRef.current) return;
      const doc = cleanResumeRichText(rawDoc);
      revisionsRef.current.set(targetSlug, { id: rawDoc.id, updatedAt: rawDoc.updatedAt });
      setActiveSlug(targetSlug);
      activeDocRef.current = doc;
      resetHistory(doc);
      pendingSaveRef.current = null;
      setSaveState('saved');
      setSaveError(null);
      onVersionChangedRef.current?.();
    },
    [activeSlug, flushPendingSave, resetHistory],
  );

  const reloadActiveFromDisk = useCallback(async () => {
    if (!activeSlug || versionTransitionRef.current) return;
    versionTransitionRef.current = true;
    ++switchGenerationRef.current;
    const original = activeDocRef.current;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    setLoading(true);
    try {
      if (inFlightSaveRef.current) await inFlightSaveRef.current.catch(() => {});
      const raw = await apiClient.getResume(activeSlug);
      if (activeDocRef.current !== original) throw new Error('重载期间出现新的编辑，已保留草稿。');
      const doc = cleanResumeRichText(raw);
      revisionsRef.current.set(activeSlug,{id:raw.id,updatedAt:raw.updatedAt});
      setSummaries(prev=>prev.map(item=>item.slug===activeSlug?{...item,id:raw.id,title:raw.title,templateId:raw.templateId,updatedAt:raw.updatedAt}:item));
      if(activeSlug==='master')setMasterSummary(prev=>prev?{...prev,id:raw.id,title:raw.title,templateId:raw.templateId,updatedAt:raw.updatedAt}:prev);
      // Caller has explicitly confirmed discard. Only discard after successful read.
      pendingSaveRef.current=null;
      activeDocRef.current=doc;
      resetHistory(doc);
      setSaveState('saved');
      setSaveError(null);
      onVersionChangedRef.current?.();
    } catch(err) {
      setSaveState('error');
      setSaveError(err instanceof Error?err.message:'重载磁盘版本失败，草稿仍保留。');
      throw err;
    } finally {
      versionTransitionRef.current=false;
      setLoading(false);
    }
  },[activeSlug,resetHistory]);

  const handleCreateVersion = useCallback(
    async (title: string, sourceSlug?: string) => {
      await flushPendingSave();
      const created = await apiClient.createResume({
        title,
        cloneFromSlug: sourceSlug ?? (activeSlug || undefined),
      });
      await refreshListAndLoad(created.slug);
    },
    [activeSlug, flushPendingSave, refreshListAndLoad],
  );

  const handleDeleteVersion = useCallback(
    async (slug: string) => {
      await flushPendingSave();
      const revision = revisionsRef.current.get(slug);
      if (!revision) throw new Error('缺少删除版本基线，请刷新版本列表。');
      await apiClient.deleteResume(slug, resumeRevision(revision));
      await refreshListAndLoad();
    },
    [flushPendingSave, refreshListAndLoad],
  );

  const handleImportJson = useCallback(
    async (rawJson: unknown, fallbackTitle: string) => {
      await flushPendingSave();
      const created = await apiClient.createResume({
        title:
          typeof rawJson === 'object' &&
          rawJson !== null &&
          'title' in rawJson &&
          typeof (rawJson as { title?: unknown }).title === 'string' &&
          (rawJson as { title: string }).title.trim()
            ? (rawJson as { title: string }).title.trim()
            : fallbackTitle,
        document: rawJson,
      });
      await refreshListAndLoad(created.slug);
    },
    [flushPendingSave, refreshListAndLoad],
  );

  const markSavedFromSnapshot = useCallback(
    (restoredDoc: ResumeDocument) => {
      const cleaned = cleanResumeRichText(restoredDoc);
      revisionsRef.current.set(activeSlug, { id: restoredDoc.id, updatedAt: restoredDoc.updatedAt });
      activeDocRef.current = cleaned;
      pendingSaveRef.current = null;
      resetHistory(cleaned);
      setSaveState('saved');
    },
    [activeSlug, resetHistory],
  );

  const getCurrentRevision = useCallback(() => {
    const revision = revisionsRef.current.get(activeSlug);
    if (!revision) throw new Error('当前简历缺少版本基线。');
    return resumeRevision(revision);
  }, [activeSlug]);

  const ensureCurrentQueued = useCallback(() => {
    const latest = activeDocRef.current;
    if (!latest || !activeSlug) return false;
    if (!pendingSaveRef.current) {
      pendingSaveRef.current = { slug: activeSlug, doc: latest };
    }
    return true;
  }, [activeSlug]);

  return {
    summaries,
    masterSummary,
    activeSlug,
    activeDoc,
    activeDocRef,
    history,
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
    getCurrentRevision,
    reloadActiveFromDisk,
    ensureCurrentQueued,
  };
}
