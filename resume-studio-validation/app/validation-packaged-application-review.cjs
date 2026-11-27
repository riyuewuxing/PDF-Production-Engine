const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-packaged-application-review-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,sourceSha:require('./runner-manifest.json').sourceSha,checks:{},mode:'win-unpacked packaged ASAR; synthetic local files only'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,ws;
const pending=new Map(),listeners=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'packaged-application-review.json'),JSON.stringify(report,null,2));
function stop(){try{ws?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}}
function cleanup(){stop();try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='packaged application review watchdog';write();cleanup();process.exit(2)},170000);
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
const dialogText=()=>js(q(dialog)+'?.textContent||""');
const dialogHas=async t=>(await dialogText()).includes(t);
async function select(label,value){
 assert(await js('(()=>{const el='+q('select[aria-label="'+label+'"]')+';if(!el||![...el.options].some(o=>o.value==='+JSON.stringify(value)+'))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,'+JSON.stringify(value)+');el.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'missing selection '+label+' '+value);
}
const button=company=>'button[aria-label="只读复盘 '+company+'"]';
async function open(company){await until('packaged review entry '+company,()=>js('!!'+q(button(company)+':not([disabled])')));assert(await js('(()=>{const b='+q(button(company))+';if(!b||b.disabled)return false;b.scrollIntoView({block:"center"});b.click();return true})()'),'review entry missing');await until('packaged review modal',()=>js('!!'+q(dialog)));}
async function read(){await click('读取并对比');await until('packaged review read finished',()=>js('[...document.querySelectorAll('+JSON.stringify(dialog+' button')+')].some(b=>b.innerText.trim()==="读取并对比"&&!b.disabled)'));}
async function close(){await click('关闭对照');await until('packaged review closed',()=>js('!'+q(dialog)));}
async function baseline(){if(await active()!=='runner-fixture'){await select('快速切换简历版本','runner-fixture');await until('baseline version',async()=>await active()==='runner-fixture'&&await js(q('#basic-field-name')+'?.value==="打包合成甲"'));}}
async function run(){
 const data=path.join(root,'data'),resumes=path.join(data,'resumes'),archives=path.join(data,'.application-snapshots');
 fs.mkdirSync(resumes,{recursive:true});fs.mkdirSync(archives,{recursive:true});
 const master=path.join(data,'master.json'),existing=path.join(resumes,'runner-fixture.json'),other=path.join(resumes,'target-compare.json'),ledger=path.join(data,'applications.json');
 const current={...fixture,id:'packaged-current-doc-39',title:'打包当前合成稿',basic:{...fixture.basic,name:'打包合成甲',email:'pack-current@example.invalid',phone:'PACK_HIDDEN_CURRENT_39',fieldOrder:[
   {id:'name',key:'name',label:'姓名',visible:true},{id:'title',key:'title',label:'职位',visible:true},{id:'email',key:'email',label:'邮箱',visible:true},{id:'phone',key:'phone',label:'电话',visible:false}
 ]},skillContent:'PACK_CURRENT_SKILL_39',templateId:'teacher-table-classic',globalSettings:{...fixture.globalSettings,themeColor:'#123456'}};
 const old={...current,title:'打包封存原稿',templateId:'minimal-ats',basic:{...current.basic,email:'pack-sealed@example.invalid',phone:'PACK_HIDDEN_SEALED_39'},skillContent:'PACK_SEALED_SKILL_39',globalSettings:{...current.globalSettings,themeColor:'#654321'}};
 const gone={...old,id:'packaged-gone-doc-39',title:'打包已移除关联稿',basic:{...old.basic,email:'pack-gone@example.invalid'},skillContent:'PACK_GONE_SKILL_39'};
 const target={...current,id:'packaged-other-doc-39',title:'打包另一磁盘稿',basic:{...current.basic,email:'pack-other@example.invalid'}};
 const entries=[
   {id:'app-good-39',company:'打包合成学校',role:'物理教师',resumeSlug:'runner-fixture',snapshotId:'snapshot-pack-good-39',exportedFilePath:'C:/synthetic/missing.pdf',atsScore:62},
   {id:'app-gone-39',company:'打包已移除学校',role:'物理教师',resumeSlug:'gone-version',snapshotId:'snapshot-pack-gone-39',exportedFilePath:'',atsScore:null},
   {id:'app-bad-39',company:'打包异常学校',role:'物理教师',resumeSlug:'runner-fixture',snapshotId:'snapshot-pack-bad-39',exportedFilePath:'',atsScore:null}
 ];
 const writeSnapshot=(entry,doc,metaPatch={})=>{const f=path.join(archives,entry.snapshotId+'.json');fs.writeFileSync(f,JSON.stringify({meta:{id:entry.snapshotId,applicationId:entry.id,resumeSlug:entry.resumeSlug,exportedFilePath:entry.exportedFilePath,atsScore:entry.atsScore,createdAt:'2026-01-01T00:00:00Z',title:doc.title,templateId:doc.templateId,...metaPatch},document:doc}));return f};
 const archiveFiles=[writeSnapshot(entries[0],old),writeSnapshot(entries[1],gone),writeSnapshot(entries[2],{...old,basic:{...old.basic,email:'PACK_FOREIGN_PRIVATE_39'}},{applicationId:'wrong-identity'})];
 fs.writeFileSync(master,JSON.stringify({...current,id:'packaged-master-doc-39',title:'打包合成母库'}));fs.writeFileSync(existing,JSON.stringify(current));fs.writeFileSync(other,JSON.stringify(target));
 fs.writeFileSync(ledger,JSON.stringify({schemaVersion:1,applications:entries,coverLetters:[],interviewAnswers:{}}));
 const files=[master,existing,other,ledger,...archiveFiles],hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),hashes=()=>Object.fromEntries(files.map(f=>[path.relative(root,f),hash(f)]));
 const initial=hashes(),unchanged=()=>assert(JSON.stringify(hashes())===JSON.stringify(initial)&&fs.readdirSync(archives).length===3&&fs.readdirSync(resumes).filter(n=>n.endsWith('.json')).length===2,'read-only packaged review mutated source');
 const exe=path.resolve('release','win-unpacked','Resume Studio.exe');assert(fs.existsSync(exe),'packaged executable absent');
 report.asarSha256=hash(path.join(path.dirname(exe),'resources','app.asar'));
 await connect(exe);await baseline();await click('求职面试');await open(entries[0].company);await read();await until('packaged sealed comparison',()=>dialogHas('pack-current@example.invalid'));
 let text=await dialogText();assert(text.includes('pack-sealed@example.invalid')&&text.includes('永久投递原稿')&&text.includes('不读取或核验 PDF 字节')&&!text.includes('PACK_HIDDEN_'),'package source direction/mask/receipt disclosure wrong');
 unchanged();await capture('01-packaged-sealed-to-current');report.checks.sealedToCurrentAndMask=true;
 await click('样式');await until('packaged style diff',()=>dialogHas('#123456'));assert(await dialogHas('#654321')&&!await dialogHas('pack-current@example.invalid'),'style filter failed');await capture('02-packaged-style-diff');report.checks.styleDirection=true;
 await select('对照来源','disk:target-compare');await read();await until('packaged other disk comparison',()=>dialogHas('pack-other@example.invalid'));assert(await dialogHas('对照稿不是台账原关联版本'),'unrelated warning missing');unchanged();report.checks.otherDiskNoSwitch=true;
 await close();await open(entries[2].company);await read();await until('packaged mismatch refusal',()=>dialogHas('永久快照与台账身份'));assert(!await dialogHas('PACK_FOREIGN_PRIVATE_39'),'foreign archive exposed');await capture('03-packaged-mismatch-refusal');report.checks.foreignArchiveRejected=true;
 await close();await open(entries[1].company);await read();await until('packaged deleted origin',()=>dialogHas('pack-gone@example.invalid'));
 assert(await dialogHas('关联版本不在当前可用列表'),'missing origin warning absent');unchanged();await capture('04-packaged-deleted-origin');report.checks.deletedOriginReviewable=true;
 await close();await click('隐私脱敏');await until('packaged redaction gate',()=>js(q(button(entries[0].company))+'?.disabled===true'));assert(!await js('!!'+q(dialog)),'raw review visible in privacy mode');report.checks.redactionGate=true;
 unchanged();stop();await sleep(400);await connect(exe);await baseline();await click('求职面试');await open(entries[1].company);await read();await until('restart archive review',()=>dialogHas('pack-gone@example.invalid'));
 assert(await active()==='runner-fixture'&&!(await dialogText()).includes('PACK_HIDDEN_'),'restart changed active or exposed hidden data');unchanged();
 await capture('05-packaged-reopened-archive');report.checks.restartReadOnlyAndHashesPreserved=true;
 report.hashes=initial;write();
}
run().then(()=>{clearTimeout(watchdog);cleanup();process.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e?.message||'package fixture error').slice(0,500);write();cleanup();process.exit(1)});
