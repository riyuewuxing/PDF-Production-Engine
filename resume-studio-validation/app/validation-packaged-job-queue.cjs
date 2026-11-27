const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-packaged-job-queue-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,sourceSha:require('./runner-manifest.json').sourceSha,checks:{},mode:'win-unpacked packaged ASAR; synthetic local files only'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,ws;
const pending=new Map(),listeners=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'packaged-job-queue.json'),JSON.stringify(report,null,2));
function stop(){try{ws?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}}
function cleanup(){stop();try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='packaged job queue watchdog';write();cleanup();process.exit(2)},210000);
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
async function connect(exe){
  const reserved=net.createServer();await new Promise(r=>reserved.listen(0,'127.0.0.1',r));const port=reserved.address().port;await new Promise(r=>reserved.close(r));
  child=spawn(exe,['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{cwd:path.dirname(exe),env:{...process.env,RESUME_STUDIO_DATA_DIR:root},stdio:'ignore',windowsHide:false});
  let target;await until('packaged renderer',async()=>{const r=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(2000)});target=(await r.json()).find(t=>t.type==='page'&&t.url.startsWith('file:')&&t.webSocketDebuggerUrl);return !!target},35000);
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
async function run(){
 const data=path.join(root,'data'),resumes=path.join(data,'resumes');
 fs.mkdirSync(resumes,{recursive:true});
 const a={...fixture,id:'packaged-queue-a',title:'打包合成简历 A',updatedAt:'2026-11-27T00:00:02.000Z',basic:{...fixture.basic,name:'打包队列甲'}};
 const b={...fixture,id:'packaged-queue-b',title:'打包合成简历 B',updatedAt:'2026-11-27T00:00:01.000Z',basic:{...fixture.basic,name:'打包队列乙'}};
 const af=path.join(resumes,'runner-a.json'),bf=path.join(resumes,'runner-b.json'),lf=path.join(data,'applications.json');
 fs.writeFileSync(af,JSON.stringify(a));fs.writeFileSync(bf,JSON.stringify(b));fs.writeFileSync(path.join(data,'master.json'),JSON.stringify({...a,id:'packaged-queue-master',title:'合成母库'}));
 fs.writeFileSync(lf,JSON.stringify({schemaVersion:1,applications:[],coverLetters:[],interviewAnswers:{}}));
 const initialA=hash(fs.readFileSync(af)),initialB=hash(fs.readFileSync(bf)),initialLedger=hash(fs.readFileSync(lf));
 const exe=path.resolve('release','win-unpacked','Resume Studio.exe');assert(fs.existsSync(exe),'packaged exe missing');
 report.asarSha256=hash(fs.readFileSync(path.join(path.dirname(exe),'resources','app.asar')));
 const ledger=()=>JSON.parse(fs.readFileSync(lf,'utf8'));
 const count=()=>ledger().jobQueue?.length??0;
 const currentDoc=slug=>js('window.resumeDesktop.resumes.get('+JSON.stringify(slug)+')');
 const register=async(company,role,jd,n)=>{
  await fill('队列单位',company);await fill('队列岗位',role);await fill('队列岗位原文',jd);
  await click('核对任务绑定');await until('explicit binding confirmation',()=>has('确认登记：'+company));
  assert(count()===n-1,'prepare wrote early');await click('确认登记岗位任务');await until('persisted '+company,()=>count()===n);
  await until('ready after write',()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==="核对任务绑定"&&!b.disabled)'));
 };
 await connect(exe);await switchTo('runner-a');
 await until('fixture A',()=>js(q('#basic-field-name')+'?.value==="打包队列甲"'));
 const docA=await currentDoc('runner-a');await openQueue();
 const jdA='  打包岗位 A\n条件甲。  ',jdB='打包岗位 B\n条件乙。';
 await register('打包学校甲','物理教师',jdA,1);
 await rowClick('核验岗位绑定 打包学校甲 物理教师');await until('binding A',()=>has('绑定一致（核验时）'));await capture('01-packaged-queue-a');
 assert(hash(fs.readFileSync(af))===initialA&&hash(fs.readFileSync(bf))===initialB,'first task changed source');
 await switchTo('runner-b');await until('fixture B active',()=>active().then(v=>v==='runner-b'));
 const docB=await currentDoc('runner-b');await openQueue();
 await until('B current title',()=>has('打包合成简历 B'));
 await register('打包研究所乙','研究员',jdB,2);
 const rows=ledger().jobQueue;
 assert(rows.length===2&&rows[0].id!==rows[1].id&&rows[0].slug==='runner-a'&&rows[1].slug==='runner-b'&&rows[0].docId===docA.id&&rows[1].docId===docB.id,'incorrect task/document identity');
 assert(rows[0].jdText===jdA&&rows[1].jdText===jdB&&rows.every(t=>t.status==='pending'),'cross-job original text or state');
 assert(rows[0].documentSha256===hash(Buffer.from(canonical(docA)))&&rows[1].documentSha256===hash(Buffer.from(canonical(docB))),'independent document digest mismatch');
 assert(rows[0].documentRevision===JSON.stringify([docA.id,docA.updatedAt])&&rows[1].documentRevision===JSON.stringify([docB.id,docB.updatedAt]),'revision mismatch');
 report.checks.crossVersionExactBindings=true;
 const saved=hash(fs.readFileSync(lf));assert(saved!==initialLedger&&hash(fs.readFileSync(af))===initialA&&hash(fs.readFileSync(bf))===initialB,'registration altered source or failed persistence');
 report.checks.originalDocumentsUnchanged=true;
 await capture('02-packaged-two-versions');
 await fill('队列单位','打包研究所乙');await fill('队列岗位','研究员');await fill('队列岗位原文',jdB);await click('核对任务绑定');await until('duplicate refused',()=>has('同一岗位及绑定版本已登记'));
 assert(hash(fs.readFileSync(lf))===saved&&count()===2,'duplicate changed ledger');report.checks.duplicateRejectedNoWrite=true;
 fs.writeFileSync(bf,JSON.stringify({...b,title:'同修订号合成变更'}));
 const alteredB=hash(fs.readFileSync(bf));
 await rowClick('核验岗位绑定 打包研究所乙 研究员');await until('stale B',()=>has('版本已变化，原任务不得沿用'));await capture('03-packaged-same-revision-stale');
 await rowClick('核验岗位绑定 打包学校甲 物理教师');await until('still valid A',()=>has('绑定一致（核验时）'));
 assert(hash(fs.readFileSync(lf))===saved,'verification changed ledger');report.checks.sameRevisionTamperIsolated=true;
 stop();await until('first process exited',()=>child.exitCode!==null||child.signalCode!==null,10000);await connect(exe);await openQueue();
 await until('cold restart queue',()=>has('打包学校甲')&&has('打包研究所乙')&&has('未核验当前版本'));
 assert(hash(fs.readFileSync(lf))===saved&&JSON.stringify(ledger().jobQueue)===JSON.stringify(rows)&&ledger().applications.length===0,'restart executed or changed task');
 report.checks.coldProcessRestartPending=true;
 await rowClick('核验岗位绑定 打包研究所乙 研究员');await until('restart stale B',()=>has('版本已变化，原任务不得沿用'));await capture('04-packaged-reopened');
 await click('隐私脱敏');await until('redaction hides queue',()=>has('脱敏预览开启时隐藏岗位队列原文和登记操作。'));assert(!await has('打包学校甲')&&!await has('打包研究所乙'),'queue exposed');await capture('05-packaged-redacted');
 assert(hash(fs.readFileSync(lf))===saved&&hash(fs.readFileSync(af))===initialA&&hash(fs.readFileSync(bf))===alteredB,'read, restart or privacy action wrote data');
 report.checks.redactionAndRestartNoWrite=true;report.ledgerSha256=saved;report.rows=rows;report.docAHash=initialA;report.docBAlteredHash=alteredB;write();
}
run().then(()=>{clearTimeout(watchdog);cleanup();process.exit(0)}).catch(async e=>{clearTimeout(watchdog);report.error=String(e?.message||'package fixture error').slice(0,1200);try{const shot=await cdp('Page.captureScreenshot',{format:'png'});if(shot.data)fs.writeFileSync(path.join(out,'failure-renderer.png'),Buffer.from(shot.data,'base64'));}catch{}write();cleanup();process.exit(1)});
