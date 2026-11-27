const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-portable-t49-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,sourceSha:require('./runner-manifest.json').sourceSha,checks:{},mode:'actual early V6 portable → current portable on isolated copy → earlier executable on original preserved copy'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,ws;
const pending=new Map(),listeners=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'packaged-queue-execution.json'),JSON.stringify(report,null,2));
function stop(){try{ws?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}}
function cleanup(){stop();try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='packaged job queue watchdog';write();cleanup();process.exit(2)},300000);
async function until(label,f,ms=25000){const end=Date.now()+ms;while(Date.now()<end){try{if(await f())return}catch{}await sleep(150)}throw Error('timeout '+label);}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));})}
async function js(expression,userGesture=false){const v=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture});if(v.exceptionDetails)throw Error('renderer evaluation failed');return v.result.value;}
const eventOnce=(method,ms=8000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(method);reject(Error('CDP event timeout '+method));},ms);listeners.set(method,{resolve:v=>{clearTimeout(timer);resolve(v);}});});
const version='select[aria-label="快速切换简历版本"]',dialog='[role="dialog"][aria-label="永久投递快照只读复盘"]';
const q=sel=>'document.querySelector('+JSON.stringify(sel)+')',has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')'),active=()=>js(q(version)+'?.value||""');
const clickCode=name=>'(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.innerText.trim()==='+JSON.stringify(name)+'&&!b.disabled);if(!b)return false;b.click();return true})()';
async function click(name){await until('button '+name,()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(name)+'&&!b.disabled)'));assert(await js(clickCode(name)),'button missing '+name)}
const capture=async(name,sel)=>{if(sel)await js(q(sel)+'?.scrollIntoView({block:"center",behavior:"instant"})');await js('document.fonts.ready.then(()=>true)');await sleep(250);const shot=await cdp('Page.captureScreenshot',{format:'png'});assert(shot.data?.length>1000,'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'))};
async function chooseFile(name,file){await cdp('Page.enable');await cdp('Page.setInterceptFileChooserDialog',{enabled:true});try{const [e,ok]=await Promise.all([eventOnce('Page.fileChooserOpened'),js(clickCode(name),true)]);assert(ok&&e.backendNodeId,'packaged picker did not open');await cdp('DOM.setFileInputFiles',{files:[file],backendNodeId:e.backendNodeId});}finally{await cdp('Page.setInterceptFileChooserDialog',{enabled:false}).catch(()=>{});}}
async function connect(exe,workspace){
  const reserved=net.createServer();await new Promise(r=>reserved.listen(0,'127.0.0.1',r));const port=reserved.address().port;await new Promise(r=>reserved.close(r));
  child=spawn(exe,['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{cwd:path.dirname(exe),env:{...process.env,RESUME_STUDIO_DATA_DIR:workspace},stdio:'ignore',windowsHide:false});
  let target;await until('packaged renderer',async()=>{const r=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(2000)});target=(await r.json()).find(t=>t.type==='page'&&t.url.startsWith('file:')&&t.webSocketDebuggerUrl);return !!target},75000);
  assert(['127.0.0.1','localhost'].includes(new URL(target.webSocketDebuggerUrl).hostname),'CDP not loopback');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.method&&listeners.has(d.method)){const l=listeners.get(d.method);listeners.delete(d.method);l.resolve(d.params);return;}if(!d.id)return;const p=pending.get(d.id);if(!p)return;pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);});
  await until('packaged editor',()=>js('!!'+q(version)+'&&!!document.querySelector("#basic-field-name")'));
}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const row=label=>'button[aria-label="'+label+'"]';
async function rowClick(label){const selector=row(label);await until(label,()=>js('!!'+q(selector+':not([disabled])')));assert(await js('(()=>{const b='+q(selector)+';if(!b||b.disabled)return false;b.scrollIntoView({block:"center"});b.click();return true})()'),label);}
async function fill(label,value){
 const selector='[aria-label='+JSON.stringify(label)+']';
 assert(await js('(()=>{const e='+q(selector)+';if(!e||e.disabled)return false;Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));return true})()'),'field missing '+label);
}
async function switchTo(slug){
 if(await active()===slug)return;
 assert(await js('(()=>{const s='+q(version)+';if(!s||s.disabled||![...s.options].some(o=>o.value==='+JSON.stringify(slug)+'))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,'+JSON.stringify(slug)+');s.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'switch option missing '+slug);
 await until('active '+slug,async()=>await active()===slug);
}
async function openQueue(){await click('求职面试');await rowClick('岗位队列');await until('queue view',()=>has('本地岗位任务队列'));}
const canonical=doc=>JSON.stringify(doc,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);

const shaFile=f=>hash(fs.readFileSync(f));
const inventory=dir=>{const out={};function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.isFile())out[path.relative(dir,p).replaceAll('\\','/')]=shaFile(p);else throw Error('unexpected entry '+p);}}walk(dir);return Object.fromEntries(Object.entries(out).sort(([a],[b])=>a.localeCompare(b)))};
async function gracefulStop(){
 if(!child)return;
 try{await cdp('Browser.close')}catch{}
 try{ws?.close()}catch{}
 await until('portable wrapper exit',()=>child.exitCode!==null||child.signalCode!==null,20000);
 child=null;
}
async function editName(name,file){
 await click('内容编辑');
 assert(await js('(()=>{const e=document.querySelector("#basic-field-name");if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(name)+');e.dispatchEvent(new Event("input",{bubbles:true}));return true})()'),'name field absent');
 await until('actual disk edit',()=>JSON.parse(fs.readFileSync(file,'utf8')).basic.name===name);
 await until('saved UI',()=>has('已保存至本地硬盘'));
}
async function run(){
 const previous=process.env.RESUME_STUDIO_T49_OLD_EXE,newer=path.resolve('Resume Studio.exe');
 const oldFixture=process.env.RESUME_STUDIO_T49_OLD_FIXTURE;
 assert(previous&&oldFixture&&fs.existsSync(previous),'old immutable candidate missing');
 const oldHash=shaFile(previous),newHash=shaFile(newer);assert(oldHash!==newHash,'old and new binaries identical');
 const a=path.join(root,'old-original'),b=path.join(root,'upgrade-copy'),c=path.join(root,'rollback-copy');
 fs.mkdirSync(a);fs.mkdirSync(path.join(a,'data','resumes'),{recursive:true});
 const oldDoc=JSON.parse(fs.readFileSync(oldFixture,'utf8'));
 fs.writeFileSync(path.join(a,'data','master.json'),JSON.stringify({...oldDoc,id:'old-master-49',title:'合成旧版母库'}));
 fs.writeFileSync(path.join(a,'data','resumes','runner-fixture.json'),JSON.stringify(oldDoc));
 const oldLedger={schemaVersion:1,applications:[],coverLetters:[],interviewAnswers:{}};
 fs.writeFileSync(path.join(a,'data','applications.json'),JSON.stringify(oldLedger));
 const av=path.join(a,'data','resumes','runner-fixture.json'),ae=path.join(a,'Resume Studio.exe');
 fs.copyFileSync(previous,ae);await connect(ae,a);await switchTo('runner-fixture');
 await until('old candidate loaded',()=>js(q('#basic-field-name')+'?.value==="演示候选人"'));
 await editName('合成旧版已保存',av);await capture('01-old-actual-saved');
 await gracefulStop();
 const original=inventory(path.join(a,'data'));
 for(const d of [b,c]){fs.mkdirSync(d);fs.cpSync(path.join(a,'data'),path.join(d,'data'),{recursive:true});fs.copyFileSync(previous,path.join(d,'Resume Studio.exe'));}
 assert(JSON.stringify(inventory(path.join(b,'data')))===JSON.stringify(original)&&JSON.stringify(inventory(path.join(c,'data')))===JSON.stringify(original),'preupgrade copy mismatch');
 fs.mkdirSync(path.join(b,'release'));fs.copyFileSync(newer,path.join(b,'release','Resume Studio.exe'));
 fs.writeFileSync(path.join(b,'release','keep.txt'),'synthetic retained evidence');
 execFileSync(process.execPath,[path.resolve('scripts/postpack-win.mjs')],{cwd:b,timeout:20000,stdio:'pipe'});
 const be=path.join(b,'Resume Studio.exe'),bv=path.join(b,'data','resumes','runner-fixture.json');
 assert(shaFile(be)===newHash&&!fs.existsSync(path.join(b,'release','Resume Studio.exe'))&&fs.readFileSync(path.join(b,'release','keep.txt'),'utf8')==='synthetic retained evidence','actual replacement failed');
 assert(JSON.stringify(inventory(path.join(b,'data')))===JSON.stringify(original)&&shaFile(ae)===oldHash,'replacement changed workspace or old binary');
 report.checks.actualBinaryReplacePreservesWorkspaceAndOriginal=true;
 await connect(be,b);await switchTo('runner-fixture');await until('old content read by new candidate',()=>js(q('#basic-field-name')+'?.value==="合成旧版已保存"'));
 assert(JSON.stringify(inventory(path.join(b,'data')))===JSON.stringify(original),'new startup rewrote old persisted bytes');
 await capture('02-new-opens-old-data');
 report.checks.newReadsOldWorkspaceNoRewrite=true;
 await editName('合成新版独立保存',bv);await capture('03-new-edited-copy');
 const newDocHash=shaFile(bv);
 assert(newDocHash!==original['resumes/runner-fixture.json']&&shaFile(path.join(b,'data','master.json'))===original['master.json']&&JSON.stringify(inventory(path.join(a,'data')))===JSON.stringify(original),'new edit affected original');
 await openQueue();await fill('队列单位','合成升级学校');await fill('队列岗位','物理教师');await fill('队列岗位原文','必须具备教学能力。');
 await click('核对任务绑定');await until('queue confirmation',()=>has('确认登记：合成升级学校'));
 await click('确认登记岗位任务');const ledgerFile=path.join(b,'data','applications.json');
 await until('new queue persisted',()=>JSON.parse(fs.readFileSync(ledgerFile,'utf8')).jobQueue?.length===1);
 const ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));assert(ledger.jobQueue[0].status==='pending'&&ledger.jobQueue[0].slug==='runner-fixture'&&ledger.applications.length===0,'new queue unexpected mutation');
 await capture('04-new-only-queue');await gracefulStop();
 const upgraded=inventory(path.join(b,'data'));assert(JSON.stringify(upgraded)!==JSON.stringify(original),'no upgraded changes');
 const ce=path.join(c,'Resume Studio.exe');assert(shaFile(ce)===oldHash,'rollback old binary mismatch');
 await connect(ce,c);await switchTo('runner-fixture');await until('old rollback opens unchanged copy',()=>js(q('#basic-field-name')+'?.value==="合成旧版已保存"'));
 await capture('05-old-rollback-isolated');
 assert(JSON.stringify(inventory(path.join(c,'data')))===JSON.stringify(original)&&JSON.stringify(inventory(path.join(a,'data')))===JSON.stringify(original)&&JSON.stringify(inventory(path.join(b,'data')))===JSON.stringify(upgraded),'rollback touched source or upgraded workspace');
 await gracefulStop();report.checks.newFeatureConfinedToUpgradeCopy=true;report.checks.oldBinaryRollbackOnPreservedCopy=true;
 report.oldSourceSha='7e390c4b64143d39632071a07d6eccd7beded9d8';report.oldExe={sha256:oldHash,bytes:fs.statSync(previous).size};report.newExe={sha256:newHash,bytes:fs.statSync(newer).size};report.originalFiles=original;report.upgradedFiles=upgraded;
 fs.copyFileSync(av,path.join(out,'old-saved-version.json'));fs.copyFileSync(bv,path.join(out,'new-saved-version.json'));fs.copyFileSync(ledgerFile,path.join(out,'new-ledger.json'));fs.copyFileSync(path.join(c,'data','resumes','runner-fixture.json'),path.join(out,'rollback-version.json'));write();
}
run().then(()=>{clearTimeout(watchdog);cleanup();process.exit(0)}).catch(async e=>{clearTimeout(watchdog);report.error=String(e?.message||'rollback fixture error').slice(0,1200);try{if(ws){const shot=await cdp('Page.captureScreenshot',{format:'png'});if(shot.data)fs.writeFileSync(path.join(out,'failure-renderer.png'),Buffer.from(shot.data,'base64'));}}catch{}write();cleanup();process.exit(1)});
