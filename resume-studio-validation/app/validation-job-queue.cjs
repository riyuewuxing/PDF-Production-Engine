const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,phase=process.env.QUEUE_PHASE;
if(!root||!out||!path.basename(root).startsWith('synthetic-job-queue-')||!['create','reopen'].includes(phase))throw Error('isolated paths/phase required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},observations={},sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const watchdog=setTimeout(()=>{console.error('queue watchdog '+phase);app.exit(2)},150000);
const assert=(v,m)=>{if(!v)throw Error(m)};
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label);}
function report(error){fs.writeFileSync(path.join(out,'queue-'+phase+'.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,sourceSha:require('./runner-manifest.json').sourceSha,checks,observations,...(error?{error:String(error)}:{})},null,2))}
async function run(){
 const store=main.store;
 const doc=phase==='create'?await store.saveResume('runner-fixture',{...fixture,id:'synthetic-queue-doc',title:'合成岗位绑定简历',basic:{...fixture.basic,name:'合成队列候选人'}}):await store.getResume('runner-fixture');
 const source=store.resolveResumePath('runner-fixture').filePath;
 if(phase==='create'){
   const base=await store.getApplications();
   await store.saveApplications({...base,applications:[{id:'legacy-synthetic',company:'合成原始台账',resumeSlug:'runner-fixture'}]},base.revision);
 }
 const beforeDoc=sha(fs.readFileSync(source)),beforeLedger=sha(fs.readFileSync(store.applicationsPath));
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(v=>JSON.stringify(v)).join(',')+')');
 const has=t=>js(t=>document.body.innerText.includes(t),t);
 const click=async label=>assert(await js(label=>{const b=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===label||b.innerText.trim()===label)&&!b.disabled);if(!b)return false;b.scrollIntoView({block:'center'});b.click();return true},label),'missing '+label);
 const enabled=label=>js(label=>[...document.querySelectorAll('button')].some(b=>(b.getAttribute('aria-label')===label||b.innerText.trim()===label)&&!b.disabled),label);
 const capture=async name=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(250);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
 const fill=async(label,value)=>assert(await js((label,value)=>{const e=[...document.querySelectorAll('input,textarea')].find(e=>e.getAttribute('aria-label')===label);if(!e||e.disabled)return false;Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));return true},label,value),'missing input '+label);
 await until('initial editor',()=>js(()=>document.querySelector('#basic-field-name')?.value==='合成队列候选人'));
 await click('求职面试');await until('queue tab',()=>enabled('岗位队列'));await click('岗位队列');await until('queue page',()=>has('本地岗位任务队列'));
 if(phase==='create'){
   await until('registration ready',()=>enabled('核对任务绑定'));
   const jdA='  合成岗位 A\n必须具备合成资格。  ',jdB='合成岗位 B\n研究方向不同。';
   await fill('队列单位','合成第一学校');await fill('队列岗位','物理教师');await fill('队列岗位原文',jdA);
   await click('核对任务绑定');await until('review',()=>enabled('确认登记岗位任务'));
   assert(sha(fs.readFileSync(store.applicationsPath))===beforeLedger,'prepare wrote ledger');await capture('01-binding-confirm');
   await click('取消本次登记');await until('cancel',()=>enabled('核对任务绑定'));assert(sha(fs.readFileSync(store.applicationsPath))===beforeLedger,'cancel wrote ledger');
   checks.reviewCancelNoWrite=true;
   await click('核对任务绑定');await until('review again',()=>enabled('确认登记岗位任务'));await click('确认登记岗位任务');
   await until('first persisted',async()=>((await store.getApplications()).jobQueue??[]).length===1&&await enabled('核对任务绑定'));
   await fill('队列单位','合成第二研究所');await fill('队列岗位','研究员');await fill('队列岗位原文',jdB);
   await click('核对任务绑定');await until('second review',()=>enabled('确认登记岗位任务'));await click('确认登记岗位任务');
   await until('second persisted',async()=>((await store.getApplications()).jobQueue??[]).length===2&&await enabled('核对任务绑定'));
   const ledger=await store.getApplications(),rows=ledger.jobQueue;
   assert(rows[0].jdText===jdA&&rows[1].jdText===jdB&&rows[0].id!==rows[1].id,'cross-job identity or original text wrong');
   assert(rows.every(r=>r.status==='pending'&&r.slug==='runner-fixture'&&r.docId===doc.id&&r.documentRevision===JSON.stringify([doc.id,doc.updatedAt])&&/^[a-f0-9]{64}$/.test(r.documentSha256)),'disk binding mismatch');
   assert(ledger.applications.length===1&&ledger.applications[0].company==='合成原始台账'&&sha(fs.readFileSync(source))===beforeDoc,'queue changed original data');
   checks.twoTasksPersistedIsolated=true;checks.originalUnchanged=true;
   await click('核验岗位绑定 合成第一学校 物理教师');await until('verified',()=>has('绑定一致（核验时）'));await capture('02-queue-verified');
   const savedHash=sha(fs.readFileSync(store.applicationsPath));
   await store.saveResume('runner-fixture',{...doc,title:'外部变更后的合成简历'});
   await click('核验岗位绑定 合成第二研究所 研究员');await until('stale',()=>has('版本已变化，原任务不得沿用'));await capture('03-queue-stale');
   assert(sha(fs.readFileSync(store.applicationsPath))===savedHash,'verify changed ledger');checks.staleReadNoWrite=true;
   await click('隐私脱敏');await until('redaction',()=>has('脱敏预览开启时隐藏岗位队列原文和登记操作。'));assert(!await has('合成第一学校')&&!await has('合成第二研究所')&&!await enabled('核对任务绑定'),'queue exposed in redaction');await capture('04-queue-redacted');checks.redactionGate=true;
   fs.writeFileSync(path.join(out,'restart-expected.json'),JSON.stringify({ledgerHash:savedHash,sourceHash:sha(fs.readFileSync(source)),rows,applicationCount:ledger.applications.length},null,2));
 }else{
   const expected=JSON.parse(fs.readFileSync(path.join(out,'restart-expected.json'),'utf8')),ledger=await store.getApplications();
   assert(beforeLedger===expected.ledgerHash&&beforeDoc===expected.sourceHash&&JSON.stringify(ledger.jobQueue)===JSON.stringify(expected.rows),'restart changed persisted data');
   assert(ledger.applications.length===expected.applicationCount&&ledger.jobQueue.every(r=>r.status==='pending'),'unexpected execution');
   await until('reopened records',()=>has('合成第一学校')&&has('合成第二研究所')&&has('未核验当前版本'));checks.coldRestartPending=true;
   await click('核验岗位绑定 合成第一学校 物理教师');await until('reopened stale',()=>has('版本已变化，原任务不得沿用'));await capture('05-queue-reopened');
   assert(sha(fs.readFileSync(store.applicationsPath))===beforeLedger&&sha(fs.readFileSync(source))===beforeDoc,'restart verify wrote data');checks.coldRestartStaleNoWrite=true;
   win.setSize(680,820);await sleep(500);await capture('06-queue-narrow');checks.narrowRendered=true;
 }
 observations.ledgerSha256=sha(fs.readFileSync(store.applicationsPath));
 observations.sourceSha256=sha(fs.readFileSync(source));report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
