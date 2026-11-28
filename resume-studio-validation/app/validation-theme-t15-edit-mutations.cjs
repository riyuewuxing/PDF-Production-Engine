// T15 native foundation actions; synthetic fixture only. UI settings via real controls, native pointer/keyboard for representative actions.
const {app,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,id=process.env.STUDIO_SKIN_THEME;
if(!root||!out||!path.basename(root).startsWith('synthetic-t15-foundation-')||!['classic','light','dark','highContrast'].includes(id))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={runnerSha:process.env.GITHUB_SHA,theme:id,rows:[],checks:{},network:[]};const write=()=>fs.writeFileSync(path.join(out,'foundation.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='foundation watchdog';write();app.exit(2)},360000);
async function until(label,fn,ms=18000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(90)}throw Error('timeout '+label)}
const pairs=[['solid','square'],['outline','round'],['soft','pill'],['flat','ghost'],['raised','floating'],['gradient','fine-outline']];
const lum=s=>{const a=s.match(/[\d.]+/g).map(Number);return a.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0)};
async function run(){
 const rgba=Buffer.alloc(137*193*4);for(let y=0;y<193;y++)for(let x=0;x<137;x++){const i=(y*137+x)*4;rgba[i]=(x*3+y)%256;rgba[i+1]=(y*5+x)%256;rgba[i+2]=(x*7+y*2)%256;rgba[i+3]=255;}
 const png=nativeImage.createFromBitmap(rgba,{width:137,height:193}).toPNG(),assets=path.join(main.dataDir,'assets');fs.mkdirSync(assets,{recursive:true});fs.writeFileSync(path.join(assets,'synthetic-t15-photo.png'),png);
 const source={...fixture,basic:{...fixture.basic,photo:'/api/assets/synthetic-t15-photo.png',photoConfig:{visible:true,aspectRatio:'3:4',borderRadius:'sm',bgBackdrop:'',frameStyle:'none',width:88,height:116}}};
 await main.store.saveResume('master',{...fixture,id:'synthetic-master',title:'合成母库'});await main.store.saveResume('runner-fixture',source);
 const disk=path.join(main.store.resumesDir,'runner-fixture.json'),hashes=()=>({resume:sha(fs.readFileSync(disk)),photo:sha(fs.readFileSync(path.join(assets,'synthetic-t15-photo.png'))),files:fs.readdirSync(assets).sort()}),before=hashes(),snapshots=JSON.stringify(await main.store.listSnapshots('runner-fixture')),ledger=JSON.stringify(await main.store.getApplications());
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.focus();
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>{report.network.push(d.url);cb({cancel:true})});
 const js=(fn,...a)=>win.webContents.executeJavaScript('('+fn.toString()+')('+a.map(x=>JSON.stringify(x)).join(',')+')');
 const dlg='dialog[aria-label="组件外观工坊"]',crop='[role="dialog"][aria-label="证件照裁剪与底色工作台"]',lightbox='[role="dialog"][aria-label^="模板大图对比"]',card='[data-studio-gallery-card="vip-cyber-dark"]',actions=card+' [data-studio-region="gallery-card-actions"]';
 const key=async(keyCode)=>{win.webContents.sendInputEvent({type:'keyDown',keyCode});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode:'Enter'});await sleep(35);win.webContents.sendInputEvent({type:'keyUp',keyCode});await sleep(120)};
 const setupClick=async(label,scope='body')=>{assert(await js((label,scope)=>{const b=[...document.querySelectorAll(scope+' button')].find(e=>(e.innerText.trim()===label||e.getAttribute('aria-label')===label)&&!e.disabled&&e.getClientRects().length);if(!b)return false;b.click();return true},label,scope),'setup '+label);await sleep(120)};
 const set=async(sel,value)=>{assert(await js((sel,v)=>{const e=document.querySelector(sel);if(!e||e.disabled)return false;const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,v);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return true},sel,value),'set '+sel);await sleep(120)};
 const shot=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(150);const im=await win.webContents.capturePage();assert(!im.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),im.toPNG());return im.getSize()};
 const exists=sel=>js(sel=>!!document.querySelector(sel),sel);
 const pref=()=>js(()=>JSON.parse(localStorage.getItem('resume-studio-ui-component-skins-v1')||'null'));
 const noWrite=async()=>{assert.deepEqual(hashes(),before);assert.equal(JSON.stringify(await main.store.listSnapshots('runner-fixture')),snapshots);assert.equal(JSON.stringify(await main.store.getApplications()),ledger);assert.deepEqual(report.network,[])};
 const nav=async text=>{await setupClick(text,'nav');await sleep(200)};
 const skin=async(b,i)=>{await setupClick('组件外观');await until('modal',()=>js(d=>document.querySelector(d)?.matches(':modal'),dlg));await set(dlg+' select[aria-label="普通按钮皮肤"]',b);await set(dlg+' select[aria-label="图标按钮皮肤"]',i);await setupClick('应用组件外观',dlg);await until('workshop closed',async()=>!(await exists(dlg)));assert.deepEqual(await pref(),{schemaVersion:1,skins:{button:b,icon:i}})};
 const check=async(label,scope,family,variant)=>{const r=await js((l,s)=>{const e=[...document.querySelectorAll(s+' button')].find(e=>(e.innerText.trim()===l||e.getAttribute('aria-label')===l)&&e.getClientRects().length);if(!e)return null;const c=getComputedStyle(e),b=e.getBoundingClientRect(),root=e.closest('[data-studio-surface][data-studio-theme]');return {label:l,family:e.dataset.studioSkinFamily,variant:e.dataset.studioSkin,role:e.dataset.studioSkinRole,disabled:e.disabled,fg:c.color,bg:c.backgroundColor,border:c.borderRadius,outline:c.outline,width:b.width,height:b.height,surface:root?.dataset.studioSurface,protected:!!e.closest('.a4-sheet,[data-studio-paper]')}} ,label,scope);
 assert(r,'missing actual button '+label);assert.equal(r.family,family,label);assert.equal(r.variant,variant,label);assert(r.surface&&!r.protected,'scope '+label);if(!r.disabled){const a=lum(r.fg),b=lum(r.bg);r.contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert(r.contrast>=4.5,'button color contrast '+JSON.stringify(r));}return r};
 const native=async(label,scope='body',mode='pointer')=>{const s=await js((l,s)=>{const e=[...document.querySelectorAll(s+' button')].find(e=>(e.innerText.trim()===l||e.getAttribute('aria-label')===l)&&!e.disabled&&e.getClientRects().length);if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});e.focus();const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),focused:document.activeElement===e}},label,scope);assert(s?.focused,'focus '+label);await sleep(180);
 if(mode==='keyboard'){await key('Enter');return}
 const hit=await js((l,s,x,y)=>{const e=[...document.querySelectorAll(s+' button')].find(e=>(e.innerText.trim()===l||e.getAttribute('aria-label')===l)&&!e.disabled&&e.getClientRects().length);const h=document.elementFromPoint(x,y);return !!e&&!!h&&(h===e||e.contains(h))},label,scope,s.x,s.y);assert(hit,'pointer hit '+label+' '+JSON.stringify(s));win.webContents.sendInputEvent({type:'mouseMove',x:s.x,y:s.y});win.webContents.sendInputEvent({type:'mouseDown',x:s.x,y:s.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:s.x,y:s.y,button:'left',clickCount:1});await sleep(130)};
 const clean=()=>js(()=>[...document.querySelectorAll('.a4-sheet [data-studio-skin],[data-studio-paper] [data-studio-skin],.a4-sheet[data-studio-skin]')].length===0);
 const canvas=()=>js(s=>document.querySelector(s+' canvas')?.toDataURL('image/png'),crop);
 await until('editor ready',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'&&document.querySelector('.studio-shell')?.getAttribute('aria-busy')==='false'));
 await until('photo loaded',()=>js(()=>document.querySelector('img[alt="证件照预览"]')?.naturalWidth>0));
 await until('native window shown',()=>win.isVisible());await sleep(1600);await until('stable native content 1440x900',async()=>{if(win.isMaximized()){win.unmaximize();await sleep(300);return false;}win.setContentSize(1440,900);await sleep(300);return !win.isMaximized()&&JSON.stringify(win.getContentSize())==='[1440,900]'},8000);await sleep(350);assert.deepEqual(win.getContentSize(),[1440,900]);
 await set('select[aria-label="切换工作台主题"]',id);await until('theme',()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));

 const semantic=d=>{const x=structuredClone(d);delete x.updatedAt;return x};
 const get=()=>main.store.getResume('runner-fixture');
 const baseDoc=await get();assert.equal(baseDoc.education.length,1);assert.equal(baseDoc.templateId,'minimal-ats');
 const same=async()=>JSON.stringify(semantic(await get()))===JSON.stringify(semantic(baseDoc));
 for(const [b,i] of pairs){const label=b+'-'+i;await skin(b,i);assert(await same());const start=await get();const n=start.education.length;
 await check('复制一份该条经历','aside','icon',i);
 await native('复制一份该条经历','aside','keyboard');
 await until('duplicate persisted',async()=>(await get()).education.length===n+1,25000);
 const duplicate=await get();assert.deepEqual({...semantic(duplicate),education:start.education},semantic(start));const edu=duplicate.education;assert.equal(new Set(edu.map(x=>x.id)).size,n+1);assert.deepEqual(edu[0],start.education[0]);assert.deepEqual({...edu[1],id:edu[0].id},edu[0]);
 await shot(label+'-duplicate');
 await native('撤销','body','keyboard');await until('undo persisted',same,25000);
 await native('重做','body','keyboard');await until('redo persisted',async()=>JSON.stringify(semantic(await get()))===JSON.stringify(semantic(duplicate)),25000);
 await shot(label+'-redo');await native('撤销','body','keyboard');await until('second undo persisted',same,25000);
 assert(await clean());assert.equal(sha(fs.readFileSync(path.join(assets,'synthetic-t15-photo.png'))),before.photo);assert.equal(JSON.stringify(await main.store.getApplications()),ledger);report.rows.push({button:b,icon:i,duplicate:true,undo:true,redo:true,finalUndo:true});write();
 }
 await nav('模板库(51)');await until('gallery',()=>exists('input[aria-label="搜索模板"]'));const name=await js(s=>document.querySelector(s)?.querySelector('h3')?.innerText,card);assert(name);await set('input[aria-label="搜索模板"]',name);await until('thumbnail',()=>exists(card+' [data-studio-paper="thumbnail"]'));await native('大图放大对比',actions,'keyboard');await until('lightbox',()=>exists(lightbox));await native('应用此模板并开始编辑',lightbox,'keyboard');await until('template persisted',async()=>(await get()).templateId==='vip-cyber-dark',25000);
 const applied=await get();const original=semantic(baseDoc),after=semantic(applied);assert.deepEqual({...after,templateId:original.templateId,globalSettings:{...after.globalSettings,themeColor:original.globalSettings.themeColor}},original);
 await shot('template-applied');assert(await clean());assert.equal(JSON.stringify(await main.store.getApplications()),ledger);assert.deepEqual(report.network,[]);report.checks={sixPairs:true,duplicateUndoRedo:true,templateApplied:true,ledgerUnchanged:true,protectedPaperNoSkinMarkers:true};write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);write();app.exit(1)});
