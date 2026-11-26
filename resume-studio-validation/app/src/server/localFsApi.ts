import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { ZodError } from 'zod';
import { adaptResumeOrLegacy } from '../schema/legacyAdapter';
import {
  type ApplicationSnapshotMeta,
  type ApplicationSnapshotRecord,
  ApplicationsStoreSchema,
  type ApplicationsStoreData,
} from '../schema/applicationSchema';
import {
  ResumeDocument,
  ResumeDocumentSchema,
  resumeRevision,
  ResumeSummary,
  type TemplateId,
} from '../schema/resumeSchema';

const SAFE_SLUG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const SAFE_ASSET_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.(png|jpe?g|webp)$/i;
const SAFE_SNAPSHOT_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;
export const MAX_SNAPSHOTS_PER_RESUME = 15;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class LocalFsApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'LocalFsApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function assertSafeSlug(rawSlug: string): string {
  let decoded = rawSlug;
  try {
    decoded = decodeURIComponent(rawSlug);
  } catch {
    throw new LocalFsApiError(400, 'INVALID_SLUG', '非法的简历标识编码。');
  }
  if (!SAFE_SLUG_REGEX.test(decoded) || decoded.includes('..') || decoded.includes('/') || decoded.includes('\\')) {
    throw new LocalFsApiError(
      400,
      'INVALID_SLUG',
      '非法的简历 slug：仅允许字母、数字、连字符和下划线，且不允许路径分隔符。',
    );
  }
  return decoded;
}

export function assertSafeAssetName(rawName: string): string {
  let decoded = rawName;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    throw new LocalFsApiError(400, 'INVALID_ASSET', '非法的资源文件名编码。');
  }
  if (
    !SAFE_ASSET_REGEX.test(decoded) ||
    decoded.includes('..') ||
    decoded.includes('/') ||
    decoded.includes('\\')
  ) {
    throw new LocalFsApiError(400, 'INVALID_ASSET', '非法的资源文件名。');
  }
  return decoded;
}

function resolveContainedPath(baseDir: string, relativeName: string): string {
  const resolvedBase = path.resolve(baseDir);
  const target = path.resolve(resolvedBase, relativeName);
  if (target !== resolvedBase && !target.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new LocalFsApiError(400, 'PATH_TRAVERSAL', '检测到越界路径访问，已拒绝。');
  }
  return target;
}

export function slugifyTitle(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (ascii.length >= 2) {
    return ascii;
  }
  return `resume-${Date.now().toString(36)}`;
}

async function atomicWriteFile(targetPath: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fs.writeFile(tempPath, data, { flag: 'wx' });
    await fs.rename(tempPath, targetPath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export interface ResumeSnapshotMeta {
  id: string;
  slug: string;
  reason: string;
  createdAt: string;
  templateId: TemplateId;
  title: string;
  charCount: number;
}

export function assertSafeSnapshotId(rawId: string): string {
  const clean = rawId.trim().replace(/\.json$/i, '');
  if (!SAFE_SNAPSHOT_ID_REGEX.test(clean) || clean.includes('..') || clean.includes('/') || clean.includes('\\')) {
    throw new LocalFsApiError(400, 'INVALID_SNAPSHOT', '非法的历史快照标识。');
  }
  return clean;
}

function countDocumentChars(doc: ResumeDocument): number {
  const chunks: string[] = [
    doc.basic.name,
    doc.basic.title,
    doc.skillContent,
    doc.selfEvaluationContent,
  ];
  doc.education.forEach((e) => chunks.push(e.school, e.major, e.description));
  doc.experience.forEach((e) => chunks.push(e.company, e.position, e.description));
  doc.projects.forEach((p) => chunks.push(p.name, p.role, p.description));
  Object.values(doc.customData).forEach((arr) =>
    arr.forEach((c) => chunks.push(c.title, c.subtitle, c.description)),
  );
  return chunks.join('').replace(/\s+/g, '').length;
}

/**
 * Cross-process lock for resume mutations. Never steal an old lock based solely on age:
 * a paused process could resume writing. A crashed owner's lock requires explicit recovery.
 */
export async function withResumeWriteLock<T>(dataDir: string, work: () => Promise<T>): Promise<T> {
  await fs.mkdir(dataDir, { recursive: true });
  const lock = path.join(dataDir, '.resume-write-lock');
  const deadline = Date.now() + 4000;
  while (true) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (Date.now() >= deadline) {
        throw new LocalFsApiError(423, 'RESUME_WRITE_LOCKED',
          '简历写入被占用。请稍后重试；若程序异常退出，请关闭所有工作台/MCP 后检查 data/.resume-write-lock。');
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try {
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    return await work();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

function assertExpectedRevision(current: ResumeDocument | null, expected: string | null): void {
  if ((current ? resumeRevision(current) : null) !== expected) {
    throw new LocalFsApiError(409, 'REVISION_CONFLICT',
      '简历已被其他窗口或进程修改，当前编辑尚未覆盖磁盘。请先备份当前编辑，再重新打开最新版本。');
  }
}

function nextUpdatedAt(current: ResumeDocument | null): string {
  const previous = current ? Date.parse(current.updatedAt) : NaN;
  return new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString();
}

export class LocalResumeStore {
  readonly dataDir: string;
  readonly masterPath: string;
  readonly resumesDir: string;
  readonly assetsDir: string;
  readonly backupsDir: string;
  readonly appSnapshotsDir: string;
  readonly applicationsPath: string;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.masterPath = path.join(this.dataDir, 'master.json');
    this.resumesDir = path.join(this.dataDir, 'resumes');
    this.assetsDir = path.join(this.dataDir, 'assets');
    this.backupsDir = path.join(this.dataDir, '.backups');
    this.appSnapshotsDir = path.join(this.dataDir, '.application-snapshots');
    this.applicationsPath = path.join(this.dataDir, 'applications.json');
  }

  async ensureDirs(): Promise<void> {
    await fs.mkdir(this.resumesDir, { recursive: true });
    await fs.mkdir(this.assetsDir, { recursive: true });
  }

  resolveResumePath(rawSlug: string): { slug: string; filePath: string; isMaster: boolean } {
    const slug = assertSafeSlug(rawSlug);
    if (slug === 'master') {
      return {
        slug: 'master',
        filePath: resolveContainedPath(this.dataDir, 'master.json'),
        isMaster: true,
      };
    }
    return {
      slug,
      filePath: resolveContainedPath(this.resumesDir, `${slug}.json`),
      isMaster: false,
    };
  }

  async listResumes(): Promise<{ master: ResumeSummary | null; resumes: ResumeSummary[] }> {
    await this.ensureDirs();

    let master: ResumeSummary | null = null;
    if (await fileExists(this.masterPath)) {
      const doc = await this.readAndValidateFile(this.masterPath);
      master = {
        slug: 'master',
        id: doc.id,
        title: doc.title,
        templateId: doc.templateId,
        updatedAt: doc.updatedAt,
        isMaster: true,
      };
    }

    const entries = await fs.readdir(this.resumesDir, { withFileTypes: true });
    const resumes: ResumeSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const slug = entry.name.slice(0, -5);
      if (!SAFE_SLUG_REGEX.test(slug) || slug === 'master') continue;
      const fullPath = resolveContainedPath(this.resumesDir, entry.name);
      const doc = await this.readAndValidateFile(fullPath);
      resumes.push({
        slug,
        id: doc.id,
        title: doc.title,
        templateId: doc.templateId,
        updatedAt: doc.updatedAt,
        isMaster: false,
      });
    }

    resumes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { master, resumes };
  }

  private async readAndValidateFile(filePath: string): Promise<ResumeDocument> {
    const text = await fs.readFile(filePath, 'utf-8');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      throw new LocalFsApiError(500, 'CORRUPTED_JSON', `JSON 文件解析失败: ${path.basename(filePath)}`);
    }
    try {
      return ResumeDocumentSchema.parse(parsedJson);
    } catch (err) {
      const detail = err instanceof ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : '';
      throw new LocalFsApiError(422, 'SCHEMA_INVALID', `简历数据校验失败: ${detail}`);
    }
  }

  async getResume(rawSlug: string): Promise<ResumeDocument> {
    const { filePath } = this.resolveResumePath(rawSlug);
    if (!(await fileExists(filePath))) {
      throw new LocalFsApiError(404, 'NOT_FOUND', `未找到简历版本: ${rawSlug}`);
    }
    return this.readAndValidateFile(filePath);
  }

  async saveResume(rawSlug: string, payload: unknown, options?: {
    expectedRevision?: string | null;
    snapshotReason?: string;
    onSnapshotCreated?: (snapshot: ResumeSnapshotMeta) => void;
    requireExisting?: boolean;
  }): Promise<ResumeDocument> {
    await this.ensureDirs();
    const { slug, filePath } = this.resolveResumePath(rawSlug);
    let validated: ResumeDocument;
    try {
      validated = ResumeDocumentSchema.parse(payload);
    } catch (err) {
      const detail = err instanceof ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : '格式非法';
      throw new LocalFsApiError(422, 'VALIDATION_ERROR', `保存失败，数据校验未通过: ${detail}`);
    }
    return withResumeWriteLock(this.dataDir, async () => {
      const current = await this.readOptionalResume(filePath);
      // Existing files always need a matching revision, including legacy direct callers.
      const expected = options?.expectedRevision !== undefined ? options.expectedRevision
        : current || options?.requireExisting ? resumeRevision(validated) : null;
      assertExpectedRevision(current, expected);
      if (options?.requireExisting && !current) throw new LocalFsApiError(409, 'REVISION_CONFLICT', '简历已不存在，未重新创建。');
      if (current && current.id !== validated.id) throw new LocalFsApiError(409, 'DOCUMENT_ID_CONFLICT', '不能用另一份简历的身份标识覆盖当前版本。');
      if (current && options?.snapshotReason) {
        const snapshot = await this.createSnapshot(slug, options.snapshotReason, current);
        options.onSnapshotCreated?.(snapshot);
      }
      return this.writeResume(filePath, validated, current);
    });
  }

  private async readOptionalResume(filePath: string): Promise<ResumeDocument | null> {
    try { return await this.readAndValidateFile(filePath); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private async writeResume(filePath: string, doc: ResumeDocument, current: ResumeDocument | null): Promise<ResumeDocument> {
    const updated = { ...doc, updatedAt: nextUpdatedAt(current) };
    await atomicWriteFile(filePath, `${JSON.stringify(updated, null, 2)}\n`);
    return updated;
  }

  async createResume(input: {
    slug?: string;
    title?: string;
    cloneFromSlug?: string;
    document?: unknown;
  }): Promise<{ slug: string; document: ResumeDocument }> {
    await this.ensureDirs();
    const nowIso = new Date().toISOString();

    let baseDoc: ResumeDocument;
    if (input.document !== undefined) {
      try {
        baseDoc = adaptResumeOrLegacy(input.document);
      } catch (err) {
        throw new LocalFsApiError(
          422,
          'IMPORT_INVALID',
          err instanceof Error ? err.message : '导入的简历 JSON 格式无法识别。',
        );
      }
    } else if (input.cloneFromSlug) {
      baseDoc = await this.getResume(input.cloneFromSlug);
    } else if (await fileExists(this.masterPath)) {
      baseDoc = await this.readAndValidateFile(this.masterPath);
    } else {
      throw new LocalFsApiError(400, 'MISSING_SOURCE', '缺少复制源简历或导入文档。');
    }

    const finalTitle = (input.title && input.title.trim()) || `${baseDoc.title}（副本）`;
    let candidateSlug = input.slug ? assertSafeSlug(input.slug) : slugifyTitle(finalTitle);
    if (candidateSlug === 'master') {
      throw new LocalFsApiError(400, 'RESERVED_SLUG', '不能使用保留标识 master 作为新版本文件名。');
    }

    return withResumeWriteLock(this.dataDir, async () => {
    let targetPath = resolveContainedPath(this.resumesDir, `${candidateSlug}.json`);
    if (input.slug) {
      if (await fileExists(targetPath)) {
        throw new LocalFsApiError(409, 'SLUG_EXISTS', `版本标识 "${candidateSlug}" 已存在。`);
      }
    } else {
      let suffix = 2;
      while (await fileExists(targetPath)) {
        const nextSlug = `${candidateSlug}-${suffix}`;
        targetPath = resolveContainedPath(this.resumesDir, `${nextSlug}.json`);
        if (!(await fileExists(targetPath))) {
          candidateSlug = nextSlug;
          break;
        }
        suffix += 1;
      }
    }

    const nextDoc: ResumeDocument = {
      ...baseDoc,
      id: crypto.randomUUID(),
      title: finalTitle,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const validated = ResumeDocumentSchema.parse(nextDoc);
    await atomicWriteFile(targetPath, `${JSON.stringify(validated, null, 2)}\n`);
    return { slug: candidateSlug, document: validated };
    });
  }

  async deleteResume(rawSlug: string, expectedRevision?: string): Promise<void> {
    const { slug, filePath, isMaster } = this.resolveResumePath(rawSlug);
    if (isMaster) {
      throw new LocalFsApiError(400, 'MASTER_PROTECTED', '母库 master.json 受保护，不允许删除。');
    }
    await withResumeWriteLock(this.dataDir, async () => {
      const current = await this.readOptionalResume(filePath);
      if (!current) throw new LocalFsApiError(404, 'NOT_FOUND', `简历版本 "${slug}" 不存在。`);
      if (expectedRevision !== undefined) assertExpectedRevision(current, expectedRevision);
      await fs.unlink(filePath);
    });
  }

  async saveAsset(input: { filename?: string; dataUrl: string }): Promise<{ filename: string; url: string }> {
    await this.ensureDirs();
    if (typeof input.dataUrl !== 'string') {
      throw new LocalFsApiError(400, 'INVALID_IMAGE', '缺少图片 dataUrl 数据。');
    }

    const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(input.dataUrl.trim());
    if (!match || !match[1] || !match[2]) {
      throw new LocalFsApiError(400, 'INVALID_IMAGE', '仅支持 PNG、JPG、JPEG 或 WebP 格式的 Base64 图片。');
    }

    const rawExt = match[1].toLowerCase();
    const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new LocalFsApiError(413, 'IMAGE_TOO_LARGE', '图片体积必须在 1B 至 5MB 之间。');
    }

    const rawBase = (input.filename ?? 'photo')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'photo';
    const filename = assertSafeAssetName(`${rawBase}-${Date.now().toString(36)}.${ext}`);
    const targetPath = resolveContainedPath(this.assetsDir, filename);

    await atomicWriteFile(targetPath, buffer);
    return {
      filename,
      url: `/api/assets/${filename}`,
    };
  }

  async readAsset(rawFilename: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const filename = assertSafeAssetName(rawFilename);
    const targetPath = resolveContainedPath(this.assetsDir, filename);
    if (!(await fileExists(targetPath))) {
      throw new LocalFsApiError(404, 'ASSET_NOT_FOUND', '图片资源不存在。');
    }
    const buffer = await fs.readFile(targetPath);
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    };
    return {
      buffer,
      mimeType: mimeMap[ext] ?? 'application/octet-stream',
    };
  }

  private resolveSnapshotDir(rawSlug: string): { slug: string; dir: string } {
    const slug = assertSafeSlug(rawSlug);
    return {
      slug,
      dir: resolveContainedPath(this.backupsDir, slug),
    };
  }

  async createSnapshot(
    rawSlug: string,
    reason = '手动创建快照',
    docOverride?: ResumeDocument,
  ): Promise<ResumeSnapshotMeta> {
    const { slug, dir } = this.resolveSnapshotDir(rawSlug);
    const sourceDoc = docOverride
      ? ResumeDocumentSchema.parse(docOverride)
      : await this.getResume(slug);
    await fs.mkdir(dir, { recursive: true });

    const createdAt = new Date().toISOString();
    const stamp = createdAt.replace(/[:.]/g, '-');
    const shortRand = Math.random().toString(36).slice(2, 6);
    const id = `${stamp}-${shortRand}`;
    const meta: ResumeSnapshotMeta = {
      id,
      slug,
      reason: reason.trim() || '自动快照',
      createdAt,
      templateId: sourceDoc.templateId,
      title: sourceDoc.title,
      charCount: countDocumentChars(sourceDoc),
    };

    const filePath = resolveContainedPath(dir, `${id}.json`);
    await atomicWriteFile(
      filePath,
      `${JSON.stringify({ meta, document: sourceDoc }, null, 2)}\n`,
    );

    // Prune oldest snapshots strictly keeping MAX_SNAPSHOTS_PER_RESUME (15)
    const all = await this.listSnapshots(slug);
    if (all.length > MAX_SNAPSHOTS_PER_RESUME) {
      const stale = all.slice(MAX_SNAPSHOTS_PER_RESUME);
      await Promise.all(
        stale.map((item) =>
          fs.unlink(resolveContainedPath(dir, `${item.id}.json`)).catch(() => {}),
        ),
      );
    }

    return meta;
  }

  async listSnapshots(rawSlug: string): Promise<ResumeSnapshotMeta[]> {
    const { slug, dir } = this.resolveSnapshotDir(rawSlug);
    if (!(await fileExists(dir))) {
      return [];
    }
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const metas: ResumeSnapshotMeta[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const fullPath = resolveContainedPath(dir, entry.name);
      try {
        const raw = JSON.parse(await fs.readFile(fullPath, 'utf-8')) as {
          meta?: Partial<ResumeSnapshotMeta>;
          document?: unknown;
        };
        if (raw.meta && typeof raw.meta.id === 'string' && typeof raw.meta.createdAt === 'string') {
          metas.push({
            id: raw.meta.id,
            slug: raw.meta.slug || slug,
            reason: raw.meta.reason || '自动快照',
            createdAt: raw.meta.createdAt,
            templateId: (raw.meta.templateId as TemplateId) || 'left-right',
            title: raw.meta.title || slug,
            charCount: typeof raw.meta.charCount === 'number' ? raw.meta.charCount : 0,
          });
        }
      } catch {
        // Ignore unreadable backup file
      }
    }
    metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return metas;
  }

  async restoreSnapshot(rawSlug: string, rawSnapshotId: string, expectedRevision?: string): Promise<ResumeDocument> {
    const { slug, dir } = this.resolveSnapshotDir(rawSlug);
    const snapshotId = assertSafeSnapshotId(rawSnapshotId);
    const snapPath = resolveContainedPath(dir, `${snapshotId}.json`);
    if (!(await fileExists(snapPath))) {
      throw new LocalFsApiError(404, 'SNAPSHOT_NOT_FOUND', `未找到历史快照: ${snapshotId}`);
    }

    const parsedRaw = JSON.parse(await fs.readFile(snapPath, 'utf-8')) as {
      document?: unknown;
    };
    const restoredDoc = ResumeDocumentSchema.parse(parsedRaw.document);

    // Always capture reversible pre-rollback backup if target file exists
    const { filePath: targetPath } = this.resolveResumePath(slug);
    return withResumeWriteLock(this.dataDir, async () => {
      const current = await this.readOptionalResume(targetPath);
      if (expectedRevision !== undefined) assertExpectedRevision(current, expectedRevision);
      if (current) await this.createSnapshot(slug, '回滚前自动备份', current);
      return this.writeResume(targetPath, restoredDoc, current);
    });
  }

  async getApplications(): Promise<ApplicationsStoreData> {
    await this.ensureDirs();
    if (!(await fileExists(this.applicationsPath))) {
      return { schemaVersion: 1, applications: [], coverLetters: [], interviewAnswers: {} };
    }
    const text = await fs.readFile(this.applicationsPath, 'utf-8');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new LocalFsApiError(500, 'CORRUPTED_JSON', 'applications.json 解析失败。');
    }
    try {
      return ApplicationsStoreSchema.parse(raw);
    } catch (err) {
      const detail = err instanceof ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : '';
      throw new LocalFsApiError(422, 'VALIDATION_ERROR', `投递记录数据格式校验失败: ${detail}`);
    }
  }

  async saveApplicationSnapshot(input: {
    snapshotId?: string;
    applicationId?: string;
    resumeSlug: string;
    exportedFilePath?: string;
    atsScore?: number | null;
    document: unknown;
  }): Promise<ApplicationSnapshotMeta> {
    await fs.mkdir(this.appSnapshotsDir, { recursive: true });
    const resumeSlug = assertSafeSlug(input.resumeSlug);
    const parsedDoc = ResumeDocumentSchema.parse(input.document);
    const createdAt = new Date().toISOString();
    const rawId =
      input.snapshotId?.trim() ||
      `app-${createdAt.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
    const id = assertSafeSnapshotId(rawId);

    const meta: ApplicationSnapshotMeta = {
      id,
      applicationId: input.applicationId?.trim() || '',
      resumeSlug,
      exportedFilePath: input.exportedFilePath?.trim() || '',
      createdAt,
      title: parsedDoc.title,
      templateId: parsedDoc.templateId,
      atsScore: input.atsScore ?? null,
    };
    const record: ApplicationSnapshotRecord = { meta, document: parsedDoc };
    const targetPath = resolveContainedPath(this.appSnapshotsDir, `${id}.json`);
    await atomicWriteFile(targetPath, `${JSON.stringify(record, null, 2)}\n`);
    return meta;
  }

  async getApplicationSnapshot(rawSnapshotId: string): Promise<ApplicationSnapshotRecord> {
    const id = assertSafeSnapshotId(rawSnapshotId);
    const targetPath = resolveContainedPath(this.appSnapshotsDir, `${id}.json`);
    if (!(await fileExists(targetPath))) {
      throw new LocalFsApiError(404, 'SNAPSHOT_NOT_FOUND', `未找到永久投递快照: ${id}`);
    }
    const parsed = JSON.parse(await fs.readFile(targetPath, 'utf-8')) as {
      meta?: ApplicationSnapshotMeta;
      document?: unknown;
    };
    const document = ResumeDocumentSchema.parse(parsed.document);
    return {
      meta: parsed.meta ?? {
        id,
        applicationId: '',
        resumeSlug: 'resume',
        exportedFilePath: '',
        createdAt: document.updatedAt,
        title: document.title,
        templateId: document.templateId,
        atsScore: null,
      },
      document,
    };
  }

  async deleteApplicationSnapshot(rawSnapshotId: string): Promise<{ deleted: boolean }> {
    const id = assertSafeSnapshotId(rawSnapshotId);
    const targetPath = resolveContainedPath(this.appSnapshotsDir, `${id}.json`);
    if (!(await fileExists(targetPath))) {
      return { deleted: false };
    }
    await fs.unlink(targetPath);
    return { deleted: true };
  }

  async saveApplications(payload: unknown): Promise<ApplicationsStoreData> {
    await this.ensureDirs();
    let validated: ApplicationsStoreData;
    try {
      validated = ApplicationsStoreSchema.parse(payload);
    } catch (err) {
      const detail = err instanceof ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : '格式非法';
      throw new LocalFsApiError(422, 'VALIDATION_ERROR', `投递记录校验失败: ${detail}`);
    }
    await atomicWriteFile(this.applicationsPath, `${JSON.stringify(validated, null, 2)}\n`);
    return validated;
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_JSON_BYTES) {
      throw new LocalFsApiError(413, 'PAYLOAD_TOO_LARGE', '请求体体积超过 5MB 限制。');
    }
    chunks.push(buf);
  }

  const rawText = Buffer.concat(chunks).toString('utf-8').trim();
  if (!rawText) {
    return {};
  }
  try {
    return JSON.parse(rawText);
  } catch {
    throw new LocalFsApiError(400, 'INVALID_JSON', '请求体不是合法的 JSON 格式。');
  }
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export type ConnectNext = (err?: unknown) => void;

export function createLocalFsMiddleware(store: LocalResumeStore) {
  return async function localFsMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: ConnectNext,
  ): Promise<void> {
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0] ?? '/';
    if (!pathname.startsWith('/api/')) {
      next();
      return;
    }

    try {
      const method = (req.method ?? 'GET').toUpperCase();

      if (method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true, dataDir: store.dataDir });
        return;
      }

      if (method === 'GET' && pathname === '/api/resumes') {
        const list = await store.listResumes();
        sendJson(res, 200, list);
        return;
      }

      if (method === 'POST' && pathname === '/api/resumes') {
        const body = (await readJsonBody(req)) as {
          slug?: string;
          title?: string;
          cloneFromSlug?: string;
          document?: unknown;
        };
        const created = await store.createResume(body);
        sendJson(res, 201, created);
        return;
      }

      if (method === 'GET' && pathname === '/api/applications') {
        const data = await store.getApplications();
        sendJson(res, 200, data);
        return;
      }

      if (method === 'PUT' && pathname === '/api/applications') {
        const body = await readJsonBody(req);
        const saved = await store.saveApplications(body);
        sendJson(res, 200, saved);
        return;
      }

      if (method === 'POST' && pathname === '/api/application-snapshots') {
        const body = (await readJsonBody(req)) as {
          snapshotId?: string;
          applicationId?: string;
          resumeSlug: string;
          exportedFilePath?: string;
          atsScore?: number | null;
          document: unknown;
        };
        const meta = await store.saveApplicationSnapshot(body);
        sendJson(res, 201, meta);
        return;
      }

      if (pathname.startsWith('/api/application-snapshots/')) {
        const snapId = pathname.slice('/api/application-snapshots/'.length);
        if (method === 'GET') {
          const rec = await store.getApplicationSnapshot(snapId);
          sendJson(res, 200, rec);
          return;
        }
        if (method === 'DELETE') {
          const result = await store.deleteApplicationSnapshot(snapId);
          sendJson(res, 200, result);
          return;
        }
      }

      if (pathname.startsWith('/api/resumes/')) {
        const tail = pathname.slice('/api/resumes/'.length);
        const snapMatch = /^([^/]+)\/snapshots(\/restore)?$/.exec(tail);
        if (snapMatch && snapMatch[1]) {
          const slug = snapMatch[1];
          const isRestore = Boolean(snapMatch[2]);
          if (method === 'GET' && !isRestore) {
            const list = await store.listSnapshots(slug);
            sendJson(res, 200, list);
            return;
          }
          if (method === 'POST' && !isRestore) {
            const body = (await readJsonBody(req)) as { reason?: string };
            const meta = await store.createSnapshot(slug, body.reason);
            sendJson(res, 201, meta);
            return;
          }
          if (method === 'POST' && isRestore) {
            const body = (await readJsonBody(req)) as { snapshotId: string; expectedRevision?: string };
            if (typeof body.expectedRevision !== 'string') throw new LocalFsApiError(428, 'REVISION_REQUIRED', '回滚前必须提供已读取的版本标识。');
            const doc = await store.restoreSnapshot(slug, body.snapshotId, body.expectedRevision);
            sendJson(res, 200, doc);
            return;
          }
        }
        const rawSlug = tail;
        if (method === 'GET') {
          const doc = await store.getResume(rawSlug);
          sendJson(res, 200, doc);
          return;
        }
        if (method === 'PUT') {
          const body = await readJsonBody(req);
          const saved = await store.saveResume(rawSlug, body, { requireExisting: true });
          sendJson(res, 200, saved);
          return;
        }
        if (method === 'DELETE') {
          const expected = req.headers['if-match'];
          if (typeof expected !== 'string') throw new LocalFsApiError(428, 'REVISION_REQUIRED', '删除前必须提供已读取的版本标识。');
          await store.deleteResume(rawSlug, decodeURIComponent(expected));
          sendJson(res, 200, { deleted: true });
          return;
        }
      }

      if (method === 'POST' && pathname === '/api/assets') {
        const body = (await readJsonBody(req)) as { filename?: string; dataUrl: string };
        const result = await store.saveAsset(body);
        sendJson(res, 201, result);
        return;
      }

      if (method === 'GET' && pathname.startsWith('/api/assets/')) {
        const rawFilename = pathname.slice('/api/assets/'.length);
        const { buffer, mimeType } = await store.readAsset(rawFilename);
        res.statusCode = 200;
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.end(buffer);
        return;
      }

      sendJson(res, 404, { code: 'ENDPOINT_NOT_FOUND', message: `未知接口: ${method} ${pathname}` });
    } catch (err) {
      if (err instanceof LocalFsApiError) {
        sendJson(res, err.statusCode, { code: err.code, message: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : '服务器内部错误';
      sendJson(res, 500, { code: 'INTERNAL_ERROR', message });
    }
  };
}

export async function ensureInitialDataFromLegacy(options: {
  rootDir: string;
  force?: boolean;
}): Promise<{ initialized: boolean; masterPath: string; resumePath: string }> {
  const dataDir = path.join(options.rootDir, 'data');
  return withResumeWriteLock(dataDir, async () => {
  const legacyFile = path.join(options.rootDir, '高中物理教师（云南省内）.json');
  const masterPath = path.join(dataDir, 'master.json');
  const resumePath = path.join(dataDir, 'resumes', 'synthetic-job.json');

  const store = new LocalResumeStore(dataDir);
  await store.ensureDirs();

  const hasMaster = await fileExists(masterPath);
  const hasResume = await fileExists(resumePath);

  if (!options.force && hasMaster && hasResume) {
    return { initialized: false, masterPath, resumePath };
  }

  if (!(await fileExists(legacyFile))) {
    const existingList = await store.listResumes();
    if (existingList.master || existingList.resumes.length > 0) {
      return { initialized: false, masterPath, resumePath };
    }
    const nowIso = new Date().toISOString();
    const starterDoc = ResumeDocumentSchema.parse({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      title: '我的简历',
      templateId: 'left-right',
      createdAt: nowIso,
      updatedAt: nowIso,
      activeSection: 'basic',
      basic: {
        name: '你的姓名',
        title: '求职岗位',
        employmentStatus: '随时到岗',
        email: '',
        phone: '',
        location: '',
        birthDate: '',
        photo: '',
      },
      menuSections: [
        { id: 'basic', title: '基本信息', icon: 'User', enabled: true, order: 0 },
        { id: 'education', title: '教育经历', icon: 'GraduationCap', enabled: true, order: 1 },
        { id: 'experience', title: '工作经历', icon: 'Briefcase', enabled: true, order: 2 },
        { id: 'projects', title: '项目经历', icon: 'Rocket', enabled: true, order: 3 },
        { id: 'skills', title: '专业技能', icon: 'Zap', enabled: true, order: 4 },
        { id: 'selfEvaluation', title: '自我评价', icon: 'User', enabled: true, order: 5 },
      ],
      education: [],
      experience: [],
      projects: [],
      skillContent: '',
      selfEvaluationContent: '',
      customData: {},
      globalSettings: {},
    });
    const starterPath = path.join(store.resumesDir, 'starter-resume.json');
    await atomicWriteFile(
      masterPath,
      `${JSON.stringify({ ...starterDoc, title: '个人经历母库（Master）' }, null, 2)}\n`,
    );
    await atomicWriteFile(starterPath, `${JSON.stringify(starterDoc, null, 2)}\n`);
    return { initialized: true, masterPath, resumePath: starterPath };
  }

  const rawText = await fs.readFile(legacyFile, 'utf-8');
  const rawJson = JSON.parse(rawText) as unknown;
  const adapted = adaptResumeOrLegacy(rawJson);

  if (options.force || !hasMaster) {
    const masterDoc: ResumeDocument = {
      ...adapted,
      title: '个人经历母库（Master）',
    };
    await atomicWriteFile(masterPath, `${JSON.stringify(masterDoc, null, 2)}\n`);
  }

  if (options.force || !hasResume) {
    await atomicWriteFile(resumePath, `${JSON.stringify(adapted, null, 2)}\n`);
  }

  return { initialized: true, masterPath, resumePath };
  });
}

export function localFsApiPlugin(options?: { rootDir?: string }): Plugin {
  const rootDir = path.resolve(options?.rootDir ?? process.cwd());
  const dataDir = path.join(rootDir, 'data');
  const store = new LocalResumeStore(dataDir);
  const middleware = createLocalFsMiddleware(store);

  return {
    name: 'resume-studio-local-fs-api',
    async configureServer(server) {
      await ensureInitialDataFromLegacy({ rootDir, force: false });
      server.middlewares.use((req, res, next) => {
        void middleware(req, res, next);
      });
    },
  };
}
