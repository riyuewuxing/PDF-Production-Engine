import { apiClient, localErrorMessage } from './apiClient';
import {checkpointRecovery,clearRecovery,type Checkpoint} from './recoveryCheckpoint';
import type { ApplicationsStoreData,ApplicationLogInput,JobApplication } from '../schema/applicationSchema';

type LedgerView={data:ApplicationsStoreData;ready:boolean;loading:boolean;saving:boolean;dirty:boolean;error:string|null;recoveryError:string|null};
type LedgerApi={getApplications:()=>Promise<ApplicationsStoreData>;saveApplications:(data:ApplicationsStoreData,revision:string)=>Promise<ApplicationsStoreData>;logApplication:(input:ApplicationLogInput)=>Promise<{entry:JobApplication;store:ApplicationsStoreData}>};
const empty=():ApplicationsStoreData=>({schemaVersion:1,applications:[],coverLetters:[],interviewAnswers:{}});
function validRevision(data:ApplicationsStoreData):string{
  if(typeof data.revision!=='string'||!data.revision)throw new Error('投递台账缺少版本标识，请升级桌面桥接。');
  return data.revision;
}
/** Renderer session queue survives panel unmount; every write is CAS against the last acknowledged disk version. */
export class CareerLedgerSession {
  private state:LedgerView={data:empty(),ready:false,loading:false,saving:false,dirty:false,error:null,recoveryError:null};
  private listeners=new Set<()=>void>();
  private baseRevision:string|null=null;
  private checkpoint:Checkpoint|undefined;
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
      try{const data=await this.api.getApplications();if(discard)await clearRecovery(this.checkpoint,message=>this.change({recoveryError:message}));this.adopt(data);}
      catch(err){this.change({error:localErrorMessage(err,'读取投递台账失败')});throw err;}
      finally{this.change({loading:false});}
    })();
    this.loadingTask=work;
    try{await work;}finally{if(this.loadingTask===work)this.loadingTask=null;}
  };
  update=(transform:(current:ApplicationsStoreData)=>ApplicationsStoreData):boolean=>{
    if(!this.state.ready||this.state.loading||this.logTask){this.change({error:'台账尚未加载或正在归档，请稍后重试。'});return false;}
    const data=transform(this.state.data);
    if(this.baseRevision)this.checkpoint=checkpointRecovery({kind:'ledger',baseRevision:this.baseRevision,data},message=>this.change({recoveryError:message}));
    this.change({data,dirty:true});
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
        const batch=this.state.data,checkpoint=this.checkpoint;
        try{
          const saved=await this.api.saveApplications(batch,this.baseRevision!);
          this.baseRevision=validRevision(saved);
          if(this.state.data===batch)this.change({data:saved,dirty:false,error:null});
          await clearRecovery(checkpoint,message=>this.change({recoveryError:message}));
          // New keystrokes keep their draft; the next batch uses the returned disk revision.
        }catch(err){this.change({error:localErrorMessage(err,'保存投递台账失败'),dirty:true});throw err;}
      }
    })();
    this.inFlight=work;
    try{await work;}finally{if(this.inFlight===work)this.inFlight=null;this.change({saving:false});}
  };
  restoreRecovery=async(data:ApplicationsStoreData,baseRevision:string):Promise<void>=>{
    if(this.state.dirty||this.state.saving||this.state.loading||this.logTask||this.inFlight||this.loadingTask)throw Error('当前台账有未保存或进行中的操作，请先处理。');
    this.change({loading:true,error:null});
    try{const current=await this.api.getApplications();if(validRevision(current)!==baseRevision)throw Error('正式台账已变化，未覆盖。');const saved=await this.api.saveApplications(data,baseRevision);this.adopt(saved);}
    catch(err){this.change({error:localErrorMessage(err,'台账恢复失败')});throw err;}
    finally{this.change({loading:false});}
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
