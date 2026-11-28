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
  const initial=await focus();assert(initial.inside&&initial.tag==='INPUT'&&initial.placeholder,'no initial company focus');await cap('quick-log-initial-'+id);
  const targets=()=>js(sel=>{const form=document.querySelector(sel+' form');return [...form.querySelectorAll('input,textarea,select,button')].filter(e=>!e.disabled&&e.tabIndex>=0&&e.getClientRects().length).map(e=>[e.tagName,e.getAttribute('aria-label'),e.getAttribute('placeholder'),e.innerText?.trim()||null])},sel);
  const n=(await targets()).length;
  const tabIndex=()=>js(sel=>{const form=document.querySelector(sel+' form');const nodes=[...form.querySelectorAll('input,textarea,select,button')].filter(e=>!e.disabled&&e.tabIndex>=0&&e.getClientRects().length);return nodes.indexOf(document.activeElement)},sel);
  await js(sel=>{document.querySelector(sel).querySelector('button').focus();return true},sel);
  const forward=[],reverse=[];
  for(let i=0;i<n;i++){await press('Tab');forward.push(await tabIndex());assert.equal(forward[i],(i+1)%n);}
  for(let i=0;i<n;i++){await press('Tab',['shift']);reverse.push(await tabIndex());assert.equal(reverse[i],(n-1-i+n)%n);}
  await js(()=>{document.querySelector('#basic-field-name').focus();return true});assert((await focus()).inside,'focus escape on external programmatic focus');
  await js(()=>{window.__t08Keys=[];window.__t08Listener=e=>{if(e.ctrlKey&&['k','s'].includes(e.key.toLowerCase()))window.__t08Keys.push({key:e.key.toLowerCase(),trusted:e.isTrusted,prevented:e.defaultPrevented})};document.addEventListener('keydown',window.__t08Listener,true);return true});
  await press('K',['control']);assert(!await js(()=>!!document.querySelector('[aria-label="全局命令面板"]')),'nested command palette opened');
  await press('S',['control']);assert(await js(sel=>!!document.querySelector(sel),sel));
  const keys=await js(()=>{document.removeEventListener('keydown',window.__t08Listener,true);return window.__t08Keys});
  assert.deepEqual(keys,[{key:'k',trusted:true,prevented:true},{key:'s',trusted:true,prevented:true}]);
  await press('Escape');await until('esc close',()=>js(sel=>!document.querySelector(sel),sel));const returned=await focus();assert.equal(returned.label,'记入投递并锁定快照');
  await press('Enter');await until('reopen',()=>js(sel=>!!document.querySelector(sel),sel));await click('取消');await until('cancel closed',()=>js(sel=>!document.querySelector(sel),sel));assert.equal((await focus()).label,'记入投递并锁定快照');
  assert(fs.readFileSync(source).equals(bytes));assert.deepEqual(await main.store.getApplications(),ledger);assert.deepEqual(await main.store.listSnapshots('runner-fixture'),snaps);
  report.rows[id]={initial,forward,reverse,keys,returned,mouseReturn:true,noWrite:true};write();
 }
 // Real archive IPC held at disk service boundary: Escape cannot cancel an in-flight submit, and repeat Enter cannot duplicate it.
 await js(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='记入投递并锁定快照');b.focus();return true});
 await press('Enter');await until('modal for actual submit',()=>js(sel=>!!document.querySelector(sel),sel));
 await js(sel=>{const e=document.querySelector(sel+' input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'合成T08归档学校');e.dispatchEvent(new Event('input',{bubbles:true}));return true},sel);
 const originalLog=main.store.logApplication.bind(main.store);let release,calls=0;const gate=new Promise(r=>release=r);
 main.store.logApplication=async(...args)=>{calls++;await gate;return originalLog(...args)};
 try{
  await click('确认记入并锁定快照');await until('actual disk IPC held',()=>calls===1);
  await press('Escape');await press('Enter');await press('K',['control']);await press('S',['control']);
  assert(await js(sel=>!!document.querySelector(sel),sel));assert((await focus()).inside);assert.equal(calls,1);
  assert.deepEqual(await main.store.getApplications(),ledger);assert(fs.readFileSync(source).equals(bytes));
  await cap('quick-log-busy-protected');report.busy={escapeBlocked:true,repeatEnterBlocked:true,shortcutsBlocked:true,focusContained:true,oneCall:true,ledgerUnchangedBeforeRelease:true};write();
 }finally{release();}
 await until('actual archive settled',()=>js(sel=>!document.querySelector(sel),sel),25000);
 const after=await main.store.getApplications();assert.equal(after.applications.length,ledger.applications.length+1);const entry=after.applications.find(x=>x.company==='合成T08归档学校');assert(entry&&entry.snapshotId&&entry.pdfReceipt);
 assert(fs.readFileSync(source).equals(bytes));report.actualArchive={oneEntry:true,permanentSnapshot:true,receipt:true,sourceUnchanged:true,calls};write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();app.exit(1)});
