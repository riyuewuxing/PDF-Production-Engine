import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AddFactSchema,FactBankSchema,RevokeFactSchema,type FactBank,type FactRecord} from '../schema/factBankSchema';
import {resumeRevision} from '../schema/resumeSchema';
import {factEntityId} from '../lib/aiContext';
import {LocalFsApiError,withResumeWriteLock,type LocalResumeStore} from './localFsApi';

const MAX_BYTES=5*1024*1024;
/** Separate local-only data file. No attachment loading, AI write access or automatic import. */
export class FactBankStore {
  private readonly file:string;
  constructor(private readonly resumes:LocalResumeStore){
    this.file=path.join(resumes.dataDir,'.fact-bank-v1.json');
  }
  async get():Promise<FactBank>{
    let raw:string;
    try{
      const stat=await fs.lstat(this.file);
      if(!stat.isFile()||stat.size>MAX_BYTES)throw new Error('invalid fact bank');
      raw=await fs.readFile(this.file,'utf8');
    }catch(err){
      if((err as NodeJS.ErrnoException).code==='ENOENT')return {schemaVersion:1,revision:'empty-v1',records:[]};
      throw new LocalFsApiError(422,'FACT_BANK_READ','事实库无法读取，未覆盖原文件。');
    }
    try{
      if(Buffer.byteLength(raw)>MAX_BYTES)throw new Error('oversize');
      return FactBankSchema.parse(JSON.parse(raw));
    }catch{throw new LocalFsApiError(422,'FACT_BANK_INVALID','事实库损坏或格式不支持，未覆盖原文件。');}
  }
  private check(bank:FactBank,revision:string){
    if(bank.revision!==revision)throw new LocalFsApiError(409,'FACT_BANK_CONFLICT','事实库已被其他操作更新，请重新加载；未覆盖原记录。');
  }
  private async write(records:FactRecord[]):Promise<FactBank>{
    const bank=FactBankSchema.parse({schemaVersion:1,revision:randomUUID(),records});
    const data=JSON.stringify(bank,null,2)+'\n';
    if(Buffer.byteLength(data)>MAX_BYTES)throw new LocalFsApiError(422,'FACT_BANK_LIMIT','事实库达到容量限制。');
    const temp=this.file+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temp,data,{flag:'wx',mode:0o600});await fs.rename(temp,this.file);}
    finally{await fs.rm(temp,{force:true}).catch(()=>{});}
    return bank;
  }
  async add(raw:unknown):Promise<FactBank>{
    const input=AddFactSchema.parse(raw);
    return withResumeWriteLock(this.resumes.dataDir,async()=>{
      const bank=await this.get();this.check(bank,input.bankRevision);
      const doc=await this.resumes.getResume(input.slug);
      if(resumeRevision(doc)!==input.docRevision)throw new LocalFsApiError(409,'FACT_DOCUMENT_CONFLICT','关联简历已变化，请重新核对事实主体。');
      const entityId=factEntityId(doc,input.blockKey);
      if(!entityId)throw new LocalFsApiError(422,'FACT_TARGET_INVALID','只能关联唯一可见段落。');
      const record:FactRecord={...input.fact,id:randomUUID(),docId:doc.id,blockKey:input.blockKey,entityId,
        sourceScope:'manual',verifiedStatus:'user-confirmed',modifiedAt:new Date().toISOString()};
      return this.write([...bank.records,record]);
    });
  }
  async revoke(raw:unknown):Promise<FactBank>{
    const input=RevokeFactSchema.parse(raw);
    return withResumeWriteLock(this.resumes.dataDir,async()=>{
      const bank=await this.get();this.check(bank,input.bankRevision);
      const old=bank.records.find(r=>r.id===input.id);
      if(!old||old.verifiedStatus==='revoked')throw new LocalFsApiError(409,'FACT_NOT_ACTIVE','事实记录不存在或已撤销。');
      return this.write(bank.records.map(r=>r.id===input.id?{...r,verifiedStatus:'revoked',modifiedAt:new Date().toISOString()}:r));
    });
  }
}
