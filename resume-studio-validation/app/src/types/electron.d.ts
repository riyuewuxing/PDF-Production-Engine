import type {FactBank,AddFactInput,RevokeFactInput,LinkFactInput} from '../schema/factBankSchema';
import type {EvidenceIndex,AttachEvidenceInput,EvidenceReadInput,DetachEvidenceInput,PurgeEvidenceInput,EvidenceIntegrity,EvidenceVaultAudit} from '../schema/evidenceSchema';
import type { ByokAiSettings, ByokCompletionRequest, AiProfileCatalog } from '../lib/byokAiClient';
import type {
  ApplicationSnapshotMeta,
  ApplicationSnapshotRecord,
  ApplicationsStoreData,
  ApplicationLogInput,
  JobApplication,
  CoverLetterPdfPayload,
} from '../schema/applicationSchema';
import type { ResumeDocument, ResumeSummary } from '../schema/resumeSchema';
import type { ResumeSnapshotMeta, ResumeTrashList, ResumeWriteLockStatus } from '../server/localFsApi';

export interface SystemFontResult {
  fonts: string[];
  source: 'windows-gdi' | 'browser-local' | 'fallback';
  note?: string;
}

export interface PdfExportOptions {
  slug: string;
  document: ResumeDocument;
  saveAs?: boolean;
  skipSave?: boolean;
  fileNameSuffix?: string;
}

export interface CoverLetterExportOptions {
  payload: CoverLetterPdfPayload;
  saveAs?: boolean;
}

export interface PdfExportResult {
  canceled: boolean;
  filePath?: string;
  fileName?: string;
}

export interface SaveTextFileOptions {
  defaultFileName: string;
  content: string;
  saveAs?: boolean;
  dialogTitle?: string;
  filterName?: string;
  extension?: string;
  mimeType?: string;
}

export interface SaveApplicationSnapshotInput {
  snapshotId?: string;
  applicationId?: string;
  resumeSlug: string;
  exportedFilePath?: string;
  atsScore?: number | null;
  document: ResumeDocument;
}

import type {BackupInspection,BackupResult} from '../schema/workspaceBackupSchema';

export interface ResumeDesktopBridge {
  workspaceBackup?:{create:()=>Promise<BackupResult|null>;inspect:()=>Promise<BackupInspection|null>;restore:(token:string,confirmation:'RESTORE_TO_NEW_WORKSPACE')=>Promise<BackupResult|null>};
  readonly isDesktop: true;
  resumes: {
    list: () => Promise<{ master: ResumeSummary | null; resumes: ResumeSummary[] }>;
    get: (slug: string) => Promise<ResumeDocument>;
    save: (slug: string, doc: ResumeDocument) => Promise<ResumeDocument>;
    create: (input: {
      slug?: string;
      title?: string;
      cloneFromSlug?: string;
      document?: unknown;
    }) => Promise<{ slug: string; document: ResumeDocument }>;
    delete: (slug: string, expectedRevision: string) => Promise<{ deleted: boolean; trashId?: string }>;
  };
  writeLock?: {inspect:()=>Promise<ResumeWriteLockStatus>;recover:(token:string,confirmation:'RECOVER_DEAD_LOCK')=>Promise<{recovered:true}>};
  trash?: {
    list: () => Promise<ResumeTrashList>;
    restore: (id:string,expectedRevision:string,asCopy:boolean) => Promise<{slug:string;document:ResumeDocument}>;
    purge: (id:string,expectedRevision:string,confirmation:'PERMANENT_DELETE') => Promise<{deleted:boolean}>;
  };
  snapshots: {
    list: (slug: string) => Promise<ResumeSnapshotMeta[]>;
    create: (slug: string, reason: string, expectedRevision: string) => Promise<ResumeSnapshotMeta>;
    restore: (slug: string, snapshotId: string, expectedRevision: string) => Promise<ResumeDocument>;
  };
  applications: {
    get: () => Promise<ApplicationsStoreData>;
    save: (data: ApplicationsStoreData,revision:string) => Promise<ApplicationsStoreData>;
    log?: (input:ApplicationLogInput)=>Promise<{entry:JobApplication;store:ApplicationsStoreData}>;
    saveSnapshot: (input: SaveApplicationSnapshotInput) => Promise<ApplicationSnapshotMeta>;
    getSnapshot: (snapshotId: string) => Promise<ApplicationSnapshotRecord>;
    deleteSnapshot: (snapshotId: string) => Promise<{ deleted: boolean }>;
  };
  assets: {
    upload: (filename: string, dataUrl: string) => Promise<{ filename: string; url: string }>;
  };
  fonts: {
    listSystem: () => Promise<SystemFontResult>;
  };
  pdf: {
    export: (options: PdfExportOptions) => Promise<PdfExportResult>;
    exportPng: (options: PdfExportOptions) => Promise<PdfExportResult>;
    exportDocx: (options: PdfExportOptions) => Promise<PdfExportResult>;
    exportMarkdown: (options: PdfExportOptions) => Promise<PdfExportResult>;
    exportHtml: (options: PdfExportOptions) => Promise<PdfExportResult>;
    exportCoverLetter: (options: CoverLetterExportOptions) => Promise<PdfExportResult>;
    /** 真 ATS 逆向体检专用：纯内存渲染 PDF 并返回字节，绝不落盘 */
    renderBuffer: (doc: ResumeDocument) => Promise<Uint8Array>;
    getPrintPayload: (jobId: string) => Promise<ResumeDocument>;
    getCoverLetterPayload: (jobId: string) => Promise<CoverLetterPdfPayload>;
    notifyReady: (jobId: string) => Promise<void>;
  };
  facts?: {get:()=>Promise<FactBank>;add:(input:AddFactInput)=>Promise<FactBank>;link:(input:LinkFactInput)=>Promise<FactBank>;revoke:(input:RevokeFactInput)=>Promise<FactBank>};
  evidence?:{
    get:()=>Promise<EvidenceIndex>;
    audit:()=>Promise<EvidenceVaultAudit>;
    openVault:()=>Promise<void>;
    attach:(input:AttachEvidenceInput)=>Promise<{canceled:true}|{canceled:false;index:EvidenceIndex}>;
    verify:(input:EvidenceReadInput)=>Promise<EvidenceIntegrity>;
    detach:(input:DetachEvidenceInput)=>Promise<EvidenceIndex>;
    purge:(input:PurgeEvidenceInput)=>Promise<EvidenceIndex>;
    reveal:(input:EvidenceReadInput)=>Promise<void>;
  };
  ai: {
    getSettings: () => Promise<ByokAiSettings>;
    listProfiles:()=>Promise<AiProfileCatalog>;
    createProfile:(input:Partial<ByokAiSettings>)=>Promise<AiProfileCatalog>;
    activateProfile:(id:string)=>Promise<AiProfileCatalog>;
    removeProfile:(id:string,revision:string,confirmation:'DELETE_AI_PROFILE')=>Promise<AiProfileCatalog>;
    saveSettings: (settings: ByokAiSettings) => Promise<ByokAiSettings>;
    requestCompletion: (request: ByokCompletionRequest) => Promise<string>;
    cancelCompletion: (requestId: string) => Promise<void>;
  };
  shell: {
    openPath: (filePath: string) => Promise<string>;
    showItemInFolder: (filePath: string) => Promise<void>;
    openExportsDir: () => Promise<string>;
    saveTextFile: (options: SaveTextFileOptions) => Promise<PdfExportResult>;
  };
  lifecycle: {
    onBeforeClose: (callback: (requestId: number) => void) => () => void;
    confirmCloseReady: (requestId: number, saved: boolean) => void;
  };
}

declare global {
  interface Window {
    resumeDesktop?: ResumeDesktopBridge;
  }
}
