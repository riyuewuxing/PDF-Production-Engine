const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,phase=process.env.QUEUE_PHASE;
if(!root||!out||!path.basename(root).startsWith('synthetic-queue-recovery-')||!['fail','recover','stale'].includes(phase))throw Error('isolated recovery paths/phase required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},observations={},sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const watchdog=setTimeout(()=>{console.error('recovery watchdog '+phase);app.exit(2)},100000);
const assert=(v,m)=>{if(!v)throw Error(m)};
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
function report(error){fs.writeFileSync(path.join(out,'recovery-'+phase+'.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,phase,checks,observations,...(error?{error:String(error)}:{})},null,2))}
async function run(){
 const store=main.store;
 if(phase==='fail'){
   await store.saveResume('runner-fixture',{...fixture,id:'synthetic-recovery-queue',title:'合成恢复简历',basic:{...fixture.basic,name:'合成恢复候选人'}});
   const base=await store.getApplications();await store.saveApplications({...base,applications:[{id:'synthetic-legacy',company:'合成历史台账',resumeSlug:'runner-fixture'}]},base.revision);
 }
 const doc=await store.getResume('runner-fixture'),source=store.resolveResumePath('runner-fixture').filePath;
 const beforeLedger=sha(fs.readFileSync(store.applicationsPath)),beforeSource=sha(fs.readFileSync(source));
 const draftDir=path.join(root,'.resume-studio-drafts-v1');
 const expectedFile=path.join(out,'expected.json');
 let expected,checkpointFile;
 if(phase!=='fail'){
   expected=JSON.parse(fs.readFileSync(expectedFile,'utf8'));
   checkpointFile=path.join(draftDir,expected.draftId+'.json');
   assert(beforeLedger===expected.ledgerHash&&beforeSource===expected.sourceHash&&sha(fs.readFileSync(checkpointFile))===expected.draftHash,'unexpected cold-start bytes');
   if(phase==='stale')await store.saveResume('runner-fixture',{...doc,title:'外部修改后的合成简历'});
 }
 const expectedSource=sha(fs.readFileSync(source));
 let attempts=0;
 if(phase==='fail'){
   const realSave=store.saveApplications.bind(store);
   store.saveApplications=async(...args)=>{if(args[0]?.jobQueue?.length){attempts++;throw Error('合成注入：正式台账写入失败')}return realSave(...args)};
 }
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(v=>JSON.stringify(v)).join(',')+')');
 const has=t=>js(t=>document.body.innerText.includes(t),t);
 const click=async label=>assert(await js(label=>{const b=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===label||b.innerText.trim()===label)&&!b.disabled);if(!b)return false;b.scrollIntoView({block:'center'});b.click();return true},label),'missing '+label);
 const enabled=label=>js(label=>[...document.querySelectorAll('button')].some(b=>(b.getAttribute('aria-label')===label||b.innerText.trim()===label)&&!b.disabled),label);
 const capture=async name=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(200);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
 const fill=async(label,value)=>assert(await js((label,value)=>{const e=[...document.querySelectorAll('input,textarea')].find(e=>e.getAttribute('aria-label')===label);if(!e||e.disabled)return false;Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));return true},label,value),'missing input '+label);
 await until('initial editor',()=>js(()=>document.querySelector('#basic-field-name')?.value==='合成恢复候选人'));
 if(phase==='fail'){
   await click('求职面试');await until('queue tab',()=>enabled('岗位队列'));await click('岗位队列');await until('registration ready',()=>enabled('核对任务绑定'));
   await fill('队列单位','合成恢复学校');await fill('队列岗位','物理教师');await fill('队列岗位原文','  合成恢复岗位原文\\n不可静默丢失。  ');
   await click('核对任务绑定');await until('review',()=>enabled('确认登记岗位任务'));await click('确认登记岗位任务');
   await until('failure visible',()=>has('合成注入：正式台账写入失败'));
   let draft;
   await until('checkpoint persisted',()=>{if(!fs.existsSync(draftDir))return false;for(const n of fs.readdirSync(draftDir).filter(n=>n.endsWith('.json'))){try{const r=JSON.parse(fs.readFileSync(path.join(draftDir,n),'utf8'));if(r.input?.kind==='ledger'&&r.input.data.jobQueue?.length===1){draft=r;checkpointFile=path.join(draftDir,n);return true}}catch{}}return false});
   const row=draft.input.data.jobQueue[0];assert(row.company==='合成恢复学校'&&row.status==='pending'&&row.jdText==='  合成恢复岗位原文\\n不可静默丢失。  ','checkpoint data mismatch');
   assert(attempts>=1&&sha(fs.readFileSync(store.applicationsPath))===beforeLedger&&sha(fs.readFileSync(source))===beforeSource,'failure mutated official files');
   checks.failedSavePreservesOfficialBytes=true;checks.realCheckpointContainsPendingTask=true;checks.retryNotAutomaticAfterFailure=true;
   await capture('01-failed-save');
   fs.writeFileSync(expectedFile,JSON.stringify({draftId:draft.id,draftHash:sha(fs.readFileSync(checkpointFile)),ledgerHash:beforeLedger,sourceHash:beforeSource,row}));
   observations.attempts=attempts;
 }else{
   await until('draft banner',()=>has('本地自动恢复草稿 1 份'));
   assert(sha(fs.readFileSync(store.applicationsPath))===beforeLedger,'startup restored without approval');
   await click('检查恢复草稿');await until('draft listed',()=>enabled('查看草稿内容'));
   assert(!await enabled('恢复未变化台账'),'restore enabled before preview');
   await click('查看草稿内容');await until('preview gate',()=>enabled('恢复未变化台账'));await capture('02-reviewed-draft');
   assert(sha(fs.readFileSync(store.applicationsPath))===beforeLedger,'preview wrote official ledger');
   checks.coldStartAndPreviewNoWrite=true;
   await js(()=>{window.confirm=()=>true;return true});
   await click('恢复未变化台账');
   if(phase==='recover'){
     await until('restored',()=>has('台账草稿已恢复并重新读取'));
     const data=await store.getApplications();assert(data.applications.length===1&&JSON.stringify(data.jobQueue)===JSON.stringify([expected.row]),'restored ledger mismatch');
     assert(sha(fs.readFileSync(checkpointFile))===expected.draftHash&&sha(fs.readFileSync(source))===expectedSource,'recovery altered checkpoint or source');
     checks.explicitRecoveryExactTask=true;checks.originalDraftRetained=true;
     await capture('03-restored');
   }else{
     await until('stale rejection',()=>has('岗位任务绑定的磁盘简历已变化'));
     assert(sha(fs.readFileSync(store.applicationsPath))===beforeLedger&&sha(fs.readFileSync(checkpointFile))===expected.draftHash&&sha(fs.readFileSync(source))===expectedSource,'stale recovery altered files');
     checks.staleRecoveryRejectedWithoutWrite=true;await capture('04-stale-recovery-rejected');
   }
 }
 observations.ledgerSha256=sha(fs.readFileSync(store.applicationsPath));observations.sourceSha256=sha(fs.readFileSync(source));report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
