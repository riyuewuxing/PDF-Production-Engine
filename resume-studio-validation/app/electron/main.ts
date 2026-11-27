import { BrowserWindow, app, dialog, ipcMain, nativeImage, protocol, shell, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs, lstatSync, realpathSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWorkspaceBackup,inspectWorkspaceBackup,restoreWorkspaceBackup,inspectRestoredWorkspace} from '../src/server/workspaceBackup';
import {RESTORE_PREFIX} from '../src/schema/workspaceBackupSchema';
import {readLaunchHandoff,writeLaunchReceipt,launchWorkspace,recordLaunchStage,shouldBootstrapWorkspace} from './workspaceLaunch';
import { promisify } from 'node:util';
import { requestByokCompletionDirectWithReceipt, validateByokBaseUrl,AiGatewayError,type AiCompletionOutcome } from '../src/lib/byokAiClient';
import { z } from 'zod';
import { AiSettingsStore } from './aiSettingsStore';
import {FactBankStore} from '../src/server/factBankStore';
import {EvidenceStore} from '../src/server/evidenceStore';
import {RecoveryDraftStore} from '../src/server/recoveryDraftStore';
import {AttachEvidenceSchema} from '../src/schema/evidenceSchema';
import {FactRequestBindingSchema} from '../src/schema/factBankSchema';
import {hasRecordFactSources} from '../src/lib/factPromptGate';
import { type DocxExportOptions, exportResumeToDocxBuffer } from '../src/lib/docxExporter';
import { buildStandaloneResumeHtml } from '../src/lib/htmlExporter';
import { resumeToMarkdown } from '../src/lib/markdownExporter';
import { buildResumeExportFilename, formatLocalDate, sanitizeFilePart } from '../src/lib/resumeExportNaming';
import {JobQueueOpenSchema,type CoverLetterPdfPayload,type ApplicationLogInput,type ApplicationSnapshotLink,type ApplicationPdfCheck,type SubmissionPackageResult} from '../src/schema/applicationSchema';
import {jobQueueDocumentText} from '../src/lib/jobQueueBinding';
import { type ResumeDocument, ResumeDocumentSchema } from '../src/schema/resumeSchema';
import { LocalResumeStore, LocalFsApiError, ensureInitialDataFromLegacy, inspectResumeWriteLock, recoverResumeWriteLock } from '../src/server/localFsApi';
import {JobQueueExecutor} from '../src/server/jobQueueExecutor';
import type {
  PdfExportOptions,
  SaveApplicationSnapshotInput,
  SaveTextFileOptions,
  SystemFontResult,
} from '../src/types/electron';
import { resolveAppPaths, resolveUniqueExportPath } from './paths';
import { isLoopbackDevEntry, isPathInside, isSafeExportFileName, isTrustedRendererFrame, rendererEntryUrl } from './securityPolicy';
import {PdfReceiptVault,readPdfFingerprint,checkFingerprint,canCheckRecordedPdf,canCheckRecordedRealPdf} from './pdfReceipt';
import {buildSubmissionZip,publishSubmissionZip,packageEntryName,MAX_PACKAGE_PDFS,MAX_PACKAGE_BYTES} from './submissionPackage';

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
const restoredWorkspace=path.basename(rootDir).startsWith(RESTORE_PREFIX);
const launchHandoff=readLaunchHandoff(process.env);
recordLaunchStage(launchHandoff,'module-loaded');
let launchReceiptSent=false,launchReceiptTask:Promise<void>|null=null;
async function reportLaunch(status:'ready'|'failed',message?:string){
  if(!launchHandoff||launchReceiptSent)return;
  if(launchReceiptTask)return launchReceiptTask;
  const task=writeLaunchReceipt(launchHandoff,{folder:rootDir,status,pid:process.pid,message}).then(()=>{launchReceiptSent=true;recordLaunchStage(launchHandoff,'receipt-written');});
  launchReceiptTask=task;
  try{await task;}finally{if(launchReceiptTask===task)launchReceiptTask=null;}
}
const store = new LocalResumeStore(dataDir);
const jobQueueExecutor=new JobQueueExecutor(store);
const recoveryDrafts=new RecoveryDraftStore(rootDir,store);
const facts=new FactBankStore(store);
const evidence=new EvidenceStore(store,facts);
let evidencePickerBusy=false;

let mainWindow: BrowserWindow | null = null;
let isClosingConfirmed = false;
let closeRequestSequence = 0;
let closeWaiter: { requestId: number; finish: (saved: boolean) => void } | null = null;

interface PendingPrintJob {
  kind: 'resume' | 'coverLetter';
  senderId: number;
  expectedUrl: string;
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
  if (devUrl && !app.isPackaged) {
    if (!isLoopbackDevEntry(devUrl)) throw new Error('开发服务器必须是明确的本机回环地址。');
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

function hardenWindow(win: BrowserWindow): void {
  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({action:'deny'}));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-frame-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  contents.session.setPermissionCheckHandler(()=>false);
}

async function loadWindowEntry(win: BrowserWindow, query?: Record<string, string>): Promise<void> {
  const entry = getRendererEntry(query);
  if (entry.type === 'url') {
    await win.loadURL(entry.target);
  } else {
    await win.loadFile(entry.target, entry.search ? { query: entry.search } : undefined);
  }
}

function formatLocalTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
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
      return writeUniqueExportFile(fallbackPath,data);
    }
    throw err;
  }
}

// Automatic exports must never overwrite an existing file, including a
// file created by another request/process between name selection and writing.
async function writeUniqueExportFile(targetPath: string, data: Buffer | string): Promise<string> {
  await fs.mkdir(path.dirname(targetPath), {recursive: true});
  for (let attempt = 0; attempt < 32; attempt++) {
    const candidate = resolveUniqueExportPath(targetPath);
    try {
      await fs.writeFile(candidate, data, {flag: 'wx'});
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('导出文件名冲突次数过多，请重新导出。');
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
      sandbox: true,
      webSecurity: true,
      offscreen: Boolean(options?.offscreen),
    },
  });

  hardenWindow(printWin);
  const printQuery = { mode: spec.kind === 'coverLetter' ? 'coverLetter' : 'print', jobId };
  let readyTimer:ReturnType<typeof setTimeout>;
  let totalTimer:ReturnType<typeof setTimeout>|undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyTimer = setTimeout(() => {
      reject(new Error('隐藏打印窗口渲染超时'));
    }, 15000);

    pendingPrintJobs.set(jobId, {
      kind: spec.kind,
      senderId: printWin.webContents.id,
      expectedUrl: rendererEntryUrl(getRendererEntry(printQuery)),
      doc: spec.kind === 'resume' ? spec.doc : undefined,
      coverLetter: spec.kind === 'coverLetter' ? spec.coverLetter : undefined,
      resolveReady: () => {
        clearTimeout(readyTimer);
        resolve();
      },
      rejectReady: (err) => {
        clearTimeout(readyTimer);
        reject(err);
      },
    });
  });

  try {
    const work=async()=>{
      await Promise.all([loadWindowEntry(printWin,printQuery),readyPromise]);
      await new Promise((r)=>setTimeout(r,80));
      if(printWin.isDestroyed())throw new Error('打印任务已结束。');
      return runner(printWin);
    };
    const deadline=new Promise<never>((_resolve,reject)=>{totalTimer=setTimeout(()=>reject(new Error('原生打印任务达到30秒总时限，已终止。')),30000);});
    return await Promise.race([work(),deadline]);
  } finally {
    clearTimeout(readyTimer!);
    clearTimeout(totalTimer);
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

// A supported local or embedded portrait must decode before its receipt is green.
// Freeze the bytes used for rendering; keep the original document for history.
// The local Chromium decoder also supports WebP, unlike nativeImage on some
// platforms. The script contains only a serialized data URL and fixed logic.
async function prepareExportPortrait(
  doc: ResumeDocument,
  ext: 'pdf' | 'png' | 'docx' | 'md' | 'html',
): Promise<{ document: ResumeDocument; warning?: string }> {
  const photo = doc.basic.photo.trim();
  if (ext === 'md' || !doc.basic.photoConfig.visible ||
      !doc.menuSections.some(s => s.id === 'basic' && s.enabled)) return { document: doc };
  const managed = photo.startsWith('/api/assets/');
  const inline = /^data:image\/(png|jpe?g|webp);base64,/i.exec(photo);
  // Do not introduce a network fetch or change other legacy URL formats.
  if (!managed && !inline) return { document: doc };
  const omit = (reason: string) => ({
    document: { ...doc, basic: { ...doc.basic, photo: '' } },
    warning: (managed ? '可见的本地头像资源' : '可见的内嵌头像') + reason + '，导出成品可能缺少照片。请检查成品、恢复头像或明确隐藏照片后再投递。',
  });
  let buffer: Buffer;
  let mimeType: string;
  if (managed) {
    try {
      const asset = await store.readAsset(decodeURIComponent(photo.slice('/api/assets/'.length)));
      buffer = asset.buffer;
      mimeType = asset.mimeType;
    } catch {
      return omit('无法读取');
    }
  } else if (inline) {
    const payload = photo.slice(inline[0].length).replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 === 1 ||
        (payload.includes('=') && payload.length % 4 !== 0)) return omit('无法解码');
    buffer = Buffer.from(payload, 'base64');
    const format = inline[1]?.toLowerCase();
    if (!format) return omit('无法解码');
    mimeType = 'image/' + (format === 'jpg' ? 'jpeg' : format);
  } else {
    return { document: doc };
  }
  if (!buffer.length || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
    return omit('无法解码');
  }
  const source = 'data:' + mimeType + ';base64,' + buffer.toString('base64');
  const convert = mimeType === 'image/webp' && (ext === 'docx' || ext === 'html');
  const win = mainWindow;
  if (!win || win.isDestroyed()) return omit('无法解码');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decoded = await Promise.race([
      win.webContents.executeJavaScript(`(async()=>{
        const image=new Image();
        image.src=${JSON.stringify(source)};
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight) return null;
        if (!${JSON.stringify(convert)}) return true;
        // Bound the intermediate raster used for conversion.
        if (image.naturalWidth * image.naturalHeight > 16000000) return null;
        const canvas=document.createElement('canvas');
        canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const ctx=canvas.getContext('2d');
        if(!ctx)return null;
        ctx.drawImage(image,0,0);
        return canvas.toDataURL('image/png');
      })()`),
      new Promise<null>(resolve => { timer=setTimeout(() => resolve(null), 8000); }),
    ]);
    if (convert ? typeof decoded !== 'string' || !decoded.startsWith('data:image/png;base64,') : decoded !== true) {
      return omit('无法解码');
    }
    return { document: { ...doc, basic: { ...doc.basic, photo: convert ? decoded as string : source } } };
  } catch {
    return omit('无法解码');
  } finally {
    if(timer) clearTimeout(timer);
  }
}

async function resolveDocxPhotoOptions(doc: ResumeDocument): Promise<DocxExportOptions | undefined> {
  if (!doc.menuSections.some(s => s.id === 'basic' && s.enabled) || !doc.basic.photoConfig.visible) return undefined;
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
  profile: z.object({ baseUrl: z.string().max(2048), model: z.string().max(200),profileId:z.string().max(40),revision:z.string().max(40) }).strict(),
  systemPrompt: z.string().min(1).max(20000),
  userPrompt: z.string().max(100000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  factBinding:FactRequestBindingSchema.optional(),
}).strict();

function frameMatches(event:IpcMainInvokeEvent, senderId:number, expectedUrl:string):boolean {
  const frame=event.senderFrame;
  return Boolean(frame && isTrustedRendererFrame({
    senderId:event.sender.id,expectedSenderId:senderId,
    isMainFrame:frame===event.sender.mainFrame,url:frame.url,expectedUrl,
  }));
}
function assertTrustedEditor(event:IpcMainInvokeEvent):void {
  if (!mainWindow || mainWindow.isDestroyed() ||
      !frameMatches(event,mainWindow.webContents.id,rendererEntryUrl(getRendererEntry()))) {
    throw new Error('未经授权的工作台调用来源。');
  }
}
function trustedEditorHandle(channel:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown):void {
  ipcMain.handle(channel,(event,...args)=>{
    assertTrustedEditor(event);
    return handler(event,...args);
  });
}
function getTrustedPrintJob(event:IpcMainInvokeEvent,jobId:string):PendingPrintJob {
  const job=pendingPrintJobs.get(jobId);
  if(!job||!frameMatches(event,job.senderId,job.expectedUrl))throw new Error('未经授权或已过期的打印任务。');
  return job;
}

// File paths explicitly produced in this app session, including Save As outside exports.
const authorizedOutputPaths=new Map<string,string>();
const pdfReceipts=new PdfReceiptVault();
let pdfReceiptBusy=false;
let pdfPickerBusy=false;
let submissionPackageBusy=false;
async function boundedPackageWork<T>(work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
  try{return await work(controller.signal);}finally{clearTimeout(timer);}
}
async function boundedPdfCheck<T>(work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  if(pdfReceiptBusy)throw Error('已有 PDF 字节核验或归档操作正在进行，请稍后重试。');
  pdfReceiptBusy=true;const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{return await work(controller.signal);}finally{clearTimeout(timer);pdfReceiptBusy=false;}
}
function requireRecordedPath(filePath:string):void {
  if(!canCheckRecordedPdf(filePath,exportsDir,authorizedOutputPaths))throw Error('PDF 路径不在导出目录或本次明确授权的文件内，请重新导出或选择文件核验。');
}
async function rememberOutput(filePath:string):Promise<void> {
  if(isSafeExportFileName(filePath))authorizedOutputPaths.set(path.resolve(filePath),await fs.realpath(filePath));
}
async function authorizeShellFile(filePath:string):Promise<string> {
  if(!isSafeExportFileName(filePath))throw new Error('仅允许打开已导出的安全文档类型。');
  const requested=path.resolve(filePath);
  const real=await fs.realpath(requested);
  if(!isSafeExportFileName(real)||(await fs.stat(real)).isFile()===false)throw new Error('导出文件无效。');
  const root=await fs.realpath(exportsDir).catch(()=>null);
  if((root&&isPathInside(root,real))||authorizedOutputPaths.get(requested)===real)return real;
  throw new Error('文件不在本地导出目录或本次另存记录中，请在系统文件管理器手动打开。');
}

let backupBusy=false;
let inspectedBackup:{token:string;folder:string;manifestHash:string}|null=null;
let lastRestoredFolder:string|null=null;
let inspectedLaunch:{token:string;folder:string;basis:string}|null=null;
async function runBackupOperation<T>(work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  if(backupBusy)throw new Error('已有备份操作正在进行。');
  backupBusy=true;const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),120000);
  try{return await work(ctl.signal);}finally{clearTimeout(timer);backupBusy=false;}
}
async function pickBackupFolder(title:string){
  const owner=mainWindow;if(!owner||owner.isDestroyed())throw new Error('工作台已关闭。');
  const result=await dialog.showOpenDialog(owner,{title,properties:['openDirectory']});
  return result.canceled||result.filePaths.length!==1?null:result.filePaths[0]!;
}
function registerIpcHandlers(): void {
  trustedEditorHandle('recoveryDrafts:checkpoint',(_event,input:unknown)=>recoveryDrafts.checkpoint(input));
  trustedEditorHandle('recoveryDrafts:clear',(_event,receipt,confirmation)=>recoveryDrafts.clear(receipt,confirmation));
  trustedEditorHandle('recoveryDrafts:list',()=>recoveryDrafts.list());
  trustedEditorHandle('recoveryDrafts:get',(_event,id:string,token:string)=>recoveryDrafts.get(id,token));
  trustedEditorHandle('workspaceBackup:create',()=>runBackupOperation(async signal=>{
    inspectedLaunch=null;inspectedBackup=null;
    const parent=await pickBackupFolder('选择备份保存位置（将新建文件夹，不覆盖原数据）');
    return parent?await createWorkspaceBackup(rootDir,parent,signal):null;
  }));
  trustedEditorHandle('workspaceBackup:inspect',()=>runBackupOperation(async signal=>{
    inspectedBackup=null;inspectedLaunch=null;
    const folder=await pickBackupFolder('选择待检查的完整工作区备份文件夹');
    if(!folder)return null;
    const checked=await inspectWorkspaceBackup(folder,signal),token=randomUUID();
    inspectedBackup={token,folder:checked.root,manifestHash:checked.manifestHash};
    return {...checked.summary,folder:checked.root,token};
  }));
  trustedEditorHandle('workspaceBackup:restore',(_event,token:unknown,confirmation:unknown)=>runBackupOperation(async signal=>{
    const basis=inspectedBackup;
    if(!basis||token!==basis.token||confirmation!=='RESTORE_TO_NEW_WORKSPACE')throw new Error('恢复前必须检查备份并明确确认创建新工作区。');
    inspectedBackup=null;inspectedLaunch=null;
    const parent=await pickBackupFolder('选择恢复位置（仅新建独立工作区）');
    if(!parent)return null;
    const result=await restoreWorkspaceBackup(rootDir,basis.folder,basis.manifestHash,parent,signal);
    lastRestoredFolder=result.folder;return result;
  }));
  trustedEditorHandle('workspaceBackup:context',()=>({folder:rootDir,restored:restoredWorkspace}));
  trustedEditorHandle('workspaceBackup:editorReady',async(_event,slug:unknown,id:unknown)=>{
    if(!launchHandoff||launchReceiptSent)return;
    if(typeof slug!=='string'||typeof id!=='string'||!restoredWorkspace)throw new Error('独立窗口就绪凭据不匹配。');
    const actual=await store.getResume(slug);
    if(actual.id!==id)throw new Error('独立窗口尚未确认加载目标简历。');
    const owner=mainWindow;if(!owner||owner.isDestroyed())throw new Error('独立窗口尚未创建。');
    if(!owner.isVisible())owner.show();
    recordLaunchStage(launchHandoff,'renderer-document-ready');
    await reportLaunch('ready');
  });
  trustedEditorHandle('workspaceBackup:prepareLaunch',(_event,mode:unknown)=>runBackupOperation(async signal=>{
    inspectedLaunch=null;inspectedBackup=null;
    if(mode!=='last'&&mode!=='choose')throw new Error('未知的工作区打开方式。');
    const folder=mode==='last'?lastRestoredFolder:await pickBackupFolder('选择已恢复的独立工作区（不是备份文件夹）');
    if(!folder)return null;
    const verified=await inspectRestoredWorkspace(folder,signal,rootDir),token=randomUUID();
    inspectedLaunch={token,folder:verified.root,basis:verified.basis};
    return {...verified.summary,folder:verified.root,token};
  }));
  trustedEditorHandle('workspaceBackup:launch',(_event,token:unknown,confirmation:unknown)=>runBackupOperation(async signal=>{
    const basis=inspectedLaunch;
    if(!basis||token!==basis.token||confirmation!=='OPEN_INDEPENDENT_WORKSPACE')throw new Error('打开前必须检查并明确确认独立工作区。');
    inspectedLaunch=null;
    const checked=await inspectRestoredWorkspace(basis.folder,signal,rootDir);
    if(checked.basis!==basis.basis)throw new Error('恢复工作区数据已变化，请重新检查。');
    return launchWorkspace({isPackaged:app.isPackaged,exePath:app.getPath('exe'),appDir:path.resolve(__dirname,'..'),env:process.env,root:checked.root,basis:checked.basis},signal);
  }));
  trustedEditorHandle('facts:get',()=>facts.get());
  trustedEditorHandle('facts:add',(_event,input:unknown)=>facts.add(input));
  trustedEditorHandle('facts:link',(_event,input:unknown)=>facts.link(input));
  trustedEditorHandle('facts:revoke',(_event,input:unknown)=>facts.revoke(input));
  trustedEditorHandle('evidence:get',()=>evidence.get());
  trustedEditorHandle('evidence:audit',()=>evidence.audit());
  trustedEditorHandle('evidence:openVault',async(event)=>{
    const dir=await evidence.vaultPath();assertTrustedEditor(event);
    const error=await shell.openPath(dir);if(error)throw new Error('无法打开本地证据目录。');
  });
  trustedEditorHandle('evidence:attach',async(event,raw:unknown)=>{
    if(evidencePickerBusy||!mainWindow||mainWindow.isDestroyed())throw new Error('证据附件选择窗口不可用或正在使用。');
    const input=AttachEvidenceSchema.parse(raw);
    evidencePickerBusy=true;
    try{
      await evidence.assertAttachAllowed(input);
      assertTrustedEditor(event);
      const owner=mainWindow;if(!owner||owner.isDestroyed())throw new Error('工作台已关闭。');
      const picked=await dialog.showOpenDialog(owner,{title:'选择本地证据附件（仅保存本地副本）',properties:['openFile'],filters:[{name:'证据附件 PDF / 图片 / UTF-8 文本',extensions:['pdf','png','jpg','jpeg','txt']}]});
      if(picked.canceled)return {canceled:true as const};
      if(picked.filePaths.length!==1)throw new Error('每次仅允许选择一个证据文件。');
      assertTrustedEditor(event);
      return {canceled:false as const,index:await evidence.attachSelectedFile(input,picked.filePaths[0]!)};
    }finally{evidencePickerBusy=false;}
  });
  trustedEditorHandle('evidence:verify',(_event,input:unknown)=>evidence.verify(input));
  trustedEditorHandle('evidence:detach',(_event,input:unknown)=>evidence.detach(input));
  trustedEditorHandle('evidence:purge',(_event,input:unknown)=>evidence.purge(input));
  trustedEditorHandle('evidence:reveal',async(event,input:unknown)=>{
    const file=await evidence.revealPath(input);
    assertTrustedEditor(event);
    shell.showItemInFolder(file);
  });
  trustedEditorHandle('resumes:list', () => store.listResumes());
  trustedEditorHandle('resumes:get', (_event, slug: string) => store.getResume(slug));
  trustedEditorHandle('resumes:save', (_event, slug: string, doc: unknown) => store.saveResume(slug, doc, { requireExisting: true }));
  trustedEditorHandle(
    'resumes:create',
    (
      _event,
      input: { slug?: string; title?: string; cloneFromSlug?: string; document?: unknown },
    ) => store.createResume(input),
  );
  trustedEditorHandle('resumes:delete', (_event, slug: string, expectedRevision: string) => {
    if (typeof expectedRevision !== 'string') throw new Error('删除前必须提供版本标识。');
    return store.deleteResume(slug, expectedRevision);
  });
  trustedEditorHandle(
    'assets:upload',
    (_event, payload: { filename?: string; dataUrl: string }) => store.saveAsset(payload),
  );

  trustedEditorHandle('trash:list',()=>store.listTrash());
  trustedEditorHandle('trash:restore',(_event,id:string,expectedRevision:string,asCopy:boolean)=>store.restoreTrash(id,expectedRevision,asCopy===true));
  trustedEditorHandle('trash:purge',(_event,id:string,expectedRevision:string,confirmation:unknown)=>store.purgeTrash(id,expectedRevision,confirmation));

  trustedEditorHandle('snapshots:list', (_event, slug: string) => store.listSnapshots(slug));
  trustedEditorHandle('snapshots:inventory',(_event,slug:string)=>store.listSnapshotInventory(slug));
  trustedEditorHandle('snapshots:getForComparison',(_event,slug:string,id:string)=>store.getSnapshotForComparison(slug,id));
  trustedEditorHandle('snapshots:create', (_event, slug: string, reason: string, expectedRevision: string) => {
    if (typeof expectedRevision !== 'string') throw new Error('快照前必须提供版本标识。');
    return store.createSnapshot(slug, reason, undefined, expectedRevision);
  });
  trustedEditorHandle('snapshots:restore', (_event, slug: string, snapshotId: string, expectedRevision: string) => {
    if (typeof expectedRevision !== 'string') throw new Error('回滚前必须提供版本标识。');
    return store.restoreSnapshot(slug, snapshotId, expectedRevision);
  });

  trustedEditorHandle('applications:get', () => store.getApplications());
  trustedEditorHandle('applications:save', (_event, data: unknown,revision:string) => store.saveApplications(data,revision));
  trustedEditorHandle('applications:commandJobQueue',(_event,command:unknown)=>jobQueueExecutor.command(command));
  let workflowReadBusy=false;
  trustedEditorHandle('applications:openPreparedJobQueue',async(_event,input:unknown)=>{
    if(workflowReadBusy)throw Error('上一项岗位流程读取仍未结束，请稍后重试。');
    workflowReadBusy=true;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('岗位流程核验超时。')),10000);
    try{return await store.openPreparedJobQueue(input,controller.signal);}
    finally{clearTimeout(timer);workflowReadBusy=false;}
  });
  trustedEditorHandle('applications:log',(_event,input:ApplicationLogInput)=>{
    if(input?.pdfReceiptToken===undefined)return store.logApplication(input);
    return boundedPdfCheck(async signal=>{
      const receipt=pdfReceipts.resolve(input.pdfReceiptToken,input.entry.exportedFilePath,input.entry.resumeSlug,input.document,input.entry.queueTaskId);
      requireRecordedPath(input.entry.exportedFilePath);
      const result=checkFingerprint(await readPdfFingerprint(input.entry.exportedFilePath,signal,real=>canCheckRecordedRealPdf(input.entry.exportedFilePath,real,exportsDir,authorizedOutputPaths)),receipt);
      if(result.status!=='verified')throw new Error('PDF 已变更、缺失或无法核验；未封存投递记录，请重新导出。');
      signal.throwIfAborted();
      return store.logApplication(input,receipt);
    });
  });
  trustedEditorHandle('applications:checkPdf',async(event,link:ApplicationSnapshotLink,action:unknown):Promise<ApplicationPdfCheck>=>{
    if(action!=='check'&&action!=='open'&&action!=='choose')throw Error('无效 PDF 核验操作。');
    // Native chooser is explicitly user initiated. Never read a path supplied by
    // the renderer, including a historical path outside the authorized roots.
    const record=await store.getLinkedApplicationSnapshot(link);
    const receipt=record.meta.pdfReceipt;
    if(!receipt)return {status:'unknown',checkedAt:new Date().toISOString()};
    let file=record.meta.exportedFilePath;
    if(action==='choose'){
      const owner=mainWindow;
      if(!owner||owner.isDestroyed())throw Error('工作台已关闭。');
      if(pdfReceiptBusy||pdfPickerBusy)throw Error('已有 PDF 核验或选择文件窗口正在进行。');
      pdfPickerBusy=true;
      const result=await dialog.showOpenDialog(owner,{title:'选择待核验的原 PDF（不修改台账关联）',filters:[{name:'PDF 文件',extensions:['pdf']}],properties:['openFile']}).finally(()=>{pdfPickerBusy=false;});
      assertTrustedEditor(event);
      if(result.canceled||result.filePaths.length!==1)return {status:'unavailable',checkedAt:new Date().toISOString()};
      file=result.filePaths[0]!;
    }else if(!canCheckRecordedPdf(file,exportsDir,authorizedOutputPaths))return {status:'unavailable',checkedAt:new Date().toISOString()};
    return boundedPdfCheck(async signal=>{
      const read=await readPdfFingerprint(file,signal,action==='choose'?undefined:real=>canCheckRecordedRealPdf(file,real,exportsDir,authorizedOutputPaths));
      const result=checkFingerprint(read,receipt);
      signal.throwIfAborted();
      // Recheck the persisted association before reporting or opening.
      const after=await store.getLinkedApplicationSnapshot(link);
      if(after.meta.pdfReceipt?.sha256!==receipt.sha256||after.meta.exportedFilePath!==record.meta.exportedFilePath)throw Error('PDF 关联已变化，请刷新台账。');
      assertTrustedEditor(event);signal.throwIfAborted();
      if(action==='open'&&result.status==='verified'&&read.status==='read'){
        const error=await shell.openPath(read.fingerprint.realPath);
        if(error)throw Error('已核验 PDF，但系统未能打开文件。');
        return {...result,opened:true};
      }
      return result;
    });
  });
  trustedEditorHandle('applications:exportPackage',async(event,link:ApplicationSnapshotLink):Promise<SubmissionPackageResult>=>{
    const owner=mainWindow;
    if(!owner||owner.isDestroyed())throw Error('工作台已关闭。');
    if(submissionPackageBusy||pdfReceiptBusy||pdfPickerBusy)throw Error('已有投递包或 PDF 核验操作正在进行。');
    submissionPackageBusy=true;pdfPickerBusy=true;
    try{
      const record=await boundedPackageWork(async signal=>{const linked=await store.getLinkedApplicationSnapshot(link);signal.throwIfAborted();return linked;}),receipt=record.meta.pdfReceipt;
      if(!receipt)throw Error('历史记录没有 PDF 字节凭证，不能制作核验投递包。');
      const original=record.meta.exportedFilePath;
      const ledger=await store.getApplications(false);
      if(ledger.revision!==link.ledgerRevision)throw Error('磁盘投递台账已变化，请刷新后再制作。');
      const entry=ledger.applications.find(a=>a.id===link.applicationId);
      if(!entry)throw Error('投递记录已不存在。');
      const clean=(s:string)=>s.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'�').slice(0,240);
      const targetLabel=clean(entry.company||'未填写单位')+' / '+clean(entry.role||'未填写岗位');
      requireRecordedPath(original);
      assertTrustedEditor(event);
      const choice=await dialog.showMessageBox(owner,{type:'question',title:'选择投递包内容',message:'为所选投递记录制作本地 ZIP',detail:targetLabel+'\n\n只包含封存 PDF 与您明确选择的附加 PDF。不会加入母库、台账、历史原稿、备注或其他岗位材料；不会发送。',buttons:['仅封存简历','另选附加 PDF','取消'],defaultId:2,cancelId:2});
      assertTrustedEditor(event);
      if(choice.response!==0&&choice.response!==1)return {canceled:true};
      let attachments:string[]=[];
      if(choice.response===1){
        const picked=await dialog.showOpenDialog(owner,{title:'明确选择附加 PDF（自荐信、证书等）',filters:[{name:'PDF 文件',extensions:['pdf']}],properties:['openFile','multiSelections']});
        assertTrustedEditor(event);
        if(picked.canceled)return {canceled:true};
        attachments=picked.filePaths;
        if(attachments.length<1||attachments.length>=MAX_PACKAGE_PDFS)throw Error('请选择 1～7 份附加 PDF。');
      }
      const chosen=[original,...attachments];
      if(new Set(chosen.map(file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file))).size!==chosen.length)throw Error('投递包不能重复选择同一个文件。');
      // Freeze exactly the bytes read and checked, not a later path read.
      const archive=await boundedPackageWork(async signal=>{
        await store.getLinkedApplicationSnapshot(link);
        const buffers:Buffer[]=[];let total=0;
        for(const [index,file] of chosen.entries()){
          signal.throwIfAborted();
          const read=await readPdfFingerprint(file,signal,index===0?real=>canCheckRecordedRealPdf(file,real,exportsDir,authorizedOutputPaths):undefined,true);
          if(read.status!=='read'||!read.bytes||!read.fingerprint.pdf)throw Error('PDF 缺失、路径不安全、文件异常或超过大小/时间限制：'+packageEntryName(index));
          if(index===0&&checkFingerprint(read,receipt).status!=='verified')throw Error('封存简历 PDF 字节已变更；未制作投递包。');
          total+=read.bytes.length;if(total>MAX_PACKAGE_BYTES)throw Error('投递包 PDF 总大小超过 64 MiB。');
          buffers.push(read.bytes);
        }
        return buildSubmissionZip(buffers,signal);
      });
      assertTrustedEditor(event);
      const listing=chosen.map((file,i)=>packageEntryName(i)+' ← '+clean(path.basename(file))+' ('+archive.entries[i]!.sizeBytes+' 字节)').join('\n');
      const confirm=await dialog.showMessageBox(owner,{type:'warning',title:'确认投递包文件清单',message:'确认仅将以下文件写入 ZIP？',detail:targetLabel+'\n\n'+listing+'\n\n简历字节与封存凭证一致；附加 PDF 仅检查本地文件与格式标记，不验证内容、资格或安全性。压缩包未加密，请逐份核对。',buttons:['确认清单并另存','取消'],defaultId:1,cancelId:1});
      assertTrustedEditor(event);
      if(confirm.response!==0)return {canceled:true};
      const selected=await dialog.showSaveDialog(owner,{title:'另存投递包 ZIP（不覆盖现有文件）',defaultPath:path.join(exportsDir,'submission-package-'+Date.now()+'.zip'),filters:[{name:'ZIP 压缩包',extensions:['zip']}]});
      assertTrustedEditor(event);
      if(selected.canceled||!selected.filePath)return {canceled:true};
      const target=selected.filePath;
      await boundedPackageWork(async signal=>{
        // The link must still be the exact acknowledged persisted ledger row.
        await store.getLinkedApplicationSnapshot(link);
        assertTrustedEditor(event);signal.throwIfAborted();
        await publishSubmissionZip(target,archive.bytes,signal);
      });
      return {canceled:false,filePath:target,sha256:archive.sha256,entries:archive.entries};
    }finally{submissionPackageBusy=false;pdfPickerBusy=false;}
  });
  trustedEditorHandle('applications:getLinkedSnapshot',(_event,input:Parameters<typeof store.getLinkedApplicationSnapshot>[0])=>store.getLinkedApplicationSnapshot(input));
  trustedEditorHandle('writeLock:inspect',()=>inspectResumeWriteLock(store.dataDir));
  trustedEditorHandle('writeLock:recover',(_event,token:string,confirmation:unknown)=>recoverResumeWriteLock(store.dataDir,token,confirmation));
  trustedEditorHandle(
    'applications:saveSnapshot',
    (_event, input: SaveApplicationSnapshotInput) => store.saveApplicationSnapshot(input),
  );
  trustedEditorHandle(
    'applications:getSnapshot',
    (_event, snapshotId: string) => store.getApplicationSnapshot(snapshotId),
  );
  trustedEditorHandle(
    'applications:deleteSnapshot',
    (_event, snapshotId: string) => store.deleteApplicationSnapshot(snapshotId),
  );

  ipcMain.handle('pdf:getPayload', (event, jobId: string) => {
    const job = getTrustedPrintJob(event,jobId);
    if (!job || job.kind !== 'resume' || !job.doc) {
      throw new Error('打印任务不存在或已过期');
    }
    return job.doc;
  });

  ipcMain.handle('pdf:getCoverLetterPayload', (event, jobId: string) => {
    const job = getTrustedPrintJob(event,jobId);
    if (!job || job.kind !== 'coverLetter' || !job.coverLetter) {
      throw new Error('自荐信打印任务不存在或已过期');
    }
    return job.coverLetter;
  });

  ipcMain.handle('pdf:notifyReady', (event, jobId: string) => {
    const job = getTrustedPrintJob(event,jobId);
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
    const queueScope=options.queueScope===undefined?undefined:JobQueueOpenSchema.parse(options.queueScope);
    const verifyQueueExport=async()=>{
      if(!queueScope)return;
      if(spec.ext!=='pdf'||options.skipSave===true)throw Error('岗位原稿凭证仅支持未脱敏原稿 PDF。');
      const {task,document}=await store.openPreparedJobQueue(queueScope,AbortSignal.timeout(10000));
      if(task.slug!==options.slug||jobQueueDocumentText(document)!==jobQueueDocumentText(targetDoc))throw Error('PDF 导出与固定岗位原稿不一致，未导出。');
    };
    await verifyQueueExport();
    const defaultFileName = buildResumeExportFilename(
      targetDoc,
      spec.ext,
      options.fileNameSuffix ?? '',
    );
    await fs.mkdir(exportsDir, { recursive: true });
    let targetPath = path.join(exportsDir, defaultFileName);
    let explicitPath = false;

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
      explicitPath = true;
    }

    const prepared = await prepareExportPortrait(targetDoc, spec.ext);
    const contentWarning = prepared.warning;
    const content = await spec.produce(prepared.document);
    const writtenPath = explicitPath ? await writeFileSafely(targetPath, content) : await writeUniqueExportFile(targetPath, content);
    let outputWarning:string|undefined;
    try{await rememberOutput(writtenPath);}catch(error){if(spec.ext!=='pdf')throw error;outputWarning='PDF 文件已写出，但无法确认本地输出路径。';}

    let snapshotWarning:string|undefined;
    if ((spec.ext === 'pdf' || spec.ext === 'docx') && options.slug) {
      try{
        await store.createExportSnapshot(
          options.slug,
          options.skipSave
            ? `导出${spec.ext.toUpperCase()}脱敏版时原稿快照`
            : `导出 ${spec.ext.toUpperCase()} 自动快照`,
          targetDoc,
          options.skipSave===true,
        );
      }catch(err){
        // The artifact is already written. Report that fact, separately from
        // the incomplete history operation; never make the user guess.
        snapshotWarning=err instanceof LocalFsApiError?err.message:'自动历史快照未能确认完成，请检查本地历史记录。';
      }
    }

    let receiptResult:Awaited<ReturnType<PdfReceiptVault['issue']>>|undefined;
    let receiptWarning=outputWarning;
    if(spec.ext==='pdf'&&options.skipSave!==true&&options.slug&&!snapshotWarning&&!contentWarning&&!receiptWarning){
      try{
        await verifyQueueExport();
        receiptResult=await boundedPdfCheck(signal=>pdfReceipts.issue(writtenPath,options.slug!,targetDoc,Buffer.isBuffer(content)?content:Buffer.from(content),signal,real=>canCheckRecordedRealPdf(writtenPath,real,exportsDir,authorizedOutputPaths),queueScope?.taskId));
      }catch{receiptWarning='PDF 文件已写出，但无法确认字节凭证；请重新导出后再封存投递。';}
    }
    return {
      canceled: false,
      filePath: writtenPath,
      fileName: path.basename(writtenPath),
      ...(snapshotWarning?{snapshotWarning}:{}),
      ...(contentWarning?{contentWarning}:{}),
      ...(receiptWarning?{receiptWarning}:{}),
      ...receiptResult,
    };
  }

  trustedEditorHandle(
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
  let activeBufferRenders=0;
  trustedEditorHandle('pdf:renderBuffer', async (_event, rawDoc: unknown) => {
    if(activeBufferRenders>=1)throw new Error('另一个本地 PDF 试渲染仍在执行，请稍后重试。');
    const parsed = ResumeDocumentSchema.parse(rawDoc);
    activeBufferRenders++;
    try{const buffer=await renderDocumentToPdf(parsed);
      if(buffer.byteLength>32*1024*1024)throw new Error('原生 PDF 超过32 MiB试渲染上限。');
      return new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength);
    }finally{activeBufferRenders--;}
  });

  trustedEditorHandle(
    'pdf:exportCoverLetter',
    async (_event, options: { payload: CoverLetterPdfPayload; saveAs?: boolean }) => {
      const namePart = sanitizeFilePart(options.payload.candidateName, '求职者');
      const companyPart = sanitizeFilePart(options.payload.company, '自荐信');
      const defaultName = `${namePart}-自荐信-${companyPart}-${formatLocalDate()}.pdf`;
      await fs.mkdir(exportsDir, { recursive: true });
      let targetPath = path.join(exportsDir, defaultName);
      let explicitPath=false;
      if (options.saveAs && mainWindow) {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: '导出求职自荐信 A4 PDF',
          defaultPath: resolveUniqueExportPath(targetPath),
          filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
        });
        if (result.canceled || !result.filePath) {
          return { canceled: true };
        }
        targetPath = result.filePath;
        explicitPath=true;
      }
      const pdfBytes = await renderCoverLetterToPdf(options.payload);
      const writtenPath = explicitPath?await writeFileSafely(targetPath,pdfBytes):await writeUniqueExportFile(targetPath,pdfBytes);
      await rememberOutput(writtenPath);
      return {
        canceled: false,
        filePath: writtenPath,
        fileName: path.basename(writtenPath),
      };
    },
  );

  trustedEditorHandle(
    'export:png',
    (_event, options: PdfExportOptions) =>
      runExport(options, {
        ext: 'png',
        dialogTitle: '导出高清 2x PNG 长图',
        filterName: 'PNG 图片',
        produce: renderDocumentToPng,
      }),
  );

  trustedEditorHandle('fonts:listSystem', () => listInstalledSystemFonts());

  trustedEditorHandle(
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

  trustedEditorHandle(
    'export:markdown',
    (_event, options: PdfExportOptions) =>
      runExport(options, {
        ext: 'md',
        dialogTitle: '导出 Markdown 文档 (.md)',
        filterName: 'Markdown 文件',
        produce: async (savedDoc) => resumeToMarkdown(savedDoc),
      }),
  );

  trustedEditorHandle(
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

  trustedEditorHandle('ai:getSettings', async (_event) => {
    return aiSettings.getPublicSettings();
  });

  trustedEditorHandle('ai:listProfiles',()=>aiSettings.getCatalog());
  trustedEditorHandle('ai:createProfile',(_event,input:unknown)=>aiSettings.create(input));
  trustedEditorHandle('ai:activateProfile',(_event,id:string)=>aiSettings.activate(id));
  trustedEditorHandle('ai:removeProfile',(_event,id:string,revision:string,confirmation:unknown)=>aiSettings.remove(id,revision,confirmation));
  trustedEditorHandle('ai:saveSettings', async (_event, rawSettings: unknown) => {
    return aiSettings.save(rawSettings);
  });

  const completeAiRequest=async (raw:unknown)=>{
    const parsed = aiCompletionSchema.safeParse(raw);
    if (!parsed.success) throw new Error('AI 请求参数超出许可范围。');
    const { requestId, profile, factBinding, ...options } = parsed.data;
    if (aiRequests.has(requestId) || aiRequests.size >= 4) throw new Error('AI 请求重复或并发数已达上限。');
    const controller = new AbortController();
    aiRequests.set(requestId, controller);
    try {
      const settings = await aiSettings.getRequestSettings(profile.profileId,profile.revision);
      if (!settings.enabled || settings.baseUrl !== validateByokBaseUrl(profile.baseUrl).baseUrl ||
          settings.model !== profile.model) throw new Error('AI 配置已变化，请先保存并重试。');
      if(factBinding)await facts.assertCurrentBinding(factBinding,options.userPrompt);
      else if(hasRecordFactSources(options.userPrompt))throw new Error('事实来源缺少本地授权绑定，拒绝发送。');
      if(controller.signal.aborted)throw new Error('请求已取消。');
      return await requestByokCompletionDirectWithReceipt({ ...options, settings, signal: controller.signal });
    } finally {
      aiRequests.delete(requestId);
    }
  };
  trustedEditorHandle('ai:requestCompletion',async (_event,raw:unknown)=>(await completeAiRequest(raw)).text);
  trustedEditorHandle('ai:requestCompletionWithReceipt',async (_event,raw:unknown)=>completeAiRequest(raw));
  // Additive structured error channel; retain both existing throwing contracts.
  trustedEditorHandle('ai:requestCompletionOutcome',async (_event,raw:unknown):Promise<AiCompletionOutcome>=>{
    try{return {ok:true,result:await completeAiRequest(raw)};}
    catch(err){if(err instanceof AiGatewayError)return {ok:false,error:{code:err.code,message:err.message,receipt:err.receipt}};throw err;}
  });

  trustedEditorHandle('ai:cancelCompletion', (_event, requestId: string) => {
    if (typeof requestId === 'string') aiRequests.get(requestId)?.abort();
  });

  trustedEditorHandle('shell:openPath', async (_event,filePath:string)=>{
    const error=await shell.openPath(await authorizeShellFile(filePath));
    if(error)throw new Error('无法打开导出文件：'+error);
    return '';
  });
  trustedEditorHandle('shell:showItemInFolder', async (_event, filePath: string) => {
    shell.showItemInFolder(await authorizeShellFile(filePath));
  });
  trustedEditorHandle('shell:openExportsDir', async () => {
    await fs.mkdir(exportsDir, { recursive: true });
    return shell.openPath(exportsDir);
  });
  trustedEditorHandle('shell:saveTextFile', async (_event, options: SaveTextFileOptions) => {
    if(!options||typeof options.defaultFileName!=='string'||typeof options.content!=='string'||Buffer.byteLength(options.content,'utf8')>10*1024*1024)throw new Error('文本导出参数无效或超过 10 MiB 上限。');
    await fs.mkdir(exportsDir, { recursive: true });
    const extRaw = (options.extension || path.extname(options.defaultFileName).slice(1) || 'txt')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    if(!['json','csv','ics','txt','md','html'].includes(extRaw))throw new Error('不支持该文本导出文件类型。');
    const baseNameRaw = path.basename(options.defaultFileName, path.extname(options.defaultFileName));
    const safeName = `${sanitizeFilePart(baseNameRaw, 'export')}.${extRaw || 'txt'}`;
    let targetPath = path.join(exportsDir, safeName);
    let explicitPath = false;
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
      explicitPath = true;
    }
    if(path.extname(targetPath).toLowerCase()!=='.'+extRaw)throw new Error('另存文件扩展名与导出格式不一致。');
    const writtenPath = explicitPath ? await writeFileSafely(targetPath, options.content) : await writeUniqueExportFile(targetPath, options.content);
    await rememberOutput(writtenPath);
    return {
      canceled: false,
      filePath: writtenPath,
      fileName: path.basename(writtenPath),
    };
  });

  ipcMain.on('app:closeReady', (event, requestId: number, saved: boolean) => {
    try { assertTrustedEditor(event); } catch { return; }
    if (typeof saved !== 'boolean') return;
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
    title: restoredWorkspace?'Resume Studio - 独立恢复工作区':'Resume Studio - 本地简历桌面工作台',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    backgroundColor: '#11161f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvedPaths.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  hardenWindow(win);
  if(restoredWorkspace){win.on('page-title-updated',event=>event.preventDefault());win.setTitle('Resume Studio - 独立恢复工作区');}
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
          message: '简历或求职台账保存失败或尚未完成，是否留在工作台？',
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
      if(parsed.hostname!=='local'||parsed.username||parsed.password||parsed.port||parsed.search||parsed.hash)throw new Error('invalid asset URL');
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

if (shouldBootstrapWorkspace({commonJsMain:require.main===module,hasHandoff:launchHandoff!==null,isPackaged:app.isPackaged,argvEntry:process.argv[1],appDir:path.resolve(__dirname,'..')})) {
  recordLaunchStage(launchHandoff,'entry-main');
  if (process.env.RESUME_STUDIO_DATA_DIR?.trim()) {
    const profile=path.join(rootDir,'.electron-userdata');
    if(restoredWorkspace){
      // Never create a new empty restored root or redirect its browser profile via a link.
      if(realpathSync(rootDir)!==rootDir||!lstatSync(rootDir).isDirectory()||lstatSync(rootDir).isSymbolicLink()||
         realpathSync(dataDir)!==dataDir||!lstatSync(dataDir).isDirectory()||lstatSync(dataDir).isSymbolicLink())throw new Error('恢复工作区目录不安全。');
      mkdirSync(profile,{recursive:true});
      if(!lstatSync(profile).isDirectory()||lstatSync(profile).isSymbolicLink()||realpathSync(profile)!==profile)throw new Error('恢复工作区的独立浏览器配置目录不安全。');
    }
    app.setPath('userData',profile);
  }

  recordLaunchStage(launchHandoff,'profile-ready');
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    void reportLaunch('failed','目标工作区已有运行实例，请查看现有窗口。').catch(()=>{}).finally(()=>app.quit());
  } else {
    recordLaunchStage(launchHandoff,'instance-lock-acquired');
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
      recordLaunchStage(launchHandoff,'app-ready');
      if(restoredWorkspace){
        const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),120000);
        try{const checked=await inspectRestoredWorkspace(rootDir,ctl.signal);if(launchHandoff&&checked.basis!==launchHandoff.basis)throw new Error('独立工作区启动前数据已变化，拒绝加载。');}
        finally{clearTimeout(timer);}
      }else{
        if(launchHandoff)throw new Error('独立启动目标不是恢复工作区。');
        try{await ensureInitialDataFromLegacy({rootDir,force:false});}
        catch(err){
          // Refuse unsafe initialization but keep the existing recovery screen
          // available. Restored-workspace verification above remains strict.
          if(!(err instanceof LocalFsApiError&&err.code==='UNSAFE_DIRECTORY'))throw err;
          console.warn('[resume-studio] Unsafe workspace directory; initialization skipped.');
        }
      }
      recordLaunchStage(launchHandoff,'workspace-verified');
      await registerAssetProtocol();
      registerIpcHandlers();
      await createMainWindow();
      recordLaunchStage(launchHandoff,'window-loaded');

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createMainWindow();
        }
      });
    }).catch(async err=>{
      const message=err instanceof Error?err.message:'工作区启动失败。';
      await reportLaunch('failed',message).catch(()=>{});
      dialog.showErrorBox('工作区启动失败',message);app.quit();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
  }
}
