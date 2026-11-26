import { contextBridge, ipcRenderer } from 'electron';
import type { ResumeDocument } from '../src/schema/resumeSchema';
import type {
  CoverLetterExportOptions,
  PdfExportOptions,
  ResumeDesktopBridge,
  SaveApplicationSnapshotInput,
  SaveTextFileOptions,
} from '../src/types/electron';

const bridge: ResumeDesktopBridge = {
  isDesktop: true,
  resumes: {
    list: () => ipcRenderer.invoke('resumes:list'),
    get: (slug: string) => ipcRenderer.invoke('resumes:get', slug),
    save: (slug: string, doc: ResumeDocument) => ipcRenderer.invoke('resumes:save', slug, doc),
    create: (input) => ipcRenderer.invoke('resumes:create', input),
    delete: (slug: string) => ipcRenderer.invoke('resumes:delete', slug),
  },
  snapshots: {
    list: (slug: string) => ipcRenderer.invoke('snapshots:list', slug),
    create: (slug: string, reason?: string) => ipcRenderer.invoke('snapshots:create', slug, reason),
    restore: (slug: string, snapshotId: string) =>
      ipcRenderer.invoke('snapshots:restore', slug, snapshotId),
  },
  applications: {
    get: () => ipcRenderer.invoke('applications:get'),
    save: (data) => ipcRenderer.invoke('applications:save', data),
    saveSnapshot: (input: SaveApplicationSnapshotInput) =>
      ipcRenderer.invoke('applications:saveSnapshot', input),
    getSnapshot: (snapshotId: string) => ipcRenderer.invoke('applications:getSnapshot', snapshotId),
    deleteSnapshot: (snapshotId: string) =>
      ipcRenderer.invoke('applications:deleteSnapshot', snapshotId),
  },
  assets: {
    upload: (filename: string, dataUrl: string) =>
      ipcRenderer.invoke('assets:upload', { filename, dataUrl }),
  },
  fonts: {
    listSystem: () => ipcRenderer.invoke('fonts:listSystem'),
  },
  pdf: {
    export: (options: PdfExportOptions) => ipcRenderer.invoke('pdf:export', options),
    exportPng: (options: PdfExportOptions) => ipcRenderer.invoke('export:png', options),
    exportDocx: (options: PdfExportOptions) => ipcRenderer.invoke('export:docx', options),
    exportMarkdown: (options: PdfExportOptions) => ipcRenderer.invoke('export:markdown', options),
    exportHtml: (options: PdfExportOptions) => ipcRenderer.invoke('export:html', options),
    exportCoverLetter: (options: CoverLetterExportOptions) =>
      ipcRenderer.invoke('pdf:exportCoverLetter', options),
    renderBuffer: (doc: ResumeDocument) => ipcRenderer.invoke('pdf:renderBuffer', doc),
    getPrintPayload: (jobId: string) => ipcRenderer.invoke('pdf:getPayload', jobId),
    getCoverLetterPayload: (jobId: string) =>
      ipcRenderer.invoke('pdf:getCoverLetterPayload', jobId),
    notifyReady: (jobId: string) => ipcRenderer.invoke('pdf:notifyReady', jobId),
  },
  ai: {
    getSettings: () => ipcRenderer.invoke('ai:getSettings'),
    saveSettings: (settings) => ipcRenderer.invoke('ai:saveSettings', settings),
    requestCompletion: (request) => ipcRenderer.invoke('ai:requestCompletion', request),
    cancelCompletion: (requestId) => ipcRenderer.invoke('ai:cancelCompletion', requestId),
  },
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
    showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
    openExportsDir: () => ipcRenderer.invoke('shell:openExportsDir'),
    saveTextFile: (options: SaveTextFileOptions) => ipcRenderer.invoke('shell:saveTextFile', options),
  },
  lifecycle: {
    onBeforeClose: (callback: (requestId: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, requestId: number) => callback(requestId);
      ipcRenderer.on('app:beforeClose', handler);
      return () => {
        ipcRenderer.removeListener('app:beforeClose', handler);
      };
    },
    confirmCloseReady: (requestId: number, saved: boolean) => {
      ipcRenderer.send('app:closeReady', requestId, saved);
    },
  },
};

contextBridge.exposeInMainWorld('resumeDesktop', bridge);
