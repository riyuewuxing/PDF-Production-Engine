import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { ZodError } from 'zod';
import {restoreArchivedJobReview,sameJobReviewDocument} from '../lib/jobRequirements';
import { adaptResumeOrLegacy } from '../schema/legacyAdapter';
import {
  type ApplicationSnapshotMeta,
  type ApplicationSnapshotLink,
  type PdfArtifactReceipt,
  PdfArtifactReceiptSchema,
  samePdfReceipt,
  type ApplicationSnapshotRecord,
  ApplicationsStoreSchema,
  JobApplicationSchema,
  type JobApplication,
  type ApplicationLogInput,
  type ApplicationsStoreData,
} from '../schema/applicationSchema';
import {
  ResumeDocument,
  ResumeDocumentSchema,
  resumeRevision,
  ResumeSummary,
  type ResumeListIssue,
  type ResumeListResult,
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
    // Windows antivirus/readers can transiently hold the destination open. Keep
    // the same temp file and write lock; never unlink the live destination.
    const delays=[25,50,100,200,400,400];
    for(let attempt=0;;attempt++){
      try{await fs.rename(tempPath,targetPath);break;}
      catch(err){
        const code=(err as NodeJS.ErrnoException).code;
        if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(code??'')||attempt>=delays.length)throw err;
        await new Promise(resolve=>setTimeout(resolve,delays[attempt]));
      }
    }
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

// Occupancy is not readability: an inaccessible or dangling entry must not be
// treated as free space for initialization, import, or recovery.
async function pathEntryExists(targetPath: string): Promise<boolean> {
  try { await fs.lstat(targetPath); return true; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function checkWorkspaceDirectory(root:string,dir:string,create=false):Promise<void>{
  const relative=path.relative(root,dir);
  if(!['resumes','assets','.trash','.application-snapshots'].includes(relative))throw new LocalFsApiError(422,'UNSAFE_DIRECTORY','工作区目录不安全，未读取或写入。');
  if(create){
    await fs.mkdir(root,{recursive:true});
    try{await fs.mkdir(dir);}catch(err){if((err as NodeJS.ErrnoException).code!=='EEXIST')throw err;}
  }
  const st=await fs.lstat(dir);
  const realRoot=await fs.realpath(root);
  if(!st.isDirectory()||st.isSymbolicLink()||path.relative(path.join(realRoot,relative),await fs.realpath(dir))!==''){
    throw new LocalFsApiError(422,'UNSAFE_DIRECTORY','工作区目录不安全：'+relative+'。未读取或写入，请检查独立备份。');
  }
}

async function checkWorkspaceFile(root:string,file:string):Promise<void>{
  const dir=path.dirname(file);
  if(path.relative(root,dir)!=='')await checkWorkspaceDirectory(root,dir);
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1){
    throw new LocalFsApiError(422,'UNSAFE_ENTRY','工作区文件不是独立普通文件：'+path.basename(file)+'。原件保留，未读取或写入。');
  }
  const expected=path.join(await fs.realpath(dir),path.basename(file));
  if(path.relative(expected,await fs.realpath(file))!==''){
    throw new LocalFsApiError(422,'UNSAFE_ENTRY','工作区文件路径不安全：'+path.basename(file)+'。原件保留。');
  }
}

export interface ResumeTrashMeta {
  id: string;
  slug: string;
  title: string;
  deletedAt: string;
  templateId: TemplateId;
  revision: string;
}
export interface ResumeTrashList { items: ResumeTrashMeta[]; unreadableCount: number; }

const TRASH_ID_REGEX = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,79})\.(\d{13})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
function parseTrashId(raw: string): {id:string;slug:string;deletedAt:string} {
  if(typeof raw!=='string')throw new LocalFsApiError(400,'INVALID_TRASH_ID','非法的回收站记录标识。');
  const match=TRASH_ID_REGEX.exec(raw);
  if(!match||match[1]==='master')throw new LocalFsApiError(400,'INVALID_TRASH_ID','非法的回收站记录标识。');
  return {id:raw,slug:assertSafeSlug(match[1]!),deletedAt:new Date(Number(match[2])).toISOString()};
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

export interface ResumeSnapshotInventory { items: ResumeSnapshotMeta[]; unreadableCount:number; }

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

export interface ResumeWriteLockStatus {
  state:'unlocked'|'active'|'recoverable'|'unknown';
  pid?:number;
  acquiredAt?:string;
  token?:string;
  reason:string;
}
type LockOwner={version:1;pid:number;hostname:string;platform:string;acquiredAt:string;token:string};
const LOCK_DIR='.resume-write-lock';
const RECOVERY_DIR='.resume-lock-recovery';
function isMissing(err:unknown):boolean{return (err as NodeJS.ErrnoException)?.code==='ENOENT';}
async function readLockOwner(lock:string):Promise<LockOwner|null>{
  try{
    const entry=await fs.lstat(lock);
    if(!entry.isDirectory()||entry.isSymbolicLink())return null;
    const marker=path.join(lock,'owner.json');
    const file=await fs.lstat(marker);
    if(!file.isFile()||file.isSymbolicLink()||file.size>4096)return null;
    const raw=JSON.parse(await fs.readFile(marker,'utf8')) as Partial<LockOwner>;
    if(raw.version!==1||!Number.isSafeInteger(raw.pid)||raw.pid!<1||raw.pid!>2147483647||
      typeof raw.hostname!=='string'||typeof raw.platform!=='string'||typeof raw.acquiredAt!=='string'||
      !Number.isFinite(Date.parse(raw.acquiredAt))||typeof raw.token!=='string'||!/^[0-9a-f-]{36}$/i.test(raw.token))return null;
    return raw as LockOwner;
  }catch{return null;}
}
function processState(pid:number):'alive'|'dead'|'unknown'{
  try{process.kill(pid,0);return 'alive';}
  catch(err){
    const code=(err as NodeJS.ErrnoException)?.code;
    return code==='ESRCH'?'dead':code==='EPERM'?'alive':'unknown';
  }
}
/** An old timestamp alone is never evidence that a process is dead. */
export async function inspectResumeWriteLock(dataDir:string):Promise<ResumeWriteLockStatus>{
  const lock=path.join(dataDir,LOCK_DIR);
  try{await fs.lstat(lock);}catch(err){if(isMissing(err))return {state:'unlocked',reason:'当前没有写入锁。'};return {state:'unknown',reason:'无法读取锁目录。'};}
  const owner=await readLockOwner(lock);
  if(!owner)return {state:'unknown',reason:'锁缺少可验证的新格式所有者信息。不能自动恢复；请关闭所有工作台及 MCP 后人工检查。'};
  const base={pid:owner.pid,acquiredAt:owner.acquiredAt,token:owner.token};
  if(owner.hostname!==os.hostname()||owner.platform!==process.platform)return {...base,state:'unknown',reason:'锁来自不同主机或平台，不允许在线恢复。'};
  const state=processState(owner.pid);
  if(state==='alive')return {...base,state:'active',reason:'锁所有者进程仍在运行（或 PID 已被复用），不允许抢占。'};
  if(state==='unknown')return {...base,state:'unknown',reason:'无法可靠确认锁所有者已退出。'};
  return {...base,state:'recoverable',reason:'同一主机上的锁所有者进程已不存在。可以确认后归档旧锁。'};
}
/** Recovery is explicit, serialized and token-bound. Retain the old lock as evidence. */
export async function recoverResumeWriteLock(dataDir:string,expectedToken:string,confirmation:unknown):Promise<{recovered:true}>{
  if(confirmation!=='RECOVER_DEAD_LOCK'||typeof expectedToken!=='string')throw new LocalFsApiError(400,'CONFIRMATION_REQUIRED','恢复锁需要明确确认。');
  const guard=path.join(dataDir,RECOVERY_DIR);
  try{await fs.mkdir(guard);}catch(err){
    if((err as NodeJS.ErrnoException).code==='EEXIST')throw new LocalFsApiError(423,'LOCK_RECOVERY_BUSY','另一个锁恢复操作正在运行或曾中断，不能抢占。');
    throw err;
  }
  try{
    const status=await inspectResumeWriteLock(dataDir);
    if(status.state!=='recoverable'||status.token!==expectedToken)throw new LocalFsApiError(409,'LOCK_RECOVERY_UNSAFE','锁状态已变化或无法安全恢复。请重新检查。');
    const archive=path.join(dataDir,'.lock-recovery-history');
    await fs.mkdir(archive,{recursive:true});
    // Only this recovery owner can move a dead lock. New acquisition is possible only after rename.
    await fs.rename(path.join(dataDir,LOCK_DIR),path.join(archive,Date.now()+'-'+randomUUID()));
    return {recovered:true};
  }finally{await fs.rmdir(guard);}
}
export async function withResumeWriteLock<T>(dataDir:string,work:()=>Promise<T>):Promise<T>{
  await fs.mkdir(dataDir,{recursive:true});
  const lock=path.join(dataDir,LOCK_DIR);
  const deadline=Date.now()+4000;
  while(true){
    try{await fs.mkdir(lock);break;}
    catch(err){
      if((err as NodeJS.ErrnoException).code!=='EEXIST')throw err;
      if(Date.now()>=deadline)throw new LocalFsApiError(423,'RESUME_WRITE_LOCKED','本地写入被占用。请稍后重试，或在版本母库中检查写入锁。');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  }
  const owner:LockOwner={version:1,pid:process.pid,hostname:os.hostname(),platform:process.platform,acquiredAt:new Date().toISOString(),token:randomUUID()};
  try{
    await atomicWriteFile(path.join(lock,'owner.json'),JSON.stringify(owner));
    return await work();
  }finally{
    // Never delete another owner\'s lock if an external tool replaced our directory.
    const current=await readLockOwner(lock);
    if(current?.token===owner.token)await fs.rm(lock,{recursive:true,force:true});
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
  readonly trashDir: string;
  readonly appSnapshotsDir: string;
  readonly applicationsPath: string;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.masterPath = path.join(this.dataDir, 'master.json');
    this.resumesDir = path.join(this.dataDir, 'resumes');
    this.assetsDir = path.join(this.dataDir, 'assets');
    this.backupsDir = path.join(this.dataDir, '.backups');
    this.trashDir = path.join(this.dataDir, '.trash');
    this.appSnapshotsDir = path.join(this.dataDir, '.application-snapshots');
    this.applicationsPath = path.join(this.dataDir, 'applications.json');
  }

  async ensureDirs(): Promise<void> {
    await checkWorkspaceDirectory(this.dataDir,this.resumesDir,true);
    await checkWorkspaceDirectory(this.dataDir,this.assetsDir,true);
  }

  private async ensureResumeDir():Promise<void>{
    await checkWorkspaceDirectory(this.dataDir,this.resumesDir,true);
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

  async listResumes(): Promise<ResumeListResult> {
    await this.ensureResumeDir();
    const issues: ResumeListIssue[] = [];
    const summarize = async (slug:string,filePath:string):Promise<ResumeSummary|null> => {
      try {
        const doc = await this.readAndValidateFile(filePath);
        return {slug,id:doc.id,title:doc.title,templateId:doc.templateId,updatedAt:doc.updatedAt,isMaster:slug==='master'};
      } catch (err) {
        if (err instanceof LocalFsApiError) {
          issues.push({slug,reason:err.code==='CORRUPTED_JSON'?'CORRUPTED_JSON':err.code==='SCHEMA_INVALID'?'SCHEMA_INVALID':err.code==='UNSAFE_ENTRY'||err.code==='UNSAFE_DIRECTORY'?'UNSAFE_ENTRY':'UNREADABLE'});
          return null;
        }
        if (typeof (err as NodeJS.ErrnoException)?.code === 'string') {
          // A file removed during listing is no longer available; any other
          // file-specific error is reported, not silently hidden.
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') issues.push({slug,reason:'UNREADABLE'});
          return null;
        }
        throw err;
      }
    };
    const master = await summarize('master',this.masterPath);
    const entries = await fs.readdir(this.resumesDir, { withFileTypes: true });
    const resumes:ResumeSummary[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue;
      const slug = entry.name.slice(0,-5);
      if (!SAFE_SLUG_REGEX.test(slug) || slug === 'master') continue;
      const row = await summarize(slug,resolveContainedPath(this.resumesDir,entry.name));
      if (row) resumes.push(row);
    }
    resumes.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    issues.sort((a,b)=>a.slug.localeCompare(b.slug));
    return {master,resumes,...(issues.length?{issues}:{})};
  }

  private async readAndValidateFile(filePath: string): Promise<ResumeDocument> {
    await checkWorkspaceFile(this.dataDir,filePath);
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
    try{return await this.readAndValidateFile(filePath);}
    catch(err){
      if(isMissing(err))throw new LocalFsApiError(404,'NOT_FOUND',`未找到简历版本: ${rawSlug}`);
      throw err;
    }
  }

  async saveResume(rawSlug: string, payload: unknown, options?: {
    expectedRevision?: string | null;
    snapshotReason?: string;
    onSnapshotCreated?: (snapshot: ResumeSnapshotMeta) => void;
    requireExisting?: boolean;
  }): Promise<ResumeDocument> {
    await this.ensureResumeDir();
    const { slug, filePath } = this.resolveResumePath(rawSlug);
    let validated: ResumeDocument;
    try {
      validated = ResumeDocumentSchema.parse(payload);
    } catch (err) {
      const detail = err instanceof ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : '格式非法';
      throw new LocalFsApiError(422, 'VALIDATION_ERROR', `保存失败，数据校验未通过: ${detail}`);
    }
    return withResumeWriteLock(this.dataDir, async () => {
      await checkWorkspaceDirectory(this.dataDir,this.resumesDir);
      const current = await this.readOptionalResume(filePath);
      // Existing files always need a matching revision, including legacy direct callers.
      const expected = options?.expectedRevision !== undefined ? options.expectedRevision
        : current || options?.requireExisting ? resumeRevision(validated) : null;
      assertExpectedRevision(current, expected);
      if (options?.requireExisting && !current) throw new LocalFsApiError(409, 'REVISION_CONFLICT', '简历已不存在，未重新创建。');
      if (!current && (await this.reservedTrashSlugs()).has(slug.toLowerCase())) throw new LocalFsApiError(409,'SLUG_RESERVED','该版本标识在回收站中保留，请恢复或创建其他版本。');
      if (current && current.id !== validated.id) throw new LocalFsApiError(409, 'DOCUMENT_ID_CONFLICT', '不能用另一份简历的身份标识覆盖当前版本。');
      if (current && options?.snapshotReason) {
        const snapshot = await this.createSnapshotUnlocked(slug, options.snapshotReason, current);
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
    await this.ensureResumeDir();
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
    } else if (await pathEntryExists(this.masterPath)) {
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
      await checkWorkspaceDirectory(this.dataDir,this.resumesDir);
      const reserved=await this.reservedTrashSlugs();
      const baseSlug=candidateSlug;
      const occupied=async(slug:string)=>reserved.has(slug.toLowerCase())||await pathEntryExists(this.resolveResumePath(slug).filePath);
      if(input.slug&&await occupied(candidateSlug)){
        throw new LocalFsApiError(409,reserved.has(candidateSlug.toLowerCase())?'SLUG_RESERVED':'SLUG_EXISTS','版本标识已存在或在回收站中保留。');
      }
      if(!input.slug){
        let suffix=2;
        while(await occupied(candidateSlug)){
          const tail='-'+suffix++;
          candidateSlug=baseSlug.slice(0,80-tail.length)+tail;
        }
      }
      const nextDoc:ResumeDocument={...baseDoc,id:crypto.randomUUID(),title:finalTitle,createdAt:nowIso,updatedAt:nowIso};
      const validated=ResumeDocumentSchema.parse(nextDoc);
      await atomicWriteFile(this.resolveResumePath(candidateSlug).filePath,`${JSON.stringify(validated,null,2)}\n`);
      return {slug:candidateSlug,document:validated};
    });
  }

  private async trashEntries() {
    try {await checkWorkspaceDirectory(this.dataDir,this.trashDir);return await fs.readdir(this.trashDir,{withFileTypes:true});}
    catch(err){if((err as NodeJS.ErrnoException).code==='ENOENT')return [];throw err;}
  }

  private async reservedTrashSlugs():Promise<Set<string>> {
    const result=new Set<string>();
    for(const entry of await this.trashEntries()){
      if(!entry.name.endsWith('.json'))continue;
      try {result.add(parseTrashId(entry.name.slice(0,-5)).slug.toLowerCase());}catch{/* unrelated file, not managed */}
    }
    return result;
  }

  async listTrash():Promise<ResumeTrashList>{
    const items:ResumeTrashMeta[]=[];
    let unreadableCount=0;
    for(const entry of await this.trashEntries()){
      if(!entry.name.endsWith('.json'))continue;
      let parsed:ReturnType<typeof parseTrashId>;
      try {parsed=parseTrashId(entry.name.slice(0,-5));}catch{unreadableCount++;continue;}
      try {
        if(!entry.isFile())throw new Error('not a regular file');
        const doc=await this.readAndValidateFile(resolveContainedPath(this.trashDir,entry.name));
        items.push({...parsed,title:doc.title,templateId:doc.templateId,revision:resumeRevision(doc)});
      } catch(err) {
        // A simultaneous completed restore removes this entry. Corruption is not silently hidden.
        if((err as NodeJS.ErrnoException).code!=='ENOENT')unreadableCount++;
      }
    }
    items.sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
    return {items,unreadableCount};
  }

  async deleteResume(rawSlug:string,expectedRevision?:string):Promise<{deleted:true;trashId:string}> {
    const {slug,filePath,isMaster}=this.resolveResumePath(rawSlug);
    if(isMaster)throw new LocalFsApiError(400,'MASTER_PROTECTED','母库 master.json 受保护，不允许删除。');
    return withResumeWriteLock(this.dataDir,async()=>{
      const current=await this.readOptionalResume(filePath);
      if(!current)throw new LocalFsApiError(404,'NOT_FOUND','简历版本不存在。');
      if(expectedRevision!==undefined)assertExpectedRevision(current,expectedRevision);
      await checkWorkspaceDirectory(this.dataDir,this.trashDir,true);
      const trashId=`${slug}.${Date.now()}.${crypto.randomUUID()}`;
      // A single atomic rename; the document never exists in a partially archived state.
      await fs.rename(filePath,resolveContainedPath(this.trashDir,trashId+'.json'));
      return {deleted:true,trashId};
    });
  }

  private async readTrash(rawId:string) {
    const record=parseTrashId(rawId);
    const filePath=resolveContainedPath(this.trashDir,record.id+'.json');
    let info;
    try{await checkWorkspaceDirectory(this.dataDir,this.trashDir);info=await fs.lstat(filePath);}catch(err){
      if((err as NodeJS.ErrnoException).code==='ENOENT')throw new LocalFsApiError(404,'TRASH_NOT_FOUND','回收站记录不存在或已恢复。');
      throw err;
    }
    if(!info.isFile())throw new LocalFsApiError(422,'TRASH_INVALID','回收站记录不是普通文件。');
    return {...record,filePath,document:await this.readAndValidateFile(filePath)};
  }

  async restoreTrash(rawId:string,expectedRevision:string,asCopy=false):Promise<{slug:string;document:ResumeDocument}> {
    if(typeof expectedRevision!=='string')throw new LocalFsApiError(428,'REVISION_REQUIRED','恢复前必须提供回收站记录版本。');
    await this.ensureResumeDir();
    return withResumeWriteLock(this.dataDir,async()=>{
      await checkWorkspaceDirectory(this.dataDir,this.resumesDir);
      const archived=await this.readTrash(rawId);
      assertExpectedRevision(archived.document,expectedRevision);
      let slug=archived.slug;
      if(asCopy){
        const reserved=await this.reservedTrashSlugs();
        const base=slug.slice(0,60)+'-restored';
        slug=base;
        let i=2;
        while(reserved.has(slug.toLowerCase())||await pathEntryExists(this.resolveResumePath(slug).filePath)){
          const tail='-'+i++;slug=base.slice(0,80-tail.length)+tail;
        }
        const now=new Date().toISOString();
        const doc=ResumeDocumentSchema.parse({...archived.document,id:crypto.randomUUID(),title:archived.document.title+'（恢复副本）',createdAt:now,updatedAt:now});
        await atomicWriteFile(this.resolveResumePath(slug).filePath,`${JSON.stringify(doc,null,2)}\n`);
        return {slug,document:doc};
      }
      const target=this.resolveResumePath(slug).filePath;
      if(await pathEntryExists(target))throw new LocalFsApiError(409,'RESTORE_CONFLICT','原版本标识已被占用，未覆盖现有文件。可另存恢复副本。');
      // Advance revision before moving back so old open editors cannot write using a pre-delete revision.
      const doc=await this.writeResume(archived.filePath,archived.document,archived.document);
      await fs.rename(archived.filePath,target);
      return {slug,document:doc};
    });
  }

  async purgeTrash(rawId:string,expectedRevision:string,confirmation:unknown):Promise<{deleted:true}> {
    if(confirmation!=='PERMANENT_DELETE'||typeof expectedRevision!=='string')throw new LocalFsApiError(400,'CONFIRMATION_REQUIRED','永久删除需要明确确认与记录版本。');
    return withResumeWriteLock(this.dataDir,async()=>{
      const archived=await this.readTrash(rawId);
      assertExpectedRevision(archived.document,expectedRevision);
      await fs.unlink(archived.filePath);
      // History, application snapshots and assets have independent lifetimes. Never purge them here.
      return {deleted:true};
    });
  }

  async saveAsset(input: { filename?: string; dataUrl: string }): Promise<{ filename: string; url: string }> {
    await checkWorkspaceDirectory(this.dataDir,this.assetsDir,true);
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
    const filename = assertSafeAssetName(`${rawBase}-${Date.now().toString(36)}-${randomUUID().slice(0,8)}.${ext}`);
    const targetPath = resolveContainedPath(this.assetsDir, filename);

    await withResumeWriteLock(this.dataDir,async()=>{
      await checkWorkspaceDirectory(this.dataDir,this.assetsDir);
      if(await pathEntryExists(targetPath))throw new LocalFsApiError(409,'ASSET_EXISTS','图片文件名已被占用，未覆盖。');
      await atomicWriteFile(targetPath,buffer);
    });
    return {
      filename,
      url: `/api/assets/${filename}`,
    };
  }

  async readAsset(rawFilename: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const filename = assertSafeAssetName(rawFilename);
    const targetPath = resolveContainedPath(this.assetsDir, filename);
    try{await checkWorkspaceFile(this.dataDir,targetPath);}
    catch(err){
      if(isMissing(err))throw new LocalFsApiError(404,'ASSET_NOT_FOUND','图片资源不存在。');
      throw err;
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

  /** Snapshot paths are independent of the active document. Never follow a
   * linked backup directory into another workspace. A missing directory is
   * normal for listing; only creation may make ordinary directories. */
  private async checkedSnapshotDir(rawSlug:string,create:boolean):Promise<{slug:string;dir:string}|null>{
    const target=this.resolveSnapshotDir(rawSlug);
    let root:string;
    try{root=await fs.realpath(this.dataDir);}catch(err){if(isMissing(err)&&!create)return null;throw err;}
    for(const p of [this.backupsDir,target.dir]){
      if(create)await fs.mkdir(p).catch(err=>{if((err as NodeJS.ErrnoException).code!=='EEXIST')throw err;});
      try{
        const st=await fs.lstat(p);
        const expected=path.join(root,path.relative(this.dataDir,p));
        if(!st.isDirectory()||st.isSymbolicLink()||path.relative(expected,await fs.realpath(p))!==''){
          throw new LocalFsApiError(422,'SNAPSHOT_UNSAFE','历史快照目录不安全，未读取、写入或清理。');
        }
      }catch(err){if(isMissing(err)&&!create)return null;throw err;}
    }
    const dir=await fs.realpath(target.dir);
    return {slug:path.basename(dir),dir};
  }

  /** The filename, directory and embedded metadata must identify the same
   * snapshot. Never use an unverified metadata ID as a deletion target. */
  private async readSnapshotRecord(slug:string,dir:string,id:string):Promise<{meta:ResumeSnapshotMeta;document:ResumeDocument}>{
    const file=resolveContainedPath(dir,id+'.json');
    try{
      const st=await fs.lstat(file);
      if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||path.relative(file,await fs.realpath(file))!=='')throw Error('not an independent ordinary file');
      const raw=JSON.parse(await fs.readFile(file,'utf8')) as {meta?:Partial<ResumeSnapshotMeta>;document?:unknown};
      const meta=raw?.meta;
      const sameSlug=typeof meta?.slug==='string'&&assertSafeSlug(meta.slug)===meta.slug&&
        (process.platform==='win32'?meta.slug.toLowerCase()===slug.toLowerCase():meta.slug===slug);
      if(!meta||meta.id!==id||!sameSlug||typeof meta.createdAt!=='string'||!Number.isFinite(Date.parse(meta.createdAt)))throw Error('metadata mismatch');
      const document=ResumeDocumentSchema.parse(raw.document);
      return {meta:{id,slug,createdAt:meta.createdAt,reason:typeof meta.reason==='string'?meta.reason:'自动快照',
        templateId:document.templateId,title:document.title,charCount:countDocumentChars(document)},document};
    }catch(err){
      if(isMissing(err))throw new LocalFsApiError(404,'SNAPSHOT_NOT_FOUND','历史快照不存在或已变化。');
      throw new LocalFsApiError(422,'SNAPSHOT_INVALID','历史快照文件损坏、标识不一致或路径不安全；原文件保留，未执行回滚。');
    }
  }

  async createSnapshot(
    rawSlug: string,
    reason = '手动创建快照',
    docOverride?: ResumeDocument,
    expectedRevision?: string,
  ): Promise<ResumeSnapshotMeta> {
    return withResumeWriteLock(this.dataDir,async()=>{
      if(expectedRevision!==undefined){
        const current=await this.readOptionalResume(this.resolveResumePath(rawSlug).filePath);
        assertExpectedRevision(current,expectedRevision);
        if(!current)throw new LocalFsApiError(409,'REVISION_CONFLICT','简历已不存在。');
        return this.createSnapshotUnlocked(rawSlug,reason,current);
      }
      return this.createSnapshotUnlocked(rawSlug,reason,docOverride);
    });
  }
  /** Bind a finished export to the original version identity under the write
   * lock. Later edits of that same document are allowed; a deleted or reused
   * slug must never receive another document's exported history. */
  async createExportSnapshot(rawSlug:string,reason:string,exported:ResumeDocument,redacted:boolean):Promise<ResumeSnapshotMeta>{
    return withResumeWriteLock(this.dataDir,async()=>{
      const current=await this.getResume(rawSlug);
      const frozen=ResumeDocumentSchema.parse(exported);
      if(current.id!==frozen.id)throw new LocalFsApiError(409,'DOCUMENT_ID_CONFLICT','导出所属版本已变化，未向另一份简历写入历史快照。');
      return this.createSnapshotUnlocked(rawSlug,reason,redacted?current:frozen);
    });
  }

  private async createSnapshotUnlocked(rawSlug:string,reason:string,docOverride?:ResumeDocument):Promise<ResumeSnapshotMeta>{
    const sourceDoc = docOverride
      ? ResumeDocumentSchema.parse(docOverride)
      : await this.getResume(rawSlug);
    const checked=await this.checkedSnapshotDir(rawSlug,true);
    if(!checked)throw new LocalFsApiError(422,'SNAPSHOT_UNSAFE','无法确认历史快照目录。');
    const {slug,dir}=checked;

    const createdAt = new Date().toISOString();
    const stamp = createdAt.replace(/[:.]/g, '-');
    const id = `${stamp}-${randomUUID()}`;
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
    if(await pathEntryExists(filePath))throw new LocalFsApiError(409,'SNAPSHOT_EXISTS','历史快照标识已占用，未覆盖。');
    await atomicWriteFile(
      filePath,
      `${JSON.stringify({ meta, document: sourceDoc }, null, 2)}\n`,
    );

    // Always retain the new verified record (including a pre-rollback backup).
    // A backwards wall-clock change or future-dated history must not erase it.
    const all = await this.listSnapshots(slug);
    if(!all.some(item=>item.id===id))throw new LocalFsApiError(500,'SNAPSHOT_UNVERIFIED','新快照未通过读回校验，未自动清理历史记录。');
    if (all.length > MAX_SNAPSHOTS_PER_RESUME) {
      const stale = all.filter(item=>item.id!==id).slice(MAX_SNAPSHOTS_PER_RESUME-1);
      await Promise.all(
        stale.map((item) =>
          fs.unlink(resolveContainedPath(dir, `${item.id}.json`)).catch(() => {}),
        ),
      );
    }

    return meta;
  }

  async listSnapshots(rawSlug:string):Promise<ResumeSnapshotMeta[]>{
    return (await this.listSnapshotInventory(rawSlug)).items;
  }

  async listSnapshotInventory(rawSlug:string):Promise<ResumeSnapshotInventory>{
    const checked=await this.checkedSnapshotDir(rawSlug,false);
    if(!checked)return {items:[],unreadableCount:0};
    const {slug,dir}=checked;
    const entries=await fs.readdir(dir,{withFileTypes:true});
    const items:ResumeSnapshotMeta[]=[];let unreadableCount=0;
    for(const entry of entries){
      if(!entry.name.endsWith('.json'))continue;
      const id=entry.name.slice(0,-5);
      try{
        if(!entry.isFile()||assertSafeSnapshotId(id)!==id){unreadableCount++;continue;}
        items.push((await this.readSnapshotRecord(slug,dir,id)).meta);
      }catch(err){
        // A corrupt/foreign record is preserved, never counted toward the
        // retention cap and never used as the target of automatic deletion.
        // A concurrently removed file is no longer an abnormal record.
        if(!(err instanceof LocalFsApiError&&err.code==='SNAPSHOT_NOT_FOUND'))unreadableCount++;
      }
    }
    items.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id));
    return {items,unreadableCount};
  }

  /** Read only; do not create directories, backups or restore state for comparison. */
  async getSnapshotForComparison(rawSlug:string,rawId:string):Promise<{meta:ResumeSnapshotMeta;document:ResumeDocument}>{
    if(typeof rawSlug!=='string'||typeof rawId!=='string')throw new LocalFsApiError(400,'INVALID_SNAPSHOT','无效的快照对照标识。');
    const slug=assertSafeSlug(rawSlug),id=assertSafeSnapshotId(rawId);
    if(slug!==rawSlug||id!==rawId)throw new LocalFsApiError(400,'INVALID_SNAPSHOT','只接受原始版本与快照标识，不接受路径或别名。');
    const checked=await this.checkedSnapshotDir(slug,false);
    if(!checked)throw new LocalFsApiError(404,'SNAPSHOT_NOT_FOUND','历史快照不存在。');
    const current=await this.getResume(slug);
    const record=await this.readSnapshotRecord(checked.slug,checked.dir,id);
    if(record.document.id!==current.id)throw new LocalFsApiError(409,'DOCUMENT_ID_CONFLICT','该历史快照属于另一份简历，未展示内容。');
    return record;
  }

  async restoreSnapshot(rawSlug:string,rawSnapshotId:string,expectedRevision?:string):Promise<ResumeDocument>{
    const snapshotId=assertSafeSnapshotId(rawSnapshotId);
    const {slug,filePath:targetPath}=this.resolveResumePath(rawSlug);
    return withResumeWriteLock(this.dataDir,async()=>{
      const checked=await this.checkedSnapshotDir(slug,false);
      if(!checked)throw new LocalFsApiError(404,'SNAPSHOT_NOT_FOUND','历史快照不存在。');
      const restoredDoc=(await this.readSnapshotRecord(checked.slug,checked.dir,snapshotId)).document;
      const current=await this.readOptionalResume(targetPath);
      if(!current)throw new LocalFsApiError(404,'NOT_FOUND','当前简历不存在，请通过回收站恢复原版本。');
      if(expectedRevision!==undefined)assertExpectedRevision(current,expectedRevision);
      if(current.id!==restoredDoc.id)throw new LocalFsApiError(409,'DOCUMENT_ID_CONFLICT','该历史快照属于另一份简历，未覆盖当前版本。');
      await this.createSnapshotUnlocked(slug,'回滚前自动备份',current);
      return this.writeResume(targetPath,restoredDoc,current);
    });
  }

  private applicationRevision(data:ApplicationsStoreData):string {
    const content={schemaVersion:data.schemaVersion,applications:data.applications,coverLetters:data.coverLetters,interviewAnswers:Object.fromEntries(Object.entries(data.interviewAnswers).sort(([a],[b])=>a.localeCompare(b))),jobReviews:data.jobReviews};
    return createHash('sha256').update(JSON.stringify(content)).digest('hex');
  }
  private async writeApplications(data:ApplicationsStoreData):Promise<ApplicationsStoreData>{
    const validated=ApplicationsStoreSchema.parse(data);
    const next={...validated,revision:this.applicationRevision(validated)};
    await atomicWriteFile(this.applicationsPath,JSON.stringify(next,null,2)+'\n');
    return next;
  }
  async getApplications(createRoot=true): Promise<ApplicationsStoreData> {
    if(createRoot)await fs.mkdir(this.dataDir,{recursive:true});
    let text:string;
    try{
      await checkWorkspaceFile(this.dataDir,this.applicationsPath);
      text=await fs.readFile(this.applicationsPath,'utf8');
    }
    catch(err){
      if(!isMissing(err))throw err;
      const empty:ApplicationsStoreData={schemaVersion:1,applications:[],coverLetters:[],interviewAnswers:{}};
      return {...empty,revision:this.applicationRevision(empty)};
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new LocalFsApiError(500, 'CORRUPTED_JSON', 'applications.json 解析失败。');
    }
    try {
      const data=ApplicationsStoreSchema.parse(raw);
      return {...data,revision:this.applicationRevision(data)};
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
    const resumeSlug = assertSafeSlug(input.resumeSlug);
    const parsedDoc = ResumeDocumentSchema.parse(input.document);
    const createdAt = new Date().toISOString();
    const rawId =
      input.snapshotId?.trim() ||
      `app-${createdAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
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
    return withResumeWriteLock(this.dataDir,()=>this.writeImmutableApplicationSnapshot(targetPath,record));
  }

  private async writeImmutableApplicationSnapshot(targetPath:string,record:ApplicationSnapshotRecord):Promise<ApplicationSnapshotMeta>{
    await checkWorkspaceDirectory(this.dataDir,this.appSnapshotsDir,true);
    try{await fs.lstat(targetPath);throw new LocalFsApiError(409,'SNAPSHOT_EXISTS','永久投递快照已存在，不允许覆盖。');}catch(err){if(!isMissing(err))throw err;}
    await atomicWriteFile(targetPath,JSON.stringify(record,null,2)+'\n');
    return record.meta;
  }

  /** Snapshot first, then ledger: a crash may leave an orphan, never a ledger pointing to a half-written snapshot.
   * Stable request/application id allows safe retries without duplicating snapshots or ledger entries.
   */
  async logApplication(input:ApplicationLogInput,trustedReceipt?:PdfArtifactReceipt):Promise<{entry:JobApplication;store:ApplicationsStoreData}>{
    const entry=JobApplicationSchema.parse(input.entry);
    const doc=ResumeDocumentSchema.parse(input.document);
    if(entry.pdfReceipt!==undefined||(!trustedReceipt&&input.pdfReceiptToken!==undefined))throw new LocalFsApiError(400,'PDF_RECEIPT_UNTRUSTED','PDF 凭证必须由桌面导出流程签发，不能直接提交哈希。');
    const receipt=trustedReceipt===undefined?undefined:PdfArtifactReceiptSchema.parse(trustedReceipt);
    if(receipt&&(!entry.exportedFilePath||receipt.documentSha256!==createHash('sha256').update(JSON.stringify(doc)).digest('hex')))throw new LocalFsApiError(409,'PDF_RECEIPT_MISMATCH','导出凭证与封存文档不一致。');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id)||!entry.company.trim())throw new LocalFsApiError(400,'INVALID_APPLICATION','投递记录标识或单位无效。');
    const snapshotId='app-'+entry.id;
    const candidate={...entry,snapshotId,...(receipt?{pdfReceipt:receipt}:{})};
    const resumeSlug=assertSafeSlug(entry.resumeSlug);
    return withResumeWriteLock(this.dataDir,async()=>{
      const current=await this.getApplications();
      const existing=current.applications.find(a=>a.id===entry.id);
      if(existing){
        if(existing.snapshotId!==snapshotId)throw new LocalFsApiError(409,'APPLICATION_EXISTS','投递标识已被其他记录使用。');
        const previous=await this.getApplicationSnapshot(snapshotId);
        if(JSON.stringify(previous.document)!==JSON.stringify(doc)||previous.meta.applicationId!==entry.id||previous.meta.exportedFilePath!==entry.exportedFilePath||previous.meta.resumeSlug!==resumeSlug||previous.meta.atsScore!==entry.atsScore||!samePdfReceipt(previous.meta.pdfReceipt,receipt)||!samePdfReceipt(existing.pdfReceipt,receipt))
          throw new LocalFsApiError(409,'APPLICATION_EXISTS','该请求已记入不同投递资料，不会重复写入。');
        return {entry:existing,store:current};
      }
      await checkWorkspaceDirectory(this.dataDir,this.appSnapshotsDir,true);
      const target=resolveContainedPath(this.appSnapshotsDir,snapshotId+'.json');
      const meta:ApplicationSnapshotMeta={id:snapshotId,applicationId:entry.id,resumeSlug,exportedFilePath:entry.exportedFilePath,createdAt:entry.updatedAt||new Date().toISOString(),title:doc.title,templateId:doc.templateId,atsScore:entry.atsScore,...(receipt?{pdfReceipt:receipt}:{})};
      if(await pathEntryExists(target)){
        const previous=await this.getApplicationSnapshot(snapshotId);
        if(JSON.stringify(previous.document)!==JSON.stringify(doc)||previous.meta.applicationId!==entry.id||previous.meta.resumeSlug!==resumeSlug||previous.meta.exportedFilePath!==entry.exportedFilePath||previous.meta.atsScore!==entry.atsScore||!samePdfReceipt(previous.meta.pdfReceipt,receipt))
          throw new LocalFsApiError(409,'SNAPSHOT_EXISTS','重试请求与已有永久快照不一致，未覆盖原快照。');
      }else await this.writeImmutableApplicationSnapshot(target,{meta,document:doc});
      const store=await this.writeApplications({...current,applications:[candidate,...current.applications]});
      return {entry:candidate,store};
    });
  }

  async getApplicationSnapshot(rawSnapshotId: string): Promise<ApplicationSnapshotRecord> {
    const id = assertSafeSnapshotId(rawSnapshotId);
    const targetPath = resolveContainedPath(this.appSnapshotsDir, `${id}.json`);
    try{await checkWorkspaceFile(this.dataDir,targetPath);}
    catch(err){
      if(isMissing(err))throw new LocalFsApiError(404,'SNAPSHOT_NOT_FOUND',`未找到永久投递快照: ${id}`);
      throw err;
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

  /** A permanent snapshot review is bound to a unique persisted ledger row and
   * its acknowledged revision. It does not restore, create or require the
   * original editable resume. Legacy standalone raw reads remain unchanged. */
  async getLinkedApplicationSnapshot(input:ApplicationSnapshotLink):Promise<ApplicationSnapshotRecord>{
    if(!input||typeof input!=='object'||Array.isArray(input)||
       typeof input.applicationId!=='string'||!input.applicationId.trim()||input.applicationId.length>200||
       typeof input.snapshotId!=='string'||input.snapshotId.length>125||
       typeof input.ledgerRevision!=='string'||!/^[a-f0-9]{64}$/.test(input.ledgerRevision)){
      throw new LocalFsApiError(400,'INVALID_APPLICATION_LINK','投递复盘关联标识或台账版本无效。');
    }
    const id=assertSafeSnapshotId(input.snapshotId);
    // A .json suffix in an already-persisted legacy link is supported; no
    // caller-chosen aliases, padding or case substitution of the record ID.
    if(input.snapshotId!==id&&input.snapshotId.slice(0,-5)!==id)throw new LocalFsApiError(400,'INVALID_APPLICATION_LINK','永久快照关联标识不规范。');
    const current=await this.getApplications(false);
    if(current.revision!==input.ledgerRevision)throw new LocalFsApiError(409,'APPLICATION_CONFLICT','磁盘投递台账已变化，请重新读取台账后复盘。');
    const matches=current.applications.filter(a=>a.id===input.applicationId);
    if(matches.length!==1||matches[0]!.snapshotId!==input.snapshotId||!matches[0]!.snapshotId){
      throw new LocalFsApiError(409,'APPLICATION_SNAPSHOT_LINK','投递记录不存在、重复或永久快照关联不一致，未读取原稿。');
    }
    const entry=matches[0]!;
    const slug=assertSafeSlug(entry.resumeSlug);
    if(slug!==entry.resumeSlug)throw new LocalFsApiError(422,'APPLICATION_SNAPSHOT_LINK','关联简历标识不规范，未读取原稿。');
    let record:ApplicationSnapshotRecord;
    try{record=await this.getApplicationSnapshot(id);}
    catch(err){if(err instanceof LocalFsApiError)throw err;throw new LocalFsApiError(422,'APPLICATION_SNAPSHOT_INVALID','永久快照损坏或结构无效，原文件保留，未显示原稿。');}
    const meta=record.meta,doc=record.document;
    if(!meta||meta.id!==id||meta.applicationId!==entry.id||meta.resumeSlug!==slug||
       meta.exportedFilePath!==entry.exportedFilePath||meta.atsScore!==entry.atsScore||!samePdfReceipt(meta.pdfReceipt,entry.pdfReceipt)||
       (entry.pdfReceipt!==undefined&&entry.pdfReceipt.documentSha256!==createHash('sha256').update(JSON.stringify(doc)).digest('hex'))||
       meta.title!==doc.title||meta.templateId!==doc.templateId||typeof meta.createdAt!=='string'||!Number.isFinite(Date.parse(meta.createdAt))){
      throw new LocalFsApiError(409,'APPLICATION_SNAPSHOT_LINK','永久快照与台账身份、导出关联或原稿元数据不一致，未显示原稿；请核对原件或备份。');
    }
    // A concurrent atomic ledger update must not make a stale association look
    // verified. This is a point-in-time check, not a filesystem transaction.
    const after=await this.getApplications(false);
    if(after.revision!==current.revision)throw new LocalFsApiError(409,'APPLICATION_CONFLICT','读取期间投递台账已变化，请重新读取台账后复盘。');
    return {meta:{id,applicationId:entry.id,resumeSlug:slug,exportedFilePath:entry.exportedFilePath,createdAt:meta.createdAt,title:doc.title,templateId:doc.templateId,atsScore:entry.atsScore,...(entry.pdfReceipt?{pdfReceipt:entry.pdfReceipt}:{})},document:doc};
  }

  async deleteApplicationSnapshot(rawSnapshotId: string): Promise<{ deleted: boolean }> {
    const id = assertSafeSnapshotId(rawSnapshotId);
    const targetPath = resolveContainedPath(this.appSnapshotsDir, `${id}.json`);
    return withResumeWriteLock(this.dataDir,async()=>{
      const current=await this.getApplications();
      // Compare the actual resolved filename, not unnormalized reference text.
      // Existing ledgers can contain the optional .json suffix; Windows also
      // treats case aliases as the same path. Protect every matching reference.
      const referencesTarget=(raw:string|null)=>{
        if(!raw)return false;
        try{return path.relative(targetPath,resolveContainedPath(this.appSnapshotsDir,assertSafeSnapshotId(raw)+'.json'))==='';}
        catch{return false;}
      };
      if(current.applications.some(a=>referencesTarget(a.snapshotId))||current.jobReviews?.some(a=>referencesTarget(a.snapshotId)))throw new LocalFsApiError(409,'SNAPSHOT_REFERENCED','永久快照仍被投递记录或岗位核对档案引用，不允许删除。');
      try{await checkWorkspaceFile(this.dataDir,targetPath);}
      catch(err){if(isMissing(err))return {deleted:false};throw err;}
      await fs.unlink(targetPath);return {deleted:true};
    });
  }

  async saveApplications(payload: unknown,expectedRevision?:string): Promise<ApplicationsStoreData> {
    let validated: ApplicationsStoreData;
    try {
      validated = ApplicationsStoreSchema.parse(payload);
    } catch (err) {
      const detail = err instanceof ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : '格式非法';
      throw new LocalFsApiError(422, 'VALIDATION_ERROR', `投递记录校验失败: ${detail}`);
    }
    return withResumeWriteLock(this.dataDir,async()=>{
      const current=await this.getApplications();
      if(typeof expectedRevision!=='string')throw new LocalFsApiError(428,'APPLICATION_REVISION_REQUIRED','投递台账保存需要已读取的版本标识。');
      if(current.revision!==expectedRevision)throw new LocalFsApiError(409,'APPLICATION_CONFLICT','投递台账已被其他操作更新；未覆盖磁盘。请备份草稿并重载。');
      const ids=new Set<string>();
      const letters=new Set<string>();
      for(const l of validated.coverLetters){if(letters.has(l.id))throw new LocalFsApiError(422,'DUPLICATE_LETTER','自荐信标识重复。');letters.add(l.id);}
      for(const a of validated.applications){
        if(ids.has(a.id))throw new LocalFsApiError(422,'DUPLICATE_APPLICATION','投递标识重复。');ids.add(a.id);
        const old=current.applications.find(x=>x.id===a.id);
        if(old&&(!samePdfReceipt(a.pdfReceipt,old.pdfReceipt)||a.snapshotId!==old.snapshotId||(old.snapshotId&&(a.resumeSlug!==old.resumeSlug||a.exportedFilePath!==old.exportedFilePath||a.atsScore!==old.atsScore||a.jdText!==old.jdText))))throw new LocalFsApiError(409,'SNAPSHOT_LINK_PROTECTED','已有永久快照关联、原岗位原文及导出信息不能通过整表保存修改。');
        if(!old&&a.pdfReceipt&&!a.snapshotId)throw new LocalFsApiError(409,'SNAPSHOT_LINK_PROTECTED','PDF 凭证不能添加到无永久快照的记录。');
        if(!old&&a.snapshotId){const snap=await this.getApplicationSnapshot(a.snapshotId);if(snap.meta.applicationId!==a.id||snap.meta.resumeSlug!==a.resumeSlug||!samePdfReceipt(snap.meta.pdfReceipt,a.pdfReceipt)||(a.pdfReceipt&&(snap.meta.exportedFilePath!==a.exportedFilePath||a.pdfReceipt.documentSha256!==createHash('sha256').update(JSON.stringify(snap.document)).digest('hex'))))throw new LocalFsApiError(409,'SNAPSHOT_LINK_PROTECTED','投递记录与永久快照身份不一致。');}
      }
      // Older clients omitting the optional field cannot silently erase local review archives.
      if(validated.jobReviews===undefined&&current.jobReviews!==undefined)validated={...validated,jobReviews:current.jobReviews};
      for(const archive of validated.jobReviews??[]){
        const old=current.jobReviews?.find(a=>a.id===archive.id);
        if(old){
          if(JSON.stringify(old)!==JSON.stringify(archive))throw new LocalFsApiError(409,'JOB_REVIEW_IMMUTABLE','已保存岗位核对档案不可覆盖，请另存新档案。');
          continue;
        }
        // The same data-directory write lock covers the resume, fact bank and application ledger.
        const doc=await this.getResume(archive.slug);
        const {FactBankStore}=await import('./factBankStore');
        const bank=archive.factRevision===null?null:await new FactBankStore(this).get();
        try{await restoreArchivedJobReview(archive,doc,bank,resumeRevision(doc));}
        catch(err){throw new LocalFsApiError(409,'JOB_REVIEW_STALE',err instanceof Error?err.message:'岗位核对依据无效。');}
        if(archive.applicationId!==null){
          const linked=validated.applications.find(a=>a.id===archive.applicationId);
          const persisted=current.applications.find(a=>a.id===archive.applicationId);
          if(!persisted||persisted.snapshotId!==archive.snapshotId||persisted.jdText!==archive.source||!linked||linked.snapshotId!==archive.snapshotId||linked.resumeSlug!==archive.slug||linked.jdText!==archive.source)
            throw new LocalFsApiError(409,'JOB_REVIEW_LINK','投递关联与原文或版本不一致。');
          const snap=await this.getApplicationSnapshot(linked.snapshotId);
          if(snap.meta.applicationId!==linked.id||snap.meta.resumeSlug!==archive.slug||!sameJobReviewDocument(snap.document,doc))
            throw new LocalFsApiError(409,'JOB_REVIEW_LINK','永久投递快照与核对版本内容不一致。');
        }
      }
      return this.writeApplications(validated);
    });
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

/** Historical resume data must only be returned to a local same-origin
 * browser development session. Native app uses trusted-editor IPC. */
function assertLocalSnapshotRead(req:IncomingMessage,res:ServerResponse,method:string):void {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  const host=req.headers.host??'',origin=req.headers.origin,site=req.headers['sec-fetch-site'];
  const localPeer=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'');
  const localHost=/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host);
  const scheme='encrypted' in req.socket&&req.socket.encrypted?'https:':'http:';
  let originMatches=true;
  if(origin!==undefined){try{const u=new URL(origin);originMatches=u.protocol===scheme&&u.host.toLowerCase()===host.toLowerCase()&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash;}catch{originMatches=false;}}
  if(!localPeer||!localHost||!originMatches||(site!==undefined&&site!=='same-origin'&&site!=='none'))throw new LocalFsApiError(403,'SNAPSHOT_LOCAL_ONLY','历史快照对照仅允许本地同源读取。');
  if(method!=='GET'){res.setHeader('Allow','GET');throw new LocalFsApiError(405,'METHOD_NOT_ALLOWED','历史快照对照只支持 GET，不执行任何写入。');}
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

      if(method==='GET'&&pathname==='/api/write-lock'){sendJson(res,200,await inspectResumeWriteLock(store.dataDir));return;}
      if(method==='POST'&&pathname==='/api/write-lock/recover'){
        const body=await readJsonBody(req) as {token:string;confirmation?:string};
        sendJson(res,200,await recoverResumeWriteLock(store.dataDir,body.token,body.confirmation));return;
      }
      if(method==='GET'&&pathname==='/api/trash'){
        sendJson(res,200,await store.listTrash());return;
      }
      if(method==='POST'&&pathname==='/api/trash/restore'){
        const body=(await readJsonBody(req)) as {id:string;expectedRevision:string;asCopy?:boolean};
        sendJson(res,200,await store.restoreTrash(body.id,body.expectedRevision,body.asCopy===true));return;
      }
      if(method==='POST'&&pathname==='/api/trash/purge'){
        const body=(await readJsonBody(req)) as {id:string;expectedRevision:string;confirmation?:string};
        sendJson(res,200,await store.purgeTrash(body.id,body.expectedRevision,body.confirmation));return;
      }

      if(method==='POST'&&pathname==='/api/applications/log'){sendJson(res,201,await store.logApplication(await readJsonBody(req) as ApplicationLogInput));return;}
      if (method === 'GET' && pathname === '/api/applications') {
        const data = await store.getApplications();
        sendJson(res, 200, data);
        return;
      }

      if (method === 'PUT' && pathname === '/api/applications') {
        const body = await readJsonBody(req);
        const revision=req.headers['if-match'];
        const saved = await store.saveApplications(body,typeof revision==='string'?revision:undefined);
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

      if(pathname==='/api/application-snapshot-review'){
        assertLocalSnapshotRead(req,res,method);
        const query=new URLSearchParams(rawUrl.includes('?')?rawUrl.slice(rawUrl.indexOf('?')+1):'');
        const keys=['applicationId','snapshotId','ledgerRevision'] as const;
        if([...query.keys()].length!==keys.length||keys.some(k=>query.getAll(k).length!==1))throw new LocalFsApiError(400,'INVALID_APPLICATION_LINK','投递复盘查询参数无效。');
        sendJson(res,200,await store.getLinkedApplicationSnapshot({applicationId:query.get('applicationId')!,snapshotId:query.get('snapshotId')!,ledgerRevision:query.get('ledgerRevision')!}));return;
      }

      if (pathname.startsWith('/api/application-snapshots/')) {
        const snapId = pathname.slice('/api/application-snapshots/'.length);
        if (method === 'GET') {
          assertLocalSnapshotRead(req,res,method);
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
        const inventoryMatch=/^([^/]+)\/snapshot-inventory$/.exec(tail);
        if(method==='GET'&&inventoryMatch?.[1]){
          sendJson(res,200,await store.listSnapshotInventory(inventoryMatch[1]));return;
        }
        const previewMatch=/^([^/]+)\/snapshot-preview\/([^/]+)$/.exec(tail);
        if(previewMatch?.[1]&&previewMatch?.[2]){
          assertLocalSnapshotRead(req,res,method);
          sendJson(res,200,await store.getSnapshotForComparison(previewMatch[1],previewMatch[2]));return;
        }
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
            const body = (await readJsonBody(req)) as { reason?: string; expectedRevision?: string };
            if (typeof body.expectedRevision !== 'string') throw new LocalFsApiError(428, 'REVISION_REQUIRED', '快照前必须提供已读取的版本标识。');
            const meta = await store.createSnapshot(slug, body.reason, undefined, body.expectedRevision);
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
          const result=await store.deleteResume(rawSlug, decodeURIComponent(expected));
          sendJson(res, 200, result);
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

  const hasMaster = await pathEntryExists(masterPath);
  const hasResume = await pathEntryExists(resumePath);

  if (!options.force && hasMaster && hasResume) {
    return { initialized: false, masterPath, resumePath };
  }

  // Explicit force still does not authorize replacing a linked file.
  if(options.force){
    if(hasMaster)await checkWorkspaceFile(dataDir,masterPath);
    if(hasResume)await checkWorkspaceFile(dataDir,resumePath);
  }

  if (!(await pathEntryExists(legacyFile))) {
    const existingList = await store.listResumes();
    if (existingList.master || existingList.resumes.length > 0 || existingList.issues?.length) {
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
