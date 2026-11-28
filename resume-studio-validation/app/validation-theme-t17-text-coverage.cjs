// Public synthetic text-skin coverage. Real native interaction and captures, no private data.
const {app,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,theme=process.env.T17_THEME;
const variants=['inset','outline','soft','underline','raised','gradient'];
assert(root&&out&&path.basename(root).startsWith('synthetic-t17-text-')&&['classic','light','dark','highContrast'].includes(theme));assert(!fs.existsSync(root));fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={sourceSha:process.env.T17_EXPECTED_SHA,platform:process.platform,theme,rows:[],screenshots:[],checks:{},external:0};const write=()=>fs.writeFileSync(path.join(out,'text-coverage.json'),JSON.stringify(report,null,2));
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
const state=s=>js(s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,type:e.type,variant:e.dataset.studioSkin||null,family:e.dataset.studioSkinFamily||null,value:e.value,disabled:e.disabled,readOnly:e.readOnly,focus:e.matches(':focus-visible'),radius:c.borderRadius,border:c.borderColor,shadow:c.boxShadow,bg:c.backgroundColor,fg:c.color,image:c.backgroundImage,outline:c.outline,cursor:c.cursor,width:r.width,height:r.height,protected:!!e.closest('.a4-sheet,[data-studio-paper]'),scope:e.closest('[data-studio-surface][data-studio-theme]')?.dataset.studioTheme||null}},s);
const lum=s=>{const a=s.match(/[\d.]+/g)?.map(Number);assert(a&&a.length>=3);return a.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((t,x,i)=>t+x*[.2126,.7152,.0722][i],0)};
function check(x,f,v){assert(x&&!x.protected&&x.scope===theme&&x.variant===v&&x.family===f&&x.width>0&&x.height>0);assert.equal(x.tag,f==='text'?'INPUT':'TEXTAREA');if(x.disabled)assert.equal(x.cursor,'not-allowed');else {x.contrast=(Math.max(lum(x.fg),lum(x.bg))+.05)/(Math.min(lum(x.fg),lum(x.bg))+.05);assert(x.contrast>=4.5,JSON.stringify(x))}return x}
const signature=x=>JSON.stringify([x.radius,x.border,x.shadow,x.bg,x.image]);
const paper=()=>js(()=>{const e=document.querySelector('.a4-sheet');if(!e)throw Error('paper missing');const b=e.getBoundingClientRect(),r=n=>Math.round(n*1000)/1000;return JSON.stringify([e.innerText,...[e,...e.querySelectorAll('*')].map(x=>{const s=getComputedStyle(x),p=x.getBoundingClientRect();return [x.tagName,x.className?.baseVal??x.className,r(p.x-b.x),r(p.y-b.y),r(p.width),r(p.height),s.color,s.backgroundColor,s.fontFamily,s.fontSize,s.lineHeight,s.border,s.transform]})])});
const source=async()=>JSON.stringify({doc:await main.store.getResume('runner-fixture'),master:await main.store.getResume('master'),ledger:await main.store.getApplications(),snapshots:await main.store.listSnapshots('runner-fixture')});

const nav=label=>click(label,'nav[aria-label="主导航"]');
const queueCompany='[aria-label="队列单位"]',queueRole='[aria-label="队列岗位"]',queueJD='[aria-label="队列岗位原文"]';
const profile='[aria-label="AI 模型中心"]',redaction='[aria-label="脱敏敏感词设置"]',importRegion='[data-studio-region="resume-import-dialog"]';
async function readField(selector,family,variant){
 await until('field '+selector,async()=>{const x=await state(selector);return x&&x.width>0&&x.height>0&&x.variant===variant});
 return check(await state(selector),family,variant);
}
async function choose(text,multiline){
 await open();await select(sample('单行文本皮肤'),text);await select(sample('多行文本皮肤'),multiline);await click('应用组件外观',dialog);await close();
 assert.deepEqual(JSON.parse(await prefs()),{schemaVersion:2,skins:{button:'inherit',icon:'inherit',text,multiline}});
}
async function run(){
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{report.external++;write();cb({cancel:true})});
 global.fetch=async()=>{report.external++;write();throw Error('unexpected external request')};
 assert(process.env.T17_EXPECTED_SHA&&/^[a-f0-9]{40}$/.test(process.env.T17_EXPECTED_SHA));
 await main.store.saveResume('master',{...fixture,id:'synthetic-t17-master',title:'合成母库'});await main.store.saveResume('runner-fixture',fixture);
 await main.registerAssetProtocol();main.registerIpcHandlers();win=await main.createMainWindow();win.show();win.focus();
 await until('ready',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'&&document.querySelector('.studio-shell')?.getAttribute('aria-busy')==='false'));
 await until('stable native size',async()=>{if(win.isMaximized())win.unmaximize();win.setContentSize(1440,900);await sleep(300);return !win.isMaximized()&&JSON.stringify(win.getContentSize())==='[1440,900]'},10000);
 await select('select[aria-label="切换工作台主题"]',theme);await until('theme ready',async()=>(await state(field))?.scope===theme);
 await js(()=>document.fonts.ready.then(()=>true));await sleep(500);
 const before=await source(),baseline=sha(await paper());assert.equal(await prefs(),null);
 for(const [index,v] of variants.entries()){
  const m=variants[(index+1)%variants.length],row={text:v,multiline:m,fields:[],checks:{}};
  await choose(v,m);row.fields.push(await readField(field,'text',v));
  const cmd='[aria-label="搜索命令、模板与版本"]',search='[aria-label="搜索模板"]';
  await hit(await point('button[aria-label="打开命令面板"]'));
  row.fields.push(await readField(cmd,'text',v));
  await hit(await point(cmd));win.webContents.insertText('zzqsyntheticnomatch');
  await until('command typed',()=>js(s=>document.querySelector(s)?.value==='zzqsyntheticnomatch',cmd));
  await until('command filters',()=>js(()=>!document.querySelector('[aria-label="匹配命令列表"] [role="option"]')));
  await capture(v+'-command-search',cmd);await press('Escape');await until('command closes',()=>js(s=>!document.querySelector(s),cmd));
  const gallery=await js(()=>{const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(e=>e.innerText.trim().startsWith('模板库'));return b?.innerText.trim()});
  assert(gallery);await nav(gallery);row.fields.push(await readField(search,'text',v));
  await hit(await point(search));win.webContents.insertText('zzqsyntheticnomatch');
  await until('gallery filters',()=>js(s=>document.querySelector(s)?.value==='zzqsyntheticnomatch'&&document.body.innerText.includes('未找到匹配'),search));
  await capture(v+'-gallery-search',search);
  await nav('内容编辑');row.checks.nativeSearch=true;
  await nav('版本母库');await click('重命名');const rename='[aria-label="版本标题"]';
  row.fields.push(await readField(rename,'text',v));await capture(v+'-version-rename',rename);await press('Escape');
  await until('rename canceled',()=>js(s=>!document.querySelector(s),rename));
  row.fields.push(await readField('input[placeholder="输入新岗位名称，如：物理教研员"]','text',v));
  // Inject an entirely synthetic TXT file through the actual import input; not an OS picker test.
  const importInput='input[accept=".txt,.md,.markdown,text/plain,text/markdown"]';
  assert(await js(selector=>{const e=document.querySelector(selector);if(!e)return false;const f=new File(['姓名：合成候选人\n求职意向：合成岗位\n教育经历\n合成大学\n专业技能\n合成技能'], 'synthetic-t17.txt',{type:'text/plain'});const dt=new DataTransfer();dt.items.add(f);e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));return true},importInput));
  await until('actual import review',()=>js(s=>!!document.querySelector(s),importRegion),20000);
  const imported=await js(s=>{const e=document.querySelector(s);return {text:e.querySelectorAll('input[data-studio-skin-family="text"]').length,multi:e.querySelectorAll('textarea[data-studio-skin-family="multiline"]').length,date:[...e.querySelectorAll('input')].find(x=>x.closest('label')?.innerText.includes('出生日期'))?.getAttribute('data-studio-skin')??null,forbidden:e.querySelectorAll('input:is([type=radio],[type=checkbox],[type=file],[type=password],[type=number])[data-studio-skin]').length}},importRegion);
  assert.equal(imported.text,7);assert(imported.multi>=6);assert.equal(imported.date,null);assert.equal(imported.forbidden,0);
  row.fields.push(await readField(importRegion+' input[data-studio-skin-family="text"]','text',v),await readField(importRegion+' textarea','multiline',m));
  await capture(v+'-import-review',importRegion+' input[data-studio-skin-family="text"]');await click('取消',importRegion);await until('import canceled',()=>js(s=>!document.querySelector(s),importRegion));row.checks.importCanceled=true;
  await nav('求职面试');const tracker='input[placeholder="单位/学校名称（必填）"]';
  row.fields.push(await readField(tracker,'text',v));await capture(v+'-tracker',tracker);
  await hit(await point('button[aria-label="岗位队列"]'));
  row.fields.push(await readField(queueCompany,'text',v),await readField(queueRole,'text',v),await readField(queueJD,'multiline',m));
  await until('queue ready',()=>js(s=>!document.querySelector(s)?.matches(':disabled'),queueCompany));
  await hit(await point(queueCompany));win.webContents.insertText('合成单位');
  await until('queue company input',()=>js(s=>document.querySelector(s)?.value==='合成单位',queueCompany));
  await press('Tab');await until('queue native tab',()=>js(s=>document.activeElement===document.querySelector(s)&&document.activeElement.matches(':focus-visible'),queueRole));
  await hit(await point(queueJD));win.webContents.insertText('合成岗位原文');
  await until('queue multiline input',()=>js(s=>document.querySelector(s)?.value==='合成岗位原文',queueJD));row.checks.nativeQueueText=true;
  await capture(v+'-queue',queueJD);assert.equal(await source(),before,'unconfirmed queue form wrote source');
  await nav('诊断优化');await click('JD 雷达');const jd='[data-studio-region="diagnose-jd"] textarea';
  row.fields.push(await readField(jd,'multiline',m));await capture(v+'-jd',jd);
  await click('AI 润色 Diff');await click('去配置',profile);
  await until('model loaded',()=>js(s=>!!document.querySelector(s+' [aria-label="模型名"]')&&!document.querySelector(s+' [aria-label="模型名"]').matches(':disabled'),profile));
  const profileName=profile+' [aria-label="模型档案名称"]',model=profile+' [aria-label="模型名"]',url=profile+' input[placeholder="OpenAI 兼容 Base URL"]';
  row.fields.push(await readField(profileName,'text',v),await readField(model,'text',v),await readField(url,'text',v));
  assert(await js(s=>{const e=document.querySelector(s),key=e.querySelector('input[type=password]'),numbers=e.querySelectorAll('input[type=number]');return !!key&&!key.hasAttribute('data-studio-skin')&&[...numbers].every(n=>!n.hasAttribute('data-studio-skin'))},profile));
  row.checks.secretAndNumericExcluded=true;await capture(v+'-profile',model);
  await nav('内容编辑');await hit(await point('button[aria-label="设置自定义脱敏敏感词"]'));row.fields.push(await readField(redaction+' textarea','multiline',m));await capture(v+'-redaction',redaction+' textarea');await click('完成',redaction);
  assert(await js(()=>!document.querySelector('.a4-sheet [data-studio-skin],[data-studio-paper] [data-studio-skin]')));
  assert.equal(sha(await paper()),baseline,'paper layout or style changed');assert.equal(await source(),before,'theme or unconfirmed UI wrote source');
  row.checks.sourceAndPaperUnchanged=true;report.rows.push(row);write();
 }
 // Actual minimum-size desktop window (app enforces a 1080x720 outer minimum).
 await until('compact native size',async()=>{win.setContentSize(1100,760);await sleep(250);return JSON.stringify(win.getContentSize())==='[1100,760]'},10000);
 await nav('求职面试');await hit(await point('button[aria-label="岗位队列"]'));
 report.compact={size:win.getContentSize(),fields:[await readField(queueCompany,'text','gradient'),await readField(queueJD,'multiline','inset')]};
 await capture('compact-queue',queueJD);
 await nav('内容编辑');await open();await select(sample('单行文本皮肤'),'inherit');await click('应用组件外观',dialog);await close();
 assert.equal((await state(field)).variant,null);
 await nav('求职面试');await hit(await point('button[aria-label="岗位队列"]'));
 assert.equal((await state(queueCompany)).variant,null);assert.equal((await state(queueJD)).variant,'inset');
 assert.equal(await source(),before);assert.equal(report.external,0);
 report.checks={distinctPairings:true,nativeSearch:true,independentRestore:true,nativeQueueText:true,documentIsolation:true,secretExcluded:true,importCancel:true,compactNative:true,noExternalNetwork:true};report.complete=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e.message||e);write();console.error(report.error);app.exit(1)});
