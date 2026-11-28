// @vitest-environment node
import {promises as fs} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {LocalResumeStore,MAX_JOB_QUEUE_DOCUMENT_BYTES} from './localFsApi';
import {createWorkspaceBackup,inspectWorkspaceBackup,restoreWorkspaceBackup} from './workspaceBackup';
import {JobQueueExecutor} from './jobQueueExecutor';
import {JobQueueSchema,JobQueueTaskSchema,JOB_QUEUE_RUN_MS,MAX_JOB_QUEUE_ATTEMPTS,type JobQueueCommand,type JobQueueTask,type JobQueueResult} from '../schema/applicationSchema';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
import {prepareJobQueueTask} from '../lib/jobQueueBinding';
const dirs:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();await Promise.all(dirs.splice(0).map(dir=>fs.rm(dir,{recursive:true,force:true})));});
const doc=(id:string)=>ResumeDocumentSchema.parse({id,title:'合成简历 '+id,createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{name:'合成候选人'},menuSections:[{id:'basic',title:'Basic',order:0}],globalSettings:{}});
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-queue-execution-'));dirs.push(root);
  const store=new LocalResumeStore(path.join(root,'data'));
  const a=await store.saveResume('demo-a',doc('synthetic-a')),b=await store.saveResume('demo-b',doc('synthetic-b'));
  const make=async(d:typeof a,slug:string,company:string,jdText:string)=>prepareJobQueueTask({id:randomUUID(),company,role:'合成岗位',jdText,slug,createdAt:new Date().toISOString()},d);
  const x=await make(a,'demo-a','合成学校甲','必须具备教师资格。\n硕士优先。'),y=await make(b,'demo-b','合成学校乙','合成研究经历。');
  const base=await store.getApplications(),ledger=await store.saveApplications({...base,jobQueue:[x,y]},base.revision);
  const original=await Promise.all(['demo-a','demo-b'].map(s=>fs.readFile(store.resolveResumePath(s).filePath)));
  return {root,store,a,b,x,y,ledger,original,make,other:new LocalResumeStore(store.dataDir)};
}
function command(task:JobQueueTask,rev:string,action:JobQueueCommand['action']):JobQueueCommand{return {taskId:task.id,ledgerRevision:rev,action};}
const readBytes=(s:LocalResumeStore)=>fs.readFile(s.applicationsPath);
const row=(s:Awaited<ReturnType<LocalResumeStore['getApplications']>>,id:string)=>s.jobQueue!.find(t=>t.id===id)!;
const result=(t:JobQueueTask,n=2):JobQueueResult=>({kind:'local-preflight-v1',jdSha256:createHash('sha256').update(t.jdText).digest('hex'),documentSha256:t.documentSha256,clauseCount:n});
const signal=()=>new AbortController().signal;
async function until(f:()=>Promise<boolean>){
  const deadline=Date.now()+5000;while(Date.now()<deadline){if(await f())return;await new Promise(r=>setTimeout(r,20));}throw Error('test condition timed out');
}
describe('durable local queue commands',()=>{
  it('preserves old pending data without automatic dispatch; supports master registration safely',async()=>{
    const f=await fixture(),before=await readBytes(f.store);
    const prepare=vi.spyOn(f.other,'prepareJobQueueAttempt');new JobQueueExecutor(f.other);
    expect(await f.other.getApplications()).toEqual(f.ledger);expect(prepare).not.toHaveBeenCalled();expect(await readBytes(f.store)).toEqual(before);
    const master=await f.store.saveResume('master',doc('synthetic-master')),task=await f.make(master,'master','合成母库岗位','合成条款');
    const saved=await f.store.saveApplications({...f.ledger,jobQueue:[f.x,f.y,task]},f.ledger.revision);
    expect(saved.jobQueue?.[2]).toEqual(task);
    const started=await f.store.commandJobQueue(command(task,saved.revision!,'start'));
    const p=await f.store.prepareJobQueueAttempt(started.started!,signal());
    const done=await f.store.finishJobQueueAttempt(task.id,started.started!.execution!.attemptId!,{result:p});
    expect(row(done,task.id).status).toBe('prepared');
  });
  it('serializes competing workspace writers and rejects duplicate dispatch or stale CAS without another write',async()=>{
    const f=await fixture(),rev=f.ledger.revision!;
    const replies=await Promise.allSettled([f.store.commandJobQueue(command(f.x,rev,'start')),f.other.commandJobQueue(command(f.y,rev,'start'))]);
    expect(replies.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(replies.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'APPLICATION_CONFLICT'}});
    const saved=await f.store.getApplications(),running=saved.jobQueue!.find(t=>t.status==='running')!,pending=saved.jobQueue!.find(t=>t.status==='pending')!,before=await readBytes(f.store);
    expect(running.execution?.attempts).toBe(1);
    const dup=await f.other.commandJobQueue(command(running,saved.revision!,'start'));
    expect(dup.started).toBeUndefined();expect(dup.store).toEqual(saved);
    await expect(f.other.commandJobQueue(command(pending,saved.revision!,'start'))).rejects.toMatchObject({code:'JOB_QUEUE_BUSY'});
    await expect(f.other.commandJobQueue(command(running,rev,'pause'))).rejects.toMatchObject({code:'APPLICATION_CONFLICT'});
    expect(await readBytes(f.store)).toEqual(before);
  });
  it('refuses generic edits to existing state or fabricated newly running tasks and malformed metadata',async()=>{
    const f=await fixture(),started=await f.store.commandJobQueue(command(f.x,f.ledger.revision!,'start')),running=started.started!,before=await readBytes(f.store);
    const fake={...running,id:randomUUID(),company:'伪造',execution:{...running.execution!,attemptId:randomUUID()}};
    expect(JobQueueTaskSchema.safeParse({...running,execution:undefined}).success).toBe(false);
    expect(JobQueueTaskSchema.safeParse({...running,execution:{...running.execution!,deadlineAt:null}}).success).toBe(false);
    expect(JobQueueTaskSchema.safeParse({...f.y,execution:running.execution}).success).toBe(false);
    expect(JobQueueSchema.safeParse([running,fake]).success).toBe(false);
    await expect(f.store.saveApplications({...started.store,jobQueue:[f.x,f.y]},started.store.revision)).rejects.toMatchObject({code:'JOB_QUEUE_IMMUTABLE'});
    await expect(f.store.saveApplications({...started.store,jobQueue:[running,f.y,{...fake,status:'paused',execution:{...fake.execution,deadlineAt:null}}]},started.store.revision)).rejects.toMatchObject({code:'JOB_QUEUE_IMMUTABLE'});
    await expect(f.store.commandJobQueue({...command(running,started.store.revision!,'pause'),status:'prepared'})).rejects.toMatchObject({code:'JOB_QUEUE_COMMAND'});
    expect(await readBytes(f.store)).toEqual(before);
    const {jobQueue:_omitted,...oldClient}=started.store;
    const changed=await f.store.saveApplications({...oldClient,interviewAnswers:{q:'合成答案'}},started.store.revision);
    expect(changed.jobQueue).toEqual(started.store.jobQueue);
  });
  it('pause, retry and cancel invalidate old attempts and preserve every immutable binding and other row',async()=>{
    const f=await fixture(),s=await f.store.commandJobQueue(command(f.x,f.ledger.revision!,'start')),attempt=s.started!.execution!.attemptId!;
    const paused=await f.store.commandJobQueue(command(f.x,s.store.revision!,'pause')),before=await readBytes(f.store);
    expect(row(paused.store,f.x.id).status).toBe('paused');
    const dup=await f.other.commandJobQueue(command(f.x,paused.store.revision!,'pause'));expect(dup.store).toEqual(paused.store);
    expect(await f.store.finishJobQueueAttempt(f.x.id,attempt,{result:result(f.x)})).toEqual(paused.store);
    expect(await readBytes(f.store)).toEqual(before);
    const retry=await f.other.commandJobQueue(command(f.x,paused.store.revision!,'retry')),second=retry.started!.execution!.attemptId!;
    expect(second).not.toBe(attempt);expect(retry.started!.execution!.attempts).toBe(2);
    expect(await f.store.finishJobQueueAttempt(f.x.id,attempt,{result:result(f.x)})).toEqual(retry.store);
    const canceled=await f.store.commandJobQueue(command(f.x,retry.store.revision!,'cancel')),after=await readBytes(f.store);
    expect(row(canceled.store,f.x.id).status).toBe('canceled');expect(row(canceled.store,f.y.id)).toEqual(f.y);
    expect(await f.other.finishJobQueueAttempt(f.x.id,second,{result:result(f.x)})).toEqual(canceled.store);
    const c2=await f.other.commandJobQueue(command(f.x,canceled.store.revision!,'cancel'));expect(c2.store).toEqual(canceled.store);
    await expect(f.store.commandJobQueue(command(f.x,canceled.store.revision!,'retry'))).rejects.toMatchObject({code:'JOB_QUEUE_STATE'});
    expect(await readBytes(f.store)).toEqual(after);
    const {status:_status,execution:_execution,...binding}=row(canceled.store,f.x.id),{status:_pending,...original}=f.x;expect(binding).toEqual(original);
  });
  it('does not auto-recover on restart, allows only expired explicit recovery and invalidates late completion',async()=>{
    const f=await fixture(),s=await f.store.commandJobQueue(command(f.x,f.ledger.revision!,'start')),attempt=s.started!.execution!,before=await readBytes(f.store);
    await expect(f.other.commandJobQueue(command(f.x,s.store.revision!,'recover'))).rejects.toMatchObject({code:'JOB_QUEUE_STATE'});
    vi.spyOn(Date,'now').mockReturnValue(Date.parse(attempt.deadlineAt!)+1);
    expect((await f.other.getApplications()).jobQueue).toEqual(s.store.jobQueue);
    expect(await readBytes(f.store)).toEqual(before);
    const recovered=await f.other.commandJobQueue(command(f.x,s.store.revision!,'recover'));
    expect(row(recovered.store,f.x.id)).toMatchObject({status:'failed',execution:{failure:'interrupted',attempts:1,result:null}});
    const after=await readBytes(f.store);
    expect(await f.store.finishJobQueueAttempt(f.x.id,attempt.attemptId!,{result:result(f.x)})).toEqual(recovered.store);expect(await readBytes(f.store)).toEqual(after);
  });
  it('records timeout and source changes as failure without overwriting source or another task',async()=>{
    const f=await fixture(),s=await f.store.commandJobQueue(command(f.x,f.ledger.revision!,'start')),attempt=s.started!.execution!;
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse(attempt.deadlineAt!)+1);
    const timed=await f.store.finishJobQueueAttempt(f.x.id,attempt.attemptId!,{result:result(f.x)});
    expect(row(timed,f.x.id)).toMatchObject({status:'failed',execution:{failure:'timeout',result:null}});
    clock.mockRestore();
    const retry=await f.store.commandJobQueue(command(f.x,timed.revision!,'retry')),prepared=await f.store.prepareJobQueueAttempt(retry.started!,signal());
    const file=f.store.resolveResumePath('demo-a').filePath;await fs.writeFile(file,JSON.stringify({...f.a,title:'同修订号合成外部修改'}));
    const failed=await f.store.finishJobQueueAttempt(f.x.id,retry.started!.execution!.attemptId!,{result:prepared});
    expect(row(failed,f.x.id)).toMatchObject({status:'failed',execution:{failure:'source-changed',result:null}});
    expect(row(failed,f.y.id)).toEqual(f.y);
    const before=await readBytes(f.store),changed=await fs.readFile(file);
    await expect(f.store.commandJobQueue(command(f.x,failed.revision!,'retry'))).rejects.toMatchObject({code:'JOB_QUEUE_STALE'});
    expect(await readBytes(f.store)).toEqual(before);expect(await fs.readFile(file)).toEqual(changed);
  });
  it('requires valid local preflight output and caps attempts; retries never modify source files',async()=>{
    const f=await fixture();let ledger=f.ledger;
    for(let n=1;n<=MAX_JOB_QUEUE_ATTEMPTS;n++){
      const s=await f.store.commandJobQueue(command(f.x,ledger.revision!,n===1?'start':'retry'));
      ledger=await f.store.finishJobQueueAttempt(f.x.id,s.started!.execution!.attemptId!,{result:{...result(f.x),clauseCount:80}});
      expect(row(ledger,f.x.id)).toMatchObject({status:'failed',execution:{failure:'local-error',attempts:n,result:null}});
    }
    const before=await readBytes(f.store);
    await expect(f.store.commandJobQueue(command(f.x,ledger.revision!,'retry'))).rejects.toMatchObject({code:'JOB_QUEUE_ATTEMPT_LIMIT'});
    expect(await readBytes(f.store)).toEqual(before);
    const start=await f.store.commandJobQueue(command(f.y,ledger.revision!,'start')),r=await f.store.prepareJobQueueAttempt(start.started!,signal());
    expect(r).toEqual(result(f.y,1));
    const done=await f.store.finishJobQueueAttempt(f.y.id,start.started!.execution!.attemptId!,{result:r});
    expect(row(done,f.y.id)).toMatchObject({status:'prepared',execution:{result:r,attempts:1,failure:null}});
    expect(row(done,f.x.id)).toEqual(row(ledger,f.x.id));
    expect(await Promise.all(['demo-a','demo-b'].map(s=>fs.readFile(f.store.resolveResumePath(s).filePath)))).toEqual(f.original);
  });
  it('retains a near-capacity registration quota when execution metadata is added',async()=>{
    const f=await fixture();
    const task=f.x,rows=Array.from({length:29},(_,i)=>({...task,id:randomUUID(),company:'合成 '+i,jdText:'a'.repeat(20000)}));
    // 29*20000 plus registration metadata fits within 600000 bytes.
    expect(JobQueueSchema.safeParse(rows).success).toBe(true);
    const valid=rows.map((t,i)=>({...t,status:'prepared',execution:{attempts:1,attemptId:randomUUID(),updatedAt:new Date().toISOString(),deadlineAt:null,failure:null,result:{...result(t,1),clauseCount:i%80+1}}}));
    expect(JobQueueSchema.safeParse(valid).success).toBe(true);
  });
});
describe('queue storage failure and workspace isolation',()=>{
  it('does not dispatch if publishing the running state fails; leaves exact prior ledger bytes',async()=>{
    const f=await fixture(),executor=new JobQueueExecutor(f.store),before=await readBytes(f.store),worker=vi.spyOn(f.store,'prepareJobQueueAttempt');
    const rename=fs.rename.bind(fs),inject=vi.spyOn(fs,'rename').mockImplementation(async(a,b)=>{
      if(String(b)===f.store.applicationsPath)throw Object.assign(Error('synthetic ENOSPC'),{code:'ENOSPC'});
      return rename(a,b);
    });
    await expect(executor.command(command(f.x,f.ledger.revision!,'start'))).rejects.toThrow('synthetic ENOSPC');
    expect(worker).not.toHaveBeenCalled();expect(await readBytes(f.store)).toEqual(before);expect(await f.store.getApplications()).toEqual(f.ledger);
    inject.mockRestore();
    await executor.command(command(f.x,f.ledger.revision!,'start'));await until(async()=>row(await f.store.getApplications(),f.x.id).status==='prepared');
    expect(worker).toHaveBeenCalledTimes(1);
  });
  it('retains the running lease on an actual atomic publication failure, then allows explicit expiry recovery',async()=>{
    const f=await fixture(),s=await f.store.commandJobQueue(command(f.x,f.ledger.revision!,'start')),task=s.started!,before=await readBytes(f.store);
    const prepared=await f.store.prepareJobQueueAttempt(task,signal());
    const rename=fs.rename.bind(fs),inject=vi.spyOn(fs,'rename').mockImplementation(async(a,b)=>{
      if(String(b)===f.store.applicationsPath)throw Object.assign(Error('synthetic ENOSPC'),{code:'ENOSPC'});
      return rename(a,b);
    });
    await expect(f.store.finishJobQueueAttempt(task.id,task.execution!.attemptId!,{result:prepared})).rejects.toThrow('synthetic ENOSPC');
    expect(await readBytes(f.store)).toEqual(before);expect(row(await f.other.getApplications(),task.id).status).toBe('running');
    inject.mockRestore();vi.spyOn(Date,'now').mockReturnValue(Date.parse(task.execution!.deadlineAt!)+1);
    const recovered=await f.other.commandJobQueue(command(task,s.store.revision!,'recover'));
    expect(row(recovered.store,task.id)).toMatchObject({status:'failed',execution:{failure:'interrupted',result:null}});
    expect(row(recovered.store,f.y.id)).toEqual(f.y);
  });
  it('completion merges with a concurrent unrelated acknowledged ledger edit without losing either change',async()=>{
    const f=await fixture(),s=await f.store.commandJobQueue(command(f.x,f.ledger.revision!,'start')),task=s.started!;
    const r=await f.store.prepareJobQueueAttempt(task,signal()),{jobQueue:_omitted,...oldClient}=s.store;
    const edited=await f.other.saveApplications({...oldClient,interviewAnswers:{synthetic:'new answer'}},s.store.revision);
    const finished=await f.store.finishJobQueueAttempt(task.id,task.execution!.attemptId!,{result:r});
    expect(finished.interviewAnswers).toEqual(edited.interviewAnswers);expect(row(finished,task.id).status).toBe('prepared');expect(row(finished,f.y.id)).toEqual(f.y);
    await expect(f.other.saveApplications({...edited,interviewAnswers:{synthetic:'late'}},edited.revision)).rejects.toMatchObject({code:'APPLICATION_CONFLICT'});
    expect(await f.store.getApplications()).toEqual(finished);
  });
  it('copies prepared and running states byte-exactly into a separate backup; recovery never runs or affects the original workspace',async()=>{
    const f=await fixture();await f.store.saveResume('master',doc('synthetic-master'));
    const a=await f.store.commandJobQueue(command(f.x,f.ledger.revision!,'start')),p=await f.store.prepareJobQueueAttempt(a.started!,signal());
    const done=await f.store.finishJobQueueAttempt(f.x.id,a.started!.execution!.attemptId!,{result:p});
    const b=await f.store.commandJobQueue(command(f.y,done.revision!,'start')),source=await readBytes(f.store);
    const dest=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-exec-backup-'));dirs.push(dest);
    const backup=await createWorkspaceBackup(f.root,dest,signal()),inspection=await inspectWorkspaceBackup(backup.folder,signal());
    const restored=await restoreWorkspaceBackup(f.root,backup.folder,inspection.manifestHash,dest,signal());
    const copy=new LocalResumeStore(path.join(restored.folder,'data')),worker=vi.spyOn(copy,'prepareJobQueueAttempt');
    new JobQueueExecutor(copy);
    expect(await readBytes(copy)).toEqual(source);expect(await copy.getApplications()).toEqual(b.store);expect(worker).not.toHaveBeenCalled();
    vi.spyOn(Date,'now').mockReturnValue(Date.parse(b.started!.execution!.deadlineAt!)+1);
    const recovered=await copy.commandJobQueue(command(f.y,b.store.revision!,'recover'));
    expect(row(recovered.store,f.y.id).status).toBe('failed');expect(row(recovered.store,f.x.id)).toEqual(row(done,f.x.id));expect(worker).not.toHaveBeenCalled();
    expect(await readBytes(f.store)).toEqual(source);expect(row(await f.store.getApplications(),f.y.id).status).toBe('running');
  },20000);
});
describe('bounded preparation input',()=>{
  it('rejects a too-large source before parsing or writing the running state; registration remains intact',async()=>{
    const f=await fixture(),file=f.store.resolveResumePath(f.x.slug).filePath,before=await readBytes(f.store);
    await fs.truncate(file,MAX_JOB_QUEUE_DOCUMENT_BYTES+1);
    await expect(f.store.commandJobQueue(command(f.x,f.ledger.revision!,'start'))).rejects.toMatchObject({code:'JOB_QUEUE_SOURCE_LIMIT'});
    expect(await readBytes(f.store)).toEqual(before);expect((await fs.stat(file)).size).toBe(MAX_JOB_QUEUE_DOCUMENT_BYTES+1);
    await fs.writeFile(file,f.original[0]!);
    const started=await f.store.commandJobQueue(command(f.x,f.ledger.revision!,'start'));
    const controller=new AbortController();controller.abort();
    await expect(f.store.prepareJobQueueAttempt(started.started!,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    const p=await f.store.prepareJobQueueAttempt(started.started!,signal());
    await fs.truncate(file,MAX_JOB_QUEUE_DOCUMENT_BYTES+1);
    const failed=await f.store.finishJobQueueAttempt(f.x.id,started.started!.execution!.attemptId!,{result:p});
    expect(row(failed,f.x.id)).toMatchObject({status:'failed',execution:{failure:'source-changed',result:null}});
    expect(row(failed,f.y.id)).toEqual(f.y);
  });
  it('reports deterministic invalid JD without truncation or wasted retries, leaving the next task untouched',async()=>{
    const f=await fixture(),bad=await f.make(f.a,'demo-a','合成过长条款',Array.from({length:81},(_,i)=>'条款'+i+'。').join(''));
    const saved=await f.store.saveApplications({...f.ledger,jobQueue:[f.x,f.y,bad]},f.ledger.revision);
    const executor=new JobQueueExecutor(f.store);await executor.command(command(bad,saved.revision!,'start'));
    await until(async()=>row(await f.store.getApplications(),bad.id).status==='failed');
    const failed=await f.store.getApplications(),before=await readBytes(f.store);
    expect(row(failed,bad.id)).toMatchObject({status:'failed',execution:{failure:'invalid-source',attempts:1,result:null}});
    await expect(f.store.commandJobQueue(command(bad,failed.revision!,'retry'))).rejects.toMatchObject({code:'JOB_QUEUE_JD_INVALID'});
    expect(await readBytes(f.store)).toEqual(before);expect(row(failed,f.x.id)).toEqual(f.x);expect(row(failed,f.y.id)).toEqual(f.y);
  });
});
describe('local worker cancellation and watchdog',()=>{
  it('explicitly starts a single worker, refuses overlapping work, and ignores a delayed canceled result',async()=>{
    const f=await fixture(),executor=new JobQueueExecutor(f.store);
    let release!:(v:JobQueueResult)=>void;
    const worker=vi.spyOn(f.store,'prepareJobQueueAttempt').mockImplementationOnce(()=>new Promise(r=>{release=r;}));
    const start=await executor.command(command(f.x,f.ledger.revision!,'start'));expect(worker).toHaveBeenCalledTimes(1);
    await expect(executor.command(command(f.y,start.revision!,'start'))).rejects.toThrow(/上一项任务/);
    const paused=await executor.command(command(f.x,start.revision!,'pause')),before=await readBytes(f.store);
    expect(worker.mock.calls[0]![1].aborted).toBe(true);
    await expect(executor.command(command(f.x,paused.revision!,'retry'))).rejects.toThrow(/上一项任务/);
    release(result(f.x));await new Promise(r=>setImmediate(r));
    expect(await readBytes(f.store)).toEqual(before);
    await executor.command(command(f.x,paused.revision!,'retry'));
    await until(async()=>row(await f.store.getApplications(),f.x.id).status==='prepared');
    const end=await f.store.getApplications();
    expect(row(end,f.x.id)).toMatchObject({status:'prepared',execution:{attempts:2,result:result(f.x)}});
    expect(row(end,f.y.id)).toEqual(f.y);
  });
  it('records worker failure once, then explicit retry succeeds without executing another pending task',async()=>{
    const f=await fixture(),executor=new JobQueueExecutor(f.store);
    const worker=vi.spyOn(f.store,'prepareJobQueueAttempt').mockRejectedValueOnce(Error('synthetic fault'));
    // The terminal row can become visible before the asynchronous completion
    // call returns. Hold exactly that interval instead of racing filesystem I/O.
    const realFinish=f.store.finishJobQueueAttempt.bind(f.store);
    let releaseFinish!:()=>void;
    const held=new Promise<void>(resolve=>{releaseFinish=resolve;});
    const finish=vi.spyOn(f.store,'finishJobQueueAttempt').mockImplementationOnce(async(...args)=>{
      const published=await realFinish(...args);
      await held;
      return published;
    });
    let failed!:Awaited<ReturnType<LocalResumeStore['getApplications']>>;
    try {
      await executor.command(command(f.x,f.ledger.revision!,'start'));
      await until(async()=>row(await f.store.getApplications(),f.x.id).status==='failed');
      failed=await f.store.getApplications();
      expect(row(failed,f.x.id)).toMatchObject({status:'failed',execution:{failure:'local-error',attempts:1}});
      expect(row(failed,f.y.id)).toEqual(f.y);
      expect(worker).toHaveBeenCalledTimes(1);expect(finish).toHaveBeenCalledTimes(1);
      const bytes=await readBytes(f.store);
      await expect(executor.command(command(f.x,failed.revision!,'retry'))).rejects.toThrow(/上一项任务仍在收口/);
      await expect(executor.command(command(f.y,failed.revision!,'start'))).rejects.toThrow(/上一项任务仍在收口/);
      expect(await readBytes(f.store)).toEqual(bytes);
      expect(worker).toHaveBeenCalledTimes(1);
    } finally {
      releaseFinish();
      // The worker is already done. Wait for the actual finish promise, then
      // let the executor's continuation/finally release its in-process lease.
      const first=finish.mock.results[0];
      if(first?.type==='return')await first.value;
      await new Promise<void>(resolve=>setImmediate(resolve));
    }
    await executor.command(command(f.x,failed.revision!,'retry'));
    await until(async()=>row(await f.store.getApplications(),f.x.id).status==='prepared');
    expect(finish).toHaveBeenCalledTimes(2);
    await finish.mock.results[1]!.value;
    await new Promise<void>(resolve=>setImmediate(resolve));
    const end=await f.store.getApplications();
    expect(worker).toHaveBeenCalledTimes(2);
    expect(row(end,f.x.id)).toMatchObject({status:'prepared',execution:{attempts:2,result:result(f.x)}});
    expect(row(end,f.y.id)).toEqual(f.y);
    expect(end.applications).toEqual(failed.applications);
    expect(await Promise.all(['demo-a','demo-b'].map(slug=>fs.readFile(f.store.resolveResumePath(slug).filePath)))).toEqual(f.original);
  },15000);
  it('times out an uncooperative read, aborts its signal, records failure once, and ignores eventual late reply',async()=>{
    const f=await fixture(),s=await f.store.commandJobQueue(command(f.x,f.ledger.revision!,'start')),task=s.started!;
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    let release!:(r:JobQueueResult)=>void;
    const prepare=vi.fn((_task:JobQueueTask,_signal:AbortSignal)=>new Promise<JobQueueResult>(r=>{release=r;}));
    const finish=vi.fn().mockResolvedValue(s.store);
    const executor=new JobQueueExecutor({commandJobQueue:vi.fn().mockResolvedValue(s),prepareJobQueueAttempt:prepare,finishJobQueueAttempt:finish});
    await executor.command(command(f.x,f.ledger.revision!,'start'));
    await vi.advanceTimersByTimeAsync(JOB_QUEUE_RUN_MS+1);
    expect(prepare.mock.calls[0]![1].aborted).toBe(true);
    expect(finish).toHaveBeenCalledExactlyOnceWith(task.id,task.execution!.attemptId!,{failure:'timeout'});
    release(result(f.x));await Promise.resolve();await Promise.resolve();
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
