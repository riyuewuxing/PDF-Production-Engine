const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-packaged-submission-package-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,sourceSha:require('./runner-manifest.json').sourceSha,checks:{},mode:'win-unpacked packaged ASAR; synthetic local files only'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,ws;
const pending=new Map(),listeners=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'packaged-submission-package.json'),JSON.stringify(report,null,2));
function stop(){try{ws?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}}
function cleanup(){stop();try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='packaged application review watchdog';write();cleanup();process.exit(2)},210000);
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
async function run(){
 const data=path.join(root,'data'),resumes=path.join(data,'resumes'),exports=path.join(root,'exports');
 fs.mkdirSync(resumes,{recursive:true});
 const doc={...fixture,id:'packaged-receipt-41',title:'打包凭证合成稿',basic:{...fixture.basic,name:'打包凭证候选'}};
 fs.writeFileSync(path.join(resumes,'runner-fixture.json'),JSON.stringify(doc));
 const exe=path.resolve('release','win-unpacked','Resume Studio.exe');assert(fs.existsSync(exe),'packaged exe missing');
 report.asarSha256=hash(fs.readFileSync(path.join(path.dirname(exe),'resources','app.asar')));
 await connect(exe);
 await until('fixture editor',()=>js(q('#basic-field-name')+'?.value==="打包凭证候选"'));
 await click('导出 PDF');await until('export completed',()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==="记入投递并锁定快照"&&!b.disabled)'));
 const pdfs=fs.readdirSync(exports).filter(n=>n.endsWith('.pdf'));assert(pdfs.length===1,'expected actual PDF');
 const file=path.join(exports,pdfs[0]),bytes=fs.readFileSync(file),sha=hash(bytes);
 assert(bytes.subarray(0,5).toString()==='%PDF-','not actual PDF');
 await click('记入投递并锁定快照');await until('receipt shown',()=>has(sha));await capture('01-packaged-actual-receipt');
 const selector='[role="dialog"] input[placeholder="如：示例第一中学"]';
 assert(await js('(()=>{const el='+q(selector)+';if(!el)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"打包凭证学校");el.dispatchEvent(new Event("input",{bubbles:true}));return true})()'),'company input');
 await click('确认记入并锁定快照');
 const ledgerFile=path.join(data,'applications.json');let entry;
 await until('archived receipt',()=>{if(!fs.existsSync(ledgerFile))return false;entry=JSON.parse(fs.readFileSync(ledgerFile,'utf8')).applications.find(a=>a.company==='打包凭证学校');return !!entry?.pdfReceipt});
 assert(entry.pdfReceipt.sha256===sha&&entry.pdfReceipt.sizeBytes===bytes.length,'persisted receipt mismatch');
 const archiveFile=path.join(data,'.application-snapshots',entry.snapshotId+'.json'),archive=JSON.parse(fs.readFileSync(archiveFile,'utf8'));
 assert(JSON.stringify(archive.meta.pdfReceipt)===JSON.stringify(entry.pdfReceipt)&&hash(Buffer.from(JSON.stringify(archive.document)))===entry.pdfReceipt.documentSha256,'archive mismatch');
 report.checks.realExportAndSealedReceipt=true;report.receipt=entry.pdfReceipt;
 const hashes=()=>[ledgerFile,archiveFile,path.join(resumes,'runner-fixture.json')].map(f=>hash(fs.readFileSync(f))),before=hashes(),unchanged=()=>assert(JSON.stringify(hashes())===JSON.stringify(before),'verification mutated source');
 await click('求职面试');await rowClick('核验 PDF 打包凭证学校');await until('verified',()=>has('记录路径字节一致'));await capture('02-packaged-verified');report.checks.verifiedBeforeRestart=true;
 unchanged();stop();await sleep(400);await connect(exe);await click('求职面试');await rowClick('核验 PDF 打包凭证学校');await until('verified after restart',()=>has('记录路径字节一致'));await capture('03-packaged-verified-restart');report.checks.verifiedAfterRestart=true;unchanged();
 // Exercise actual OS-owned dialogs from the packaged executable, not a mocked IPC.
 const nativeClick=(title,button,id='')=>execFileSync('pwsh',['-NoProfile','-NonInteractive','-File',path.resolve('validation-native-dialog.ps1'),'-OwnerPid',String(child.pid),'-Title',title,'-Button',button,'-ButtonId',id||'none'],{encoding:'utf8',timeout:24000,windowsHide:true});
 const zipBefore=fs.readdirSync(exports).filter(n=>n.endsWith('.zip'));
 await rowClick('制作投递包 打包凭证学校');
 nativeClick('选择投递包内容','仅封存简历');
 nativeClick('确认投递包文件清单','确认清单并另存');
 nativeClick('另存投递包 ZIP（不覆盖现有文件）','Save','1');
 await until('actual package written',()=>has('本地投递包 ZIP 已生成（未发送）'));
 const zipAfter=fs.readdirSync(exports).filter(n=>n.endsWith('.zip')&&!zipBefore.includes(n));
 assert(zipAfter.length===1,'expected exactly one new ZIP');
 const zip=fs.readFileSync(path.join(exports,zipAfter[0]));
 assert(await has(hash(zip))&&await has('resume.pdf'),'package receipt not visible');
 fs.writeFileSync(path.join(out,'actual-package.zip'),zip);fs.writeFileSync(path.join(out,'expected-resume.pdf'),bytes);
 report.packageSha256=hash(zip);report.checks.realNativeDialogPackageAfterRestart=true;
 await capture('06-packaged-submission-package');unchanged();
 const altered=Buffer.from(bytes);altered[altered.length-10]^=1;fs.writeFileSync(file,altered);
 await rowClick('核验 PDF 打包凭证学校');await until('changed',()=>has('文件字节与封存凭证不一致'));await capture('04-packaged-changed');report.checks.detectsSameSizeReplacement=true;unchanged();
 fs.rmSync(file);await rowClick('核验 PDF 打包凭证学校');await until('missing',()=>has('记录文件缺失'));await capture('05-packaged-missing');report.checks.detectsMissing=true;unchanged();
 await click('隐私脱敏');await until('redaction',()=>js(q(row('核验 PDF 打包凭证学校'))+'?.disabled===true'));report.checks.redactionGate=true;assert(await js(q(row('制作投递包 打包凭证学校'))+'?.disabled===true'),'package privacy gate');report.checks.packageRedactionGate=true;
 report.checks.originalArchiveAndLedgerUnchanged=true;write();
}
run().then(()=>{clearTimeout(watchdog);cleanup();process.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e?.message||'package fixture error').slice(0,500);write();cleanup();process.exit(1)});
