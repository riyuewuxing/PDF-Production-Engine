// Actual isolated Electron starts. Separate process for selection and verification.
// Only synthetic data. No production file modified.
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ids=['classic','dark','light','warm','graphite','obsidian','ocean','porcelain','aurora','forest','lavender','highContrast','nordic','blueprint','terracotta','ink'];
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,id=process.env.STUDIO_COLD_ID,phase=process.env.STUDIO_COLD_PHASE;
if(!root||!out||!path.basename(root).startsWith('synthetic-t12-cold-')||!ids.includes(id)||!['select','restart'].includes(phase))throw Error('isolated fixture/phase/id required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={runnerSha:process.env.GITHUB_SHA,id,phase,checks:{},viewports:[]};
const write=()=>fs.writeFileSync(path.join(out,id+'-'+phase+'.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='cold start watchdog';write();app.exit(2)},55000);
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('Timed out: '+label)}
async function run(){
 const snapshot=path.join(root,'cold-proof.json');
 if(phase==='select'){
  await main.store.saveResume('master',{...fixture,id:'synthetic-master',title:'合成母库'});
  await main.store.saveResume('runner-fixture',fixture);
 }
 const disk=path.join(main.store.resumesDir,'runner-fixture.json');
 const before=sha(fs.readFileSync(disk));
 const saved=phase==='restart'?JSON.parse(fs.readFileSync(snapshot,'utf8')):null;
 if(saved)assert.equal(before,saved.disk,'resume changed across process restart');
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);win.focus();
 const js=code=>win.webContents.executeJavaScript(code);
 const picker='select[aria-label="切换工作台主题"]',key='resume-studio-ui-theme-v1';
 const selected=()=>js('document.querySelector('+JSON.stringify(picker)+')?.value');
 const pref=()=>js('JSON.parse(localStorage.getItem('+JSON.stringify(key)+')||"null")');
 const shell=()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme');
 await until('actual document loaded',()=>js('document.querySelector("#basic-field-name")?.value==="演示候选人"&&document.querySelector(".studio-shell")?.getAttribute("aria-busy")==="false"'));
 await until('disk save state',()=>js('document.querySelector("[aria-label=\\\"本地保存状态\\\"]")?.innerText.includes("已保存至本地硬盘")'));
 assert.deepEqual(await js('Array.from(document.querySelector('+JSON.stringify(picker)+').options).map(x=>x.value)'),ids,'picker missing or duplicate ID');
 report.checks.allSixteenOptions=true;
 if(phase==='select'){
  assert.equal(await shell(),'classic','fresh profile must default classic');
  assert.equal(await pref(),null,'fresh profile wrote theme without explicit choice');
  assert(await js('(()=>{const e=document.querySelector('+JSON.stringify(picker)+');if(e.disabled)return false;e.value='+JSON.stringify(id)+';e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'));
  await until('explicit theme selected',async()=>await shell()===id);
  await until('theme saved',async()=>{const v=await pref();return v?.schemaVersion===1&&v.activePreset===id});
  report.checks.freshDefaultAndExplicitSave=true;
 }else{
  assert.equal(await shell(),id,'wrong first observed ready theme after restart');
  assert.deepEqual(await pref(),{schemaVersion:1,activePreset:id});
  report.checks.separateNativeProcessReadsPreference=true;
 }
 assert.equal(await selected(),id);
 await js('document.fonts.ready.then(()=>true)');await sleep(250);
 const getScene=()=>js('('+function(){
  const panel=document.querySelector('aside[data-studio-surface="panel"]'),head=document.querySelector('[data-studio-surface="header"]'),nav=document.querySelector('[data-studio-surface="nav"]'),picker=document.querySelector('select[aria-label="切换工作台主题"]');
  if(!panel||!head||!nav||!picker)throw Error('missing scoped UI');
  const state=e=>({theme:e.dataset.studioTheme,bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth});
  const rect=picker.getBoundingClientRect();
  const sheet=document.querySelector('.a4-sheet');
  return {panel:state(panel),header:state(head),nav:state(nav),picker:{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,value:picker.value},viewport:[innerWidth,innerHeight],paperText:sheet?.innerText};
 }.toString()+')()');
 for(const [w,h] of (phase==='restart'?[[1280,720],[1440,920],[1920,1080]]:[[1440,920]])){
  win.setSize(w,h);await sleep(300);
  const state=await getScene();
  for(const region of ['panel','header','nav']){assert.equal(state[region].theme,id);assert(state[region].scrollWidth<=state[region].clientWidth+2,'overflow '+region+' '+JSON.stringify(state[region]))}
  assert(state.picker.x>=0&&state.picker.y>=0&&state.picker.right<=state.viewport[0]+1&&state.picker.bottom<=state.viewport[1]+1,'picker inaccessible');
  assert(state.paperText.includes('演示候选人'));
  // Record actual sizes rather than assuming the runner's display matches request.
  const image=await win.webContents.capturePage();assert(!image.isEmpty());
  const name=id+'-'+phase+'-'+w+'x'+h+'.png';fs.writeFileSync(path.join(out,name),image.toPNG());
  report.viewports.push({requested:[w,h],actualWindow:win.getSize(),actualContent:win.getContentSize(),capture:image.getSize(),state,screenshot:name});
  write();
 }
 assert.equal(sha(fs.readFileSync(disk)),before,'theme modified resume bytes');
 report.checks.sourceUnchanged=true;
 if(phase==='select')fs.writeFileSync(snapshot,JSON.stringify({disk:before,id}));
 else assert.equal(saved.id,id);
 write();await sleep(400);
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=e.stack||String(e);write();console.error(report.error);app.exit(1)});
