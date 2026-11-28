const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-list-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),audit=require('./validation-theme-t05-contrast.cjs');
const report={runnerSha:process.env.GITHUB_SHA,checks:{},themes:{}};
const write=()=>fs.writeFileSync(path.join(out,'command-native.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='application watchdog';write();process.exit(2)},105000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(label,fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
async function run(){
 await main.store.saveResume('master',{...fixture,id:'synthetic-command-master',title:'合成母库'});
 await main.store.saveResume('runner-fixture',fixture);
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);win.focus();
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const sel='[data-studio-region="command-palette"]';
 const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode:'Enter',modifiers});await sleep(50);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(130)};
 const capture=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(200);const s=await win.webContents.capturePage();assert(!s.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),s.toPNG());};
 const state=()=>js(sel=>{const d=document.querySelector(sel),c=getComputedStyle(d);return {id:d.dataset.studioTheme,bg:c.backgroundColor,fg:c.color,query:d.querySelector('input').value,options:[...d.querySelectorAll('[role=option]')].map(e=>e.innerText),selected:d.querySelector('[aria-selected=true]')?.innerText||null,focus:document.activeElement?.getAttribute('aria-label')}},sel);
 const query=async value=>{await js(v=>{const e=document.querySelector('[aria-label="搜索命令、模板与版本"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));return true},value);await sleep(100)};
 const open=async()=>{await press('K',['control']);await until('command visible',()=>js(sel=>!!document.querySelector(sel),sel))};
 const close=async()=>{await press('Escape');await until('command closed',()=>js(sel=>!document.querySelector(sel),sel))};
 await until('editor',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'));
 const before=await main.store.getResume('runner-fixture'),snaps=await main.store.listSnapshots('runner-fixture'),ledger=await main.store.getApplications();
 await open();await query('lapis 青金石');assert.equal((await state()).options.length,1);await press('Enter');
 await until('actual template disk change',async()=>(await main.store.getResume('runner-fixture')).templateId==='lapis-clean',25000);
 const selected=await main.store.getResume('runner-fixture');assert.deepEqual(selected,{...before,updatedAt:selected.updatedAt,templateId:'lapis-clean',globalSettings:{...before.globalSettings,themeColor:'#2b547e'}});
 report.checks.templateExactWrite=true;await capture('command-template-selected');
 // Focus must not remain in a stale modal after an actual action. Undo via the regular workbench shortcut.
 await js(()=>{document.querySelector('nav[aria-label="主导航"] button').focus();return true});await press('Z',['control']);
 await until('actual undo saved',async()=>(await main.store.getResume('runner-fixture')).templateId===before.templateId,25000);
 const undone=await main.store.getResume('runner-fixture');assert.deepEqual({...undone,updatedAt:before.updatedAt},before);report.checks.undoRestoredOriginal=true;
 await open();await query('导出矢量 A4 PDF');assert.equal((await state()).options.length,1);await press('Enter');
 await until('actual PDF receipt',()=>js(()=>document.body.innerText.includes('已导出矢量 A4 PDF')&&[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='记入投递并锁定快照'&&!b.disabled)),30000);
 const names=fs.readdirSync(main.exportsDir).filter(n=>n.endsWith('.pdf'));assert.equal(names.length,1);
 const pdf=fs.readFileSync(path.join(main.exportsDir,names[0]));assert.equal(pdf.subarray(0,4).toString(),'%PDF');fs.writeFileSync(path.join(out,'command-export.pdf'),pdf);
 assert.deepEqual(await main.store.getResume('runner-fixture'),undone);assert.deepEqual(await main.store.getApplications(),ledger);
 const newSnaps=await main.store.listSnapshots('runner-fixture');assert.equal(newSnaps.length,snaps.length+1);
 report.checks.exportActualPdfAndReceipt=true;report.checks.exportOriginalAndLedgerProtected=true;report.checks.exportHistoryCreated=true;
 report.export={size:pdf.length,sha:crypto.createHash('sha256').update(pdf).digest('hex')};await capture('command-export-receipt');write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);write();process.exit(1)});
