import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {BACKUP_PREFIX,RESTORE_PREFIX,BACKUP_MANIFEST,MAX_BACKUP_FILES,MAX_BACKUP_FILE_BYTES,MAX_BACKUP_BYTES,WorkspaceBackupManifestSchema,managedBackupPath,type BackupFile,type BackupSummary,type WorkspaceBackupManifest} from '../schema/workspaceBackupSchema';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
import {ApplicationsStoreSchema,type ApplicationsStoreData} from '../schema/applicationSchema';
import {FactBankSchema} from '../schema/factBankSchema';
import {EvidenceIndexSchema,type EvidenceIndex} from '../schema/evidenceSchema';
import {withResumeWriteLock} from './localFsApi';

const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const missing=(e:unknown)=>(e as NodeJS.ErrnoException)?.code==='ENOENT';
const sort=(a:BackupFile,b:BackupFile)=>a.path<b.path?-1:a.path>b.path?1:0;
const dirs=new Set(['resumes','assets','.backups','.trash','.application-snapshots','.evidence-files-v1']);
function check(signal:AbortSignal){if(signal.aborted)throw new Error('工作区备份操作已取消或超时；未确认完成。');}
function inside(parent:string,child:string){const rel=path.relative(parent,child);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
async function actualDirectory(p:string){
  const info=await fs.lstat(p);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('拒绝非普通目录或符号链接。');
  return fs.realpath(p);
}
async function ordinaryChild(root:string,relative:string,isDir:boolean){
  const full=path.join(root,...relative.split('/')),st=await fs.lstat(full);
  if(st.isSymbolicLink()||(isDir?!st.isDirectory():!st.isFile())||(!isDir&&st.nlink>1)||await fs.realpath(full)!==full)throw new Error('备份路径不安全：'+relative);
  return {full,st};
}
async function readBounded(root:string,relative:string,max:number,signal:AbortSignal){
  check(signal);
  const {full,st}=await ordinaryChild(root,relative,false);
  if(st.size<=0||st.size>max)throw new Error('备份文件为空或超限：'+relative);
  const handle=await fs.open(full,'r');
  try{
    const before=await handle.stat();
    if(before.dev!==st.dev||before.ino!==st.ino||before.size!==st.size||!before.isFile())throw new Error('文件在读取时发生变化：'+relative);
    const data=Buffer.alloc(before.size);let pos=0;
    while(pos<data.length){
      check(signal);const {bytesRead}=await handle.read(data,pos,Math.min(1024*1024,data.length-pos),pos);
      if(!bytesRead)throw new Error('备份文件读取不完整：'+relative);
      pos+=bytesRead;
    }
    const after=await handle.stat(),current=await fs.lstat(full);
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||current.ino!==before.ino||current.dev!==before.dev||current.mtimeMs!==before.mtimeMs||current.size!==before.size)throw new Error('文件在读取期间发生变化：'+relative);
    return data;
  }finally{await handle.close();}
}
function omitted(relative:string):boolean{
  const p=relative.split('/');
  if(p.length===1&&['.resume-write-lock','.resume-lock-recovery','.lock-recovery-history','.ai-settings.json'].includes(relative))return true;
  return /(?:^|\/)(?:Thumbs\.db|\.DS_Store)$/.test(relative)||/\.json\.[a-zA-Z0-9.-]+\.tmp$/.test(relative)||/\.(png|jpe?g|webp|pdf|txt)\.[a-zA-Z0-9.-]+\.tmp$/i.test(relative);
}
async function scan(root:string,source:boolean,signal:AbortSignal):Promise<string[]>{
  const result:string[]=[],folded=new Set<string>();let entries=0,bytes=0;
  async function walk(dir:string){
    check(signal);
    const full=dir?path.join(root,...dir.split('/')):root;
    const iterator=await fs.opendir(full);
    for await(const item of iterator){
      check(signal);if(++entries>MAX_BACKUP_FILES*2)throw new Error('工作区项目数量超限。');
      const rel=dir?dir+'/'+item.name:item.name;
      if(source&&omitted(rel))continue;
      if(item.isDirectory()&&!item.isSymbolicLink()){
        if(!(dirs.has(rel)||/^\.backups\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(rel)))throw new Error('存在未识别的数据目录，未静默忽略：'+rel);
        await ordinaryChild(root,rel,true);await walk(rel);continue;
      }
      if(!managedBackupPath(rel)||!item.isFile()||item.isSymbolicLink())throw new Error('存在未识别或不安全的数据文件：'+rel);
      const {st}=await ordinaryChild(root,rel,false);bytes+=st.size;
      if(st.size<=0||st.size>MAX_BACKUP_FILE_BYTES||bytes>MAX_BACKUP_BYTES||result.length>=MAX_BACKUP_FILES)throw new Error('工作区备份容量超限或文件为空。');
      if(folded.has(rel.toLowerCase()))throw new Error('工作区路径大小写冲突。');
      folded.add(rel.toLowerCase());result.push(rel);
    }
  }
  await walk('');return result.sort();
}
function parseJson(bytes:Buffer){return JSON.parse(bytes.toString('utf8')) as unknown;}
function validateFile(relative:string,bytes:Buffer){
  if(relative==='master.json'||relative.startsWith('resumes/')||relative.startsWith('.trash/'))ResumeDocumentSchema.parse(parseJson(bytes));
  else if(relative==='applications.json')ApplicationsStoreSchema.parse(parseJson(bytes));
  else if(relative==='.fact-bank-v1.json')FactBankSchema.parse(parseJson(bytes));
  else if(relative==='.evidence-index-v1.json')EvidenceIndexSchema.parse(parseJson(bytes));
  else if(relative.startsWith('.backups/')||relative.startsWith('.application-snapshots/')){
    const record=parseJson(bytes) as {meta?:{id?:string;slug?:string;resumeSlug?:string};document?:unknown};
    ResumeDocumentSchema.parse(record.document);
    const parts=relative.split('/'),id=parts.at(-1)!.slice(0,-5);
    if(!record.meta||record.meta.id!==id||(relative.startsWith('.backups/')&&record.meta.slug!==parts[1]))throw new Error('快照元数据与文件名不一致：'+relative);
  }
}
async function writeDurable(target:string,data:Buffer|string,signal:AbortSignal){
  check(signal);
  const handle=await fs.open(target,'wx',0o600);
  try{await handle.writeFile(data);check(signal);await handle.sync();check(signal);}
  finally{await handle.close();}
}
async function copyVerified(dataRoot:string,destination:string,files:readonly BackupFile[],signal:AbortSignal){
  for(const entry of files){
    const bytes=await readBounded(dataRoot,entry.path,MAX_BACKUP_FILE_BYTES,signal);
    if(bytes.length!==entry.size||hash(bytes)!==entry.sha256)throw new Error('备份文件内容变化或损坏：'+entry.path);
    const target=path.join(destination,...entry.path.split('/'));
    await fs.mkdir(path.dirname(target),{recursive:true});
    await writeDurable(target,bytes,signal);
  }
}
async function verifyFiles(root:string,manifest:WorkspaceBackupManifest,source:boolean,signal:AbortSignal):Promise<BackupSummary>{
  const paths=await scan(root,source,signal),expected=manifest.files.map(f=>f.path).sort();
  if(JSON.stringify(paths)!==JSON.stringify(expected))throw new Error('文件清单与备份内容不一致（缺失、额外或未识别文件）。');
  const warnings:string[]=[],counts:Record<string,number>={};let ledger:ApplicationsStoreData|undefined,index:EvidenceIndex|undefined;
  for(const entry of manifest.files){
    const bytes=await readBounded(root,entry.path,MAX_BACKUP_FILE_BYTES,signal);
    if(bytes.length!==entry.size||hash(bytes)!==entry.sha256)throw new Error('文件 SHA-256 或大小校验失败：'+entry.path);
    validateFile(entry.path,bytes);
    if(entry.path==='applications.json')ledger=ApplicationsStoreSchema.parse(parseJson(bytes));
    if(entry.path==='.evidence-index-v1.json')index=EvidenceIndexSchema.parse(parseJson(bytes));
    const group=entry.path.split('/')[0]!;counts[group]=(counts[group]??0)+1;
  }
  const byPath=new Map(manifest.files.map(f=>[f.path,f]));
  for(const id of new Set([...(ledger?.applications??[]).map(a=>a.snapshotId),...(ledger?.jobReviews??[]).map(a=>a.snapshotId)].filter(Boolean))){
    if(!byPath.has('.application-snapshots/'+id+'.json'))warnings.push('原数据已有缺失的永久投递快照：'+id);
  }
  const knownEvidence=new Set((index?.entries??[]).map(e=>'.evidence-files-v1/'+e.id+'.'+e.kind));
  const orphanCount=manifest.files.filter(f=>f.path.startsWith('.evidence-files-v1/')&&!knownEvidence.has(f.path)).length;
  if(orphanCount)warnings.push('原数据已有 '+orphanCount+' 个无索引证据附件，保留字节但无法确认关联。');
  for(const e of index?.entries??[]){
    const file=byPath.get('.evidence-files-v1/'+e.id+'.'+e.kind);
    if(e.status!=='purged'&&(!file||file.sha256!==e.sha256||file.size!==e.size))warnings.push('原数据已有缺失或异常的证据附件：'+e.id);
    if(e.status==='purged'&&file)warnings.push('原数据仍保留已标记清除的附件：'+e.id);
  }
  if(warnings.length>100)warnings.splice(100,warnings.length-100,'其余原数据异常未逐项展示。');
  return {createdAt:manifest.createdAt,fileCount:manifest.files.length,totalBytes:manifest.files.reduce((n,f)=>n+f.size,0),counts,warnings};
}
async function safeParent(parent:string,protectedRoots:string[]){
  const actual=await actualDirectory(parent);
  for(const root of protectedRoots){
    const real=await fs.realpath(root);
    if(inside(real,actual))throw new Error('请选择当前工作区及备份目录之外的目标文件夹。');
  }
  return actual;
}
async function publishFolder(parent:string,prefix:string,work:(folder:string)=>Promise<void>){
  const stage=await fs.mkdtemp(path.join(parent,'.resume-studio-incomplete-'));
  const final=path.join(parent,prefix+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
  try{
    await work(stage);
    try{await fs.lstat(final);throw new Error('目标文件夹已存在，未覆盖。');}catch(e){if(!missing(e))throw e;}
    await fs.rename(stage,final);return final;
  }catch(e){await fs.rm(stage,{recursive:true,force:true}).catch(()=>{});throw e;}
}
export async function createWorkspaceBackup(workspace:string,parent:string,signal:AbortSignal){
  const root=await actualDirectory(workspace),data=await actualDirectory(path.join(root,'data')),target=await safeParent(parent,[root]);
  if(data!==path.join(root,'data'))throw new Error('数据目录不是工作区内的普通目录。');
  return withResumeWriteLock(data,async()=>{
    check(signal);const names=await scan(data,true,signal);const files:BackupFile[]=[];
    let manifest:WorkspaceBackupManifest|undefined,summary:BackupSummary|undefined;
    const folder=await publishFolder(target,BACKUP_PREFIX,async stage=>{
      const dest=path.join(stage,'data');await fs.mkdir(dest);
      for(const relative of names){
        const bytes=await readBounded(data,relative,MAX_BACKUP_FILE_BYTES,signal);
        validateFile(relative,bytes);
        files.push({path:relative,size:bytes.length,sha256:hash(bytes)});
        const out=path.join(dest,...relative.split('/'));await fs.mkdir(path.dirname(out),{recursive:true});await writeDurable(out,bytes,signal);
      }
      manifest=WorkspaceBackupManifestSchema.parse({format:'resume-studio-workspace',version:1,createdAt:new Date().toISOString(),files:files.sort(sort)});
      // Check source again under the same application write lock; external edits are detected when observable.
      await verifyFiles(data,manifest,true,signal);
      summary=await verifyFiles(dest,manifest,false,signal);
      await writeDurable(path.join(stage,BACKUP_MANIFEST),JSON.stringify(manifest,null,2)+'\n',signal);
      const staged=await inspectWorkspaceBackup(stage,signal);
      if(JSON.stringify(staged.manifest)!==JSON.stringify(manifest))throw new Error('写入后的备份清单复核失败。');
      check(signal);
    });
    if(!summary)throw new Error('未确认备份完成。');
    return {...summary as BackupSummary,folder};
  });
}
export async function inspectWorkspaceBackup(folder:string,signal:AbortSignal){
  const root=await actualDirectory(folder);
  const children=(await fs.readdir(root)).sort();
  if(JSON.stringify(children)!==JSON.stringify([BACKUP_MANIFEST,'data'].sort()))throw new Error('请选择完整备份文件夹（包含清单与 data）。');
  const bytes=await readBounded(root,BACKUP_MANIFEST,4*1024*1024,signal);
  const manifest=WorkspaceBackupManifestSchema.parse(parseJson(bytes));
  const data=await actualDirectory(path.join(root,'data'));
  if(data!==path.join(root,'data'))throw new Error('备份数据目录不安全。');
  const summary=await verifyFiles(data,manifest,false,signal);
  return {root,manifest,manifestHash:hash(bytes),summary};
}
export async function restoreWorkspaceBackup(workspace:string,backupFolder:string,expectedManifestHash:string,parent:string,signal:AbortSignal){
  const checked=await inspectWorkspaceBackup(backupFolder,signal);
  if(checked.manifestHash!==expectedManifestHash)throw new Error('备份清单已变化，请重新检查。');
  const target=await safeParent(parent,[workspace,checked.root]);
  const folder=await publishFolder(target,RESTORE_PREFIX,async stage=>{
    const data=path.join(stage,'data');await fs.mkdir(data);
    await copyVerified(path.join(checked.root,'data'),data,checked.manifest.files,signal);
    await verifyFiles(data,checked.manifest,false,signal);
    // A second inventory/digest check rejects source changes during restoration.
    const after=await inspectWorkspaceBackup(checked.root,signal);
    if(after.manifestHash!==expectedManifestHash)throw new Error('恢复期间备份已变化。');
    check(signal);
  });
  return {...checked.summary,folder};
}
