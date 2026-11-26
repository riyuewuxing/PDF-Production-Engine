import { type ByokAiSettings, type AiProfileCatalog, DEFAULT_BYOK_SETTINGS } from './byokAiClient';
import { exportResumeToDocxBlob } from './docxExporter';
import { buildStandaloneResumeHtml } from './htmlExporter';
import { resumeToMarkdown } from './markdownExporter';
import { buildResumeExportFilename, printResumeInBrowser } from './resumeExportNaming';
import type {
  ApplicationSnapshotMeta,
  ApplicationSnapshotRecord,
  ApplicationsStoreData,
  ApplicationLogInput,
  JobApplication,
} from '../schema/applicationSchema';
import type { ResumeDocument, ResumeSummary } from '../schema/resumeSchema';
import type { ResumeSnapshotMeta, ResumeTrashList, ResumeWriteLockStatus } from '../server/localFsApi';
import type {
  CoverLetterExportOptions,
  PdfExportOptions,
  PdfExportResult,
  SaveApplicationSnapshotInput,
  SaveTextFileOptions,
  SystemFontResult,
} from '../types/electron';

export interface ResumeListResponse {
  master: ResumeSummary | null;
  resumes: ResumeSummary[];
}

async function handleJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const errBody = (await res.json()) as { message?: string };
      if (errBody.message) {
        message = errBody.message;
      }
    } catch {
      // Ignore non-JSON error body
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Strip only Electron's known IPC wrapper, preserving the actual domain error. */
export function localErrorMessage(error:unknown,fallback:string):string {
  const message=error instanceof Error?error.message:fallback;
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:LocalFsApiError|Error):\s*/,'')||fallback;
}
export function isDesktopMode(): boolean {
  return typeof window !== 'undefined' && Boolean(window.resumeDesktop?.isDesktop);
}

export function resolveAssetUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/api/assets/') && isDesktopMode()) {
    const filename = trimmed.slice('/api/assets/'.length);
    return `resume-asset://local/${encodeURIComponent(filename)}`;
  }
  return trimmed;
}

export const apiClient = {
  async listResumes(): Promise<ResumeListResponse> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.resumes.list();
    }
    const res = await fetch('/api/resumes');
    return handleJsonResponse<ResumeListResponse>(res);
  },

  async getResume(slug: string): Promise<ResumeDocument> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.resumes.get(slug);
    }
    const res = await fetch(`/api/resumes/${encodeURIComponent(slug)}`);
    return handleJsonResponse<ResumeDocument>(res);
  },

  async saveResume(slug: string, doc: ResumeDocument): Promise<ResumeDocument> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.resumes.save(slug, doc);
    }
    const res = await fetch(`/api/resumes/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    return handleJsonResponse<ResumeDocument>(res);
  },

  async createResume(input: {
    slug?: string;
    title?: string;
    cloneFromSlug?: string;
    document?: unknown;
  }): Promise<{ slug: string; document: ResumeDocument }> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.resumes.create(input);
    }
    const res = await fetch('/api/resumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleJsonResponse<{ slug: string; document: ResumeDocument }>(res);
  },

  async deleteResume(slug: string, expectedRevision: string): Promise<{ deleted: boolean; trashId?: string }> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.resumes.delete(slug, expectedRevision);
    }
    const res = await fetch(`/api/resumes/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      headers: { 'If-Match': encodeURIComponent(expectedRevision) },
    });
    return handleJsonResponse<{ deleted: boolean; trashId?: string }>(res);
  },

  async listTrash(): Promise<ResumeTrashList> {
    if(window.resumeDesktop){if(!window.resumeDesktop.trash)throw new Error('当前桌面桥接版本不支持回收站，请升级工作台。');return window.resumeDesktop.trash.list();}
    return handleJsonResponse<ResumeTrashList>(await fetch('/api/trash'));
  },
  async restoreTrash(id:string,expectedRevision:string,asCopy=false):Promise<{slug:string;document:ResumeDocument}>{
    if(window.resumeDesktop){if(!window.resumeDesktop.trash)throw new Error('当前桌面桥接版本不支持回收站。');return window.resumeDesktop.trash.restore(id,expectedRevision,asCopy);}
    return handleJsonResponse<{slug:string;document:ResumeDocument}>(await fetch('/api/trash/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,expectedRevision,asCopy})}));
  },
  async purgeTrash(id:string,expectedRevision:string):Promise<{deleted:boolean}>{
    if(window.resumeDesktop){if(!window.resumeDesktop.trash)throw new Error('当前桌面桥接版本不支持回收站。');return window.resumeDesktop.trash.purge(id,expectedRevision,'PERMANENT_DELETE');}
    return handleJsonResponse<{deleted:boolean}>(await fetch('/api/trash/purge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,expectedRevision,confirmation:'PERMANENT_DELETE'})}));
  },

  async listSnapshots(slug: string): Promise<ResumeSnapshotMeta[]> {
    if (window.resumeDesktop?.snapshots) {
      return window.resumeDesktop.snapshots.list(slug);
    }
    const res = await fetch(`/api/resumes/${encodeURIComponent(slug)}/snapshots`);
    return handleJsonResponse<ResumeSnapshotMeta[]>(res);
  },

  async createSnapshot(slug: string, reason: string, expectedRevision: string): Promise<ResumeSnapshotMeta> {
    if (window.resumeDesktop?.snapshots) {
      return window.resumeDesktop.snapshots.create(slug, reason, expectedRevision);
    }
    const res = await fetch(`/api/resumes/${encodeURIComponent(slug)}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, expectedRevision }),
    });
    return handleJsonResponse<ResumeSnapshotMeta>(res);
  },

  async restoreSnapshot(slug: string, snapshotId: string, expectedRevision: string): Promise<ResumeDocument> {
    if (window.resumeDesktop?.snapshots) {
      return window.resumeDesktop.snapshots.restore(slug, snapshotId, expectedRevision);
    }
    const res = await fetch(`/api/resumes/${encodeURIComponent(slug)}/snapshots/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId, expectedRevision }),
    });
    return handleJsonResponse<ResumeDocument>(res);
  },

  async getApplications(): Promise<ApplicationsStoreData> {
    if (window.resumeDesktop?.applications) {
      return window.resumeDesktop.applications.get();
    }
    const res = await fetch('/api/applications');
    return handleJsonResponse<ApplicationsStoreData>(res);
  },

  async saveApplications(data: ApplicationsStoreData,revision:string): Promise<ApplicationsStoreData> {
    if (window.resumeDesktop?.applications) {
      return window.resumeDesktop.applications.save(data,revision);
    }
    const res = await fetch('/api/applications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json','If-Match':revision },
      body: JSON.stringify(data),
    });
    return handleJsonResponse<ApplicationsStoreData>(res);
  },

  async logApplication(input:ApplicationLogInput):Promise<{entry:JobApplication;store:ApplicationsStoreData}>{
    if(window.resumeDesktop){if(!window.resumeDesktop.applications.log)throw new Error('桌面桥接版本过旧。');return window.resumeDesktop.applications.log(input);}
    return handleJsonResponse<{entry:JobApplication;store:ApplicationsStoreData}>(await fetch('/api/applications/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));
  },
  async inspectWriteLock():Promise<ResumeWriteLockStatus>{
    if(window.resumeDesktop){if(!window.resumeDesktop.writeLock)throw new Error('桌面桥接版本过旧。');return window.resumeDesktop.writeLock.inspect();}
    return handleJsonResponse<ResumeWriteLockStatus>(await fetch('/api/write-lock'));
  },
  async recoverWriteLock(token:string):Promise<{recovered:true}>{
    if(window.resumeDesktop){if(!window.resumeDesktop.writeLock)throw new Error('桌面桥接版本过旧。');return window.resumeDesktop.writeLock.recover(token,'RECOVER_DEAD_LOCK');}
    return handleJsonResponse<{recovered:true}>(await fetch('/api/write-lock/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,confirmation:'RECOVER_DEAD_LOCK'})}));
  },

  async saveApplicationSnapshot(
    input: SaveApplicationSnapshotInput,
  ): Promise<ApplicationSnapshotMeta> {
    if (window.resumeDesktop?.applications?.saveSnapshot) {
      return window.resumeDesktop.applications.saveSnapshot(input);
    }
    const res = await fetch('/api/application-snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleJsonResponse<ApplicationSnapshotMeta>(res);
  },

  async getApplicationSnapshot(snapshotId: string): Promise<ApplicationSnapshotRecord> {
    if (window.resumeDesktop?.applications?.getSnapshot) {
      return window.resumeDesktop.applications.getSnapshot(snapshotId);
    }
    const res = await fetch(`/api/application-snapshots/${encodeURIComponent(snapshotId)}`);
    return handleJsonResponse<ApplicationSnapshotRecord>(res);
  },

  async deleteApplicationSnapshot(snapshotId: string): Promise<{ deleted: boolean }> {
    if (window.resumeDesktop?.applications?.deleteSnapshot) {
      return window.resumeDesktop.applications.deleteSnapshot(snapshotId);
    }
    const res = await fetch(`/api/application-snapshots/${encodeURIComponent(snapshotId)}`, {
      method: 'DELETE',
    });
    return handleJsonResponse<{ deleted: boolean }>(res);
  },

  async uploadAsset(filename: string, dataUrl: string): Promise<{ filename: string; url: string }> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.assets.upload(filename, dataUrl);
    }
    const res = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, dataUrl }),
    });
    return handleJsonResponse<{ filename: string; url: string }>(res);
  },

  async exportPdf(options: PdfExportOptions): Promise<PdfExportResult> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.pdf.export(options);
    }
    printResumeInBrowser(options.document, options.fileNameSuffix);
    return { canceled: false };
  },

  async exportPng(options: PdfExportOptions): Promise<PdfExportResult> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.pdf.exportPng(options);
    }
    throw new Error('高清 PNG 长图导出需在 Resume Studio 桌面客户端中使用');
  },

  async exportDocx(options: PdfExportOptions): Promise<PdfExportResult> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.pdf.exportDocx(options);
    }
    const blob = await exportResumeToDocxBlob(options.document);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildResumeExportFilename(options.document, 'docx', options.fileNameSuffix);
    a.click();
    URL.revokeObjectURL(url);
    return { canceled: false, fileName: a.download };
  },

  async exportMarkdown(options: PdfExportOptions): Promise<PdfExportResult> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.pdf.exportMarkdown(options);
    }
    const md = resumeToMarkdown(options.document);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildResumeExportFilename(options.document, 'md', options.fileNameSuffix);
    a.click();
    URL.revokeObjectURL(url);
    return { canceled: false, fileName: a.download };
  },

  async exportHtml(options: PdfExportOptions): Promise<PdfExportResult> {
    if (window.resumeDesktop?.pdf?.exportHtml) {
      return window.resumeDesktop.pdf.exportHtml(options);
    }
    const html = buildStandaloneResumeHtml(options.document);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildResumeExportFilename(options.document, 'html', options.fileNameSuffix);
    a.click();
    URL.revokeObjectURL(url);
    return { canceled: false, fileName: a.download };
  },

  /**
   * 真 ATS 逆向体检：请求主进程把当前文档纯内存渲染成 PDF 字节。
   * 不落盘、不产生快照；非桌面环境明确报错。
   */
  async renderPdfBuffer(doc: ResumeDocument): Promise<Uint8Array> {
    if (window.resumeDesktop?.pdf?.renderBuffer) {
      return window.resumeDesktop.pdf.renderBuffer(doc);
    }
    throw new Error('真 ATS 逆向解析需在 Resume Studio 桌面端运行');
  },

  async exportCoverLetterPdf(options: CoverLetterExportOptions): Promise<PdfExportResult> {
    if (window.resumeDesktop?.pdf?.exportCoverLetter) {
      return window.resumeDesktop.pdf.exportCoverLetter(options);
    }
    const blob = new Blob([options.payload.bodyText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${options.payload.candidateName || '求职者'}-自荐信.txt`;
    a.click();
    URL.revokeObjectURL(url);
    return { canceled: false, fileName: a.download };
  },

  async getAiSettings(): Promise<ByokAiSettings> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.ai.getSettings();
    }
    return { ...DEFAULT_BYOK_SETTINGS };
  },

  async listAiProfiles():Promise<AiProfileCatalog>{
    if(window.resumeDesktop)return window.resumeDesktop.ai.listProfiles();
    return {activeProfileId:'browser',profiles:[]};
  },
  async createAiProfile(input:Partial<ByokAiSettings>):Promise<AiProfileCatalog>{
    if(!window.resumeDesktop)throw new Error('模型档案仅支持桌面端。');return window.resumeDesktop.ai.createProfile(input);
  },
  async activateAiProfile(id:string):Promise<AiProfileCatalog>{
    if(!window.resumeDesktop)throw new Error('模型档案仅支持桌面端。');return window.resumeDesktop.ai.activateProfile(id);
  },
  async removeAiProfile(id:string,revision:string):Promise<AiProfileCatalog>{
    if(!window.resumeDesktop)throw new Error('模型档案仅支持桌面端。');return window.resumeDesktop.ai.removeProfile(id,revision,'DELETE_AI_PROFILE');
  },
  async saveAiSettings(settings: ByokAiSettings): Promise<ByokAiSettings> {
    if (window.resumeDesktop) {
      return window.resumeDesktop.ai.saveSettings(settings);
    }
    return settings;
  },

  async listSystemFonts(): Promise<SystemFontResult> {
    if (window.resumeDesktop?.fonts) {
      return window.resumeDesktop.fonts.listSystem();
    }
    return {
      fonts: [
        'Noto Sans SC',
        'Noto Serif SC',
        'MiSans',
        'Microsoft YaHei',
        'KaiTi',
        'FangSong',
        'SimHei',
        'DengXian',
        'Segoe UI',
        'Consolas',
      ],
      source: 'fallback',
      note: '浏览器预览模式使用内置推荐字体集；桌面端可枚举本机全部已装字体。',
    };
  },

  async openFile(filePath: string): Promise<void> {
    if (window.resumeDesktop) {
      try{await window.resumeDesktop.shell.openPath(filePath);}catch(err){window.alert(localErrorMessage(err,'无法打开导出文件'));}
    }
  },

  async showInFolder(filePath: string): Promise<void> {
    if (window.resumeDesktop) {
      try{await window.resumeDesktop.shell.showItemInFolder(filePath);}catch(err){window.alert(localErrorMessage(err,'无法定位导出文件'));}
    }
  },

  async openExportsDir(): Promise<void> {
    if (window.resumeDesktop) {
      try{await window.resumeDesktop.shell.openExportsDir();}catch(err){window.alert(localErrorMessage(err,'无法打开导出目录'));}
    }
  },

  async saveTextFile(options: SaveTextFileOptions): Promise<PdfExportResult> {
    if (window.resumeDesktop?.shell?.saveTextFile) {
      return window.resumeDesktop.shell.saveTextFile(options);
    }
    const blob = new Blob([options.content], {
      type: options.mimeType ?? 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = options.defaultFileName;
    a.click();
    URL.revokeObjectURL(url);
    return { canceled: false, fileName: options.defaultFileName };
  },
};
