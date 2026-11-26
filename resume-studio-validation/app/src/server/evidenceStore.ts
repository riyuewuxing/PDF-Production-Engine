import {promises as fs,constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {AttachEvidenceSchema,DetachEvidenceSchema,EvidenceIndexSchema,EvidenceReadSchema,PurgeEvidenceSchema,MAX_EVIDENCE_FILE_BYTES,MAX_EVIDENCE_RECORDS,MAX_EVIDENCE_VAULT_BYTES,type EvidenceEntry,type EvidenceIndex,type EvidenceIntegrity,type EvidenceKind,type EvidenceVaultAudit} from '../schema/evidenceSchema';
import {resumeRevision} from '../schema/resumeSchema';
import {factEntityId} from '../lib/aiContext';
import {FactBankStore} from './factBankStore';
import {LocalFsApiError,withResumeWriteLock,type LocalResumeStore} from './localFsApi';

const MAX_INDEX_BYTES=1024*1024;
const MAX_SCAN_ENTRIES=1000;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const fail=(code:string,message:string)=>new LocalFsApiError(422,code,message);
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
/** Bounded read from a regular file. Never follow a symlink intentionally or read a device/pipe. */
async function readBounded(file:string,max:number):Promise<Buffer>{
  const before=await fs.lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>max)throw fail('EVIDENCE_FILE_INVALID','仅允许大小符合限制的普通文件。');
  const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const st=await handle.stat();
    if(!st.isFile()||st.size<1||st.size>max||st.dev!==before.dev||st.ino!==before.ino)throw fail('EVIDENCE_FILE_INVALID','文件已变化或不是普通文件。');
    const bytes=Buffer.alloc(st.size);
    let offset=0;
    while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)throw fail('EVIDENCE_FILE_CHANGED','读取时文件发生变化。');offset+=bytesRead;}
    const extra=Buffer.alloc(1),end=await handle.read(extra,0,1,offset),after=await handle.stat();
    if(end.bytesRead||after.size!==st.size||after.mtimeMs!==st.mtimeMs||after.ctimeMs!==st.ctimeMs)throw fail('EVIDENCE_FILE_CHANGED','读取时文件发生变化。');
    return bytes;
  }finally{await handle.close();}
}
/** Format sanity check, not a content authentication or malware scan. */
function validateKind(name:string,bytes:Buffer):EvidenceKind{
  const ext=path.extname(name).toLowerCase();
  if(ext==='.pdf'&&bytes.subarray(0,5).toString('ascii')==='%PDF-')return 'pdf';
  if(ext==='.png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if((ext==='.jpg'||ext==='.jpeg')&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
  if(ext==='.txt'){
    try{const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(value.trim()&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))return 'txt';}catch{/* unsupported */}
  }
  throw fail('EVIDENCE_TYPE','仅支持格式匹配的 PDF、PNG、JPG 或 UTF-8 文本文件。');
}
/** This vault is deliberately separate from resume assets, exports, model prompts and renderer file APIs. */
export class EvidenceStore{
  private readonly indexFile:string;
  private readonly vault:string;
  constructor(private readonly resumes:LocalResumeStore,private readonly facts=new FactBankStore(resumes)){
    this.indexFile=path.join(resumes.dataDir,'.evidence-index-v1.json');
    this.vault=path.join(resumes.dataDir,'.evidence-files-v1');
  }
  private async assertVault(create=false):Promise<void>{
    if(create)await fs.mkdir(this.vault,{recursive:true,mode:0o700});
    const stat=await fs.lstat(this.vault);
    const root=await fs.realpath(this.resumes.dataDir);
    if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(this.vault)!==path.join(root,'.evidence-files-v1'))throw fail('EVIDENCE_VAULT','本地证据目录不安全，拒绝读写。');
  }
  async get():Promise<EvidenceIndex>{
    let bytes:Buffer;
    try{bytes=await readBounded(this.indexFile,MAX_INDEX_BYTES);}
    catch(e){if(missing(e))return {schemaVersion:1,revision:'empty-v1',entries:[]};throw fail('EVIDENCE_INDEX_READ','证据索引无法读取，未覆盖原文件。');}
    try{return EvidenceIndexSchema.parse(JSON.parse(bytes.toString('utf8')));}
    catch{throw fail('EVIDENCE_INDEX_INVALID','证据索引损坏或格式不支持，未覆盖原文件。');}
  }
  private check(index:EvidenceIndex,revision:string){
    if(index.revision!==revision)throw new LocalFsApiError(409,'EVIDENCE_INDEX_CONFLICT','证据索引已变化，请刷新后重试。');
  }
  private async write(entries:EvidenceEntry[]):Promise<EvidenceIndex>{
    const index=EvidenceIndexSchema.parse({schemaVersion:1,revision:randomUUID(),entries});
    const bytes=Buffer.from(JSON.stringify(index,null,2)+'\n');
    if(bytes.length>MAX_INDEX_BYTES)throw fail('EVIDENCE_LIMIT','证据索引达到容量限制。');
    const temp=this.indexFile+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600});await fs.rename(temp,this.indexFile);}
    finally{await fs.rm(temp,{force:true}).catch(()=>{});}
    return index;
  }
  private fileFor(entry:EvidenceEntry){return path.join(this.vault,entry.id+'.'+entry.kind);}
  private async scanVault(){
    const files=new Map<string,{regular:boolean;size:number}>();
    let totalBytes=0,unsafeEntries=0;
    try{await this.assertVault();}
    catch(e){if(missing(e))return {exists:false,files,totalBytes,unsafeEntries};throw e;}
    const dir=await fs.opendir(this.vault);
    for await(const item of dir){
      if(files.size>=MAX_SCAN_ENTRIES)throw fail('EVIDENCE_LIMIT','证据目录项目过多，请在本地检查，未执行自动清理。');
      const info=await fs.lstat(path.join(this.vault,item.name));
      const regular=info.isFile()&&!info.isSymbolicLink();
      files.set(item.name,{regular,size:regular?info.size:0});
      if(regular)totalBytes+=info.size;else unsafeEntries++;
    }
    return {exists:true,files,totalBytes,unsafeEntries};
  }
  async audit():Promise<EvidenceVaultAudit>{
    return withResumeWriteLock(this.resumes.dataDir,async()=>{
      const index=await this.get(),scan=await this.scanVault();
      const known=new Set(index.entries.map(e=>path.basename(this.fileFor(e))));
      let missingCopies=0,sizeMismatches=0,purgedResiduals=0;
      for(const e of index.entries){
        const found=scan.files.get(path.basename(this.fileFor(e)));
        if(e.status==='purged'){if(found)purgedResiduals++;continue;}
        if(!found)missingCopies++;
        else if(found.regular&&found.size!==e.size)sizeMismatches++;
      }
      return {checkedAt:new Date().toISOString(),exists:scan.exists,totalBytes:scan.totalBytes,
        regularFiles:[...scan.files.values()].filter(e=>e.regular).length,missingCopies,sizeMismatches,
        unsafeEntries:scan.unsafeEntries,unindexedFiles:[...scan.files.entries()].filter(([name,e])=>e.regular&&!known.has(name)).length,purgedResiduals};
    });
  }
  /** Explicitly open the validated managed directory; no renderer-provided path. */
  async vaultPath():Promise<string>{await this.assertVault();return this.vault;}
  private async basis(raw:unknown){
    const input=AttachEvidenceSchema.parse(raw),index=await this.get();this.check(index,input.indexRevision);
    const bank=await this.facts.get(),doc=await this.resumes.getResume(input.slug);
    if(bank.revision!==input.bankRevision||resumeRevision(doc)!==input.docRevision)throw new LocalFsApiError(409,'EVIDENCE_FACT_CONFLICT','事实库或当前简历已变化，请刷新后重新核对。');
    const fact=bank.records.find(r=>r.id===input.factId);
    if(!fact||fact.sourceScope!=='manual'||fact.verifiedStatus!=='user-confirmed'||fact.docId!==doc.id||factEntityId(doc,fact.blockKey)!==fact.entityId)
      throw fail('EVIDENCE_FACT_INVALID','只能为当前有效原始事实关联本地附件。');
    if(index.entries.length>=MAX_EVIDENCE_RECORDS)throw fail('EVIDENCE_LIMIT','证据索引已达到记录上限。');
    return {input,index,fact};
  }
  /** Before opening the dialog, and again when the selected file is committed. */
  async assertAttachAllowed(raw:unknown):Promise<void>{await this.basis(raw);}
  async attachSelectedFile(raw:unknown,selectedPath:string):Promise<EvidenceIndex>{
    // The file path comes only from the native file picker, never from renderer IPC input.
    const name=path.basename(selectedPath).replace(/[\x00-\x1f\x7f]/g,'_').slice(0,255);
    const bytes=await readBounded(selectedPath,MAX_EVIDENCE_FILE_BYTES);
    const kind=validateKind(selectedPath,bytes),sha256=hash(bytes);
    return withResumeWriteLock(this.resumes.dataDir,async()=>{
      const {input,index,fact}=await this.basis(raw);
      if(index.entries.some(e=>e.factId===fact.id&&e.sha256===sha256&&e.status==='attached'))throw fail('EVIDENCE_DUPLICATE','该事实已关联相同内容的附件。');
      await this.assertVault(true);
      const scan=await this.scanVault();
      if(scan.unsafeEntries)throw fail('EVIDENCE_VAULT','证据目录含异常项目，请在本地检查。');
      if(scan.totalBytes+bytes.length>MAX_EVIDENCE_VAULT_BYTES)throw fail('EVIDENCE_LIMIT','证据目录达到 200 MB 上限。');
      const now=new Date().toISOString(),entry:EvidenceEntry={id:randomUUID(),factId:fact.id,docId:fact.docId,originalName:name,kind,size:bytes.length,sha256,note:input.note,createdAt:now,changedAt:now,status:'attached'};
      const dest=this.fileFor(entry);
      const handle=await fs.open(dest,'wx',0o600);
      try{
        try{await handle.writeFile(bytes);}finally{await handle.close();}
        return await this.write([...index.entries,entry]);
      }catch(e){await fs.rm(dest,{force:true}).catch(()=>{});throw e;}
    });
  }
  private async find(raw:unknown){
    const input=EvidenceReadSchema.parse(raw),index=await this.get();this.check(index,input.indexRevision);
    const entry=index.entries.find(e=>e.id===input.id);
    if(!entry)throw fail('EVIDENCE_UNKNOWN','证据记录不存在。');
    return {entry,index};
  }
  private async integrity(entry:EvidenceEntry):Promise<EvidenceIntegrity>{
    const checkedAt=new Date().toISOString();let state:EvidenceIntegrity['state']='unreadable';
    if(entry.status==='purged')return {id:entry.id,state:'purged',checkedAt};
    try{
      await this.assertVault();
      const file=this.fileFor(entry),st=await fs.lstat(file);
      if(st.isFile()&&!st.isSymbolicLink()){
        if(st.size!==entry.size)state='changed';
        else state=hash(await readBounded(file,MAX_EVIDENCE_FILE_BYTES))===entry.sha256?'intact':'changed';
      }
    }catch(e){if(missing(e))state='missing';}
    return {id:entry.id,state,checkedAt};
  }
  async verify(raw:unknown):Promise<EvidenceIntegrity>{const {entry}=await this.find(raw);return this.integrity(entry);}
  /** No arbitrary file path accepted; reveal only an intact managed file. */
  async revealPath(raw:unknown):Promise<string>{
    const {entry}=await this.find(raw);
    if((await this.integrity(entry)).state!=='intact')throw fail('EVIDENCE_INTEGRITY','副本缺失、已变化或不可读，不能定位。');
    return this.fileFor(entry);
  }
  async detach(raw:unknown):Promise<EvidenceIndex>{
    const input=DetachEvidenceSchema.parse(raw);
    return withResumeWriteLock(this.resumes.dataDir,async()=>{
      const {entry,index}=await this.find({id:input.id,indexRevision:input.indexRevision});
      if(entry.status!=='attached')throw fail('EVIDENCE_STATUS','只能解除有效附件关联。');
      return this.write(index.entries.map(e=>e.id===entry.id?{...e,status:'detached',changedAt:new Date().toISOString()}:e));
    });
  }
  /** Explicit deletion of the managed copy only; retain a historical index entry. */
  async purge(raw:unknown):Promise<EvidenceIndex>{
    const input=PurgeEvidenceSchema.parse(raw);
    return withResumeWriteLock(this.resumes.dataDir,async()=>{
      const {entry,index}=await this.find({id:input.id,indexRevision:input.indexRevision});
      if(entry.status!=='detached')throw fail('EVIDENCE_STATUS','请先解除附件关联，再明确删除本地副本。');
      const file=this.fileFor(entry);
      try{
        await this.assertVault();
        const st=await fs.lstat(file);
        if(!st.isFile()||st.isSymbolicLink())throw fail('EVIDENCE_FILE_INVALID','副本不是普通文件，拒绝自动删除。');
        await fs.unlink(file);
      }catch(e){if(!missing(e))throw e;}
      // If index write fails after deletion, status remains detached and verification reports missing; retry is safe.
      return this.write(index.entries.map(e=>e.id===entry.id?{...e,status:'purged',changedAt:new Date().toISOString()}:e));
    });
  }
}
