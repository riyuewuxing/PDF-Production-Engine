import { apiClient, localErrorMessage } from './apiClient';
import type { ApplicationsStoreData,ApplicationLogInput,JobApplication } from '../schema/applicationSchema';

type LedgerView={data:ApplicationsStoreData;ready:boolean;loading:boolean;saving:boolean;dirty:boolean;error:string|null};
type LedgerApi={getApplications:()=>Promise<ApplicationsStoreData>;saveApplications:(data:ApplicationsStoreData,revision:string)=>Promise<ApplicationsStoreData>;logApplication:(input:ApplicationLogInput)=>Promise<{entry:JobApplication;store:ApplicationsStoreData}>};
const empty=():ApplicationsStoreData=>({schemaVersion:1,applications:[],coverLetters:[],interviewAnswers:{}});
function validRevision(data:ApplicationsStoreData):string{
  if(typeof data.revision!=='string'||!data.revision)throw new Error('投递台账缺少版本标识，请升级桌面桥接。');
  return data.revision;
}
/** Renderer session queue survives panel unmount; every write is CAS against the last acknowledged disk version. */
export class CareerLedgerSession {
  private state:LedgerView={data:empty(),ready:false,loading:false,saving:false,dirty:false,error:null};
  private listeners=new Set<()=>void>();
  private baseRevision:string|null=null;
  private inFlight:Promise<void>|null=null;
  private loadingTask:Promise<void>|null=null;
  private logTask:Promise<{entry:JobApplication;store:ApplicationsStoreData}>|null=null;
  constructor(private api:LedgerApi){}
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  private change(patch:Partial<LedgerView>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  private adopt(data:ApplicationsStoreData){
    this.baseRevision=validRevision(data);
    this.change({data,ready:true,dirty:false,error:null});
  }
  load=async(discard=false):Promise<void>=>{
    if(this.logTask){await this.logTask;return;}
    if(this.inFlight){try{await this.inFlight;}catch{if(!discard)return;}}
    if(this.state.dirty&&!discard)return;
    if(this.loadingTask)return this.loadingTask;
    this.change({loading:true});
    const work=(async()=>{
      try{this.adopt(await this.api.getApplications());}
      catch(err){this.change({error:localErrorMessage(err,'读取投递台账失败')});throw err;}
      finally{this.change({loading:false});}
    })();
    this.loadingTask=work;
    try{await work;}finally{if(this.loadingTask===work)this.loadingTask=null;}
  };
  update=(transform:(current:ApplicationsStoreData)=>ApplicationsStoreData):boolean=>{
    if(!this.state.ready||this.state.loading||this.logTask){this.change({error:'台账尚未加载或正在归档，请稍后重试。'});return false;}
    this.change({data:transform(this.state.data),dirty:true});
    // After a write error preserve drafts until the user explicitly retries or reloads.
    if(!this.state.error)void this.flush().catch(()=>{});
    return true;
  };
  flush=async():Promise<void>=>{
    if(this.logTask){await this.logTask;return;}
    if(this.inFlight)return this.inFlight;
    if(!this.state.dirty)return;
    if(!this.baseRevision)throw new Error('投递台账缺少已确认版本。');
    this.change({saving:true,error:null});
    const work=(async()=>{
      while(this.state.dirty){
        const batch=this.state.data;
        try{
          const saved=await this.api.saveApplications(batch,this.baseRevision!);
          this.baseRevision=validRevision(saved);
          if(this.state.data===batch)this.change({data:saved,dirty:false,error:null});
          // New keystrokes keep their draft; the next batch uses the returned disk revision.
        }catch(err){this.change({error:localErrorMessage(err,'保存投递台账失败'),dirty:true});throw err;}
      }
    })();
    this.inFlight=work;
    try{await work;}finally{if(this.inFlight===work)this.inFlight=null;this.change({saving:false});}
  };
  log=async(input:ApplicationLogInput):Promise<JobApplication>=>{
    if(this.logTask)throw new Error('已有投递归档正在进行。');
    if(this.loadingTask)await this.loadingTask;
    await this.flush();
    if(this.logTask||this.loadingTask||this.state.dirty||this.inFlight)throw new Error('台账仍有进行中的操作，请稍后重试。');
    this.change({saving:true,error:null});
    const work=this.api.logApplication(input);
    this.logTask=work;
    try{const result=await work;this.adopt(result.store);return result.entry;}
    catch(err){this.change({error:localErrorMessage(err,'投递归档失败')});throw err;}
    finally{if(this.logTask===work)this.logTask=null;this.change({saving:false});}
  };
}
export const careerLedger=new CareerLedgerSession(apiClient);
