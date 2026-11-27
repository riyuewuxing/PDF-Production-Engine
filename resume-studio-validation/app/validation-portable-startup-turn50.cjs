const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-portable-t50-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,sourceSha:require('./runner-manifest.json').sourceSha,checks:{},mode:'single-file portable wrapper; synthetic legacy migration, explicit trash and permanent deletion; normal default-root cold starts'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,ws;
const pending=new Map(),listeners=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'packaged-queue-execution.json'),JSON.stringify(report,null,2));
function stop(){try{ws?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}}
function cleanup(){stop();try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='packaged job queue watchdog';write();cleanup();process.exit(2)},390000);
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
  const env={...process.env};delete env.RESUME_STUDIO_DATA_DIR;
  if(workspace)env.RESUME_STUDIO_DATA_DIR=workspace;
  child=spawn(exe,['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{cwd:path.dirname(exe),env,stdio:'ignore',windowsHide:false});
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
function legacyFixture() {
  return {
    id: 'synthetic-legacy-19', title: 'Independent compatibility fixture',
    templateId: 'classic', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    basic: {
      name: '测试甲', title: '科学教学助理', employementStatus: '示例状态',
      email: 'sample19@example.invalid', phone: '0000000000', location: '虚构地点',
      fieldOrder: [{id:'f1',key:'name',label:'姓名'}, {id:'f2',key:'title',label:'职位'},
        {id:'f3',key:'employementStatus',label:'状态'}],
      icons: {employementStatus:'Briefcase'},
      customFields: [{id:'cf1',label:'示例字段',value:'保留值',visible:false}],
    },
    menuSections: [
      {id:'education',title:'教育经历',order:7},
      {id:'basic',title:'基本信息',order:1},
      {id:'experience',title:'工作经历',order:8},
      {id:'projects',title:'项目经历',order:9},
      {id:'skills',title:'技能',order:10},
      {id:'selfEvaluation',title:'自我评价',order:11},
      {id:'custom-awards',title:'荣誉',order:12},
    ],
    education: [{id:'edu-1',school:'虚构学院',major:'科学教育',degree:'硕士',
      description:'<ul><li><strong>课程</strong>：科学实验</li></ul>'}],
    experience: [{id:'exp-1',company:'虚构单位',position:'助理',description:'课堂教学，协助 12 次实验。'}],
    projects: [
      {id:'project-1',name:'示例工具',role:'成员',startDate:'2024.01',endDate:'2024.03',
        description:'<ul><li>整理 6 项记录</li></ul>'},
      {id:'project-hidden',name:'HIDDEN_PROJECT_19',visible:false,description:'班主任'},
    ],
    customData: {'custom-awards': [{id:'award-1',title:'示例荣誉',description:'<p>独立记录</p>'}]},
    publications: [{id:'paper-1',name:'Synthetic publication',journal:'Example Journal',date:'2025',summary:'Synthetic abstract'}],
    certificates: [{id:'cert-1',certificateName:'Synthetic certificate',issuer:'Example institute',issueDate:'2025'}],
    skillContent:'<ul><li>Python</li><li>实验教学</li></ul>',
    selfEvaluationContent:'<p>遵守实验流程</p>',
    globalSettings:{baseFontSize:15,themeColor:'#123456'},
  };
}

const shaFile=f=>hash(fs.readFileSync(f));
async function gracefulStop(){
 if(!child) return;
 try{await cdp('Browser.close')}catch{}
 try{ws?.close()}catch{}
 await until('portable wrapper exit',()=>child.exitCode!==null||child.signalCode!==null,20000);
 child=null;
}
async function run(){
 const wrapper=path.resolve('Resume Studio.exe');
 assert(fs.statSync(wrapper).size>1000000,'actual root portable absent');
 assert(!fs.existsSync(path.resolve('release','Resume Studio.exe')),'postpack did not consume release wrapper');
 const workspace=path.join(root,'legacy-workspace'),prior=path.join(root,'prior-copy');
 fs.mkdirSync(workspace);fs.mkdirSync(prior);
 const legacyName='高中物理教师（云南省内）.json',raw=legacyFixture(),rawBytes=Buffer.from(JSON.stringify(raw,null,2));
 for(const dir of [workspace,prior])fs.writeFileSync(path.join(dir,legacyName),rawBytes);
 const localExe=path.join(workspace,'Resume Studio.exe');fs.copyFileSync(wrapper,localExe);
 const legacyHash=hash(rawBytes),master=path.join(workspace,'data','master.json'),versionFile=path.join(workspace,'data','resumes','synthetic-job.json');
 report.wrapperSha256=shaFile(wrapper);report.wrapperBytes=fs.statSync(wrapper).size;
 await connect(localExe,undefined);
 await until('migrated UI',()=>js(q('#basic-field-name')+'?.value==="测试甲"'));
 await capture('01-portable-legacy-migrated');
 const firstMaster=fs.readFileSync(master),firstVersion=fs.readFileSync(versionFile),doc=JSON.parse(firstVersion);
 assert(doc.schemaVersion===1&&doc.templateId==='classic-serif'&&doc.basic.employmentStatus==='示例状态'&&doc.basic.customFields[0].visible===false&&doc.basic.customFields[0].value==='保留值'&&doc.education[0].description==='- **课程**：科学实验'&&doc.projects[1].visible===false&&doc.customData.publications[0].title==='Synthetic publication'&&doc.customData.certificates[0].title==='Synthetic certificate','legacy fields lost');
 assert(shaFile(path.join(workspace,legacyName))===legacyHash&&shaFile(path.join(prior,legacyName))===legacyHash,'legacy source mutated');
 report.checks.actualPortableLegacyMigration=true;report.checks.defaultPortableRootWithoutEnv=true;
 fs.writeFileSync(path.join(out,'legacy-before.json'),rawBytes);fs.writeFileSync(path.join(out,'master-migrated.json'),firstMaster);fs.writeFileSync(path.join(out,'version-migrated.json'),firstVersion);
 await switchTo('synthetic-job');await click('内容编辑');
 assert(await js('(()=>{const e=document.querySelector("#basic-field-name");if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"合成升级后独立修改");e.dispatchEvent(new Event("input",{bubbles:true}));return true})()'),'edit missing');
 await until('persisted edit',()=>JSON.parse(fs.readFileSync(versionFile,'utf8')).basic.name==='合成升级后独立修改'&&has('已保存至本地硬盘'));
 const edited=fs.readFileSync(versionFile);
 assert(hash(edited)!==hash(firstVersion)&&shaFile(master)===hash(firstMaster),'version did not persist independently');
 await capture('02-portable-edited');await gracefulStop();
 await connect(localExe,undefined);await switchTo('synthetic-job');await click('内容编辑');
 await until('cold edited persisted',()=>js(q('#basic-field-name')+'?.value==="合成升级后独立修改"'));
 assert(shaFile(versionFile)===hash(edited)&&shaFile(master)===hash(firstMaster)&&shaFile(path.join(workspace,legacyName))===legacyHash,'restart migrated over user edits');
 report.checks.nonDestructiveColdRestart=true;await capture('03-portable-cold-edited');
 await click('导出 PDF');await until('actual exported PDF',()=>fs.existsSync(path.join(workspace,'exports'))&&fs.readdirSync(path.join(workspace,'exports')).some(f=>f.endsWith('.pdf')),35000);
 await until('PDF receipt visible',()=>has('记入投递'),35000);
 const pdf=path.join(workspace,'exports',fs.readdirSync(path.join(workspace,'exports')).find(f=>f.endsWith('.pdf')));assert(fs.readFileSync(pdf).subarray(0,5).toString()==='%PDF-'&&fs.statSync(pdf).size>1000,'invalid actual PDF');
 fs.copyFileSync(pdf,path.join(out,'portable-export.pdf'));await capture('04-portable-export');
 report.checks.actualPortablePdf=true;

 // Real UI delete, with synthetic confirmation decisions explicitly injected.
 const trashDir=path.join(workspace,'data','.trash'),legacyPath=path.join(workspace,legacyName);
 const archiveFiles=()=>fs.existsSync(trashDir)?fs.readdirSync(trashDir).filter(n=>n.endsWith('.json')):[];
 const confirm=async()=>assert(await js('(()=>{window.__t50Confirm=[];window.confirm=(s)=>{window.__t50Confirm.push(String(s));return true};return true})()'),'test confirmation setup');
 const openTrash=async()=>{
   await click('版本母库');
   await until('trash panel',()=>js('!!document.querySelector(\'[aria-label="本地版本回收站"] button[aria-expanded]\')'));
   await js('(()=>{const e=document.querySelector(\'[aria-label="本地版本回收站"] button[aria-expanded]\');if(e?.getAttribute("aria-expanded")==="false")e.click();return true})()');
 };
 const deleteVersion=async()=>{
   await click('版本母库');await confirm();await rowClick('删除'+doc.title);
   await until('version moved to trash',()=>!fs.existsSync(versionFile)&&archiveFiles().length===1);
   await until('master selection',async()=>await active()==='master');
   assert((await js('window.__t50Confirm')).some(t=>t.includes('移入本地回收站')),'delete prompt missing');
 };
 await deleteVersion();await openTrash();await until('trash restore visible',()=>has('恢复原版本'));
 const archived=fs.readFileSync(path.join(trashDir,archiveFiles()[0]));
 assert(hash(archived)===hash(edited),'trash bytes changed');
 fs.writeFileSync(path.join(out,'deleted-version-archive.json'),archived);
 await capture('05-portable-deleted','[aria-label="本地版本回收站"]');await gracefulStop();
 await connect(localExe,undefined);await until('master after deletion cold restart',async()=>await active()==='master');
 assert(!fs.existsSync(versionFile)&&archiveFiles().length===1&&shaFile(master)===hash(firstMaster)&&shaFile(legacyPath)===legacyHash&&hash(fs.readFileSync(path.join(trashDir,archiveFiles()[0])))===hash(archived),'normal startup recreated or mutated deleted version');
 await openTrash();await until('archive persisted',()=>has('恢复原版本'));await capture('06-cold-deletion-preserved','[aria-label="本地版本回收站"]');
 report.checks.deletedLegacyVersionNotResurrected=true;
 await confirm();await click('恢复原版本');await until('restored file',()=>fs.existsSync(versionFile)&&archiveFiles().length===0);
 await until('restored version available',()=>js('[...document.querySelector('+JSON.stringify(version)+').options].some(o=>o.value==="synthetic-job")'));
 await switchTo('synthetic-job');
 const restoreDoc=JSON.parse(fs.readFileSync(versionFile,'utf8')),editedDoc=JSON.parse(edited);
 const stable=o=>{const {updatedAt,...rest}=o;return canonical(rest)};
 assert(stable(restoreDoc)===stable(editedDoc),'explicit restore lost document content');
 fs.copyFileSync(versionFile,path.join(out,'explicitly-restored-version.json'));
 await capture('07-explicit-restore');report.checks.explicitRestoreKeepsDocumentIdentityAndContent=true;
 await deleteVersion();await openTrash();await until('purge ready',()=>has('永久删除归档'));await confirm();await click('永久删除归档');
 await until('purged archive',()=>archiveFiles().length===0&&!fs.existsSync(versionFile));
 await until('purge confirmation visible',()=>has('已永久删除指定归档'));
 assert((await js('window.__t50Confirm')).length===2,'expected two purge confirmations');
 await capture('08-permanent-purge','[aria-label="本地版本回收站"]');await gracefulStop();
 await connect(localExe,undefined);await until('master after purge cold restart',async()=>await active()==='master');
 assert(!fs.existsSync(versionFile)&&archiveFiles().length===0&&shaFile(master)===hash(firstMaster)&&shaFile(legacyPath)===legacyHash,'permanent purge failed across cold restart');
 await capture('09-purge-cold-restart');report.checks.permanentPurgeNotResurrected=true;await gracefulStop();
 // Deliberately damage only the isolated legacy fixture, then recover its bytes.
 fs.writeFileSync(legacyPath,'{broken synthetic legacy');
 try{
   await connect(localExe,undefined);await until('healthy master despite old invalid JSON',async()=>await active()==='master');
   assert(!fs.existsSync(versionFile)&&shaFile(master)===hash(firstMaster),'invalid legacy affected live workspace');
   await capture('10-invalid-legacy-ignored');report.checks.healthyMasterOpensWithMalformedLegacy=true;await gracefulStop();
 }finally{fs.writeFileSync(legacyPath,rawBytes)}
 assert(shaFile(legacyPath)===legacyHash&&shaFile(master)===hash(firstMaster),'legacy restoration or master preservation mismatch');
 report.checks.legacyAndMasterUnchanged=true;

 // Restore the pre-upgrade input in a separate workspace, never downgrade the upgraded data.
 const priorExe=path.join(prior,'Resume Studio.exe');fs.copyFileSync(wrapper,priorExe);
 await connect(priorExe,prior);await until('independent rollback source',()=>js(q('#basic-field-name')+'?.value==="测试甲"'));
 const restored=JSON.parse(fs.readFileSync(path.join(prior,'data','resumes','synthetic-job.json'),'utf8'));
 assert(restored.basic.name===doc.basic.name&&restored.education[0].description===doc.education[0].description&&!fs.existsSync(versionFile)&&shaFile(master)===hash(firstMaster)&&shaFile(path.join(prior,legacyName))===legacyHash,'rollback copy differs or upgraded source mutated');
 await capture('11-independent-prior-workspace');report.checks.priorCopyReopensWithoutChangingUpgrade=true;
 fs.writeFileSync(path.join(out,'version-edited.json'),edited);fs.writeFileSync(path.join(out,'rollback-version.json'),JSON.stringify(restored,null,2));
 report.hashes={legacy:legacyHash,master:hash(firstMaster),migrated:hash(firstVersion),edited:hash(edited),pdf:shaFile(pdf)};
 await gracefulStop();write();
}
run().then(()=>{clearTimeout(watchdog);cleanup();process.exit(0)}).catch(async e=>{clearTimeout(watchdog);report.error=String(e?.message||'portable fixture error').slice(0,1200);try{if(ws){const shot=await cdp('Page.captureScreenshot',{format:'png'});if(shot.data)fs.writeFileSync(path.join(out,'failure-renderer.png'),Buffer.from(shot.data,'base64'));}}catch{}write();cleanup();process.exit(1)});
