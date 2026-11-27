const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-packaged-comparison-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,sourceSha:require('./runner-manifest.json').sourceSha,checks:{},mode:'win-unpacked packaged ASAR; synthetic local files only'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,ws;
const pending=new Map(),listeners=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'packaged-version-comparison.json'),JSON.stringify(report,null,2));
function stop(){try{ws?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}}
function cleanup(){stop();try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='packaged version comparison watchdog';write();cleanup();process.exit(2)},170000);
async function until(label,f,ms=25000){const end=Date.now()+ms;while(Date.now()<end){try{if(await f())return}catch{}await sleep(150)}throw Error('timeout '+label);}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));})}
async function js(expression,userGesture=false){const v=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture});if(v.exceptionDetails)throw Error('renderer evaluation failed');return v.result.value;}
const eventOnce=(method,ms=8000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(method);reject(Error('CDP event timeout '+method));},ms);listeners.set(method,{resolve:v=>{clearTimeout(timer);resolve(v);}});});
const version='select[aria-label="快速切换简历版本"]',dialog='[role="dialog"][aria-label="只读版本差异对照"]';
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
const dialogText=()=>js(q(dialog)+'?.textContent||""');
const dialogHas=async t=>(await dialogText()).includes(t);
async function select(label,value){
  assert(await js('(()=>{const el='+q('select[aria-label="'+label+'"]')+';if(!el||![...el.options].some(o=>o.value==='+JSON.stringify(value)+'))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,'+JSON.stringify(value)+');el.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'missing selection '+label+' '+value);
}
async function open(){await click('对比版本 / 历史快照');await until('packaged comparison dialog',()=>js('!!'+q(dialog)));}
async function read(){await click('读取并对比');await until('packaged read finished',()=>js('[...document.querySelectorAll('+JSON.stringify(dialog+' button')+')].some(b=>b.innerText.trim()==="读取并对比"&&!b.disabled)'));}
async function close(){await click('关闭对照');await until('packaged comparison closed',()=>js('!'+q(dialog)));}
async function ensureBaseline(){if(await active()!=='runner-fixture'){await select('快速切换简历版本','runner-fixture');await until('baseline version',async()=>await active()==='runner-fixture'&&await js(q('#basic-field-name')+'?.value==="打包合成甲"'));}}
async function run(){
  const data=path.join(root,'data'),resumes=path.join(data,'resumes'),backups=path.join(data,'.backups','runner-fixture');fs.mkdirSync(resumes,{recursive:true});fs.mkdirSync(backups,{recursive:true});
  const master=path.join(data,'master.json'),existing=path.join(resumes,'runner-fixture.json'),other=path.join(resumes,'compare-target.json'),history=path.join(backups,'snapshot-packaged-38.json');
  const current={...fixture,id:'packaged-compare-doc-38',title:'打包当前合成版本',basic:{...fixture.basic,name:'打包合成甲',email:'pack-current@example.invalid',phone:'PACK_HIDDEN_PHONE_CURRENT_38',fieldOrder:[
    {id:'name',key:'name',label:'姓名',visible:true},{id:'title',key:'title',label:'职位',visible:true},{id:'email',key:'email',label:'邮箱',visible:true},{id:'phone',key:'phone',label:'电话',visible:false}
  ]},skillContent:'PACK_CURRENT_SKILL_38'};
  const target={...current,id:'packaged-compare-other-38',title:'打包对照合成版本',templateId:'teacher-table-classic',basic:{...current.basic,email:'pack-target@example.invalid',phone:'PACK_HIDDEN_PHONE_TARGET_38'},skillContent:'PACK_TARGET_SKILL_38',globalSettings:{...current.globalSettings,themeColor:'#123456'}};
  const historical={...current,title:'打包历史合成版本',basic:{...current.basic,email:'pack-history@example.invalid',phone:'PACK_HIDDEN_PHONE_HISTORY_38'},skillContent:'PACK_HISTORY_SKILL_38'};
  fs.writeFileSync(master,JSON.stringify({...current,id:'packaged-compare-master-38',title:'合成母库'}));fs.writeFileSync(existing,JSON.stringify(current));fs.writeFileSync(other,JSON.stringify(target));
  fs.writeFileSync(history,JSON.stringify({meta:{id:'snapshot-packaged-38',slug:'runner-fixture',createdAt:'2026-01-01T00:00:00Z',reason:'打包合成历史',templateId:historical.templateId,title:historical.title,charCount:0},document:historical}));
  const files=[master,existing,other,history],hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),hashes=()=>Object.fromEntries(files.map(f=>[path.relative(root,f),hash(f)]));
  const initial=hashes(),unchanged=()=>assert(JSON.stringify(hashes())===JSON.stringify(initial)&&fs.readdirSync(backups).length===1&&fs.readdirSync(resumes).filter(n=>n.endsWith('.json')).length===2,'comparison mutated persisted documents or history');
  const exe=path.resolve('release','win-unpacked','Resume Studio.exe');assert(fs.existsSync(exe),'packaged executable absent');const asar=path.join(path.dirname(exe),'resources','app.asar');report.asarSha256=hash(asar);
  await connect(exe);await ensureBaseline();await click('版本母库');await open();
  await read();await until('same saved version has no diff',()=>dialogHas('所比较的存储内容、结构和样式字段没有差异。'));
  unchanged();report.checks.sameDiskNoDifference=true;
  await select('对照来源','disk:compare-target');await read();await until('different saved version',()=>dialogHas('pack-target@example.invalid'));
  let text=await dialogText();assert(text.includes('pack-current@example.invalid')&&text.includes('PACK_TARGET_SKILL_38')&&!text.includes('PACK_HIDDEN_PHONE_'),'packaged comparison content or masking mismatch');
  await capture('01-packaged-version-comparison');report.checks.versionComparisonAndDefaultMask=true;
  await click('样式');await until('style diff',()=>dialogHas('#123456'));assert(!(await dialogText()).includes('pack-target@example.invalid'),'style filter not isolated');await capture('02-packaged-style-diff');
  report.checks.styleFilter=true;
  await select('对照来源','snapshot:snapshot-packaged-38');await read();await until('actual packaged snapshot IPC',()=>dialogHas('pack-history@example.invalid'));
  text=await dialogText();assert(text.includes('PACK_HISTORY_SKILL_38')&&text.includes('快照创建时间')&&!text.includes('PACK_HIDDEN_PHONE_'),'packaged historical comparison mismatch');
  unchanged();await capture('03-packaged-historical-comparison');report.checks.actualSnapshotIpcReadOnly=true;
  const valid=await js('window.resumeDesktop.snapshots.getForComparison("runner-fixture","snapshot-packaged-38").then(r=>r.document.id==="packaged-compare-doc-38"&&r.meta.id==="snapshot-packaged-38")');assert(valid,'packaged bridge did not return selected history');
  const rejected=await js('window.resumeDesktop.snapshots.getForComparison("runner-fixture","snapshot-packaged-38.json").then(()=>false,()=>true)');assert(rejected,'packaged bridge accepted alias');report.checks.snapshotBridgeIdentityAndAlias=true;
  await close();await click('隐私脱敏');await until('redaction gate',()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==="对比版本 / 历史快照"&&b.disabled)'));
  assert(!await js('!!'+q(dialog)),'raw comparison visible in privacy mode');await capture('04-packaged-redaction-gate');report.checks.redactionBlocksComparison=true;
  unchanged();stop();await sleep(400);await connect(exe);await ensureBaseline();await click('版本母库');await open();await select('对照来源','snapshot:snapshot-packaged-38');await read();
  await until('restart historical comparison',()=>dialogHas('pack-history@example.invalid'));assert((await dialogText()).includes('pack-current@example.invalid')&&!(await dialogText()).includes('PACK_HIDDEN_PHONE_'),'restart historical comparison changed or exposed hidden values');
  unchanged();assert(await active()==='runner-fixture','comparison switched active version');await capture('05-packaged-history-reopened');report.checks.restartReadbackAndHashesPreserved=true;
  report.hashes=initial;write();
}
run().then(()=>{clearTimeout(watchdog);cleanup();process.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e?.message||'package fixture error').slice(0,500);write();cleanup();process.exit(1)});
