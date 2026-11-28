// T18 synthetic native secret and number skin verification. Never serialize password values.
const {app,session,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,theme=process.env.T18_THEME;
const variants=['inset','outline','soft','underline','raised','gradient'];
assert(root&&out&&path.basename(root).startsWith('synthetic-t18-fields-')&&['classic','light','dark','highContrast'].includes(theme));assert(!fs.existsSync(root));fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={sourceSha:process.env.T18_EXPECTED_SHA,platform:process.platform,theme,rows:[],screenshots:[],checks:{},external:0};const write=()=>fs.writeFileSync(path.join(out,'secret-number.json'),JSON.stringify(report,null,2));
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
const state=s=>js(s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,type:e.type,variant:e.dataset.studioSkin||null,family:e.dataset.studioSkinFamily||null,value:e.type==='password'?undefined:e.value,min:e.min,max:e.max,step:e.step,disabled:e.disabled,readOnly:e.readOnly,focus:e.matches(':focus-visible'),radius:c.borderRadius,border:c.borderColor,shadow:c.boxShadow,bg:c.backgroundColor,fg:c.color,image:c.backgroundImage,outline:c.outline,cursor:c.cursor,width:r.width,height:r.height,protected:!!e.closest('.a4-sheet,[data-studio-paper]'),scope:e.closest('[data-studio-surface][data-studio-theme]')?.dataset.studioTheme||null}},s);
const lum=s=>{const a=s.match(/[\d.]+/g)?.map(Number);assert(a&&a.length>=3);return a.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((t,x,i)=>t+x*[.2126,.7152,.0722][i],0)};
function check(x,f,v){assert(x&&!x.protected&&x.scope===theme&&x.variant===v&&x.family===f&&x.width>0&&x.height>0);assert.equal(x.tag,'INPUT');assert.equal(x.type,f);if(x.disabled)assert.equal(x.cursor,'not-allowed');else {x.contrast=(Math.max(lum(x.fg),lum(x.bg))+.05)/(Math.min(lum(x.fg),lum(x.bg))+.05);assert(x.contrast>=4.5,JSON.stringify(x))}return x}
const signature=x=>JSON.stringify([x.radius,x.border,x.shadow,x.bg,x.image]);
const paper=()=>js(()=>{const e=document.querySelector('.a4-sheet');if(!e)throw Error('paper missing');const b=e.getBoundingClientRect(),r=n=>Math.round(n*1000)/1000;return JSON.stringify([e.innerText,...[e,...e.querySelectorAll('*')].map(x=>{const s=getComputedStyle(x),p=x.getBoundingClientRect();return [x.tagName,x.className?.baseVal??x.className,r(p.x-b.x),r(p.y-b.y),r(p.width),r(p.height),s.color,s.backgroundColor,s.fontFamily,s.fontSize,s.lineHeight,s.border,s.transform]})])});
const source=async()=>JSON.stringify({doc:await main.store.getResume('runner-fixture'),master:await main.store.getResume('master'),ledger:await main.store.getApplications(),snapshots:await main.store.listSnapshots('runner-fixture')});


const nav=label=>click(label,'nav[aria-label="主导航"]');
const group='[aria-label="AI 模型中心"]',secret=group+' input[type=password]',budget=group+' [aria-label="输入字符预算"]',tokens=group+' [aria-label="输出 tokens"]',timeout=group+' [aria-label="超时（秒）"]',photoWidth='input[type=number][min="50"][max="180"]',photoHeight='input[type=number][min="50"][max="220"]';
const secretSample=sample('密钥输入样例'),numberSample=sample('数字输入样例'),disabledSample=sample('不可用密钥样例'),readonlySample=sample('只读数字样例');
const masked=s=>js(s=>{const e=document.querySelector(s);return !!e&&e.type==='password'&&e.value.length>0},s);
const passwordMatches=(s,v)=>js((s,v)=>{const e=document.querySelector(s);return e?.type==='password'&&e.value===v},s,v);
async function readField(selector,family,variant){
 await until('field '+selector,async()=>{const x=await state(selector);return x&&x.width>0&&x.height>0&&x.variant===variant});
 return check(await state(selector),family,variant);
}
async function choose(p,n){
 await open();await select(sample('密钥输入皮肤'),p);await select(sample('数字输入皮肤'),n);await click('应用组件外观',dialog);await close();
 assert.deepEqual(JSON.parse(await prefs()),{schemaVersion:3,skins:{button:'inherit',icon:'inherit',password:p,number:n}});
}
let held=false,readQueue=[];const release=()=>{for(const fn of readQueue.splice(0))fn()};
function gate(){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('profile read gate watchdog')),30000);readQueue.push(()=>{clearTimeout(timer);resolve()})})}
const settingsHash=()=>sha(fs.readFileSync(path.join(main.dataDir,'.ai-settings.json')));
async function run(){
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{report.external++;write();cb({cancel:true})});
 global.fetch=async()=>{report.external++;write();throw Error('unexpected external request')};
 assert(process.env.T18_EXPECTED_SHA&&/^[a-f0-9]{40}$/.test(process.env.T18_EXPECTED_SHA));
 fs.mkdirSync(main.dataDir,{recursive:true});
 const initial={profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:false,providerLabel:'Synthetic numeric fixture',baseUrl:'http://127.0.0.1:43219/v1',model:'synthetic-test',contextBudgetChars:60000,maxOutputTokens:4096,timeoutMs:25000};
 fs.writeFileSync(path.join(main.dataDir,'.ai-settings.json'),JSON.stringify({schemaVersion:2,activeProfileId:initial.profileId,profiles:[initial]}),{flag:'wx'});
 const initialSettings=settingsHash();
 await main.store.saveResume('master',{...fixture,id:'synthetic-t18-master',title:'合成母库'});await main.store.saveResume('runner-fixture',fixture);
 await main.registerAssetProtocol();
 report.profileWrites=0;
 const register=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(channel,handler)=>register(channel,async(...args)=>{if(channel==='ai:listProfiles'&&held)await gate();if(channel==='ai:saveSettings'){report.profileWrites++;write()}return handler(...args)});
 main.registerIpcHandlers();ipcMain.handle=register;
 win=await main.createMainWindow();win.show();win.focus();
 await until('ready',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'&&document.querySelector('.studio-shell')?.getAttribute('aria-busy')==='false'));
 await until('stable native size',async()=>{if(win.isMaximized())win.unmaximize();win.setContentSize(1440,900);await sleep(300);return !win.isMaximized()&&JSON.stringify(win.getContentSize())==='[1440,900]'},10000);
 await select('select[aria-label="切换工作台主题"]',theme);await until('theme ready',async()=>(await state(field))?.scope===theme);
 await js(()=>document.fonts.ready.then(()=>true));await sleep(500);
 const before=await source(),baseline=sha(await paper());assert.equal(await prefs(),null);
 const signatures={password:new Set(),number:new Set()};
 for(const [index,v] of variants.entries()){
  const n=variants[(index+1)%variants.length],row={password:v,number:n,samples:[],actual:[],checks:{}},old=await prefs();
  await open();await select(sample('密钥输入皮肤'),v);await select(sample('数字输入皮肤'),n);assert.equal(await prefs(),old);
  row.samples.push(await readField(secretSample,'password',v),await readField(numberSample,'number',n),await readField(disabledSample,'password',v),await readField(readonlySample,'number',n));
  assert(row.samples[2].disabled&&row.samples[3].readOnly);assert(!Object.hasOwn(row.samples[0],'value'));assert(!Object.hasOwn(row.samples[2],'value'));
  assert.deepEqual([row.samples[1].min,row.samples[1].max,row.samples[1].step],['1','120','1']);
  signatures.password.add(signature(row.samples[0]));signatures.number.add(signature(row.samples[1]));
  // Native typing and stepping, no password value is returned in evidence.
  await hit(await point(secretSample));await js(s=>document.querySelector(s).select(),secretSample);
  win.webContents.insertText('synthetic-appearance-check');await until('masked sample edit',()=>passwordMatches(secretSample,'synthetic-appearance-check'));
  assert(await masked(secretSample));await capture(v+'-password-sample',secretSample);
  await hit(await point(numberSample));await press('Up');await until('native increment',async()=>(await state(numberSample)).value==='61');await press('Down');assert.equal((await state(numberSample)).value,'60');
  await hit(await point(disabledSample));assert(await js(s=>document.activeElement!==document.querySelector(s),disabledSample));
  await hit(await point(readonlySample));await press('Up');assert.equal((await state(readonlySample)).value,'60');
  await capture(n+'-number-sample',numberSample);row.checks.nativeStepAndMask=true;
  await click('应用组件外观',dialog);await close();
  assert.deepEqual(JSON.parse(await prefs()),{schemaVersion:3,skins:{button:'inherit',icon:'inherit',password:v,number:n}});
  row.actual.push(await readField(photoWidth,'number',n),await readField(photoHeight,'number',n));
  assert.deepEqual([row.actual[0].min,row.actual[0].max,row.actual[1].min,row.actual[1].max],['50','180','50','220']);
  assert.equal((await state(field)).variant,null);await capture(n+'-photo-size',photoWidth);
  held=true;await nav('诊断优化');await click('AI 润色 Diff');await click('去配置',group);
  await until('profile read held',()=>readQueue.length>0);
  await until('actual inputs locked',()=>js((g,p,b)=>document.querySelector(g)?.getAttribute('aria-busy')==='true'&&!!document.querySelector(p)?.disabled&&!!document.querySelector(b)?.disabled,group,secret,budget));
  row.locked=[await readField(secret,'password',v),await readField(budget,'number',n),await readField(tokens,'number',n),await readField(timeout,'number',n)];
  assert(row.locked.every(x=>x.disabled));
  await hit(await point(secret));assert(await js(s=>document.activeElement!==document.querySelector(s),secret));
  await capture(v+'-profile-locked',secret);held=false;release();
  await until('profile ready',()=>js((g,p,b)=>document.querySelector(g)?.getAttribute('aria-busy')==='false'&&!document.querySelector(p)?.disabled&&document.querySelector(b)?.value==='60000',group,secret,budget));
  row.actual.push(await readField(secret,'password',v),await readField(budget,'number',n),await readField(tokens,'number',n),await readField(timeout,'number',n));
  assert.deepEqual(row.actual.slice(-3).map(x=>[x.min,x.max]),[['1000','100000'],['64','8192'],['1','120']]);
  assert(await passwordMatches(secret,''));
  await hit(await point(secret));win.webContents.insertText('synthetic-appearance-check');await until('actual masked edit',()=>passwordMatches(secret,'synthetic-appearance-check'));
  await press('Tab');await until('native focus next',()=>js(()=>document.activeElement?.getAttribute('aria-label')==='模型名'&&document.activeElement.matches(':focus-visible')));
  await hit(await point(timeout));await press('Up');await until('timeout native increment',async()=>(await state(timeout)).value==='26');await press('Down');assert.equal((await state(timeout)).value,'25');
  assert(await masked(secret));await capture(v+'-profile-edit',secret);await capture(n+'-profile-number',timeout);
  assert.equal(settingsHash(),initialSettings,'unsaved profile changed on disk');assert.equal(report.profileWrites,0);
  // Navigate away without any approval or save; profile drafts are not persisted.
  await nav('内容编辑');
  assert.equal(sha(await paper()),baseline,'paper layout or style changed');assert.equal(await source(),before,'appearance wrote source');
  assert(await js(()=>!document.querySelector('.a4-sheet [data-studio-skin],[data-studio-paper] [data-studio-skin]')));
  row.checks.profileLock=true;row.checks.unsavedIsolation=true;report.rows.push(row);write();
 }
 assert.equal(signatures.password.size,6);assert.equal(signatures.number.size,6);
 await until('compact native size',async()=>{win.setContentSize(1100,760);await sleep(250);return JSON.stringify(win.getContentSize())==='[1100,760]'},10000);
 await nav('诊断优化');await click('AI 润色 Diff');await click('去配置',group);await until('compact ready',()=>js(s=>!!document.querySelector(s)&&!document.querySelector(s).disabled,secret));
 report.compact={size:win.getContentSize(),fields:[await readField(secret,'password','gradient'),await readField(timeout,'number','inset')]};
 await capture('compact-profile',secret);
 await nav('内容编辑');await open();await select(sample('密钥输入皮肤'),'inherit');await click('应用组件外观',dialog);await close();
 assert.deepEqual(JSON.parse(await prefs()),{schemaVersion:3,skins:{button:'inherit',icon:'inherit',number:'inset'}});
 await nav('诊断优化');await click('AI 润色 Diff');await click('去配置',group);await until('reset profile ready',()=>js(s=>!!document.querySelector(s)&&!document.querySelector(s).disabled,secret));
 assert.equal((await state(secret)).variant,null);assert.equal((await state(timeout)).variant,'inset');
 await nav('内容编辑');await open();await select(sample('数字输入皮肤'),'inherit');await click('应用组件外观',dialog);await close();
 assert.deepEqual(JSON.parse(await prefs()),{schemaVersion:1,skins:{button:'inherit',icon:'inherit'}});
 assert.equal((await state(photoWidth)).variant,null);assert.equal(settingsHash(),initialSettings);assert.equal(report.profileWrites,0);
 assert.equal(await source(),before);assert.equal(report.external,0);
 report.checks={sixDistinctEach:true,nativeStepAndMask:true,profileTransactionLock:true,independentRestore:true,legacyDowngrade:true,documentIsolation:true,unsavedProfileIsolation:true,compactNative:true,noExternalNetwork:true,noPasswordValuesInReport:true};report.complete=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e.message||e);write();console.error(report.error);app.exit(1)});
