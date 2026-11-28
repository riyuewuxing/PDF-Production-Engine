const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-portable-t12-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,productCommit:process.env.GITHUB_SHA,priorValidationSource:'84b8a001a9773b3a0f056aeb80130713769f658b',checks:{},mode:'single-file portable wrapper; isolated synthetic workspace; sixteen palette options, explicit selection, cold restart, future/legacy config preservation'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,ws;
const pending=new Map(),listeners=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'portable-theme-evidence.json'),JSON.stringify(report,null,2));
function stop(){try{ws?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}}
function cleanup(){stop();try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='portable theme watchdog';write();cleanup();process.exit(2)},390000);
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
 const ids=['classic','dark','light','warm','graphite','obsidian','ocean','porcelain','aurora','forest','lavender','highContrast','nordic','blueprint','terracotta','ink'];
 const wrapper=path.resolve('Resume Studio.exe');assert(fs.statSync(wrapper).size>1000000,'actual root portable absent');
 assert(!fs.existsSync(path.resolve('release','Resume Studio.exe')),'postpack did not consume release wrapper');
 const workspace=path.join(root,'theme-workspace');fs.mkdirSync(workspace);
 const legacyName='高中物理教师（云南省内）.json',raw=legacyFixture(),rawBytes=Buffer.from(JSON.stringify(raw,null,2));
 fs.writeFileSync(path.join(workspace,legacyName),rawBytes);
 const localExe=path.join(workspace,'Resume Studio.exe');fs.copyFileSync(wrapper,localExe);
 report.wrapperSha256=shaFile(wrapper);report.wrapperBytes=fs.statSync(wrapper).size;
 const master=path.join(workspace,'data','master.json'),versionFile=path.join(workspace,'data','resumes','synthetic-job.json');
 const picker='select[aria-label="切换工作台主题"]',key='resume-studio-ui-theme-v1',legacyKey='resume-studio-ui-theme';
 const shell=()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme');
 const rawPref=()=>js('localStorage.getItem('+JSON.stringify(key)+')');
 const rawLegacy=()=>js('localStorage.getItem('+JSON.stringify(legacyKey)+')');
 const setStorage=async(k,v)=>assert(await js('(()=>{localStorage.setItem('+JSON.stringify(k)+','+JSON.stringify(v)+');return true})()'),'synthetic storage fixture');
 const choose=async id=>{
  assert(await js('(()=>{const s='+q(picker)+';if(!s||s.disabled||![...s.options].some(o=>o.value==='+JSON.stringify(id)+'))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,'+JSON.stringify(id)+');s.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'picker missing '+id);
  await until('actual selected theme '+id,async()=>await shell()===id);
  await until('selector reads '+id,()=>js(q(picker)+'?.value==='+JSON.stringify(id)));
 };
 const ready=async()=>{await until('synthetic migrated UI',()=>js(q('#basic-field-name')+'?.value==="测试甲"'));await until('saved document',()=>has('已保存至本地硬盘'))};
 await connect(localExe,workspace);await ready();
 assert(fs.existsSync(master)&&fs.existsSync(versionFile),'migration source absent');
 const stable={master:shaFile(master),version:shaFile(versionFile),legacy:shaFile(path.join(workspace,legacyName))};
 const noWrite=()=>assert(shaFile(master)===stable.master&&shaFile(versionFile)===stable.version&&shaFile(path.join(workspace,legacyName))===stable.legacy,'theme changed synthetic business source');
 assert(JSON.stringify(await js('Array.from('+q(picker)+'.options).map(x=>x.value)'))===JSON.stringify(ids),'actual portable picker incomplete');
 assert(await shell()==='classic'&&await rawPref()===null,'fresh portable profile not classic or unsolicited write');
 report.checks.sixteenActualPickerOptions=true;report.checks.freshDefaultNoWrite=true;report.selections=[];
 for(const id of ids){
  await choose(id);const expected=JSON.stringify({schemaVersion:1,activePreset:id});
  await until('preference saved '+id,async()=>await rawPref()===expected);
  const scoped=await js('(()=>{const a=document.querySelector("aside[data-studio-surface=panel]"),h=document.querySelector("[data-studio-surface=header]");return {panel:a?.dataset.studioTheme,header:h?.dataset.studioTheme,bg:a?getComputedStyle(a).backgroundColor:null,viewport:[innerWidth,innerHeight]}})()');
  assert(scoped.panel===id&&scoped.header===id,'wrong portable scope '+id);
  noWrite();await capture('portable-select-'+id);report.selections.push({id,pref:await rawPref(),scoped});write();
 }
 report.checks.allSixteenSelectionsAndPersistence=true;
 await gracefulStop();
 await connect(localExe,workspace);await ready();
 assert(await shell()==='ink'&&await rawPref()===JSON.stringify({schemaVersion:1,activePreset:'ink'}),'cold start did not restore ink');noWrite();
 await capture('portable-cold-ink');report.checks.actualPackagedColdRestart=true;write();
 const future=JSON.stringify({schemaVersion:99,activePreset:'dark'});
 await setStorage(key,future);await gracefulStop();
 await connect(localExe,workspace);await ready();
 assert(await shell()==='classic'&&await rawPref()===future,'future config not preserved on startup');
 await until('future config notice',()=>has('原配置已保留'));await capture('portable-future-fallback');
 await choose('forest');assert(await rawPref()===future,'future config overwritten by explicit choice');
 await until('session only notice',()=>has('仅本次会话生效'));noWrite();await capture('portable-future-session-only');
 report.checks.futureConfigRetainedAndSessionOnly=true;write();
 await js('localStorage.removeItem('+JSON.stringify(key)+')');await setStorage(legacyKey,'blueprint');await gracefulStop();
 await connect(localExe,workspace);await ready();
 assert(await shell()==='blueprint'&&await rawPref()===null&&await rawLegacy()==='blueprint','legacy read modified data');
 await capture('portable-legacy-cold-blueprint');await choose('terracotta');
 assert(await rawPref()===JSON.stringify({schemaVersion:1,activePreset:'terracotta'})&&await rawLegacy()==='blueprint','explicit upgrade did not preserve legacy');
 noWrite();await capture('portable-legacy-explicit-terracotta');report.checks.legacyReadOnlyAndExplicitV1=true;
 await gracefulStop();await connect(localExe,workspace);await ready();
 assert(await shell()==='terracotta'&&await rawPref()===JSON.stringify({schemaVersion:1,activePreset:'terracotta'}),'cold terracotta failed');
 noWrite();await capture('portable-cold-terracotta');report.checks.secondColdRestart=true;report.checks.sourceBytesUnchanged=true;report.hashes=stable;
 await gracefulStop();write();
}
run().then(()=>{clearTimeout(watchdog);cleanup();process.exit(0)}).catch(async e=>{clearTimeout(watchdog);report.error=String(e?.message||'portable fixture error').slice(0,1200);try{if(ws){const shot=await cdp('Page.captureScreenshot',{format:'png'});if(shot.data)fs.writeFileSync(path.join(out,'failure-renderer.png'),Buffer.from(shot.data,'base64'));}}catch{}write();cleanup();process.exit(1)});
