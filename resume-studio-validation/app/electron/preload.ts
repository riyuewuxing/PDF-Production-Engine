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
    delete: (slug, expectedRevision) => ipcRenderer.invoke('resumes:delete', slug, expectedRevision),
  },
  writeLock:{inspect:()=>ipcRenderer.invoke('writeLock:inspect'),recover:(token,confirmation)=>ipcRenderer.invoke('writeLock:recover',token,confirmation)},
  trash: {
    list:()=>ipcRenderer.invoke('trash:list'),
    restore:(id,expectedRevision,asCopy)=>ipcRenderer.invoke('trash:restore',id,expectedRevision,asCopy),
    purge:(id,expectedRevision,confirmation)=>ipcRenderer.invoke('trash:purge',id,expectedRevision,confirmation),
  },
  snapshots: {
    list: (slug: string) => ipcRenderer.invoke('snapshots:list', slug),
    create: (slug, reason, expectedRevision) => ipcRenderer.invoke('snapshots:create', slug, reason, expectedRevision),
    restore: (slug, snapshotId, expectedRevision) =>
      ipcRenderer.invoke('snapshots:restore', slug, snapshotId, expectedRevision),
  },
  applications: {
    get: () => ipcRenderer.invoke('applications:get'),
    save: (data,revision) => ipcRenderer.invoke('applications:save', data,revision),
    log: input=>ipcRenderer.invoke('applications:log',input),
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
    listProfiles:()=>ipcRenderer.invoke('ai:listProfiles'),
    createProfile:input=>ipcRenderer.invoke('ai:createProfile',input),
    activateProfile:id=>ipcRenderer.invoke('ai:activateProfile',id),
    removeProfile:(id,revision,confirmation)=>ipcRenderer.invoke('ai:removeProfile',id,revision,confirmation),
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
