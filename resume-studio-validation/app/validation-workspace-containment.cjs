const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {spawn,execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const exe=require('electron');
const out=process.env.RESUME_STUDIO_BOOTSTRAP_OUT;
if(!out||!process.env.RUNNER_TEMP||process.platform!=='win32'||typeof exe!=='string')throw Error('isolated Windows runner required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'synthetic-production-redirected-'));
const appDir=process.cwd(),data=path.join(root,'data'),resumes=path.join(data,'resumes');
fs.mkdirSync(data,{recursive:true});
const external=path.join(root,'external-sentinel');fs.mkdirSync(external);
const fixture=require('./runner-fixture.json');
const originalBytes=Buffer.from(JSON.stringify({...fixture,id:'synthetic-external-resume',title:'External sentinel must not load',basic:{...fixture.basic,name:'Synthetic external sentinel'}}));
fs.writeFileSync(path.join(external,'outside.json'),originalBytes);
fs.symlinkSync(external,resumes,'junction');
const checks={},observations={};let child,ws,logs='',closed=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(v,m)=>{if(!v)throw Error(m)};
const report=error=>fs.writeFileSync(path.join(out,'workspace-containment-evidence.json'),JSON.stringify({sourceSha:'78d2264811a14a6ff8522235b422ccbffcec2126',runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks,observations,...(error?{error:String(error),logs:logs.slice(-4000)}:{})},null,2));
function killChild(){if(child?.pid&&!closed)try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{timeout:10000,stdio:'ignore'})}catch{}}
const watchdog=setTimeout(()=>{killChild();report('production startup watchdog expired');process.exit(2)},95000);
async function freePort(){const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r)});const p=s.address().port;await new Promise(r=>s.close(r));return p}
async function until(label,fn,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(child?.exitCode!==null&&child?.exitCode!==undefined)throw Error('production entry exited: '+child.exitCode+' '+logs);const value=await fn();if(value)return value;await sleep(200)}throw Error('timeout '+label)}
async function connect(url){
  ws=new WebSocket(url);
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('CDP connection timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(t);resolve()},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);reject(Error('CDP socket error'))},{once:true})});
  let seq=0;const pending=new Map();
  ws.addEventListener('message',event=>{let j;try{j=JSON.parse(event.data)}catch{return}const r=pending.get(j.id);if(!r)return;pending.delete(j.id);clearTimeout(r.timer);if(j.error)r.reject(Error(JSON.stringify(j.error)));else r.resolve(j.result)});
  return (method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method+' timeout'))},6000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
}
function originalCheck(){
  assert(fs.lstatSync(resumes).isSymbolicLink(),'synthetic junction replaced');
  assert(JSON.stringify(fs.readdirSync(external))===JSON.stringify(['outside.json']),'external directory changed');
  assert(fs.readFileSync(path.join(external,'outside.json')).equals(originalBytes),'external original changed');
  assert(!fs.existsSync(path.join(data,'master.json')),'unexpected initialization of master');
  assert(!fs.existsSync(path.join(resumes,'starter-resume.json')),'starter created in external directory');
}
async function run(){
  const port=await freePort();
  const env={...process.env,RESUME_STUDIO_DATA_DIR:root};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(exe,[appDir,'--remote-debugging-port='+port,'--remote-debugging-address=127.0.0.1'],{cwd:appDir,env,windowsHide:false,stdio:['ignore','pipe','pipe']});
  child.on('error',e=>{logs+='\n'+e.message});child.on('close',()=>{closed=true});
  for(const s of [child.stdout,child.stderr])s.on('data',b=>{logs=(logs+b.toString()).slice(-12000)});
  const page=await until('production renderer debugging endpoint',async()=>{try{const r=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(2000)});if(!r.ok)return null;return (await r.json()).find(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!t.url.startsWith('devtools:'))}catch{return null}},35000);
  const cdp=await connect(page.webSocketDebuggerUrl);
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('renderer evaluation failed');return r.result.value};
  const safeError='document.body.innerText.includes("无法加载本地简历")&&document.body.innerText.includes("工作区目录不安全")&&!!document.querySelector("details[aria-label=\\"启动异常时的备份恢复\\"]")&&!document.querySelector("#basic-field-name")';
  await until('production startup refusal and existing recovery entry',async()=>{try{return await evaluate(safeError)}catch{return false}});
  originalCheck();checks.productionStartupRefusesRedirectedWorkspace=true;
  const read=await evaluate('window.resumeDesktop.resumes.get("outside").then(()=>false,e=>String(e).includes("工作区目录不安全"))');
  assert(read,'direct trusted editor IPC followed directory link');
  checks.directIpcReadRefused=true;
  const creation=await evaluate('window.resumeDesktop.resumes.create({slug:"new-outside",title:"Synthetic forbidden creation",document:'+JSON.stringify(fixture)+'}).then(()=>false,e=>String(e).includes("工作区目录不安全"))');
  assert(creation,'trusted editor IPC allowed external creation');originalCheck();checks.directIpcCreationRefused=true;
  await evaluate('document.fonts.ready.then(()=>true)');await sleep(350);
  const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});assert(typeof shot.data==='string'&&shot.data.length>1000,'empty screenshot');fs.writeFileSync(path.join(out,'01-redirected-workspace-recovery.png'),Buffer.from(shot.data,'base64'));
  const retry=await evaluate('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText==="重试加载");if(!b||b.disabled)return false;b.click();return true})()');assert(retry,'retry button unavailable');
  await until('retry refusal persists',async()=>{try{return await evaluate(safeError)}catch{return false}});
  originalCheck();checks.retryPreservesExternalDirectory=true;
  observations.externalSha256=createHash('sha256').update(originalBytes).digest('hex');
  ws.close();ws=null;
  const ps='$p=Get-Process -Id '+child.pid+' -ErrorAction Stop; if(!$p.CloseMainWindow()){throw "no production window"}; $p.WaitForExit(8000)';
  const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8',timeout:15000});
  assert(result.includes('True'),'production window did not close');closed=true;checks.productionNativeWindowClosed=true;
  originalCheck();report();
}
run().then(()=>{clearTimeout(watchdog);fs.rmdirSync(resumes);assert(fs.readFileSync(path.join(external,'outside.json')).equals(originalBytes),'junction cleanup changed external original');fs.rmSync(root,{recursive:true,force:true});}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);try{ws?.close()}catch{}killChild();process.exitCode=1});
