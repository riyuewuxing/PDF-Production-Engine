import { BrowserWindow, app, dialog, ipcMain, nativeImage, protocol, shell, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { requestByokCompletionDirect, validateByokBaseUrl } from '../src/lib/byokAiClient';
import { z } from 'zod';
import { AiSettingsStore } from './aiSettingsStore';
import { type DocxExportOptions, exportResumeToDocxBuffer } from '../src/lib/docxExporter';
import { buildStandaloneResumeHtml } from '../src/lib/htmlExporter';
import { resumeToMarkdown } from '../src/lib/markdownExporter';
import type { CoverLetterPdfPayload } from '../src/schema/applicationSchema';
import { type ResumeDocument, ResumeDocumentSchema } from '../src/schema/resumeSchema';
import { LocalResumeStore, ensureInitialDataFromLegacy } from '../src/server/localFsApi';
import type {
  PdfExportOptions,
  SaveApplicationSnapshotInput,
  SaveTextFileOptions,
  SystemFontResult,
} from '../src/types/electron';
import { resolveAppPaths, resolveUniqueExportPath } from './paths';

const execFileAsync = promisify(execFile);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'resume-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const resolvedPaths = resolveAppPaths({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  mainDir: __dirname,
  exePath: app.getPath('exe'),
  portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
  envDataRoot: process.env.RESUME_STUDIO_DATA_DIR,
  cwd: process.cwd(),
});
const rootDir = resolvedPaths.dataRootDir;
const dataDir = resolvedPaths.dataDir;
const exportsDir = resolvedPaths.exportsDir;
const store = new LocalResumeStore(dataDir);

let mainWindow: BrowserWindow | null = null;
let isClosingConfirmed = false;
let closeRequestSequence = 0;
let closeWaiter: { requestId: number; finish: (saved: boolean) => void } | null = null;

interface PendingPrintJob {
  kind: 'resume' | 'coverLetter';
  doc?: ResumeDocument;
  coverLetter?: CoverLetterPdfPayload;
  resolveReady: () => void;
  rejectReady: (err: Error) => void;
}

const pendingPrintJobs = new Map<string, PendingPrintJob>();

function getRendererEntry(query?: Record<string, string>): {
  type: 'url' | 'file';
  target: string;
  search?: Record<string, string>;
} {
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        url.searchParams.set(k, v);
      }
    }
    return { type: 'url', target: url.toString() };
  }
  return { type: 'file', target: resolvedPaths.indexHtmlPath, search: query };
}

async function loadWindowEntry(win: BrowserWindow, query?: Record<string, string>): Promise<void> {
  const entry = getRendererEntry(query);
  if (entry.type === 'url') {
    await win.loadURL(entry.target);
  } else {
    await win.loadFile(entry.target, entry.search ? { query: entry.search } : undefined);
  }
}

function sanitizeFilePart(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '');
  return cleaned || fallback;
}

function formatLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatLocalTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
}

function buildDefaultExportFilename(
  doc: ResumeDocument,
  ext: 'pdf' | 'png' | 'docx' | 'md' | 'html',
  suffix = '',
): string {
  const rawName = doc.basic.name.trim();
  const namePart = rawName && rawName !== '[姓名]' ? sanitizeFilePart(rawName, '简历') : '个人简历';
  const rolePart = sanitizeFilePart(doc.basic.title || doc.title, '求职简历');
  const cleanSuffix = suffix ? sanitizeFilePart(suffix, '') : '';
  return `${namePart}-${rolePart}-${formatLocalDate()}${cleanSuffix}.${ext}`;
}

async function writeFileSafely(targetPath: string, data: Buffer | string): Promise<string> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.writeFile(targetPath, data);
    return targetPath;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EBUSY' || code === 'EPERM') {
      const ext = path.extname(targetPath);
      const base = targetPath.slice(0, -ext.length);
      const fallbackPath = `${base}-${formatLocalTime()}${ext}`;
      await fs.writeFile(fallbackPath, data);
      return fallbackPath;
    }
    throw err;
  }
}

async function withHiddenPrintWindow<T>(
  spec:
    | { kind: 'resume'; doc: ResumeDocument }
    | { kind: 'coverLetter'; coverLetter: CoverLetterPdfPayload },
  runner: (win: BrowserWindow) => Promise<T>,
  options?: { offscreen?: boolean },
): Promise<T> {
  const jobId = crypto.randomUUID();
  const isDarkTemplate = spec.kind === 'resume' && spec.doc.templateId === 'vip-cyber-dark';

  const printWin = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    enableLargerThanScreen: true,
    backgroundColor: isDarkTemplate ? '#0b1220' : '#ffffff',
    webPreferences: {
      preload: resolvedPaths.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: Boolean(options?.offscreen),
    },
  });

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('隐藏打印窗口渲染超时'));
    }, 15000);

    pendingPrintJobs.set(jobId, {
      kind: spec.kind,
      doc: spec.kind === 'resume' ? spec.doc : undefined,
      coverLetter: spec.kind === 'coverLetter' ? spec.coverLetter : undefined,
      resolveReady: () => {
        clearTimeout(timer);
        resolve();
      },
      rejectReady: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
  });

  try {
    await loadWindowEntry(printWin, { mode: spec.kind === 'coverLetter' ? 'coverLetter' : 'print', jobId });
    await readyPromise;
    await new Promise((r) => setTimeout(r, 80));
    return await runner(printWin);
  } finally {
    pendingPrintJobs.delete(jobId);
    if (!printWin.isDestroyed()) {
      try {
        if (printWin.webContents.debugger.isAttached()) {
          printWin.webContents.debugger.detach();
        }
      } catch {
        // Ignore detach errors on closing window
      }
      printWin.destroy();
    }
  }
}

async function renderDocumentToPdf(doc: ResumeDocument): Promise<Buffer> {
  return withHiddenPrintWindow({ kind: 'resume', doc }, async (printWin) => {
    const pdfBuffer = await printWin.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      },
    });
    return Buffer.from(pdfBuffer);
  });
}

async function renderCoverLetterToPdf(coverLetter: CoverLetterPdfPayload): Promise<Buffer> {
  return withHiddenPrintWindow({ kind: 'coverLetter', coverLetter }, async (printWin) => {
    const pdfBuffer = await printWin.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      },
    });
    return Buffer.from(pdfBuffer);
  });
}

async function renderDocumentToPng(doc: ResumeDocument): Promise<Buffer> {
  return withHiddenPrintWindow(
    { kind: 'resume', doc },
    async (printWin) => {
      const measuredHeight = Number(
        await printWin.webContents.executeJavaScript(
          'Math.max(document.body ? document.body.scrollHeight : 1123, document.documentElement ? document.documentElement.scrollHeight : 1123, 1123)',
        ),
      );
      const fullHeight = Math.min(12000, Math.max(1123, Math.ceil(Number.isFinite(measuredHeight) ? measuredHeight : 1123)));
      const dbg = printWin.webContents.debugger;
      dbg.attach('1.3');
      await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: 794,
        height: fullHeight,
        deviceScaleFactor: 2,
        mobile: false,
      });
      await new Promise((r) => setTimeout(r, 120));
      const shot = (await dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      })) as { data: string };
      return Buffer.from(shot.data, 'base64');
    },
    { offscreen: true },
  );
}

const FALLBACK_SYSTEM_FONTS = [
  'Noto Sans SC',
  'Noto Serif SC',
  'MiSans',
  'Microsoft YaHei',
  'KaiTi',
  'FangSong',
  'SimHei',
  'DengXian',
  'SimSun',
  'Segoe UI',
  'Consolas',
];

let cachedSystemFonts: SystemFontResult | null = null;

async function listInstalledSystemFonts(): Promise<SystemFontResult> {
  if (cachedSystemFonts) return cachedSystemFonts;

  if (process.platform !== 'win32') {
    cachedSystemFonts = {
      fonts: FALLBACK_SYSTEM_FONTS,
      source: 'fallback',
      note: '当前非 Windows 平台，使用预置排印字体列表',
    };
    return cachedSystemFonts;
  }

  try {
    const psScript =
      "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); " +
      'Add-Type -AssemblyName System.Drawing; ' +
      '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name; $en = $_.GetName(1033); if ($en -and $en -ne $_.Name) { $en } }';
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 6000, windowsHide: true, encoding: 'utf8' },
    );
    const unique = Array.from(
      new Set(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    );
    if (unique.length > 0) {
      cachedSystemFonts = { fonts: unique, source: 'windows-gdi' };
      return cachedSystemFonts;
    }
  } catch {
    // Graceful fallback below
  }

  cachedSystemFonts = {
    fonts: FALLBACK_SYSTEM_FONTS,
    source: 'fallback',
    note: '读取本机字体清单失败，已优雅降级至推荐排印字体',
  };
  return cachedSystemFonts;
}

async function resolveDocxPhotoOptions(doc: ResumeDocument): Promise<DocxExportOptions | undefined> {
  if (!doc.basic.photoConfig.visible) return undefined;
  const rawPhoto = doc.basic.photo.trim();
  if (!rawPhoto) return undefined;

  let rawBuffer: Buffer | null = null;
  let extHint: 'png' | 'jpg' | undefined;

  try {
    if (rawPhoto.startsWith('/api/assets/')) {
      const filename = decodeURIComponent(rawPhoto.slice('/api/assets/'.length));
      const asset = await store.readAsset(filename);
      rawBuffer = asset.buffer;
      if (asset.mimeType === 'image/png') extHint = 'png';
      else if (asset.mimeType === 'image/jpeg') extHint = 'jpg';
    } else if (rawPhoto.startsWith('data:image/')) {
      const match = /^data:image\/([a-z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(rawPhoto);
      if (match && match[2]) {
        rawBuffer = Buffer.from(match[2], 'base64');
        const sub = match[1]?.toLowerCase();
        if (sub === 'png') extHint = 'png';
        else if (sub === 'jpeg' || sub === 'jpg') extHint = 'jpg';
      }
    }
  } catch {
    return undefined;
  }

  if (!rawBuffer || rawBuffer.byteLength === 0) return undefined;
  if (extHint === 'png' || extHint === 'jpg') {
    return { photoBuffer: rawBuffer, photoType: extHint };
  }

  const converted = nativeImage.createFromBuffer(rawBuffer).toPNG();
  if (converted.byteLength === 0) return undefined;
  return { photoBuffer: converted, photoType: 'png' };
}

async function resolveEmbeddedPhotoDataUrl(doc: ResumeDocument): Promise<string | undefined> {
  const opts = await resolveDocxPhotoOptions(doc);
  if (!opts?.photoBuffer || opts.photoBuffer.byteLength === 0) return undefined;
  const mime = opts.photoType === 'jpg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${Buffer.from(opts.photoBuffer).toString('base64')}`;
}

const aiSettings = new AiSettingsStore(path.join(dataDir, '.ai-settings.json'), {
  available: () => safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (bytes) => safeStorage.decryptString(bytes),
});
const aiRequests = new Map<string, AbortController>();
const aiCompletionSchema = z.object({
  requestId: z.string().uuid(),
  profile: z.object({ baseUrl: z.string().max(2048), model: z.string().max(200) }).strict(),
  systemPrompt: z.string().min(1).max(20000),
  userPrompt: z.string().max(100000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
}).strict();

function assertTrustedAiSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('未经授权的 AI 调用来源。');
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('resumes:list', () => store.listResumes());
  ipcMain.handle('resumes:get', (_event, slug: string) => store.getResume(slug));
  ipcMain.handle('resumes:save', (_event, slug: string, doc: unknown) => store.saveResume(slug, doc, { requireExisting: true }));
  ipcMain.handle(
    'resumes:create',
    (
      _event,
      input: { slug?: string; title?: string; cloneFromSlug?: string; document?: unknown },
    ) => store.createResume(input),
  );
  ipcMain.handle('resumes:delete', (_event, slug: string, expectedRevision: string) => {
    if (typeof expectedRevision !== 'string') throw new Error('删除前必须提供版本标识。');
    return store.deleteResume(slug, expectedRevision);
  });
  ipcMain.handle(
    'assets:upload',
    (_event, payload: { filename?: string; dataUrl: string }) => store.saveAsset(payload),
  );

  ipcMain.handle('snapshots:list', (_event, slug: string) => store.listSnapshots(slug));
  ipcMain.handle('snapshots:create', (_event, slug: string, reason?: string) =>
    store.createSnapshot(slug, reason),
  );
  ipcMain.handle('snapshots:restore', (_event, slug: string, snapshotId: string, expectedRevision: string) => {
    if (typeof expectedRevision !== 'string') throw new Error('回滚前必须提供版本标识。');
    return store.restoreSnapshot(slug, snapshotId, expectedRevision);
  });

  ipcMain.handle('applications:get', () => store.getApplications());
  ipcMain.handle('applications:save', (_event, data: unknown) => store.saveApplications(data));
  ipcMain.handle(
    'applications:saveSnapshot',
    (_event, input: SaveApplicationSnapshotInput) => store.saveApplicationSnapshot(input),
  );
  ipcMain.handle(
    'applications:getSnapshot',
    (_event, snapshotId: string) => store.getApplicationSnapshot(snapshotId),
  );
  ipcMain.handle(
    'applications:deleteSnapshot',
    (_event, snapshotId: string) => store.deleteApplicationSnapshot(snapshotId),
  );

  ipcMain.handle('pdf:getPayload', (_event, jobId: string) => {
    const job = pendingPrintJobs.get(jobId);
    if (!job || job.kind !== 'resume' || !job.doc) {
      throw new Error('打印任务不存在或已过期');
    }
    return job.doc;
  });

  ipcMain.handle('pdf:getCoverLetterPayload', (_event, jobId: string) => {
    const job = pendingPrintJobs.get(jobId);
    if (!job || job.kind !== 'coverLetter' || !job.coverLetter) {
      throw new Error('自荐信打印任务不存在或已过期');
    }
    return job.coverLetter;
  });

  ipcMain.handle('pdf:notifyReady', (_event, jobId: string) => {
    const job = pendingPrintJobs.get(jobId);
    if (job) {
      job.resolveReady();
    }
  });

  async function runExport(
    options: PdfExportOptions,
    spec: {
      ext: 'pdf' | 'png' | 'docx' | 'md' | 'html';
      dialogTitle: string;
      filterName: string;
      produce: (saved: ResumeDocument) => Promise<Buffer | string>;
    },
  ) {
    // The editor flushes before export. Export itself is read-only with respect to the original document.
    const targetDoc = ResumeDocumentSchema.parse(options.document);
    const defaultFileName = buildDefaultExportFilename(
      targetDoc,
      spec.ext,
      options.fileNameSuffix ?? '',
    );
    await fs.mkdir(exportsDir, { recursive: true });
    let targetPath = path.join(exportsDir, defaultFileName);

    if (options.saveAs && mainWindow) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: spec.dialogTitle,
        defaultPath: targetPath,
        filters: [{ name: spec.filterName, extensions: [spec.ext] }],
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }
      targetPath = result.filePath;
    } else {
      targetPath = resolveUniqueExportPath(targetPath);
    }

    const content = await spec.produce(targetDoc);
    const writtenPath = await writeFileSafely(targetPath, content);

    if ((spec.ext === 'pdf' || spec.ext === 'docx') && options.slug) {
      await store.createSnapshot(
        options.slug,
        options.skipSave
          ? `导出${spec.ext.toUpperCase()}脱敏版前原稿快照`
          : `导出 ${spec.ext.toUpperCase()} 自动快照`,
        options.skipSave ? undefined : targetDoc,
      );
    }

    return {
      canceled: false,
      filePath: writtenPath,
      fileName: path.basename(writtenPath),
    };
  }

  ipcMain.handle(
    'pdf:export',
    (_event, options: PdfExportOptions) =>
      runExport(options, {
        ext: 'pdf',
        dialogTitle: '导出矢量 A4 PDF',
        filterName: 'PDF 文件',
        produce: renderDocumentToPdf,
      }),
  );

  // 真 ATS 逆向体检：把当前文档纯内存渲染成 PDF 字节返回渲染进程。
  // 严格只读：不落盘、不写 exports/、不创建 .backups/ 快照。
  ipcMain.handle('pdf:renderBuffer', async (_event, rawDoc: unknown) => {
    const parsed = ResumeDocumentSchema.parse(rawDoc);
    const buffer = await renderDocumentToPdf(parsed);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  });

  ipcMain.handle(
    'pdf:exportCoverLetter',
    async (_event, options: { payload: CoverLetterPdfPayload; saveAs?: boolean }) => {
      const namePart = sanitizeFilePart(options.payload.candidateName, '求职者');
      const companyPart = sanitizeFilePart(options.payload.company, '自荐信');
      const defaultName = `${namePart}-自荐信-${companyPart}-${formatLocalDate()}.pdf`;
      await fs.mkdir(exportsDir, { recursive: true });
      let targetPath = resolveUniqueExportPath(path.join(exportsDir, defaultName));
      if (options.saveAs && mainWindow) {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: '导出求职自荐信 A4 PDF',
          defaultPath: targetPath,
          filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
        });
        if (result.canceled || !result.filePath) {
          return { canceled: true };
        }
        targetPath = result.filePath;
      }
      const pdfBytes = await renderCoverLetterToPdf(options.payload);
      const writtenPath = await writeFileSafely(targetPath, pdfBytes);
      return {
        canceled: false,
        filePath: writtenPath,
        fileName: path.basename(writtenPath),
      };
    },
  );

  ipcMain.handle(
    'export:png',
    (_event, options: PdfExportOptions) =>
      runExport(options, {
        ext: 'png',
        dialogTitle: '导出高清 2x PNG 长图',
        filterName: 'PNG 图片',
        produce: renderDocumentToPng,
      }),
  );

  ipcMain.handle('fonts:listSystem', () => listInstalledSystemFonts());

  ipcMain.handle(
    'export:docx',
    (_event, options: PdfExportOptions) =>
      runExport(options, {
        ext: 'docx',
        dialogTitle: '导出可编辑 Word 文档 (.docx)',
        filterName: 'Word 文档',
        produce: async (savedDoc) => {
          const photoOpts = await resolveDocxPhotoOptions(savedDoc);
          return exportResumeToDocxBuffer(savedDoc, photoOpts);
        },
      }),
  );

  ipcMain.handle(
    'export:markdown',
    (_event, options: PdfExportOptions) =>
      runExport(options, {
        ext: 'md',
        dialogTitle: '导出 Markdown 文档 (.md)',
        filterName: 'Markdown 文件',
        produce: async (savedDoc) => resumeToMarkdown(savedDoc),
      }),
  );

  ipcMain.handle(
    'export:html',
    (_event, options: PdfExportOptions) =>
      runExport(options, {
        ext: 'html',
        dialogTitle: '导出单文件离线简历主页 (.html)',
        filterName: 'HTML 网页文件',
        produce: async (savedDoc) => {
          const embeddedPhotoDataUrl = await resolveEmbeddedPhotoDataUrl(savedDoc);
          return buildStandaloneResumeHtml(savedDoc, { embeddedPhotoDataUrl });
        },
      }),
  );

  ipcMain.handle('ai:getSettings', async (event) => {
    assertTrustedAiSender(event);
    return aiSettings.getPublicSettings();
  });

  ipcMain.handle('ai:saveSettings', async (event, rawSettings: unknown) => {
    assertTrustedAiSender(event);
    return aiSettings.save(rawSettings);
  });

  ipcMain.handle('ai:requestCompletion', async (event, raw: unknown) => {
    assertTrustedAiSender(event);
    const parsed = aiCompletionSchema.safeParse(raw);
    if (!parsed.success) throw new Error('AI 请求参数超出许可范围。');
    const { requestId, profile, ...options } = parsed.data;
    if (aiRequests.has(requestId) || aiRequests.size >= 4) throw new Error('AI 请求重复或并发数已达上限。');
    const controller = new AbortController();
    aiRequests.set(requestId, controller);
    try {
      const settings = await aiSettings.getRequestSettings();
      if (!settings.enabled || settings.baseUrl !== validateByokBaseUrl(profile.baseUrl).baseUrl ||
          settings.model !== profile.model) throw new Error('AI 配置已变化，请先保存并重试。');
      return await requestByokCompletionDirect({ ...options, settings, signal: controller.signal });
    } finally {
      aiRequests.delete(requestId);
    }
  });

  ipcMain.handle('ai:cancelCompletion', (event, requestId: string) => {
    assertTrustedAiSender(event);
    if (typeof requestId === 'string') aiRequests.get(requestId)?.abort();
  });

  ipcMain.handle('shell:openPath', (_event, filePath: string) => shell.openPath(filePath));
  ipcMain.handle('shell:showItemInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
  ipcMain.handle('shell:openExportsDir', async () => {
    await fs.mkdir(exportsDir, { recursive: true });
    return shell.openPath(exportsDir);
  });
  ipcMain.handle('shell:saveTextFile', async (_event, options: SaveTextFileOptions) => {
    await fs.mkdir(exportsDir, { recursive: true });
    const extRaw = (options.extension || path.extname(options.defaultFileName).slice(1) || 'txt')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    const baseNameRaw = path.basename(options.defaultFileName, path.extname(options.defaultFileName));
    const safeName = `${sanitizeFilePart(baseNameRaw, 'export')}.${extRaw || 'txt'}`;
    let targetPath = path.join(exportsDir, safeName);
    if (options.saveAs && mainWindow) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: options.dialogTitle || '导出文件',
        defaultPath: targetPath,
        filters: [{ name: options.filterName || '导出文件', extensions: [extRaw || 'txt'] }],
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }
      targetPath = result.filePath;
    } else {
      targetPath = resolveUniqueExportPath(targetPath);
    }
    const writtenPath = await writeFileSafely(targetPath, options.content);
    return {
      canceled: false,
      filePath: writtenPath,
      fileName: path.basename(writtenPath),
    };
  });

  ipcMain.on('app:closeReady', (event, requestId: number, saved: boolean) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || typeof saved !== 'boolean') return;
    if (closeWaiter?.requestId === requestId) {
      closeWaiter.finish(saved);
    }
  });
}

async function createMainWindow(): Promise<BrowserWindow> {
  isClosingConfirmed = false;
  const appIcon = nativeImage.createFromPath(resolvedPaths.iconPath);
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    title: 'Resume Studio - 本地简历桌面工作台',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    backgroundColor: '#11161f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvedPaths.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;

  let shown = false;
  const showAndMaximize = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.maximize();
    win.show();
  };
  const showFallbackTimer = setTimeout(showAndMaximize, 1500);

  win.once('ready-to-show', () => {
    clearTimeout(showFallbackTimer);
    showAndMaximize();
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  win.on('close', (event) => {
    if (isClosingConfirmed) return;
    event.preventDefault();
    if (closeWaiter) return;
    const requestId = ++closeRequestSequence;
    const finishClose = (saved: boolean) => {
      if (closeWaiter?.requestId !== requestId) return;
      clearTimeout(timer);
      closeWaiter = null;
      if (win.isDestroyed()) return;
      if (!saved) {
        // A timeout or failed disk write is not permission to lose edits.
        const choice = dialog.showMessageBoxSync(win, {
          type: 'warning',
          title: '未能确认保存',
          message: '简历保存失败或尚未完成，是否留在工作台？',
          detail: '建议返回工作台重试保存。只有明确选择放弃未保存内容才会关闭。',
          buttons: ['返回工作台', '放弃未保存内容并关闭'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (choice !== 1) return;
      }
      isClosingConfirmed = true;
      win.close();
    };

    const timer = setTimeout(() => finishClose(false), 10000);
    closeWaiter = { requestId, finish: finishClose };
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('app:beforeClose', requestId);
    } else {
      finishClose(false);
    }
  });

  win.on('closed', () => {
    clearTimeout(showFallbackTimer);
    for (const controller of aiRequests.values()) controller.abort();
    mainWindow = null;
  });

  await loadWindowEntry(win);
  return win;
}

export {
  createMainWindow,
  dataDir,
  exportsDir,
  registerIpcHandlers,
  renderDocumentToPdf,
  renderDocumentToPng,
  rootDir,
  store,
};

export async function registerAssetProtocol(): Promise<void> {
  protocol.handle('resume-asset', async (request) => {
    try {
      const parsed = new URL(request.url);
      const rawName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      const { buffer, mimeType } = await store.readAsset(rawName);
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: { 'Content-Type': mimeType },
      });
    } catch {
      return new Response('Asset not found', { status: 404 });
    }
  });
}

if (require.main === module) {
  if (process.env.RESUME_STUDIO_DATA_DIR?.trim()) {
    app.setPath(
      'userData',
      path.join(path.resolve(process.env.RESUME_STUDIO_DATA_DIR.trim()), '.electron-userdata'),
    );
  }

  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
      }
    });

    app.whenReady().then(async () => {
      await ensureInitialDataFromLegacy({ rootDir, force: false });
      await registerAssetProtocol();
      registerIpcHandlers();
      await createMainWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createMainWindow();
        }
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
  }
}
