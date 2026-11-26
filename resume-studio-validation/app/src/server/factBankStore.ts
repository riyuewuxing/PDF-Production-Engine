import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AddFactSchema,FactBankSchema,RevokeFactSchema,LinkFactSchema,FactRequestBindingSchema,type FactBank,type FactRecord} from '../schema/factBankSchema';
import {resumeRevision} from '../schema/resumeSchema';
import {collectEditableBlocks} from '../lib/resumeBlocks';
import {factEntityId,isShareableFact} from '../lib/aiContext';
import {assertBoundFactPrompt} from '../lib/factPromptGate';
import {assertLinkedFactOrigin,canLinkFactToDocument,isLinkedPrivacyCompatible} from '../lib/factLink';
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
  /** Last main-process gate before external transport. Does not hold a file lock over network I/O. */
  async assertCurrentBinding(raw:unknown,userPrompt:string):Promise<void>{
    const binding=FactRequestBindingSchema.parse(raw);
    await withResumeWriteLock(this.resumes.dataDir,async()=>{
      const bank=await this.get();this.check(bank,binding.bankRevision);
      const doc=await this.resumes.getResume(binding.slug);
      const records=binding.ids.map(id=>bank.records.find(r=>r.id===id));
      if(doc.id!==binding.docId||!records.every(r=>r!==undefined&&isShareableFact(doc,r)))
        throw new LocalFsApiError(409,'FACT_BINDING_CONFLICT','事实主体、敏感级别或授权状态已变化，拒绝发送。');
      for(const r of records as FactRecord[])await assertLinkedFactOrigin(bank,doc,r,slug=>this.resumes.getResume(slug));
      const master=binding.masterRevision?await this.resumes.getResume('master'):null;
      if(master&&resumeRevision(master)!==binding.masterRevision)throw new LocalFsApiError(409,'FACT_MASTER_CONFLICT','参考母库已变化，请重新预览。');
      assertBoundFactPrompt(doc,binding,records as FactRecord[],userPrompt,master);
    });
  }
  async add(raw:unknown):Promise<FactBank>{
    const input=AddFactSchema.parse(raw);
    return withResumeWriteLock(this.resumes.dataDir,async()=>{
      const bank=await this.get();this.check(bank,input.bankRevision);
      const doc=await this.resumes.getResume(input.slug);
      if(resumeRevision(doc)!==input.docRevision)throw new LocalFsApiError(409,'FACT_DOCUMENT_CONFLICT','关联简历已变化，请重新核对事实主体。');
      const entityId=factEntityId(doc,input.blockKey);
      if(!entityId)throw new LocalFsApiError(422,'FACT_TARGET_INVALID','只能关联唯一可见段落。');
      const old=input.supersedesId?bank.records.find(r=>r.id===input.supersedesId):undefined;
      if(input.supersedesId&&(!old||old.sourceScope==='linked'||old.verifiedStatus!=='user-confirmed'||old.docId!==doc.id||old.blockKey!==input.blockKey||old.entityId!==entityId))
        throw new LocalFsApiError(409,'FACT_CORRECTION_CONFLICT','原事实已撤销或关联主体已变化，不能直接更正。');
      const modifiedAt=new Date().toISOString();
      const block=collectEditableBlocks(doc).find(b=>b.key===input.blockKey);
      const record:FactRecord={...input.fact,id:randomUUID(),docId:doc.id,blockKey:input.blockKey,entityId,
        documentTitle:doc.title.slice(0,500),blockLabel:block?.label.slice(0,1000),
        sourceScope:'manual',verifiedStatus:'user-confirmed',modifiedAt,...(old?{supersedesId:old.id}:{})};
      return this.write([...this.revokeFamily(bank.records,old?.id,modifiedAt),record]);
    });
  }
  private revokeFamily(records:readonly FactRecord[],id:string|undefined,modifiedAt:string):FactRecord[]{
    return records.map(r=>id&&r.verifiedStatus!=='revoked'&&(r.id===id||r.linkedFrom?.recordId===id)?{...r,verifiedStatus:'revoked' as const,modifiedAt}:r);
  }
  async link(raw:unknown):Promise<FactBank>{
    const input=LinkFactSchema.parse(raw);
    return withResumeWriteLock(this.resumes.dataDir,async()=>{
      const bank=await this.get();this.check(bank,input.bankRevision);
      const target=await this.resumes.getResume(input.slug);
      if(resumeRevision(target)!==input.docRevision)throw new LocalFsApiError(409,'FACT_DOCUMENT_CONFLICT','当前简历已变化，请重新核对关联主体。');
      const root=bank.records.find(r=>r.id===input.sourceId);
      if(!root||!canLinkFactToDocument(target,root))throw new LocalFsApiError(422,'FACT_LINK_ENTITY','仅可关联其他版本中同一稳定段落且主体、时间完全匹配的有效手工事实。');
      if(bank.records.some(r=>r.linkedFrom?.recordId===root.id&&r.docId===target.id&&r.verifiedStatus==='user-confirmed'))
        throw new LocalFsApiError(409,'FACT_LINK_DUPLICATE','当前版本已有关联记录。');
      const list=await this.resumes.listResumes();
      const matches=[list.master,...list.resumes].filter(s=>s?.id===root.docId);
      const summary=matches[0];
      if(matches.length!==1||!summary)throw new LocalFsApiError(409,'FACT_LINK_ORIGIN','来源版本不存在或不唯一，不能建立关联。');
      const source=await this.resumes.getResume(summary.slug);
      if(source.id!==root.docId||factEntityId(source,root.blockKey)!==root.entityId)throw new LocalFsApiError(409,'FACT_LINK_ORIGIN','来源版本主体已变化，不能建立关联。');
      if(input.sensitivity==='shareable'&&(root.sensitivity!=='shareable'||!isLinkedPrivacyCompatible(target,source,root)))
        throw new LocalFsApiError(422,'FACT_LINK_PRIVACY','来源仅限本地或包含其他版本隐私标识，不能提升外发权限。');
      const block=collectEditableBlocks(target).find(b=>b.key===root.blockKey);
      const entityId=factEntityId(target,root.blockKey);
      if(!block||!entityId)throw new LocalFsApiError(422,'FACT_LINK_ENTITY','当前段落不可关联。');
      const record:FactRecord={id:randomUUID(),docId:target.id,blockKey:root.blockKey,entityId,documentTitle:target.title.slice(0,500),blockLabel:block.label.slice(0,1000),
        kind:root.kind,assertion:root.assertion,value:root.value,unit:root.unit,timeframe:root.timeframe,evidenceRef:root.evidenceRef,
        sensitivity:input.sensitivity,sourceScope:'linked',linkedFrom:{recordId:root.id,slug:summary.slug},verifiedStatus:'user-confirmed',modifiedAt:new Date().toISOString()};
      return this.write([...bank.records,record]);
    });
  }
  async revoke(raw:unknown):Promise<FactBank>{
    const input=RevokeFactSchema.parse(raw);
    return withResumeWriteLock(this.resumes.dataDir,async()=>{
      const bank=await this.get();this.check(bank,input.bankRevision);
      const old=bank.records.find(r=>r.id===input.id);
      if(!old||old.verifiedStatus==='revoked')throw new LocalFsApiError(409,'FACT_NOT_ACTIVE','事实记录不存在或已撤销。');
      return this.write(this.revokeFamily(bank.records,input.id,new Date().toISOString()));
    });
  }
}
