const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-packaged-ai-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,checks:{},calls:[],mode:'win-unpacked packaged ASAR; synthetic loopback only'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,server,ws,mode='success',active=false;
const pending=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'packaged-ai-receipts.json'),JSON.stringify(report,null,2));
async function until(label,f,ms=30000){const end=Date.now()+ms;while(Date.now()<end){try{if(await f())return}catch{}await sleep(150)}throw Error('timeout '+label)}
function stop(){try{ws?.close()}catch{}try{server?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='packaged fixture watchdog';write();stop();process.exit(2)},125000);
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));})}
async function js(expression){const v=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error('renderer eval failed '+expression.slice(0,100));return v.result.value;}
async function run(){
  const data=path.join(root,'data');fs.mkdirSync(path.join(data,'resumes'),{recursive:true});
  const original=JSON.stringify({...fixture,id:'synthetic-packaged-ai-doc',title:'合成便携包回执'});
  fs.writeFileSync(path.join(data,'master.json'),original);
  fs.writeFileSync(path.join(data,'resumes','runner-fixture.json'),JSON.stringify({...fixture,id:'synthetic-packaged-ai-version',title:'合成便携包回执'}));
  server=http.createServer((req,res)=>{
    let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{
      try{
        const b=JSON.parse(raw);
        assert(active&&req.method==='POST'&&req.url==='/v1/chat/completions'&&b.model==='synthetic-packaged-model'&&b.messages.length===2&&b.messages[0].content==='Connectivity probe. Reply only OK.'&&b.messages[1].content===JSON.stringify({task:'connection-probe',message:'synthetic data only'})&&b.max_tokens===64,'unexpected packaged outbound request');
        report.calls.push({mode,model:b.model,cap:b.max_tokens});
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'synthetic-packaged-returned',usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14},choices:[{finish_reason:mode==='limit'?'length':'stop',message:{content:'OK'}}]}));
      }catch(e){report.error=String(e.message);res.writeHead(400);res.end('fixture rejected');}
    });
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const reserved=net.createServer();await new Promise(r=>reserved.listen(0,'127.0.0.1',r));const debugPort=reserved.address().port;await new Promise(r=>reserved.close(r));
  const exe=path.resolve('release','win-unpacked','Resume Studio.exe');assert(fs.existsSync(exe),'packaged executable absent');
  const asar=path.join(path.dirname(exe),'resources','app.asar');assert(fs.existsSync(asar),'packaged ASAR absent');report.asarSha256=crypto.createHash('sha256').update(fs.readFileSync(asar)).digest('hex');
  child=spawn(exe,['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debugPort],{cwd:path.dirname(exe),env:{...process.env,RESUME_STUDIO_DATA_DIR:root},stdio:'ignore',windowsHide:false});
  let target;await until('packaged renderer CDP',async()=>{
    const r=await fetch('http://127.0.0.1:'+debugPort+'/json/list',{signal:AbortSignal.timeout(2000)});
    target=(await r.json()).find(t=>t.type==='page'&&t.url.startsWith('file:')&&t.webSocketDebuggerUrl);return !!target;
  },35000);
  assert(new URL(target.webSocketDebuggerUrl).hostname==='127.0.0.1'||new URL(target.webSocketDebuggerUrl).hostname==='localhost','CDP not loopback');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(!d.id)return;const p=pending.get(d.id);if(!p)return;pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);});
  await until('packaged editor ready',()=>js('document.querySelector("#basic-field-name")?.value==="演示候选人"&&typeof window.resumeDesktop?.ai?.requestCompletionOutcome==="function"'));
  const names=await js('["requestCompletion","requestCompletionWithReceipt","requestCompletionOutcome"].map(k=>typeof window.resumeDesktop.ai[k])');
  assert(names.every(n=>n==='function'),'preload contract absent');report.checks.packagedPreloadPresent=true;
  const old=await js('window.resumeDesktop.ai.getSettings()');
  const saved=await js('window.resumeDesktop.ai.saveSettings('+JSON.stringify({...old,enabled:true,providerLabel:'Synthetic packaged loopback',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',model:'synthetic-packaged-model',apiKey:'',maxOutputTokens:128,timeoutMs:25000,deepseekThinking:'provider-default'})+')');
  assert(saved.enabled&&saved.model==='synthetic-packaged-model'&&saved.apiKey==='','packaged profile save failed');
  const req={profile:{profileId:saved.profileId,revision:saved.revision,baseUrl:saved.baseUrl,model:saved.model},systemPrompt:'Connectivity probe. Reply only OK.',userPrompt:JSON.stringify({task:'connection-probe',message:'synthetic data only'}),temperature:0,maxTokens:64,timeoutMs:25000};
  active=true;
  for(const method of ['requestCompletion','requestCompletionWithReceipt','requestCompletionOutcome']){
    mode=method==='requestCompletionOutcome'?'limit':'success';
    const r=await js('window.resumeDesktop.ai['+JSON.stringify(method)+']('+JSON.stringify({...req,requestId:crypto.randomUUID()})+')');
    if(method==='requestCompletion')assert(r==='OK','packaged legacy string wrong');
    if(method==='requestCompletionWithReceipt')assert(r.text==='OK'&&r.receipt.totalTokens===14,'packaged legacy receipt wrong');
    if(method==='requestCompletionOutcome')assert(r.ok===false&&r.error.code==='LIMIT'&&r.error.receipt.totalTokens===14&&!('text' in r.error),'packaged structured failure metadata wrong');
  }
  report.checks.packagedThreeIpcContracts=true;
  const click=async name=>{await until('button '+name,()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(name)+'&&!b.disabled&&b.getClientRects().length)'));assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.innerText.trim()==='+JSON.stringify(name)+'&&!b.disabled&&b.getClientRects().length);if(!b)return false;b.click();return true})()'),'button missing '+name)};
  await click('诊断优化');await click('AI 润色 Diff');await click('已启用 · 修改');
  mode='limit';await click('测试模型连接');
  const receipt='document.querySelector('+JSON.stringify('[aria-label="连接测试调用回执"]')+')';
  await until('packaged UI failure receipt',()=>js(receipt+'?.dataset.attemptState==="rejected"'));
  const visible=await js(receipt+'?.innerText||""');assert(visible.includes('合计 14 tokens')&&visible.includes('实际请求上限 64 输出 tokens'),'packaged receipt missing actual counters');
  report.checks.packagedUiReceipt=true;report.receipt=visible;
  await js(receipt+'?.scrollIntoView({block:"center",behavior:"instant"})');await sleep(500);const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'packaged-ai-receipt.png'),Buffer.from(shot.data,'base64'));
  assert(report.calls.length===4&&!report.error,'unexpected packaged provider calls');
  assert(fs.readFileSync(path.join(data,'master.json'),'utf8')===original,'packaged probe modified original');
  report.checks.originalUnchanged=true;report.checks.noExternalNetworkByFixture=true;
  active=false;write();
}
run().then(()=>{clearTimeout(watchdog);stop();process.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e?.message||'package fixture error').slice(0,500);write();stop();process.exit(1)});
