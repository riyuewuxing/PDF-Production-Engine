const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,phase=process.env.STUDIO_THEME_PHASE;
if(!root||!out||!['baseline','candidate'].includes(phase)||!path.basename(root).startsWith('synthetic-list-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),audit=require('./validation-theme-t05-contrast.cjs');
const report={runnerSha:process.env.GITHUB_SHA,phase,rows:{}};
const write=()=>fs.writeFileSync(path.join(out,'command-focus-diagnostic.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='application watchdog';write();process.exit(2)},85000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(label,fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
async function run(){
 await main.store.saveResume('master',{...fixture,id:'synthetic-command-master',title:'合成母库'});await main.store.saveResume('runner-fixture',fixture);
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);win.focus();
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const sel='[role="dialog"][aria-label="全局命令面板"]';
 const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});await sleep(60);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(120)};
 const focus=()=>js(sel=>{const e=document.activeElement;return {inside:!!e.closest(sel),label:e.getAttribute('aria-label')||e.id||e.innerText?.trim().slice(0,60)||'',tag:e.tagName}},sel);
 const capture=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(250);const s=await win.webContents.capturePage();assert(!s.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),s.toPNG())};
 await until('editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 for(const id of (phase==='baseline'?['classic']:['classic','dark','light','warm'])){
  await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#basic-field-name').focus();return true},id);
  await until('theme selected',()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));
  await press('K',['control']);await until('open',()=>js(sel=>!!document.querySelector(sel),sel));
  const initial=await focus();const contrast=await audit(win,sel,id+'-classic-match');await capture('initial-'+id);
  await press('Tab',['shift']);const reverse=await focus();
  // The last control is tab reachable only if the modal contains keyboard focus.
  await js(()=>{document.querySelector('[aria-label="搜索命令、模板与版本"]').focus();return true});
  await press('Escape');await until('closed',()=>js(sel=>!document.querySelector(sel),sel));
  const returned=await focus();
  await js(()=>{document.querySelector('#basic-field-name').focus();return true});await press('K',['control']);await until('reopened',()=>js(sel=>!!document.querySelector(sel),sel));
  await js(sel=>{window.__t07Audit=[];window.__t07Listener=e=>{if(e.ctrlKey&&e.key.toLowerCase()==='s')window.__t07Audit.push({prevented:e.defaultPrevented,inside:!!e.target.closest(sel),trusted:e.isTrusted})};window.addEventListener('keydown',window.__t07Listener);return true},sel);
  await press('S',['control']);const saveEvents=await js(()=>{window.removeEventListener('keydown',window.__t07Listener);return window.__t07Audit});
  const openAfterSave=await js(sel=>!!document.querySelector(sel),sel);await press('Escape');
  await until('closed after save',()=>js(sel=>!document.querySelector(sel),sel));
  report.rows[id]={initial,reverse,returned,contrast,saveEvents,openAfterSave};write();
 }
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();process.exit(1)});
