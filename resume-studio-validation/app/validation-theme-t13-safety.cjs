const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,kind=process.env.STUDIO_SKIN_CASE,phase=process.env.STUDIO_SKIN_PHASE;
if(!root||!out||!path.basename(root).startsWith('synthetic-t13-safety-')||!['future','corrupt','concurrent','forced'].includes(kind)||!['prepare','restart'].includes(phase))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={runnerSha:process.env.GITHUB_SHA,kind,phase,checks:{},observations:{}};
const write=()=>fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='native safety watchdog';write();app.exit(2)},150000);
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('Timed out: '+label)}
async function run(){
 if(phase==='prepare'){await main.store.saveResume('master',{...fixture,id:'synthetic-master',title:'合成母库'});await main.store.saveResume('runner-fixture',fixture);}
 const disk=path.join(main.store.resumesDir,'runner-fixture.json'),before=sha(fs.readFileSync(disk)),snaps=JSON.stringify(await main.store.listSnapshots('runner-fixture'));
 let writes=0;const save=main.store.saveResume.bind(main.store);main.store.saveResume=(...args)=>{writes++;return save(...args)};
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.focus();
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const key='resume-studio-ui-component-skins-v1',dialog='dialog[aria-label="组件外观工坊"]',buttonSel=dialog+' select[aria-label="普通按钮皮肤"]',iconSel=dialog+' select[aria-label="图标按钮皮肤"]',actual='button[aria-label="打开命令面板"]';
 const raw=()=>js(k=>localStorage.getItem(k),key),val=s=>js(s=>document.querySelector(s)?.value,s);
 const setRaw=v=>js((k,v)=>{localStorage.setItem(k,v);return true},key,v);
 const enc=(b,i,v=1)=>JSON.stringify({schemaVersion:v,skins:{button:b,icon:i}});
 const click=async(label,scope='body')=>{assert(await js((l,s)=>{const b=[...document.querySelectorAll(s+' button')].find(e=>e.innerText.trim()===l&&e.getClientRects().length&&!e.disabled);if(!b)return false;b.click();return true},label,scope),'button missing '+label);await sleep(100)};
 const open=async()=>{await click('组件外观');await until('modal',()=>js(s=>document.querySelector(s)?.matches(':modal'),dialog))};
 const close=()=>until('workshop closed',()=>js(s=>!document.querySelector(s),dialog));
 const select=async(s,v)=>{assert(await js((s,v)=>{const e=document.querySelector(s);if(!e||e.disabled)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('change',{bubbles:true}));return true},s,v));await until('selection',async()=>await val(s)===v)};
 const apply=async()=>{await click('应用组件外观',dialog);await close()};
 const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode:'Enter',modifiers});await sleep(40);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(100)};
 const shot=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(150);const im=await win.webContents.capturePage();assert(!im.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),im.toPNG())};
 await until('ready',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'&&document.querySelector('.studio-shell')?.getAttribute('aria-busy')==='false'));await until('saved',()=>js(()=>document.querySelector('[aria-label="本地保存状态"]')?.innerText.includes('已保存至本地硬盘')));
 if(win.isMaximized()){win.unmaximize();await sleep(250)}win.setContentSize(1280,720);await sleep(300);assert.deepEqual(win.getContentSize(),[1280,720]);
 const beforeWrites=writes;
 if(phase==='prepare'){
  const content=kind==='future'?enc('gradient','round',99):kind==='corrupt'?'{"schemaVersion":1,"skins":':enc('raised','floating');
  await setRaw(content);assert.equal(await raw(),content);fs.writeFileSync(path.join(root,'basis.json'),JSON.stringify({before,content}));await shot('prepared');report.checks.fixturePrepared=true;write();return;
 }
 const expected=JSON.parse(fs.readFileSync(path.join(root,'basis.json'),'utf8'));assert.equal(before,expected.before);assert.equal(await raw(),expected.content);
 if(kind==='future'||kind==='corrupt'){
  assert.equal(await js(s=>document.querySelector(s)?.hasAttribute('data-studio-skin'),actual),false);
  assert(await js(()=>document.body.innerText.includes('原配置已保留')));
  await open();assert.equal(await val(buttonSel),'inherit');assert.equal(await val(iconSel),'inherit');await select(buttonSel,'gradient');await select(iconSel,'round');await apply();
  assert.equal(await js(s=>document.querySelector(s)?.dataset.studioSkin,actual),'gradient');assert.equal(await raw(),expected.content);
  assert(await js(()=>document.body.innerText.includes('仅本次会话生效')));await shot('unsupported-preserved');report.checks.unsupportedOriginalPreserved=true;
 }else if(kind==='concurrent'){
  assert.equal(await js(s=>document.querySelector(s)?.dataset.studioSkin,actual),'raised');await open();await select(buttonSel,'outline');
  // Represent a separate window changing storage while this transaction is open.
  const external=enc('flat','ghost');await setRaw(external);await apply();
  assert.equal(await raw(),external);assert.equal(await js(s=>document.querySelector(s)?.dataset.studioSkin,actual),'outline');
  assert(await js(()=>document.body.innerText.includes('其他窗口已修改组件外观')));await shot('concurrent-preserved');report.checks.concurrentOriginalPreserved=true;
 }else{
  await open();await select(buttonSel,'gradient');await select(iconSel,'floating');
  const d=win.webContents.debugger;
  try{
   d.attach('1.3');await d.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
   await until('forced color simulation',()=>js(()=>matchMedia('(forced-colors:active)').matches));
   const state=()=>js(s=>[...document.querySelectorAll(s+' button[data-studio-skin]')].map(e=>{const c=getComputedStyle(e);return {label:e.getAttribute('aria-label')||e.innerText,disabled:e.disabled,bg:c.backgroundColor,color:c.color,border:c.borderColor,shadow:c.boxShadow,image:c.backgroundImage,outline:c.outline,focus:e.matches(':focus-visible')}}),dialog);
   const normal=await state();assert.equal(normal.length,7);assert(normal.every(x=>x.image==='none'&&x.shadow==='none'),'forced colors decorative effects survive');
   assert(normal.filter(x=>!x.disabled).every(x=>x.bg!==x.color),'forced colors invisible text');
   await js(s=>document.querySelector(s).focus(),iconSel);await press('Tab');const focused=(await state()).find(x=>x.label==='普通操作');assert(focused?.focus&&focused.outline.includes('2px'));
   report.observations.forcedColor={normal,focused,actualContent:win.getContentSize(),host:'CDP emulation only; not actual OS forced colors'};
   await shot('forced-colors-focus');await press('Space');assert(await js(s=>document.querySelector(s)?.innerText.includes('样例操作次数：1'),dialog));report.checks.forcedColorsEmulated=true;
  }finally{if(d.isAttached()){await d.sendCommand('Emulation.setEmulatedMedia',{features:[]}).catch(()=>{});d.detach()}}
  await press('Escape');await close();
 }
 // All cases exercise background focus and global keyboard isolation.
 await open();
 await js(()=>{window.__t13Global=[];window.__t13Key=e=>{if((e.ctrlKey||e.metaKey)&&['s','k','z','y'].includes(e.key.toLowerCase()))window.__t13Global.push(e.key.toLowerCase())};window.addEventListener('keydown',window.__t13Key);document.querySelector('#basic-field-name').focus();return true});
 assert(await js(s=>!!document.activeElement.closest(s),dialog),'native modal allowed background focus');
 await press('S',['control']);await press('K',['control']);await press('Z',['control']);await press('Y',['control']);
 assert.deepEqual(await js(()=>{window.removeEventListener('keydown',window.__t13Key);return window.__t13Global}),[]);
 assert(await js(s=>document.querySelector(s)?.matches(':modal')&&!document.querySelector('[data-studio-region="command-palette"]'),dialog));
 await shot('modal-shortcut-isolation');await press('Escape');await close();await until('focus restored',()=>js(()=>document.activeElement.innerText.trim()==='组件外观'));
 await sleep(400);assert.equal(writes,beforeWrites,'background document save was invoked');assert.equal(sha(fs.readFileSync(disk)),before);assert.equal(JSON.stringify(await main.store.listSnapshots('runner-fixture')),snaps);
 report.checks.backgroundFocusAndShortcutIsolation=true;report.checks.noSaveCall=true;report.checks.focusReturn=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=e.stack||String(e);write();console.error(report.error);app.exit(1)});
