// Real native Windows component workshop, no real user data/credentials.
const {app,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,id=process.env.STUDIO_SKIN_THEME,phase=process.env.STUDIO_SKIN_PHASE||'main';
const buttons=['solid','outline','soft','flat','raised','gradient'],icons=['square','round','pill','ghost','floating','fine-outline'];
if(!root||!out||!path.basename(root).startsWith('synthetic-t13-skins-')||!['classic','light','dark','highContrast'].includes(id)||!['main','restart'].includes(phase))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={runnerSha:process.env.GITHUB_SHA,id,phase,rows:[],checks:{},contrastFailures:[],networkAttempts:[]};
const write=()=>fs.writeFileSync(path.join(out,'skin-'+phase+'.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='native skin watchdog';write();app.exit(2)},330000);
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('Timed out: '+label)}
const parse=s=>{const a=s.match(/[\d.]+/g)?.map(Number);assert(a&&a.length>=3,'not RGB '+s);return a};
const lum=a=>a.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
const contrast=(f,b)=>{const x=lum(parse(f)),y=lum(parse(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
async function run(){
 if(phase==='main'){
  await main.store.saveResume('master',{...fixture,id:'synthetic-master',title:'合成母库'});
  await main.store.saveResume('runner-fixture',fixture);
 }
 const disk=path.join(main.store.resumesDir,'runner-fixture.json'),before=sha(fs.readFileSync(disk)),snapshots=JSON.stringify(await main.store.listSnapshots('runner-fixture'));
 const saved=path.join(root,'skin-proof.json');
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.focus();
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>{report.networkAttempts.push(d.url);cb({cancel:true})});
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const dialog='dialog[aria-label="组件外观工坊"]',theme='select[aria-label="切换工作台主题"]',key='resume-studio-ui-component-skins-v1',themeKey='resume-studio-ui-theme-v1';
 const h='button[aria-label="打开命令面板"]',undo='button[aria-label="撤销"]';
 const field='#basic-field-name';
 const val=sel=>js(s=>document.querySelector(s)?.value,sel);
 const pref=()=>js(k=>localStorage.getItem(k),key);
 const selection=async(s,v)=>{assert(await js((s,v)=>{const e=document.querySelector(s);if(!e||e.disabled||![...e.options].some(o=>o.value===v))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('change',{bubbles:true}));return true},s,v),'selection '+s);await until('selected '+s,async()=>await val(s)===v);};
 const click=async(label,scope='body')=>{assert(await js((l,s)=>{const b=[...document.querySelectorAll(s+' button')].find(e=>e.innerText.trim()===l&&e.getClientRects().length&&!e.disabled);if(!b)return false;b.click();return true},label,scope),'button missing '+label);await sleep(80)};
 const modal=()=>js(s=>document.querySelector(s)?.matches(':modal')||false,dialog);
 const open=async()=>{await click('组件外观');await until('native modal open',modal)};
 const close=async()=>{await until('native modal closed',async()=>!(await modal()))};
 const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode:'Enter',modifiers});await sleep(40);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(90)};
 const screenshot=async name=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(100);const im=await win.webContents.capturePage();assert(!im.isEmpty());fs.writeFileSync(path.join(out,name+'.png'),im.toPNG());return im.getSize()};
 const noWrite=async()=>{assert.equal(sha(fs.readFileSync(disk)),before,'source document changed');assert.equal(JSON.stringify(await main.store.listSnapshots('runner-fixture')),snapshots,'snapshot changed');assert.deepEqual(report.networkAttempts,[])};
 const counts=()=>js(s=>document.querySelector(s)?.innerText.match(/样例操作次数：(\d+)/)?.[1],dialog);
 const states=()=>js(s=>Array.from(document.querySelectorAll(s+' button[data-studio-skin]')).map(e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.innerText,role:e.dataset.studioSkinRole,family:e.dataset.studioSkinFamily,variant:e.dataset.studioSkin,disabled:e.disabled,bg:c.backgroundColor,fg:c.color,border:c.borderColor,borderWidth:c.borderWidth,radius:c.borderRadius,shadow:c.boxShadow,image:c.backgroundImage,outline:c.outline,outlineOffset:c.outlineOffset,rect:{x:r.x,y:r.y,width:r.width,height:r.height},focus:e.matches(':focus-visible'),hover:e.matches(':hover'),active:e.matches(':active')}}),dialog);
 const measure=async(label)=>{const a=await states();for(const x of a){const c=contrast(x.fg,x.bg);x.contrast=c;if(c<4.5)report.contrastFailures.push({label,...x})}return a};
 const geometry=()=>js(()=>Array.from(document.querySelectorAll('header button[data-studio-skin],aside button[data-studio-skin]')).filter(e=>e.getClientRects().length).map(e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.innerText,role:e.dataset.studioSkinRole,family:e.dataset.studioSkinFamily,variant:e.dataset.studioSkin,disabled:e.disabled,bg:c.backgroundColor,fg:c.color,radius:c.borderRadius,shadow:c.boxShadow,border:c.borderWidth,image:c.backgroundImage,width:r.width,height:r.height}}));
 const encoded=(b,i)=>JSON.stringify({schemaVersion:1,skins:{button:b,icon:i}});
 const set=async(b,i)=>{await selection(dialog+' select[aria-label="普通按钮皮肤"]',b);await selection(dialog+' select[aria-label="图标按钮皮肤"]',i)};
 await until('actual ready',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'&&document.querySelector('.studio-shell')?.getAttribute('aria-busy')==='false'));
 await until('disk saved',()=>js(()=>document.querySelector('[aria-label="本地保存状态"]')?.innerText.includes('已保存至本地硬盘')));
 if(win.isMaximized()){win.unmaximize();await sleep(250)}win.setContentSize(1440,900);await sleep(250);
 assert.deepEqual(win.getContentSize(),[1440,900]);
 if(phase==='restart'){
  const s=JSON.parse(fs.readFileSync(saved,'utf8'));assert.equal(before,s.before);
  assert.equal(await pref(),s.pref);assert.equal(await val(theme),id);
  assert.equal(await js(s=>document.querySelector(s)?.dataset.studioSkin,h),'gradient');
  assert.equal(await js(s=>document.querySelector(s)?.dataset.studioSkin,undo),'fine-outline');
  await open();assert.equal(await val(dialog+' select[aria-label="普通按钮皮肤"]'),'gradient');assert.equal(await val(dialog+' select[aria-label="图标按钮皮肤"]'),'fine-outline');
  await screenshot('restart');await press('Escape');await close();await noWrite();
  report.checks.coldPersisted=true;write();return;
 }
 assert.equal(await pref(),null);assert.equal(await js(s=>document.querySelector(s)?.hasAttribute('data-studio-skin'),h),false);
 await selection(theme,id);const themeRaw=await js(k=>localStorage.getItem(k),themeKey);
 await js(()=>{window.__t13Name=document.querySelector('#basic-field-name');window.__t13Cmd=document.querySelector('button[aria-label="打开命令面板"]')});
 const source=await main.store.getResume('runner-fixture');
 async function paper(label){
  const state=await js(()=>{const sheet=document.querySelector('.a4-sheet');if(!sheet)throw Error('missing sheet');const b=sheet.getBoundingClientRect(),round=v=>Math.round(v*1000)/1000;const signature=[sheet,...sheet.querySelectorAll('*')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return [e.tagName,e.getAttribute('class'),e.getAttribute('style'),round(r.x-b.x),round(r.y-b.y),round(r.width),round(r.height),s.color,s.backgroundColor,s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,s.border,s.transform,s.colorScheme]});return {text:sheet.innerText,signature,rect:[b.x,b.y,b.width,b.height],page:document.querySelector('[aria-label="预估页数"]')?.innerText}});
  const pdf=await js(doc=>window.resumeDesktop.pdf.export({slug:'',document:doc}),source),png=await js(doc=>window.resumeDesktop.pdf.exportPng({slug:'',document:doc}),source);
  assert(!pdf.canceled&&pdf.filePath&&!png.canceled&&png.filePath);const pb=fs.readFileSync(pdf.filePath),ib=fs.readFileSync(png.filePath),im=nativeImage.createFromBuffer(ib);
  assert.equal(pb.subarray(0,5).toString(),'%PDF-');assert(!im.isEmpty());
  fs.writeFileSync(path.join(out,label+'-export.pdf'),pb);fs.writeFileSync(path.join(out,label+'-export.png'),ib);
  return {dom:sha(JSON.stringify({text:state.text,signature:state.signature,page:state.page})),rect:state.rect,page:state.page,png:sha(im.toBitmap()),pngSize:im.getSize(),pdfSha:sha(pb)};
 }
 report.baseline=await paper('baseline');await screenshot('baseline-editor');
 await open();await set('soft','pill');assert.equal(await pref(),null);assert.equal(await js(s=>document.querySelector(s)?.hasAttribute('data-studio-skin'),h),false);await press('Escape');await close();assert.equal(await pref(),null);
 report.checks.escapeCancelNoWrite=true;
 const styles={button:new Set(),icon:new Set()};
 for(let n=0;n<buttons.length;n++){
  const b=buttons[n],i=icons[n],last=await pref();
  await open();await set(b,i);assert.equal(await pref(),last,'draft wrote preference');
  const normal=await measure('normal-'+b);assert.equal(normal.length,7);assert(normal.every(x=>x.variant===(x.family==='button'?b:i)));
  const row={button:b,icon:i,normal};report.rows.push(row);write();
  const signature=x=>JSON.stringify([x.radius,x.borderWidth,x.border,x.shadow,x.image,x.bg,x.rect.width,x.rect.height]);
  styles.button.add(signature(normal.find(x=>x.label==='主要操作')));styles.icon.add(signature(normal.find(x=>x.label==='增加样例计数')));
  await screenshot('workshop-'+b+'-'+i);
  // Real pointer hover, pressed state and click. Physical event delivery, not synthetic click handler.
  for(const name of ['普通操作','主要操作','危险操作演示','增加样例计数','危险图标操作演示']){
   const s=normal.find(x=>x.label===name);assert(s);
   const x=Math.round(s.rect.x+s.rect.width/2),y=Math.round(s.rect.y+s.rect.height/2);
   win.webContents.sendInputEvent({type:'mouseMove',x,y});await sleep(70);
   const hover=await measure('hover-'+b+'-'+name);
   const hit=hover.find(a=>a.label===name);assert(hit?.hover,'actual hover failed '+name);
   (row.hover??=[]).push(hit);
   if(name==='普通操作'){
    win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});await sleep(80);
    row.pressed=(await measure('pressed-'+b)).find(a=>a.label===name);assert(row.pressed?.active,'actual pressed missing');
    await screenshot('pressed-'+b);
    win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await sleep(80);
    assert.equal(await counts(),'1','pointer event count');
   }
  }
  // Native keyboard focus on the first sample, then activation exactly once.
  await js(s=>document.querySelector(s+' select[aria-label="图标按钮皮肤"]').focus(),dialog);
  await press('Tab');const focus=(await measure('focus-'+b)).find(x=>x.label==='普通操作');assert(focus?.focus,'native keyboard focus missing');assert(focus.outline.includes('2px'),'visible focus ring missing');row.focus=focus;
  await press('Space');assert.equal(await counts(),'2','native Space failed/double fired');
  await screenshot('focus-'+b);
  const disabled=normal.find(x=>x.label==='不可用');const dx=Math.round(disabled.rect.x+disabled.rect.width/2),dy=Math.round(disabled.rect.y+disabled.rect.height/2);
  win.webContents.sendInputEvent({type:'mouseMove',x:dx,y:dy});win.webContents.sendInputEvent({type:'mouseDown',x:dx,y:dy,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:dx,y:dy,button:'left',clickCount:1});await sleep(80);assert.equal(await counts(),'2','disabled fired');
  await click('危险操作演示',dialog);assert.equal(await counts(),'2');assert(await js(()=>!!document.querySelector('[aria-label="样例危险操作确认"]')));await screenshot('danger-confirm-'+b);await click('取消样例操作',dialog);assert.equal(await counts(),'2');
  await click('危险操作演示',dialog);await click('确认样例操作',dialog);assert.equal(await counts(),'3');
  await click('应用组件外观',dialog);await close();
  assert.equal(await pref(),encoded(b,i));assert.equal(await js(s=>document.querySelector(s)?.dataset.studioSkin,h),b);assert.equal(await js(s=>document.querySelector(s)?.dataset.studioSkin,undo),i);
  assert(await js(()=>window.__t13Name===document.querySelector('#basic-field-name')&&window.__t13Cmd===document.querySelector('button[aria-label="打开命令面板"]')),'business element remounted');
  row.actual=await geometry();assert(row.actual.some(x=>x.family==='button'&&x.role==='primary')&&row.actual.some(x=>x.family==='icon')&&row.actual.some(x=>x.family==='icon'&&x.role==='danger'),'business skin markers missing');
  assert(await js(()=>[...document.querySelectorAll('.a4-sheet [data-studio-skin]')].length===0),'paper marker contamination');
  for(const x of row.actual){x.contrast=contrast(x.fg,x.bg);if(x.contrast<4.5)report.contrastFailures.push({label:'actual-'+b,...x})}
  await screenshot('editor-'+b+'-'+i);
  assert(await js(s=>{document.querySelector(s)?.click();return true},h));await until('command opens with variant',()=>js(()=>!!document.querySelector('[data-studio-region="command-palette"]')));await press('Escape');await until('command closes',()=>js(()=>!document.querySelector('[data-studio-region="command-palette"]')));
  row.paper=await paper(b+'-'+i);
  assert.equal(row.paper.dom,report.baseline.dom,'paper DOM changed');assert.equal(row.paper.png,report.baseline.png,'native PNG pixels changed');assert.deepEqual(row.paper.pngSize,report.baseline.pngSize);
  assert.equal(await js(k=>localStorage.getItem(k),themeKey),themeRaw);await noWrite();write();
 }
 assert.equal(styles.button.size,6,'duplicate visual signatures');assert.equal(styles.icon.size,6,'duplicate icon signatures');
 // Independent family override and cancellation.
 await open();await selection(dialog+' select[aria-label="普通按钮皮肤"]','inherit');assert.equal(await val(dialog+' select[aria-label="图标按钮皮肤"]'),'fine-outline');await click('应用组件外观',dialog);await close();
 assert.equal(await pref(),encoded('inherit','fine-outline'));assert.equal(await js(s=>document.querySelector(s)?.hasAttribute('data-studio-skin'),h),false);assert.equal(await js(s=>document.querySelector(s)?.dataset.studioSkin,undo),'fine-outline');
 await open();await set('gradient','fine-outline');await click('应用组件外观',dialog);await close();
 // Switching colors preserves overrides. Restore the target color for cold restart.
 const next=id==='dark'?'light':'dark';await selection(theme,next);assert.equal(await pref(),encoded('gradient','fine-outline'));await selection(theme,id);assert.equal(await pref(),encoded('gradient','fine-outline'));
 await noWrite();report.checks.sixDistinctPerFamily=true;report.checks.independentOverrides=true;report.checks.nativeStateAndBusinessIdentity=true;report.checks.paperIsolation=true;report.checks.sourceAndNetworkUnchanged=true;
 fs.writeFileSync(saved,JSON.stringify({before,pref:await pref()}));write();
 if(report.contrastFailures.length)throw Error('component contrast failures '+report.contrastFailures.length);
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=e.stack||String(e);write();console.error(report.error);app.exit(1)});
