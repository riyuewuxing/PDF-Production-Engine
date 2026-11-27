import {JOB_QUEUE_RUN_MS,JobQueueCommandSchema,type JobQueueTask,type JobQueueFailure,type JobQueueResult,type ApplicationsStoreData} from '../schema/applicationSchema';
import type {LocalResumeStore} from './localFsApi';
type Attempt={task:JobQueueTask;abort:AbortController;workerDone:boolean;settled:boolean};
type Store=Pick<LocalResumeStore,'commandJobQueue'|'prepareJobQueueAttempt'|'finishJobQueueAttempt'>;
/** One bounded local worker per process; disk CAS also enforces one running
 * attempt per workspace. No boot-time dispatch, timer-driven retry, or network. */
export class JobQueueExecutor{
  private active:Attempt|null=null;
  private starting=false;
  constructor(private readonly store:Store){}
  async command(raw:unknown):Promise<ApplicationsStoreData>{
    const command=JobQueueCommandSchema.parse(raw);
    const start=command.action==='start'||command.action==='retry';
    if(start&&(this.starting||this.active))throw Error('本进程上一项任务仍在收口，请刷新后再尝试；未重复启动。');
    if(start)this.starting=true;
    try{
      const reply=await this.store.commandJobQueue(command);
      if(reply.started)this.dispatch(reply.started);
      else if(this.active?.task.id===command.taskId&&['pause','cancel','recover'].includes(command.action))this.active.abort.abort();
      return reply.store;
    }finally{if(start)this.starting=false;}
  }
  private dispatch(task:JobQueueTask){
    const abort=new AbortController();
    const attempt:Attempt={task,abort,workerDone:false,settled:false};
    this.active=attempt;
    const release=()=>{if(attempt.workerDone&&attempt.settled&&this.active===attempt)this.active=null;};
    const run=Promise.resolve().then(()=>this.store.prepareJobQueueAttempt(task,abort.signal));
    void run.then(()=>{attempt.workerDone=true;release();},()=>{attempt.workerDone=true;release();});
    let timer:ReturnType<typeof setTimeout>|undefined;
    let timedOut=false;
    const timeout=new Promise<never>((_resolve,reject)=>{
      const remaining=Math.max(0,Math.min(JOB_QUEUE_RUN_MS,Date.parse(task.execution!.deadlineAt!)-Date.now()));
      timer=setTimeout(()=>{timedOut=true;abort.abort();reject(Error('queue deadline'));},remaining);
    });
    let onAbort:()=>void=()=>{};
    const canceled=new Promise<never>((_resolve,reject)=>{
      onAbort=()=>reject(Error('queue aborted'));
      abort.signal.addEventListener('abort',onAbort,{once:true});
    });
    void (async()=>{
      try{
        let outcome:{result:JobQueueResult}|{failure:JobQueueFailure};
        try{outcome={result:await Promise.race([run,timeout,canceled])};}
        catch(err){
          const code=(err as {code?:string})?.code;
          outcome={failure:timedOut?'timeout':code==='JOB_QUEUE_STALE'?'source-changed':'local-error'};
        }
        // Pause/cancel is committed first, then signals the worker. Its late
        // completion is harmless; timeout still records a failure if possible.
        if(!abort.signal.aborted||timedOut)await this.store.finishJobQueueAttempt(task.id,task.execution!.attemptId!,outcome);
      }catch{
        // A failed completion write leaves the durable running lease, which
        // can be explicitly recovered after expiry. Never silently retry.
      }finally{
        if(timer!==undefined)clearTimeout(timer);
        abort.signal.removeEventListener('abort',onAbort);
        attempt.settled=true;release();
      }
    })();
  }
}
