const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {spawn,execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const exe=require('electron');
const out=process.env.RESUME_STUDIO_BOOTSTRAP_OUT;
if(!out||!process.env.RUNNER_TEMP||process.platform!=='win32'||typeof exe!=='string')throw Error('isolated Windows runner required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'synthetic-production-damaged-'));
const appDir=process.cwd(),data=path.join(root,'data'),resumes=path.join(data,'resumes');
fs.mkdirSync(resumes,{recursive:true});
const originals=new Map([['master.json',Buffer.from('{synthetic damaged master')],['resumes/broken.json',Buffer.from('{}')]]);
for(const [rel,bytes] of originals)fs.writeFileSync(path.join(data,...rel.split('/')),bytes);
const checks={},observations={};let child,ws,logs='',closed=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(v,m)=>{if(!v)throw Error(m)};
const report=error=>fs.writeFileSync(path.join(out,'production-startup-evidence.json'),JSON.stringify({sourceSha:'74a017a7760ed5c60fe77aa5877ee8a88d5cba3d',runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks,observations,...(error?{error:String(error),logs:logs.slice(-4000)}:{})},null,2));
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
function originalCheck(){for(const [rel,bytes] of originals)assert(fs.readFileSync(path.join(data,...rel.split('/'))).equals(bytes),'original file altered '+rel);assert(JSON.stringify(fs.readdirSync(resumes))===JSON.stringify(['broken.json']),'unexpected new resume during bootstrap');assert(!fs.existsSync(path.join(resumes,'starter-resume.json')),'starter created over damaged workspace')}
async function run(){
  const port=await freePort();
  const env={...process.env,RESUME_STUDIO_DATA_DIR:root};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(exe,[appDir,'--remote-debugging-port='+port,'--remote-debugging-address=127.0.0.1'],{cwd:appDir,env,windowsHide:false,stdio:['ignore','pipe','pipe']});
  child.on('error',e=>{logs+='\n'+e.message});child.on('close',()=>{closed=true});
  for(const s of [child.stdout,child.stderr])s.on('data',b=>{logs=(logs+b.toString()).slice(-12000)});
  const page=await until('production renderer debugging endpoint',async()=>{try{const r=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(2000)});if(!r.ok)return null;return (await r.json()).find(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!t.url.startsWith('devtools:'))}catch{return null}},35000);
  const cdp=await connect(page.webSocketDebuggerUrl);
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('renderer evaluation failed');return r.result.value};
  await until('real production bootstrap reached damaged-document error UI',async()=>{try{return await evaluate('document.body.innerText.includes("无法加载本地简历")&&document.body.innerText.includes("有 2 份简历文件无法读取")&&!!document.querySelector("details[aria-label=\\"启动异常时的备份恢复\\"]")')}catch{return false}});
  originalCheck();checks.productionBootstrapDoesNotInitializeOverDamagedWorkspace=true;
  assert(await evaluate('!document.querySelector("#basic-field-name")'),'unexpected editor with no valid documents');
  assert(await evaluate('(()=>{const e=document.querySelector("details[aria-label=\\"简历文件读取异常\\"]");e.open=true;return document.body.innerText.includes("master.json：JSON 损坏")&&document.body.innerText.includes("broken.json：数据格式不符合规范")})()'),'actual warning reasons missing');
  checks.productionErrorShowsSpecificFilesAndBackupEntry=true;
  await evaluate('document.fonts.ready.then(()=>true)');await sleep(350);
  const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});assert(typeof shot.data==='string'&&shot.data.length>1000,'empty production screenshot');fs.writeFileSync(path.join(out,'11-production-entry-damaged-workspace.png'),Buffer.from(shot.data,'base64'));
  const btn=await evaluate('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText==="重试加载");if(!b||b.disabled)return false;b.click();return true})()');assert(btn,'retry button unavailable');
  await until('production retry preserves error and backup entry',async()=>{try{return await evaluate('document.body.innerText.includes("有 2 份简历文件无法读取")&&!!document.querySelector("details[aria-label=\\"启动异常时的备份恢复\\"]")')}catch{return false}});
  originalCheck();checks.productionRetryDoesNotOverwriteDamagedFiles=true;
  observations.pid=child.pid;observations.originalHashes=Object.fromEntries([...originals].map(([p,b])=>[p,createHash('sha256').update(b).digest('hex')]));
  ws.close();ws=null;
  const ps='$p=Get-Process -Id '+child.pid+' -ErrorAction Stop; if(!$p.CloseMainWindow()){throw "no production window"}; $p.WaitForExit(8000)';
  const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8',timeout:15000});
  assert(result.includes('True'),'production window did not close');closed=true;checks.productionNativeWindowClosed=true;
  originalCheck();report();
}
run().then(()=>{clearTimeout(watchdog);fs.rmSync(root,{recursive:true,force:true});}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);try{ws?.close()}catch{}killChild();process.exitCode=1});
