const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-list-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const report={runnerSha:process.env.GITHUB_SHA,rows:{}};
const write=()=>fs.writeFileSync(path.join(out,'command-zoom.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='application watchdog';write();process.exit(2)},105000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(label,fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
async function run(){
 await main.store.saveResume('master',{...fixture,id:'synthetic-command-master',title:'合成母库'});await main.store.saveResume('runner-fixture',fixture);
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.unmaximize();win.setSize(1080,720);win.focus();
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const sel='[aria-label="全局命令面板"]';
 const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});await sleep(50);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(120)};
 const inspect=()=>js(sel=>{const d=document.querySelector(sel),r=d.getBoundingClientRect(),footer=d.lastElementChild.getBoundingClientRect(),list=d.querySelector('[role=listbox]').parentElement;return {viewport:[innerWidth,innerHeight],dialog:[r.left,r.top,r.right,r.bottom],footer:[footer.top,footer.bottom],list:[list.clientHeight,list.scrollHeight],fullyVisible:r.bottom<=innerHeight+1&&r.right<=innerWidth+1,footerVisible:footer.bottom<=innerHeight+1}},sel);
 const capture=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(200);const s=await win.webContents.capturePage();assert(!s.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),s.toPNG())};
 await until('editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 const before=await main.store.getResume('runner-fixture');
 for(const id of ['classic','dark','light','warm']){
  await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true},id);
  await until('theme selected',()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));
  for(const factor of [1,1.25,1.5]){
   win.webContents.setZoomFactor(factor);await sleep(180);
   await press('K',['control']);await until('command open',()=>js(sel=>!!document.querySelector(sel),sel));await sleep(200);
   const row=await inspect();report.rows[id+'-'+factor]=row;write();await capture('zoom-'+id+'-'+factor);
   await press('Tab',['shift']);const last=await js(sel=>{const d=document.querySelector(sel),e=document.activeElement,r=e.getBoundingClientRect(),l=d.querySelector('[role=listbox]').parentElement.getBoundingClientRect();return {inside:d.contains(e),index:e.dataset.cmdIndex||null,visible:r.top>=l.top-1&&r.bottom<=Math.min(l.bottom,innerHeight)+1}},sel);
   row.last=last;write();await press('Escape');await until('closed',()=>js(sel=>!document.querySelector(sel),sel)); 
  }
  win.webContents.setZoomFactor(1);
 }
 assert.deepEqual(await main.store.getResume('runner-fixture'),before);report.noWrite=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();process.exit(1)});
