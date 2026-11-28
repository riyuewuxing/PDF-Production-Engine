const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-review-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const report={runnerSha:process.env.GITHUB_SHA,rows:{}};
const write=()=>fs.writeFileSync(path.join(out,'quick-log-focus.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='application watchdog';write();app.exit(2)},100000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
async function run(){
 await main.store.saveResume('runner-fixture',fixture);
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);win.focus();
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const sel='[role="dialog"][aria-label="记入投递并锁定永久快照"]';
 const click=async text=>assert(await js(text=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()===text&&!x.disabled);if(!b)return false;b.click();return true},text));
 const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode,modifiers});await sleep(50);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(100)};
 const focus=()=>js(sel=>{const e=document.activeElement;return {inside:!!e.closest(sel),tag:e.tagName,label:e.getAttribute('aria-label')||e.id||e.innerText?.trim().slice(0,80)||'',placeholder:e.getAttribute('placeholder')}},sel);
 const cap=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(180);const shot=await win.webContents.capturePage();assert(!shot.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),shot.toPNG())};
 await until('editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 await click('导出 PDF');await until('export receipt',()=>js(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='记入投递并锁定快照'&&!b.disabled)),30000);
 const source=main.store.resolveResumePath('runner-fixture').filePath,bytes=fs.readFileSync(source),ledger=await main.store.getApplications(),snaps=await main.store.listSnapshots('runner-fixture');
 for(const id of ['classic','dark','light','warm']){
  await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true},id);
  await until('theme',()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));
  await js(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='记入投递并锁定快照');b.focus();return true});
  await press('Enter');await until('quick log',()=>js(sel=>!!document.querySelector(sel),sel));
  const initial=await focus();await cap('quick-log-initial-'+id);
  // explicitly focus first focusable element to check the reverse boundary
  await js(sel=>{document.querySelector(sel).querySelector('button').focus();return true},sel);await press('Tab',['shift']);const reverse=await focus();
  await js(sel=>{document.querySelector(sel).querySelector('input').focus();return true},sel);
  await press('K',['control']);const commandOpened=await js(()=>!!document.querySelector('[aria-label="全局命令面板"]'));
  if(commandOpened){await press('Escape');await until('nested command closed',()=>js(()=>!document.querySelector('[aria-label="全局命令面板"]')))}
  await js(sel=>{document.querySelector(sel).querySelector('input').focus();return true},sel);await press('Escape');
  const escClosed=!await js(sel=>!!document.querySelector(sel),sel);
  if(!escClosed)await click('取消');
  await until('closed',()=>js(sel=>!document.querySelector(sel),sel));const returned=await focus();
  assert(fs.readFileSync(source).equals(bytes));assert.deepEqual(await main.store.getApplications(),ledger);assert.deepEqual(await main.store.listSnapshots('runner-fixture'),snaps);
  report.rows[id]={initial,reverse,commandOpened,escClosed,returned,noWrite:true};write();
 }
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();app.exit(1)});
