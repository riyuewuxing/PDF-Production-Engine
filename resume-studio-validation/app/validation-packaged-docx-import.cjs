const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-packaged-import-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,sourceSha:require('./runner-manifest.json').sourceSha,checks:{},mode:'win-unpacked packaged ASAR; synthetic local files only'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,ws;
const pending=new Map(),listeners=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'packaged-docx-import.json'),JSON.stringify(report,null,2));
function stop(){try{ws?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}}
function cleanup(){stop();try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='packaged import watchdog';write();cleanup();process.exit(2)},170000);
async function until(label,f,ms=25000){const end=Date.now()+ms;while(Date.now()<end){try{if(await f())return}catch{}await sleep(150)}throw Error('timeout '+label);}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));})}
async function js(expression,userGesture=false){const v=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture});if(v.exceptionDetails)throw Error('renderer evaluation failed');return v.result.value;}
const eventOnce=(method,ms=8000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(method);reject(Error('CDP event timeout '+method));},ms);listeners.set(method,{resolve:v=>{clearTimeout(timer);resolve(v);}});});
const version='select[aria-label="快速切换简历版本"]',dialog='[role="dialog"][aria-label*="简历解析导入确认"]';
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
async function run(){
  const data=path.join(root,'data'),resumes=path.join(data,'resumes');fs.mkdirSync(resumes,{recursive:true});
  const master=path.join(data,'master.json'),existing=path.join(resumes,'runner-fixture.json');
  fs.writeFileSync(master,JSON.stringify({...fixture,id:'synthetic-packaged-import-master',title:'合成母库'}));
  fs.writeFileSync(existing,JSON.stringify(fixture));const masterBefore=fs.readFileSync(master),existingBefore=fs.readFileSync(existing);
  const input=path.join(root,'packaged-import.docx');
  const fixturePath=process.env.RESUME_STUDIO_TEST_DOCX;assert(fixturePath&&fs.existsSync(fixturePath),'independent DOCX fixture missing');
  fs.copyFileSync(fixturePath,input);const raw=fs.readFileSync(input);
  const exe=path.resolve('release','win-unpacked','Resume Studio.exe');assert(fs.existsSync(exe),'packaged executable absent');const asar=path.join(path.dirname(exe),'resources','app.asar');report.asarSha256=crypto.createHash('sha256').update(fs.readFileSync(asar)).digest('hex');
  await connect(exe);const count=()=>fs.readdirSync(resumes).filter(n=>n.endsWith('.json')).length;const initial=count();
  await click('版本母库');await chooseFile('从 DOCX 导入',input);await until('packaged import modal',()=>js('!!'+q(dialog)));
  assert(count()===initial,'preview changed disk');assert(await js('[...document.querySelectorAll('+JSON.stringify(dialog+' button')+')].some(b=>b.innerText.trim()==="创建为新简历版本"&&b.disabled)'),'explicit source decision not required');
  assert(await js(q(dialog)+'?.innerText.includes("不是视觉脱敏")'),'visual privacy warning missing');
  const extracted=await js(q(dialog+' pre')+'?.textContent||""');
  assert(extracted.includes('表格单元甲')&&extracted.includes('表格单元乙')&&!/HEADER_PRIVATE_37|FOOTER_PRIVATE_37/.test(extracted),'independent DOCX body scope mismatch');
  report.checks.previewNoWriteAndDecisionRequired=true;report.checks.independentProducerChineseBody=true;await capture('packaged-docx-import-review');
  assert(await js('(()=>{const r='+q(dialog+' input[name="import-unclassified"]')+';if(!r)return false;r.click();return true})()'),'source choice absent');await capture('packaged-docx-import-retention',dialog+' input[name="import-unclassified"]');
  assert(await js('[...document.querySelectorAll('+JSON.stringify(dialog+' button')+')].some(b=>b.innerText.trim()==="创建为新简历版本"&&b.disabled)'),'DOCX scope acknowledgement bypassed');
  assert(await js('(()=>{const c='+q(dialog+' input[type="checkbox"]')+';if(!c)return false;c.click();return true})()'),'DOCX scope acknowledgement absent');
  await click('创建为新简历版本');let slug,created;
  await until('packaged imported disk',async()=>{slug=await active();if(!slug||slug==='runner-fixture'||slug==='master')return false;const f=path.join(resumes,slug+'.json');if(!fs.existsSync(f))return false;created=JSON.parse(fs.readFileSync(f,'utf8'));return created.basic.name==='合成甲';});
  assert(count()===initial+1&&created.education.map(e=>e.school).join('|')==='甲示例学院|乙示例学院'&&created.basic.employmentStatus===''&&created.basic.title==='高中物理教师'&&created.basic.email==='pack@example.invalid','packaged structured record mismatch');
  assert(created.menuSections.find(s=>s.id==='custom-import-unclassified')?.enabled===false&&created.customData['custom-import-unclassified']?.[0]?.description.includes('PACKAGED_UNCLASSIFIED_MARKER_37'),'packaged source retention mismatch');
  const file=path.join(resumes,slug+'.json'),saved=fs.readFileSync(file);
  assert(fs.readFileSync(master).equals(masterBefore)&&fs.readFileSync(existing).equals(existingBefore)&&fs.readFileSync(input).equals(raw),'source changed');
  report.checks.exactDiskAndOriginalPreserved=true;
  await click('内容编辑');await until('packaged visible output',()=>js('(()=>{const t=[...document.querySelectorAll(".a4-sheet")].map(e=>e.innerText).join("\\n");return t.includes("甲示例学院")&&t.includes("乙示例学院")&&!t.includes("PACKAGED_UNCLASSIFIED_MARKER_37")})()'));await capture('packaged-docx-import-visible');
  report.checks.hiddenSourceExcludedFromPreview=true;
  stop();await sleep(300);await connect(exe);
  if(await active()!==slug){assert(await js('(()=>{const e='+q(version)+';if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,'+JSON.stringify(slug)+');e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'version selector unavailable');}
  await until('reopened version',()=>js(q('#basic-field-name')+'?.value==="合成甲"'));
  assert(fs.readFileSync(file).equals(saved)&&fs.readFileSync(master).equals(masterBefore)&&fs.readFileSync(existing).equals(existingBefore),'restart modified originals or imported file');
  report.checks.restartReadback=true;await capture('packaged-docx-import-reopened');fs.writeFileSync(path.join(out,'synthetic-independent-chinese.docx'),raw);write();
}
run().then(()=>{clearTimeout(watchdog);cleanup();process.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e?.message||'package fixture error').slice(0,500);write();cleanup();process.exit(1)});
