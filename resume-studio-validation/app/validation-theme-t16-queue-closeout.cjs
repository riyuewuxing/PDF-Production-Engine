// Public T16 synthetic closeout-window gate. Product code is untouched.
// Hold the real completion promise AFTER the durable failure has been written.
const {app,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
const palette=process.env.T16_PALETTE,pair=Number(process.env.T16_PAIR);
assert(root&&out&&path.basename(root).startsWith('synthetic-queue-closeout-'),'fresh isolated fixture required');
assert(['classic','highContrast'].includes(palette)&&[0,1,2,3,4,5].includes(pair));
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),install=require('./validation-theme-t16-probe.cjs');
const store=main.store,report={sourceSha:process.env.GITHUB_SHA,platform:process.platform,palette,pair,calls:[],finishes:0,network:0,checks:{},screenshots:[]};
const write=()=>fs.writeFileSync(path.join(out,'queue-closeout.json'),JSON.stringify(report,null,2));
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=doc=>JSON.stringify(doc,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
const watchdog=setTimeout(()=>{report.error='global closeout watchdog exceeded';write();app.exit(2)},180000);
global.fetch=async()=>{report.network++;write();throw Error('external transport forbidden')};
async function until(label,fn,ms=16000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(80)}throw Error('timeout '+label)}
let win,t16,published=false,firstReturned=false,releaseHold,firstFinish;
const held=new Promise(resolve=>{releaseHold=resolve});
const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
const visible=label=>js(l=>[...document.querySelectorAll('button')].some(e=>(e.getAttribute('aria-label')===l||e.innerText.trim()===l)&&!e.disabled&&e.getClientRects().length),label);
const info=label=>js(l=>{const e=[...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')===l||e.innerText.trim()===l)&&e.getClientRects().length);if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect();return {disabled:e.disabled,type:e.type,family:e.dataset.studioSkinFamily||null,variant:e.dataset.studioSkin||null,role:e.dataset.studioSkinRole||null,cursor:s.cursor,theme:e.closest('[data-studio-theme]')?.dataset.studioTheme||null,rect:[r.width,r.height],protected:!!e.closest('.a4-sheet,[data-studio-paper]')}},label);
const capture=async(name,anchor)=>{
 if(anchor)await js(l=>{const a=[...document.querySelectorAll('article')].find(e=>e.getAttribute('aria-label')===l);a?.scrollIntoView({block:'center',behavior:'instant'})},anchor);
 await js(()=>document.fonts.ready.then(()=>true));await sleep(250);await t16.scan(name);
 const image=await win.webContents.capturePage();assert(!image.isEmpty());const png=image.toPNG();assert(png.length>10000);const file=name+'.png';fs.writeFileSync(path.join(out,file),png);report.screenshots.push({file,sha256:sha(png),width:image.getSize().width,height:image.getSize().height});write();
};
const click=async label=>{
 await until('enabled '+label,()=>visible(label));await t16.probe(label);
 const p=await js(l=>{const e=[...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')===l||e.innerText.trim()===l)&&!e.disabled&&e.getClientRects().length);if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return e.contains(document.elementFromPoint(x,y))?{x,y}:null},label);assert(p,'native hit test '+label);
 win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});await sleep(45);win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});
};
async function run(){
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>{report.network++;write();cb({cancel:true})});
 const slugs=['runner-fixture','queue-b'],labels=['合成收口学校甲','合成收口学校乙'],jds=['必须具备教师资格。\n硕士优先。','需要研究经历。'],tasks=[];
 await store.saveResume('master',{...fixture,id:'synthetic-closeout-master',title:'合成母库'});
 for(let i=0;i<slugs.length;i++){
  const doc=await store.saveResume(slugs[i],{...fixture,id:'synthetic-closeout-'+i,title:'合成收口简历 '+i,basic:{...fixture.basic,name:'演示候选人'}});
  tasks.push({taskVersion:1,id:crypto.randomUUID(),company:labels[i],role:'物理教师',jdText:jds[i],slug:slugs[i],docId:doc.id,documentRevision:JSON.stringify([doc.id,doc.updatedAt]),documentSha256:sha(Buffer.from(canonical(doc))),createdAt:new Date().toISOString(),status:'pending'});
 }
 const base=await store.getApplications();const initial=await store.saveApplications({...base,jobQueue:tasks},base.revision);
 const sourceHashes=()=>['master',...slugs].map(s=>sha(fs.readFileSync(store.resolveResumePath(s).filePath)));
 const beforeSources=sourceHashes(),ledgerHash=()=>sha(fs.readFileSync(store.applicationsPath)),initialHash=ledgerHash();
 const byIndex=async i=>(await store.getApplications()).jobQueue.find(t=>t.id===tasks[i].id);
 const rowLabel=i=>'岗位任务 '+labels[i]+' 物理教师',label=(p,i)=>p+'岗位 '+labels[i]+' 物理教师';
 const rowText=(i,t)=>js((l,t)=>[...document.querySelectorAll('article')].find(e=>e.getAttribute('aria-label')===l)?.innerText.includes(t)??false,rowLabel(i),t);
 const realPrepare=store.prepareJobQueueAttempt.bind(store),realFinish=store.finishJobQueueAttempt.bind(store);
 store.prepareJobQueueAttempt=async(task,signal)=>{
  report.calls.push({taskId:task.id,attemptId:task.execution.attemptId,attempts:task.execution.attempts});write();
  assert.equal(task.id,tasks[0].id,'unexpected worker');
  if(task.execution.attempts===1)throw Error('synthetic local worker failure');
  return realPrepare(task,signal);
 };
 store.finishJobQueueAttempt=(...args)=>{
  report.finishes++;const n=report.finishes;write();
  const work=(async()=>{const saved=await realFinish(...args);if(n===1){published=true;await held;firstReturned=true;}return saved})();
  if(n===1)firstFinish=work;return work;
 };
 await main.registerAssetProtocol();main.registerIpcHandlers();win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);win.show();win.focus();
 t16=await install(win,out,'queue-closeout');
 await until('editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 assert(await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');if(!e)return false;e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true},palette));
 await click('求职面试');await click('岗位队列');await until('queue',()=>js(()=>document.body.innerText.includes('本地岗位任务队列')));
 assert.equal(ledgerHash(),initialHash);assert.equal(report.calls.length,0);
 await click(label('开始',0));
 await until('real failure published',()=>published);
 await until('renderer acknowledges terminal row',()=>rowText(0,'准备失败'));
 assert.equal(firstReturned,false);const failed=await byIndex(0);assert.equal(failed.status,'failed');assert.equal(failed.execution.failure,'local-error');assert.equal(failed.execution.attempts,1);
 const frozen=ledgerHash();assert.deepEqual(await byIndex(1),tasks[1]);assert.deepEqual(sourceHashes(),beforeSources);
 const retry=label('重试',0),other=label('开始',1);
 report.checks.retryBefore=await info(retry);assert(!report.checks.retryBefore.disabled&&report.checks.retryBefore.role==='primary'&&report.checks.retryBefore.theme===palette);
 await capture('01-failed-before-closeout',rowLabel(0));
 await click(retry);
 await until('explicit closeout message',()=>js(()=>document.body.innerText.includes('上一项任务仍在收口')));
 await until('retry disabled after rejected operation',async()=>!!(await info(retry))?.disabled);
 const blocked=await info(retry);assert(blocked.disabled&&blocked.cursor==='not-allowed'&&!blocked.protected);
 assert((await info(other)).disabled);assert.equal(ledgerHash(),frozen);assert.equal(report.calls.length,1);assert.equal(report.finishes,1);assert.equal(firstReturned,false);
 report.checks.guardNoWrite=true;await capture('02-guard-rejection');
 // A direct second start must also be rejected while the guard is held.
 const direct=await js(async c=>{try{await window.resumeDesktop.applications.commandJobQueue(c);return {rejected:false}}catch(e){return {rejected:true,message:String(e?.message||e)}}},{taskId:tasks[1].id,ledgerRevision:(await store.getApplications()).revision,action:'start'});
 assert(direct.rejected&&direct.message.includes('上一项任务仍在收口'));assert.equal(ledgerHash(),frozen);assert.equal(report.calls.length,1);report.checks.otherTaskGuard=true;
 releaseHold();await firstFinish;await new Promise(r=>setImmediate(r));assert(firstReturned);
 assert.equal(ledgerHash(),frozen);assert.equal(report.calls.length,1);
 await sleep(1100);assert.equal(report.calls.length,1,'unexpected automatic retry');report.checks.noAutoRetry=true;
 await click('刷新岗位队列');await until('retry after refresh',()=>visible(retry));assert.equal(ledgerHash(),frozen);assert.equal(report.calls.length,1);
 await capture('03-refreshed-retry',rowLabel(0));
 await click(retry);await until('prepared durable and visible',async()=>(await byIndex(0)).status==='prepared'&&await rowText(0,'本地准备完成'));
 const done=await byIndex(0);assert.equal(done.execution.attempts,2);assert.equal(done.execution.result.clauseCount,2);assert.notEqual(done.execution.attemptId,failed.execution.attemptId);assert.equal(report.calls.length,2);assert.equal(report.finishes,2);
 assert.deepEqual(await byIndex(1),tasks[1]);assert.deepEqual(sourceHashes(),beforeSources);assert.deepEqual((await store.getApplications()).applications,initial.applications);assert.equal(report.network,0);
 report.checks.explicitRetry=true;report.checks.sourceAndOtherRowUnchanged=true;await capture('04-prepared',rowLabel(0));await t16.finish();report.complete=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{releaseHold();clearTimeout(watchdog);report.error=String(e.message||e);write();console.error(report.error);app.exit(1)});
