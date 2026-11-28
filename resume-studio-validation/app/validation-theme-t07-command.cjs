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
 const themes=['classic','dark','light','warm'],colors={dark:'rgb(17, 24, 39)',light:'rgb(255, 255, 255)',warm:'rgb(251, 247, 238)'};
 let baseline=null;
 for(const id of themes){
  await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true},id);
  await until('theme applied',()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));
  await open();const initial=await state();assert.equal(initial.id,id);if(id!=='classic')assert.equal(initial.bg,colors[id]);assert.equal(initial.focus,'搜索命令、模板与版本');
  // Theme command metadata can legitimately differ by current preset; all other options are stable.
  const options=initial.options.map(s=>s.replace('当前选择 · ',''));
  if(baseline)assert.deepEqual(options,baseline);else baseline=options;
  const contrast=await audit(win,sel,id+'-command');report.themes[id]={initial,contrast};write();if(id!=='classic')assert.equal(contrast.failures.length,0,JSON.stringify(contrast.failures.slice(0,5)));
  await capture('command-'+id);
  await press('Down');const down=await state();assert.notEqual(down.selected,initial.selected);
  await press('Up');assert.equal((await state()).selected,initial.selected);
  await query('lapis 青金石');const filtered=await state();assert.equal(filtered.options.length,1);assert(filtered.options[0].includes('LapisCV'));
  await capture('command-filter-'+id);
  await query('T07_NO_MATCH_ABC_012');const empty=await state();assert.equal(empty.options.length,0);await capture('command-empty-'+id);
  const emptyContrast=await audit(win,sel,id+'-empty');report.themes[id].emptyContrast=emptyContrast;if(id!=='classic')assert.equal(emptyContrast.failures.length,0);
  await press('Enter');assert(await js(sel=>!!document.querySelector(sel),sel),'empty Enter closed');
  await close();
  assert.deepEqual(await main.store.getResume('runner-fixture'),before);assert.deepEqual(await main.store.listSnapshots('runner-fixture'),snaps);assert.deepEqual(await main.store.getApplications(),ledger);
  report.themes[id].keyboard={initial:true,down:true,up:true,filter:true,emptyEnter:true,escape:true,noWrite:true};write();
 }
 // Exercise real keyboard selection of theme command, not just change event.
 await open();await query('工作台主题 dark');assert.equal((await state()).options.length,1);await press('Enter');await until('theme command ran',()=>js(()=>document.querySelector('.studio-shell')?.dataset.studioTheme==='dark'&&!document.querySelector('[aria-label="全局命令面板"]')));
 assert.deepEqual(await main.store.getResume('runner-fixture'),before);report.checks.themeCommandNoWrite=true;
 await open();await query('版本母库');await press('Enter');await until('navigation command executed',()=>js(()=>document.body.innerText.includes('版本与母库管理')&&!document.querySelector('[aria-label="全局命令面板"]')));
 assert.deepEqual(await main.store.getResume('runner-fixture'),before);report.checks.navigationCommandNoWrite=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);write();process.exit(1)});
