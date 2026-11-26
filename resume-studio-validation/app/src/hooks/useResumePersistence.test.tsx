import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useResumePersistence } from './useResumePersistence';
import { ResumeDocumentSchema } from '../schema/resumeSchema';
import type { ResumeDesktopBridge } from '../types/electron';

const mocks = vi.hoisted(() => ({
  listResumes: vi.fn(), getResume: vi.fn(), saveResume: vi.fn(),
}));
vi.mock('../lib/apiClient', () => ({ apiClient: mocks }));

function fixture() {
  return ResumeDocumentSchema.parse({
    id: 'synthetic-doc', title: 'Synthetic fixture',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    basic: { name: 'Demo Candidate', title: 'Demo Role' },
    menuSections: [{ id: 'basic', title: 'Basic', order: 0 }],
    globalSettings: {},
  });
}

describe('resume persistence failure safety', () => {
  let closeHandler: ((id: number) => void) | undefined;
  const closeReady = vi.fn();
  beforeEach(() => {
    const doc = fixture();
    closeHandler = undefined;
    closeReady.mockReset();
    mocks.listResumes.mockReset().mockResolvedValue({ master: null, resumes: [
      { slug: 'fixture', id: doc.id, title: doc.title, templateId: doc.templateId, updatedAt: doc.updatedAt },
    ] });
    mocks.getResume.mockReset().mockResolvedValue(doc);
    mocks.saveResume.mockReset().mockImplementation(async (_slug, next) => next);
    window.resumeDesktop = { lifecycle: {
      onBeforeClose: (cb: (id: number) => void) => { closeHandler = cb; return () => { closeHandler = undefined; }; },
      confirmCloseReady: closeReady,
    } } as unknown as ResumeDesktopBridge;
  });
  afterEach(() => { delete window.resumeDesktop; });

  it('keeps a failed write available to retry without editing again', async () => {
    const { result } = renderHook(() => useResumePersistence());
    await waitFor(() => expect(result.current.activeSlug).toBe('fixture'));
    const next = { ...result.current.activeDoc!, title: 'Edited title' };
    mocks.saveResume.mockRejectedValueOnce(new Error('disk full'));
    act(() => result.current.scheduleAutoSave(next));
    await act(async () => { await expect(result.current.flushPendingSave()).rejects.toThrow('disk full'); });
    expect(result.current.saveState).toBe('error');
    await act(async () => { await result.current.flushPendingSave(); });
    expect(mocks.saveResume).toHaveBeenCalledTimes(2);
    expect(mocks.saveResume).toHaveBeenLastCalledWith('fixture', next);
    expect(result.current.saveState).toBe('saved');
  });

  it('uses the returned disk revision for subsequent edits and undo, without changing the history payload', async () => {
    const { result } = renderHook(() => useResumePersistence());
    await waitFor(() => expect(result.current.activeSlug).toBe('fixture'));
    const base = result.current.activeDoc!;
    const revision1 = '2026-01-02T00:00:00Z';
    mocks.saveResume.mockImplementationOnce(async (_slug, next) => ({ ...next, updatedAt: revision1 }));
    act(() => result.current.scheduleAutoSave({ ...base, title: 'edit one' }));
    await act(async () => { await result.current.flushPendingSave(); });
    act(() => result.current.scheduleAutoSave(base));
    await act(async () => { await result.current.flushPendingSave(); });
    expect(mocks.saveResume).toHaveBeenLastCalledWith('fixture', { ...base, updatedAt: revision1 });
  });

  it('reports failed close flush and retries the retained batch on the next request', async () => {
    const { result } = renderHook(() => useResumePersistence());
    await waitFor(() => expect(result.current.activeSlug).toBe('fixture'));
    const next = { ...result.current.activeDoc!, title: 'Keep this edit' };
    mocks.saveResume.mockRejectedValueOnce(new Error('access denied'));
    act(() => result.current.scheduleAutoSave(next));
    await act(async () => { closeHandler!(12); });
    await waitFor(() => expect(closeReady).toHaveBeenCalledWith(12, false));
    expect(result.current.saveState).toBe('error');
    await act(async () => { closeHandler!(13); });
    await waitFor(() => expect(closeReady).toHaveBeenCalledWith(13, true));
    expect(mocks.saveResume).toHaveBeenLastCalledWith('fixture', next);
  });
});
