const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
const data=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!data||!out||!path.basename(data).startsWith('synthetic-interview-'))throw Error('isolated fixture required');
fs.mkdirSync(data,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(data,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),adapter=require('./validation-interview-baseline-adapter.cjs');
const report={runnerSha:process.env.GITHUB_SHA,reproduced:{}};let network=0;
global.fetch=async()=>{network++;throw Error('offline fixture must not call network')};
const write=()=>fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify({...report,network},null,2));
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const watchdog=setTimeout(()=>{report.error='baseline watchdog';write();app.exit(2)},110000);
async function until(label,f,ms=18000){const end=Date.now()+ms;while(Date.now()<end){try{if(await f())return}catch{}await sleep(100)}throw Error('timeout '+label)}
async function run(){
  const doc={...fixture,id:'synthetic-baseline-interview',title:'合成旧版练习',basic:{...fixture.basic,title:'科研助理'},education:fixture.education.map(e=>({...e,major:'物理学'})),projects:[{...fixture.projects[0],id:'project-a',name:'合成甲项目',description:'本人核对实验记录'},{...fixture.projects[0],id:'project-b',name:'合成乙项目',description:'本人协作清洗数据'}]};
  let d=await main.store.saveResume('runner-fixture',doc);
  const old='甲项目的原回答',ledger=await main.store.getApplications();
  await main.store.saveApplications({...ledger,interviewAnswers:{'runner-fixture:q-proj-1':old}},ledger.revision);
  await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=s=>win.webContents.executeJavaScript(s),q=s=>'document.querySelector('+JSON.stringify(s)+')';
  const click=async name=>{await until('button '+name,()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim().startsWith('+JSON.stringify(name)+')&&!b.disabled&&b.getClientRects().length)'));assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.innerText.trim().startsWith('+JSON.stringify(name)+')&&!b.disabled&&b.getClientRects().length);if(!b)return false;b.click();return true})()'),'button missing')};
  const answerUnder=name=>js('Array.from(document.querySelectorAll("textarea")).find(t=>t.placeholder?.startsWith("在此记录你的 STAR")&&t.parentElement.innerText.includes('+JSON.stringify(name)+'))?.value');
  const enter=async()=>{await until('version editor',()=>js('!!document.querySelector("#basic-field-name")'));await click('求职面试');await click('面试追问');await until('questions',()=>js('document.body.innerText.includes("合成甲项目")&&document.body.innerText.includes("合成乙项目")'))};
  const capture=async(name,marker)=>{await js('(()=>{const t=Array.from(document.querySelectorAll("textarea")).find(e=>e.placeholder?.startsWith("在此记录你的 STAR")&&e.parentElement.innerText.includes('+JSON.stringify(marker)+'));t?.parentElement.scrollIntoView({block:"center"});return true})()');await sleep(250);const shot=await win.webContents.capturePage();fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
  await enter();assert(await answerUnder('合成甲项目')===old,'baseline old answer not visible');
  assert(await js('document.body.innerText.includes("电磁感应")'),'baseline role misclassification not reproduced');
  report.reproduced.researchMisclassifiedAsPhysicsTeacher=true;
  d=await main.store.saveResume('runner-fixture',{...d,projects:[d.projects[1],d.projects[0]]},{requireExisting:true,expectedRevision:JSON.stringify([d.id,d.updatedAt])});
  win.webContents.reload();await enter();
  assert(await answerUnder('合成乙项目')===old&&await answerUnder('合成甲项目')==='','baseline ordinal answer swap not reproduced');
  report.reproduced.ordinalDraftReattachedToWrongProject=true;await capture('old-answer-under-wrong-project','合成乙项目');
  // Real production pure functions on malformed synthetic document: same raw key is hidden and visible.
  const collision={...d,projects:[{...d.projects[0],name:'HIDDEN_COLLISION_METADATA',description:'HIDDEN_COLLISION_BODY',visible:false},...d.projects]};
  const key='proj:'+d.projects[0].id;
  const ctx=adapter.collectAiToolContext(collision,[key],0);
  assert(ctx.options===undefined&&JSON.stringify(ctx.toolResults).includes('HIDDEN_COLLISION_METADATA'),'old hidden metadata leak not reproduced');
  report.reproduced.hiddenDuplicateMetadataEnteredOutboundContext=true;
  const envelope=await adapter.buildTextPatchEnvelope({document:collision,slug:'runner-fixture',baseRevision:'synthetic-rev',sourceRequestId:'00000000-0000-4000-8000-000000000035',candidates:[{blockKey:key,originalText:d.projects[0].description,suggestedText:'合成改写',reason:'合成',factIds:[]}]});
  const next=await adapter.previewTextPatch({document:collision,slug:'runner-fixture',revision:'synthetic-rev',envelope});
  assert(next.projects[0].description==='合成改写'&&next.projects[1].description==='合成改写'&&collision.projects[0].description==='HIDDEN_COLLISION_BODY','old duplicate hidden write not reproduced');
  report.reproduced.hiddenDuplicateWasAlsoModifiedByPreview=true;
  assert(network===0,'unexpected network');write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e.message).slice(0,400);write();app.exit(1)});
