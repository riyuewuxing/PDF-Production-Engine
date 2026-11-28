// T18 synthetic native secret and number skin verification. Never serialize password values.
const {app,session,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,theme=process.env.T18_THEME;
const variants=['inset','outline','soft','underline','raised','gradient'];
assert(root&&out&&path.basename(root).startsWith('synthetic-t18-integration-')&&['classic','light','dark','highContrast'].includes(theme));assert(!fs.existsSync(root));fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={sourceSha:process.env.T18_EXPECTED_SHA,platform:process.platform,theme,rows:[],screenshots:[],checks:{},external:0};const write=()=>fs.writeFileSync(path.join(out,'field-integration.json'),JSON.stringify(report,null,2));
const watchdog=setTimeout(()=>{report.error='global watchdog';write();app.exit(2)},360000);
let win;const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
async function until(label,fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(80)}throw Error('timeout '+label)}
const dialog='dialog[aria-label="组件外观工坊"]',field='#basic-field-name',area='textarea[data-studio-control="true"]',key='resume-studio-ui-component-skins-v1';
const prefs=()=>js(k=>localStorage.getItem(k),key),modal=()=>js(s=>document.querySelector(s)?.matches(':modal')||false,dialog);
async function hit(p){assert(p,'native hit test');win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});await sleep(45);win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await sleep(80)}
const point=s=>js(s=>{const e=document.querySelector(s);if(!e)return null;e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return e.contains(document.elementFromPoint(x,y))?{x,y}:null},s);
async function click(label,scope='body'){const p=await js((l,s)=>{const e=[...document.querySelectorAll(s+' button')].find(e=>e.innerText.trim()===l&&!e.disabled&&e.getClientRects().length);if(!e)return null;e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return e.contains(document.elementFromPoint(x,y))?{x,y}:null},label,scope);await hit(p)}
const open=async()=>{await click('组件外观');await until('modal',modal)},close=async()=>until('close',async()=>!(await modal()));
async function select(s,v){assert(await js((s,v)=>{const e=document.querySelector(s);if(!e||!Array.from(e.options).some(o=>o.value===v))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('change',{bubbles:true}));return true},s,v));await until('selection',()=>js((s,v)=>document.querySelector(s)?.value===v,s,v))}
async function press(keyCode){win.webContents.sendInputEvent({type:'keyDown',keyCode});await sleep(40);win.webContents.sendInputEvent({type:'keyUp',keyCode});await sleep(90)}
async function capture(name,selector){if(selector)await js(s=>document.querySelector(s)?.scrollIntoView({block:'center',behavior:'instant'}),selector);await js(()=>document.fonts.ready.then(()=>true));await sleep(200);const img=await win.webContents.capturePage();assert(!img.isEmpty());const png=img.toPNG(),filename=name+'.png';assert(png.length>10000);fs.writeFileSync(path.join(out,filename),png);report.screenshots.push({filename,width:img.getSize().width,height:img.getSize().height,sha256:sha(png)});write()}
const sample=(label)=>dialog+' [aria-label='+JSON.stringify(label)+']';
const state=s=>js(s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,type:e.type,variant:e.dataset.studioSkin||null,family:e.dataset.studioSkinFamily||null,...(e.type==='password'?{}:{value:e.value}),min:e.min,max:e.max,step:e.step,disabled:e.disabled,readOnly:e.readOnly,focus:e.matches(':focus-visible'),radius:c.borderRadius,border:c.borderColor,shadow:c.boxShadow,bg:c.backgroundColor,fg:c.color,image:c.backgroundImage,outline:c.outline,cursor:c.cursor,width:r.width,height:r.height,protected:!!e.closest('.a4-sheet,[data-studio-paper]'),scope:e.closest('[data-studio-surface][data-studio-theme]')?.dataset.studioTheme||null}},s);
const lum=s=>{const a=s.match(/[\d.]+/g)?.map(Number);assert(a&&a.length>=3);return a.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((t,x,i)=>t+x*[.2126,.7152,.0722][i],0)};
function check(x,f,v){assert(x&&!x.protected&&x.scope===theme&&x.variant===v&&x.family===f&&x.width>0&&x.height>0);assert.equal(x.tag,'INPUT');assert.equal(x.type,f);if(x.disabled)assert.equal(x.cursor,'not-allowed');else {x.contrast=(Math.max(lum(x.fg),lum(x.bg))+.05)/(Math.min(lum(x.fg),lum(x.bg))+.05);assert(x.contrast>=4.5,JSON.stringify(x))}return x}
const signature=x=>JSON.stringify([x.radius,x.border,x.shadow,x.bg,x.image]);
const paper=()=>js(()=>{const e=document.querySelector('.a4-sheet');if(!e)throw Error('paper missing');const b=e.getBoundingClientRect(),r=n=>Math.round(n*1000)/1000;return JSON.stringify([e.innerText,...[e,...e.querySelectorAll('*')].map(x=>{const s=getComputedStyle(x),p=x.getBoundingClientRect();return [x.tagName,x.className?.baseVal??x.className,r(p.x-b.x),r(p.y-b.y),r(p.width),r(p.height),s.color,s.backgroundColor,s.fontFamily,s.fontSize,s.lineHeight,s.border,s.transform]})])});
const source=async()=>JSON.stringify({doc:await main.store.getResume('runner-fixture'),master:await main.store.getResume('master'),ledger:await main.store.getApplications(),snapshots:await main.store.listSnapshots('runner-fixture')});



const nav=label=>click(label,'nav[aria-label="主导航"]');
const group='[aria-label="AI 模型中心"]',secret=group+' input[type=password]',budget=group+' [aria-label="输入字符预算"]',tokens=group+' [aria-label="输出 tokens"]',timeout=group+' [aria-label="超时（秒）"]',photoWidth='input[type=number][min="50"][max="180"]',photoHeight='input[type=number][min="50"][max="220"]';
const config={button:'outline',icon:'pill',text:'gradient',multiline:'soft',password:'outline',number:'raised'};
const labels={button:'普通按钮皮肤',icon:'图标按钮皮肤',text:'单行文本皮肤',multiline:'多行文本皮肤',password:'密钥输入皮肤',number:'数字输入皮肤'};
async function apply(values){
 await open();for(const [k,v] of Object.entries(values))await select(sample(labels[k]),v);
 await click('应用组件外观',dialog);await close();
}
async function ready(){await until('editor ready',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'&&document.querySelector('.studio-shell')?.getAttribute('aria-busy')==='false'))}
async function openProfile(){
 await nav('诊断优化');await click('AI 润色 Diff');await click('去配置',group);
 await until('profile ready',()=>js((p,b)=>!!document.querySelector(p)&&!document.querySelector(p).disabled&&document.querySelector(b)?.value==='60000',secret,budget));
}
async function nativeNumber(selector,typed,expected){
 await hit(await point(selector));await until('number focus',()=>js(s=>document.activeElement===document.querySelector(s),selector));
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});
 win.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
 await sleep(80);win.webContents.insertText(String(typed));
 await until('native number '+selector,async()=>(await state(selector))?.value===String(expected));
}
const validity=s=>js(s=>{const e=document.querySelector(s);return {type:e.type,value:e.value,valid:e.validity.valid,under:e.validity.rangeUnderflow,over:e.validity.rangeOverflow,step:e.validity.stepMismatch}},s);
async function renderPair(name,doc){
 const pdf=await main.renderDocumentToPdf(doc),png=await main.renderDocumentToPng(doc);
 assert(pdf.subarray(0,5).toString()==='%PDF-'&&pdf.length>5000);
 assert(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&png.length>10000);
 const files=[];
 for(const [ext,buf] of [['pdf',pdf],['png',png]]){
  const filename='export-'+name+'.'+ext;fs.writeFileSync(path.join(out,filename),buf);files.push({filename,bytes:buf.length,sha256:sha(buf)});
 }
 report.exports[name]=files;write();
}
async function reloadRenderer(){
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('renderer reload watchdog')),30000);
  win.webContents.once('did-finish-load',()=>{clearTimeout(timer);resolve()});win.webContents.reload();
 });
 await ready();
}
const settingsFile=()=>path.join(main.dataDir,'.ai-settings.json');
const settingsHash=()=>sha(fs.readFileSync(settingsFile()));
const doc=()=>main.store.getResume('runner-fixture');
const stripTime=d=>{const x=JSON.parse(JSON.stringify(d));delete x.updatedAt;return x};
async function waitPhoto(w,h){
 await until('saved photo size',async()=>{const d=await doc();return d.basic.photoConfig.width===w&&d.basic.photoConfig.height===h},20000);
}
async function run(){
 report.exports={};report.profileWrites=0;
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{report.external++;write();cb({cancel:true})});
 global.fetch=async()=>{report.external++;write();throw Error('unexpected external request')};
 assert(process.env.T18_EXPECTED_SHA&&/^[a-f0-9]{40}$/.test(process.env.T18_EXPECTED_SHA));
 fs.mkdirSync(main.dataDir,{recursive:true});
 const initial={profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:false,providerLabel:'Synthetic integration fixture',baseUrl:'http://127.0.0.1:43219/v1',model:'synthetic-test',contextBudgetChars:60000,maxOutputTokens:4096,timeoutMs:25000};
 fs.writeFileSync(settingsFile(),JSON.stringify({schemaVersion:2,activeProfileId:initial.profileId,profiles:[initial]}),{flag:'wx'});
 const initialSettings=settingsHash();
 await main.store.saveResume('master',{...fixture,id:'synthetic-t18-integration-master',title:'合成母库'});await main.store.saveResume('runner-fixture',fixture);
 await main.registerAssetProtocol();
 const register=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(channel,handler)=>register(channel,async(...args)=>{if(channel==='ai:saveSettings'){report.profileWrites++;write()}return handler(...args)});
 main.registerIpcHandlers();ipcMain.handle=register;
 win=await main.createMainWindow();win.show();win.focus();await ready();
 await until('stable size',async()=>{if(win.isMaximized())win.unmaximize();win.setContentSize(1440,900);await sleep(300);return JSON.stringify(win.getContentSize())==='[1440,900]'},10000);
 await select('select[aria-label="切换工作台主题"]',theme);await until('theme ready',async()=>(await state(field))?.scope===theme);
 await js(()=>document.fonts.ready.then(()=>true));await sleep(500);
 const baseline=await doc(),before=JSON.parse(await source()),paperHash=sha(await paper());
 const originalWidth=baseline.basic.photoConfig.width,originalHeight=baseline.basic.photoConfig.height;
 assert.equal(await prefs(),null);
 await renderPair('baseline',baseline);
 await apply(config);
 assert.deepEqual(JSON.parse(await prefs()),{schemaVersion:3,skins:config});
 assert.equal((await state(field)).variant,'gradient');assert.equal((await state(photoWidth)).variant,'raised');
 assert.equal(sha(await paper()),paperHash);assert.deepEqual(JSON.parse(await source()),before);
 await renderPair('mixed',await doc());await capture('01-mixed-editor',photoWidth);
 await reloadRenderer();assert.deepEqual(JSON.parse(await prefs()),{schemaVersion:3,skins:config});
 assert.equal((await state(field)).variant,'gradient');assert.equal((await state(photoHeight)).variant,'raised');
 assert.equal((await state(field)).scope,theme);assert.equal(sha(await paper()),paperHash);
 assert.deepEqual(JSON.parse(await source()),before);await capture('02-renderer-reloaded',photoHeight);report.checks.rendererReload=true;write();
 await openProfile();
 assert.equal((await state(secret)).variant,'outline');assert.equal((await state(budget)).variant,'raised');assert.equal((await state(secret)).type,'password');assert(!Object.hasOwn(await state(secret),'value'));
 await hit(await point(secret));win.webContents.insertText('synthetic-reload-only');
 await until('masked dirty draft',()=>js(s=>document.querySelector(s)?.type==='password'&&document.querySelector(s).value==='synthetic-reload-only',secret));
 for(const [sel,v,expect] of [[budget,999,'under'],[tokens,8193,'over'],[timeout,121,'over']]){
  await nativeNumber(sel,v,v);const actual=await validity(sel);assert(actual[expect]&&!actual.valid&&actual.type==='number');report.rows.push({phase:'invalid-profile',selector:sel,observation:actual});
 }
 await capture('03-native-invalid-budgets',timeout);
 assert.equal(settingsHash(),initialSettings);assert.equal(report.profileWrites,0);
 await reloadRenderer();await openProfile();
 assert(await js(s=>document.querySelector(s)?.type==='password'&&document.querySelector(s).value==='',secret));
 assert.equal((await state(timeout)).value,'25');assert.equal(settingsHash(),initialSettings);assert.equal(report.profileWrites,0);
 await capture('04-profile-reload-clears-draft',secret);report.checks.unsavedProfileDraft=true;write();
 await nav('内容编辑');
 // Business handlers intentionally clamp out-of-range photo values; test actual native text entry and both boundaries.
 await nativeNumber(photoWidth,49,50);await nativeNumber(photoHeight,49,50);await waitPhoto(50,50);
 await hit(await point(photoWidth));await press('Down');assert.equal((await state(photoWidth)).value,'50');
 await capture('05-photo-lower-bound',photoWidth);
 await nativeNumber(photoWidth,181,180);await nativeNumber(photoHeight,221,220);await waitPhoto(180,220);
 await hit(await point(photoHeight));await press('Up');assert.equal((await state(photoHeight)).value,'220');
 await capture('06-photo-upper-bound',photoHeight);
 await nativeNumber(photoWidth,originalWidth,originalWidth);await nativeNumber(photoHeight,originalHeight,originalHeight);await waitPhoto(originalWidth,originalHeight);
 const after=JSON.parse(await source());assert.deepEqual(stripTime(after.doc),stripTime(before.doc));assert.deepEqual(after.master,before.master);assert.deepEqual(after.ledger,before.ledger);assert.deepEqual(after.snapshots,before.snapshots);
 report.checks.photoClampAndRestore=true;await capture('07-photo-restored',photoWidth);
 assert.equal(sha(await paper()),paperHash);
 await apply({password:'inherit'});const {password:_p,...withoutPassword}=config;
 assert.deepEqual(JSON.parse(await prefs()),{schemaVersion:3,skins:withoutPassword});
 assert.equal((await state(photoWidth)).variant,'raised');
 await apply({number:'inherit'});const {number:_n,...withoutNew}=withoutPassword;
 assert.deepEqual(JSON.parse(await prefs()),{schemaVersion:2,skins:withoutNew});
 assert.equal((await state(photoWidth)).variant,null);assert.equal((await state(field)).variant,'gradient');
 await open();await click('恢复各族原样（草稿）',dialog);await click('应用组件外观',dialog);await close();
 assert.deepEqual(JSON.parse(await prefs()),{schemaVersion:1,skins:{button:'inherit',icon:'inherit'}});
 assert.equal((await state(field)).variant,null);assert.equal((await state(photoWidth)).variant,null);assert.equal(sha(await paper()),paperHash);
 await renderPair('restored',await doc());await capture('08-fully-restored',photoWidth);
 assert.equal(settingsHash(),initialSettings);assert.equal(report.profileWrites,0);assert.equal(report.external,0);
 assert(await js(()=>!document.querySelector('.a4-sheet [data-studio-skin],[data-studio-paper] [data-studio-skin]')));
 report.checks={...report.checks,rangeValidation:true,mixedV3:true,independentDowngrade:true,sourceIsolationExceptExplicitPhotoEdits:true,settingsIsolation:true,paperGeometryUnchanged:true,actualExportPairs:true,noExternalNetwork:true};report.complete=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e.message||e);write();console.error(e.stack||report.error);app.exit(1)});
