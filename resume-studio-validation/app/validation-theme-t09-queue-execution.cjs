const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,phase=process.env.QUEUE_PHASE;
if(!root||!out||!path.basename(root).startsWith('synthetic-queue-execution-')||!['control','interrupt','restart'].includes(phase))throw Error('isolated execution fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},observations={},sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const watchdog=setTimeout(()=>{console.error('execution watchdog '+phase);app.exit(2)},240000);
const assert=(v,m)=>{if(!v)throw Error(m)};
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
function report(error){fs.writeFileSync(path.join(out,'execution-'+phase+'.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,phase,checks,observations,...(error?{error:String(error)}:{})},null,2))}
const canonical=doc=>JSON.stringify(doc,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
async function run(){
 const store=main.store;
 const labels=['合成执行学校甲','合成执行学校乙','合成执行学校丙'],slugs=['runner-fixture','queue-b','queue-c'];
 const jds=['必须具备教师资格。\n硕士优先。','需要研究经历。','条件甲。\n条件乙。'];
 const ledgerHash=()=>sha(fs.readFileSync(store.applicationsPath)),sourceHash=slug=>sha(fs.readFileSync(store.resolveResumePath(slug).filePath));
 if(phase!=='restart'){
   const tasks=[];
   for(let i=0;i<labels.length;i++){
     const slug=slugs[i],doc=await store.saveResume(slug,{...fixture,id:'synthetic-exec-'+i,title:'合成执行简历 '+i,basic:{...fixture.basic,name:'合成执行候选 '+i}});
     tasks.push({taskVersion:1,id:crypto.randomUUID(),company:labels[i],role:'物理教师',jdText:jds[i],slug,docId:doc.id,documentRevision:JSON.stringify([doc.id,doc.updatedAt]),documentSha256:sha(Buffer.from(canonical(doc))),createdAt:new Date().toISOString(),status:'pending'});
   }
   const base=await store.getApplications();await store.saveApplications({...base,applications:[{id:'legacy-exec',company:'合成旧投递',resumeSlug:slugs[0]}],jobQueue:tasks},base.revision);
 }
 const initial=await store.getApplications(),sourceHashes=slugs.map(sourceHash),initialLedgerHash=ledgerHash();
 const tasks=initial.jobQueue,byIndex=async i=>(await store.getApplications()).jobQueue.find(t=>t.id===tasks[i].id);
 const untouched=async(indices)=>{const current=await store.getApplications();for(const i of indices)assert(JSON.stringify(current.jobQueue.find(t=>t.id===tasks[i].id))===JSON.stringify(tasks[i]),'other task mutated '+i);assert(JSON.stringify(current.applications)===JSON.stringify(initial.applications),'application ledger mutated');};
 const sourceUnchanged=(indices=[0,1,2])=>indices.forEach(i=>assert(sourceHash(slugs[i])===sourceHashes[i],'source file changed '+i));
 let calls=[],held=new Map(),finishCalls=0,finishFaults=0;
 const realPrepare=store.prepareJobQueueAttempt.bind(store),realFinish=store.finishJobQueueAttempt.bind(store);
 store.prepareJobQueueAttempt=async(task,signal)=>{
   calls.push({id:task.id,attemptId:task.execution.attemptId,attempts:task.execution.attempts});
   const i=tasks.findIndex(t=>t.id===task.id),n=task.execution.attempts;
   if(phase==='control'&&i===0&&n===2)throw Error('synthetic worker failure');
   const r=await realPrepare(task,signal);
   if(phase==='control'&&((i===0&&n===1)||i===1||i===2)){
     return new Promise(resolve=>held.set(task.id,{resolve:()=>resolve(r),signal}));
   }
   return r;
 };
 store.finishJobQueueAttempt=async(...args)=>{
   finishCalls++;
   if(phase==='interrupt'){finishFaults++;throw Error('synthetic completion write failure');}
   return realFinish(...args);
 };
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(v=>JSON.stringify(v)).join(',')+')');
 const has=t=>js(t=>document.body.innerText.includes(t),t);
 const enabled=label=>js(label=>[...document.querySelectorAll('button')].some(b=>(b.getAttribute('aria-label')===label||b.innerText.trim()===label)&&!b.disabled),label);
 const click=async label=>{await until('button '+label,()=>enabled(label));assert(await js(label=>{const b=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===label||b.innerText.trim()===label)&&!b.disabled);if(!b)return false;b.scrollIntoView({block:'center'});b.click();return true},label),'missing '+label)};
 const capture=async(name,i)=>{if(i!==undefined)await js(label=>[...document.querySelectorAll('article')].find(e=>e.getAttribute('aria-label')===label)?.scrollIntoView({block:'center'}),'岗位任务 '+labels[i]+' 物理教师');await js(()=>document.fonts.ready.then(()=>true));await sleep(250);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
 const matrix=require('./validation-theme-t08-matrix.cjs');
 const themeState=()=>({ledger:ledgerHash(),sources:slugs.map(sourceHash),calls:calls.length,finishCalls});
 const label=(prefix,i)=>prefix+'岗位 '+labels[i]+' 物理教师';
 const rowText=(i,t)=>js((label,t)=>[...document.querySelectorAll('article')].find(e=>e.getAttribute('aria-label')===label)?.innerText.includes(t)??false,'岗位任务 '+labels[i]+' 物理教师',t);
 const status=async(i,s,t,ms=20000)=>until('task '+i+' '+s,async()=> (await byIndex(i)).status===s&&await rowText(i,t),ms);
 await until('editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 await click('求职面试');await click('岗位队列');await until('queue',()=>has('本地岗位任务队列'));
 if(phase==='control'){
   assert(calls.length===0&&ledgerHash()===initialLedgerHash,'startup dispatched or wrote');
   await click(label('开始',0));await status(0,'running','准备尝试未结算');await until('worker held',()=>held.has(tasks[0].id));
   const running=await byIndex(0),rev=(await store.getApplications()).revision,beforeDup=ledgerHash();
   assert(!await enabled(label('开始',1)),'second job start enabled while first running');
   const duplicate=await js(async command=>{try{await window.resumeDesktop.applications.commandJobQueue(command);return true}catch{return false}},{taskId:tasks[0].id,ledgerRevision:rev,action:'start'});
   assert(!duplicate&&calls.length===1&&ledgerHash()===beforeDup,'duplicate started or wrote');
   checks.explicitOneAtATimeAndDuplicateNoWrite=true;await capture('01-running',0);await matrix(win,out,'job-queue','queue-running',themeState);
   await click(label('暂停',0));await status(0,'paused','已暂停');
   const pausedHash=ledgerHash();assert(held.get(tasks[0].id).signal.aborted,'pause did not signal worker');
   held.get(tasks[0].id).resolve();held.delete(tasks[0].id);await sleep(250);
   assert(ledgerHash()===pausedHash&&calls.length===1,'late paused result changed ledger');
   checks.pauseLateReplyIgnored=true;await capture('02-paused',0);await matrix(win,out,'job-queue','queue-paused',themeState);
   await click(label('重试',0));await status(0,'failed','准备失败');
   const failed=await byIndex(0);assert(failed.execution.failure==='local-error'&&failed.execution.attempts===2&&failed.execution.attemptId!==running.execution.attemptId,'failure metadata wrong');
   await untouched([1,2]);checks.workerFailureIsolated=true;await capture('03-injected-failure',0);await matrix(win,out,'job-queue','queue-failure',themeState);
   await click(label('重试',0));await status(0,'prepared','本地准备完成');
   const done=await byIndex(0);assert(done.execution.attempts===3&&done.execution.attemptId!==failed.execution.attemptId&&done.execution.result.clauseCount===2&&done.execution.result.jdSha256===sha(Buffer.from(jds[0]))&&done.execution.result.documentSha256===tasks[0].documentSha256,'retry receipt wrong');
   await untouched([1,2]);checks.explicitRetryProducesRealReceipt=true;await capture('04-prepared',0);await matrix(win,out,'job-queue','queue-prepared',themeState);
   await click(label('开始',1));await status(1,'running','准备尝试未结算');await until('second worker held',()=>held.has(tasks[1].id));
   await click(label('取消',1));await status(1,'canceled','已取消');
   const canceledRow=await byIndex(1),canceledHash=ledgerHash();assert(held.get(tasks[1].id).signal.aborted,'cancel did not signal worker');
   held.get(tasks[1].id).resolve();held.delete(tasks[1].id);await sleep(250);
   assert(ledgerHash()===canceledHash&&!await enabled(label('重试',1)),'late cancellation changed ledger or restarted');
   checks.cancelLateReplyIgnored=true;await capture('05-canceled',1);await matrix(win,out,'job-queue','queue-cancelled',themeState);
   await click(label('开始',2));await status(2,'running','准备尝试未结算');await until('third worker held',()=>held.has(tasks[2].id));
   const timeoutStart=await byIndex(2);
   await status(2,'failed','执行超时',40000);
   const timed=await byIndex(2),timedHash=ledgerHash();assert(timed.execution.failure==='timeout'&&timed.execution.attemptId===timeoutStart.execution.attemptId&&timed.execution.result===null&&held.get(tasks[2].id).signal.aborted,'watchdog failure missing');
   held.get(tasks[2].id).resolve();held.delete(tasks[2].id);await sleep(250);
   assert(ledgerHash()===timedHash,'late timeout reply changed ledger');checks.actualThirtySecondWatchdogAndLateReply=true;await capture('06-timeout',2);await matrix(win,out,'job-queue','queue-timeout',themeState);
   await click(label('重试',2));await status(2,'running','准备尝试未结算');await until('third retry held',()=>held.has(tasks[2].id));
   const doc=await store.getResume(slugs[2]),file=store.resolveResumePath(slugs[2]).filePath;
   fs.writeFileSync(file,JSON.stringify({...doc,title:'同修订号外部改动'}));const changedHash=sourceHash(slugs[2]);
   held.get(tasks[2].id).resolve();held.delete(tasks[2].id);await status(2,'failed','绑定简历发生变化');
   const changed=await byIndex(2);assert(changed.execution.failure==='source-changed'&&changed.execution.result===null&&sourceHash(slugs[2])===changedHash,'stale result accepted or source changed');
   const beforeStale=ledgerHash();await click(label('重试',2));await until('stale retry rejected',()=>has('岗位任务绑定的磁盘简历已变化'));
   assert(ledgerHash()===beforeStale&&JSON.stringify(await byIndex(0))===JSON.stringify(done)&&JSON.stringify(await byIndex(1))===JSON.stringify(canceledRow),'stale retry wrote ledger');
   sourceUnchanged([0,1]);assert((await store.getApplications()).applications.length===1,'unexpected application creation');
   checks.staleRetryRejectedOtherRowsIntact=true;await capture('07-stale-retry-refused',2);await matrix(win,out,'job-queue','queue-stale',themeState);
   await click('隐私脱敏');await until('redacted',()=>has('脱敏预览开启时隐藏岗位队列原文和登记操作。'));assert(!await has(labels[0])&&!await has(labels[1])&&!await has(labels[2]),'queue exposed');
   checks.redaction=true;await capture('08-redacted');
   observations.calls=calls;observations.finishCalls=finishCalls;
 }else if(phase==='interrupt'){
   await click(label('开始',0));await status(0,'running','准备尝试未结算');await until('completion write fault',()=>finishFaults===1);
   const task=await byIndex(0);
   assert(task.status==='running'&&task.execution.result===null&&calls.length===1,'completion failure created false success');
   await untouched([1,2]);sourceUnchanged();
   fs.writeFileSync(path.join(out,'interrupt-expected.json'),JSON.stringify({ledgerHash:ledgerHash(),sourceHashes,task,rows:(await store.getApplications()).jobQueue},null,2));
   checks.completionWriteFaultLeavesDurableRunning=true;await capture('09-completion-write-failed',0);await matrix(win,out,'job-queue','queue-write-failed',themeState);
 }else{
   const expected=JSON.parse(fs.readFileSync(path.join(out,'interrupt-expected.json'),'utf8'));
   assert(initialLedgerHash===expected.ledgerHash&&JSON.stringify(initial.jobQueue)===JSON.stringify(expected.rows)&&JSON.stringify(sourceHashes)===JSON.stringify(expected.sourceHashes),'restart bytes changed');
   await status(0,'running','准备尝试未结算');assert(await rowText(0,'不保证进程仍在运行')&&await rowText(0,'重启不会自动继续'),'restart liveness label ambiguous');assert(calls.length===0&&ledgerHash()===initialLedgerHash,'restart automatically ran or wrote');
   await capture('10-restart-running',0);checks.coldRestartNoAutomaticExecution=true;
   await until('recover after deadline',()=>enabled(label('恢复中断',0)),40000);
   await click(label('恢复中断',0));await status(0,'failed','中断后已显式恢复为失败');
   const recovered=await byIndex(0);assert(recovered.execution.failure==='interrupted'&&calls.length===0&&recovered.execution.attemptId===expected.task.execution.attemptId,'recovery auto-retried or changed attempt');
   await untouched([1,2]);checks.explicitExpiredRecovery=true;await capture('11-recovered-failed',0);await matrix(win,out,'job-queue','queue-recovered',themeState);
   await click(label('重试',0));await status(0,'prepared','本地准备完成');
   const done=await byIndex(0);assert(done.execution.attempts===2&&done.execution.attemptId!==expected.task.execution.attemptId&&done.execution.result.clauseCount===2&&calls.length===1,'retry after restart incorrect');
   await untouched([1,2]);sourceUnchanged();checks.explicitRestartRetry=true;await capture('12-restart-prepared',0);await matrix(win,out,'job-queue','queue-restart-prepared',themeState);
 }
 observations.ledgerSha256=ledgerHash();observations.sourceSha256=slugs.map(sourceHash);report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
