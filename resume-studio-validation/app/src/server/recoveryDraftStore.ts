import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DRAFT_DIR,DraftInputSchema,DraftRecordSchema,type DraftRecord,type DraftList,type DraftSummary,type DraftReceipt} from '../schema/recoveryDraftSchema';
import {resumeRevision} from '../schema/resumeSchema';
import type {LocalResumeStore} from './localFsApi';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES=8*1024*1024,MAX_RECORDS=64;
const missing=(e:unknown)=>(e as NodeJS.ErrnoException)?.code==='ENOENT';
function ownerAlive(pid:number){try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}}
function comparable(data:object,kind:'resume'|'ledger'){
  const copy={...data} as Record<string,unknown>;
  delete copy[kind==='resume'?'updatedAt':'revision'];
  return JSON.stringify(copy);
}
/** Separate workspace-local journal. Never writes the official resume/ledger on checkpoint. */
export class RecoveryDraftStore{
  private readonly session=randomUUID();
  private readonly ids=new Map<string,string>();
  private tail:Promise<unknown>=Promise.resolve();
  private queued=0;
  private readonly dir:string;
  constructor(private root:string,private store:LocalResumeStore,private isOwnerAlive=ownerAlive){this.dir=path.join(path.resolve(root),DRAFT_DIR);}
  private serial<T>(work:()=>Promise<T>):Promise<T>{
    if(this.queued>=128)return Promise.reject(Error('恢复草稿操作队列已满，请立即保存。'));
    this.queued++;
    const next=this.tail.then(work,work).finally(()=>{this.queued--;});this.tail=next.catch(()=>{});return next;
  }
  private async directory(create:boolean){
    const real=await fs.realpath(this.root);
    if(real!==path.resolve(this.root)||!(await fs.lstat(real)).isDirectory())throw Error('草稿工作区路径不安全。');
    if(create)await fs.mkdir(this.dir,{mode:0o700}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});
    try{const st=await fs.lstat(this.dir);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(this.dir)!==this.dir)throw Error('草稿目录不安全。');}
    catch(e){if(!create&&missing(e))return false;throw e;}
    return true;
  }
  private file(id:string){if(!UUID.test(id))throw Error('无效草稿标识。');return path.join(this.dir,id+'.json');}
  private async read(id:string):Promise<DraftRecord>{
    const p=this.file(id),st=await fs.lstat(p);
    if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<=0||st.size>MAX_BYTES||await fs.realpath(p)!==p)throw Error('草稿文件不安全或超限。');
    const raw=DraftRecordSchema.parse(JSON.parse(await fs.readFile(p,'utf8')));
    if(raw.id!==id)throw Error('草稿标识不一致。');
    return raw;
  }
  checkpoint(raw:unknown):Promise<DraftReceipt>{return this.serial(async()=>{
    const input=DraftInputSchema.parse(raw);
    if(input.kind==='resume'&&JSON.parse(input.baseRevision)[0]!==input.data.id)throw Error('草稿版本基线不一致。');
    await this.directory(true);
    const key=input.kind==='resume'?'resume:'+input.slug:'ledger';
    const id=this.ids.get(key)??randomUUID();
    const target=this.file(id);
    if(!this.ids.has(key)){
      const names=await fs.readdir(this.dir);
      if(names.filter(n=>n.endsWith('.json')).length>=MAX_RECORDS)throw Error('恢复草稿数量已达上限，请先检查旧草稿。');
    }
    const record:DraftRecord={version:1,id,token:randomUUID(),session:this.session,ownerPid:process.pid,createdAt:new Date().toISOString(),input};
    const bytes=Buffer.from(JSON.stringify(record));
    if(bytes.length>MAX_BYTES)throw Error('恢复草稿超过8 MB上限。');
    const temp=target+'.'+randomUUID()+'.tmp';
    try{
      const handle=await fs.open(temp,'wx',0o600);
      try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
      const delays=[25,50,100,200,400];
      for(let attempt=0;;attempt++){
        try{await fs.rename(temp,target);break;}catch(e){
          if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes((e as NodeJS.ErrnoException).code??'')||attempt>=delays.length)throw e;
          await new Promise(resolve=>setTimeout(resolve,delays[attempt]));
        }
      }
    }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
    this.ids.set(key,id);
    return {id,token:record.token};
  });}
  /** A late acknowledgement may never remove a newer checkpoint. */
  clear(receipt:DraftReceipt,confirmation:'SAVED_OR_DISCARDED'|'DISCARD_RECOVERY'):Promise<boolean>{return this.serial(async()=>{
    if(!['SAVED_OR_DISCARDED','DISCARD_RECOVERY'].includes(confirmation))throw Error('需明确清除草稿。');
    if(!await this.directory(false))return false;
    let row:DraftRecord;try{row=await this.read(receipt.id);}catch(e){if(missing(e))return false;throw e;}
    if(row.token!==receipt.token)return false;
    if(confirmation==='SAVED_OR_DISCARDED'&&row.session!==this.session)return false;
    if(confirmation==='DISCARD_RECOVERY'&&(row.session===this.session||this.isOwnerAlive(row.ownerPid)))return false;
    await fs.unlink(this.file(row.id));return true;
  });}
  private async summarize(row:DraftRecord):Promise<DraftSummary>{
    const input=row.input;
    let state:DraftSummary['state']='unreadable';
    try{
      if(input.kind==='resume'){
        const current=await this.store.getResume(input.slug);
        state=comparable(current,'resume')===comparable(input.data,'resume')?'already-saved':resumeRevision(current)===input.baseRevision?'same-base':'changed';
      }else{
        const current=await this.store.getApplications();
        state=comparable(current,'ledger')===comparable(input.data,'ledger')?'already-saved':current.revision===input.baseRevision?'same-base':'changed';
      }
    }catch(e){if((e as {code?:string})?.code==='NOT_FOUND'||missing(e))state='missing';}
    if(this.isOwnerAlive(row.ownerPid))state='active';
    return {id:row.id,token:row.token,kind:input.kind,title:input.kind==='resume'?input.data.title:'投递台账与面试记录',...(input.kind==='resume'?{slug:input.slug}:{}),createdAt:row.createdAt,state};
  }
  list():Promise<DraftList>{return this.serial(async()=>{
    if(!await this.directory(false))return {drafts:[],unreadable:0};
    const names=await fs.readdir(this.dir);const drafts:DraftSummary[]=[];let unreadable=names.filter(n=>n.endsWith('.tmp')).length;
    const files=names.filter(n=>n.endsWith('.json'));
    if(files.length>MAX_RECORDS)throw Error('草稿目录文件数量超限，未自动清理。');
    for(const n of files){
      try{const row=await this.read(n.slice(0,-5));if(row.session!==this.session)drafts.push(await this.summarize(row));}
      catch{unreadable++;}
    }
    return {drafts:drafts.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),unreadable};
  });}
  get(id:string,token:string):Promise<DraftRecord>{return this.serial(async()=>{
    if(!await this.directory(false))throw Error('恢复草稿不存在。');
    const row=await this.read(id);
    if(row.session===this.session||row.token!==token||this.isOwnerAlive(row.ownerPid))throw Error('恢复草稿已变化，请重新检查。');
    return row;
  });}
}
