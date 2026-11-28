// Independent public native profile-transaction lock gate. Public synthetic data only.
const {app,ipcMain,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,pair=Number(process.env.T16_PAIR),palette=process.env.T16_PALETTE;
assert(root&&out&&path.basename(root).startsWith('synthetic-profile-lock-')&&[0,1,2,3,4,5].includes(pair)&&['classic','light','dark','highContrast'].includes(palette));
assert(!fs.existsSync(root));fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),install=require('./validation-theme-t16-probe.cjs');
const report={sourceSha:process.env.GITHUB_SHA,platform:process.platform,pair,palette,calls:0,rendererExternal:0,reads:0,saves:0,checks:{},screenshots:[]};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const write=()=>fs.writeFileSync(path.join(out,'profile-lock.json'),JSON.stringify(report,null,2));
const watchdog=setTimeout(()=>{report.error='global watchdog';write();app.exit(2)},180000);
global.fetch=async()=>{report.calls++;write();throw Error('unexpected transport')};
let win,t16,holdRead=false,holdSave=false,reads=[],saves=[];
function hold(queue){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('IPC gate watchdog')),35000);queue.push(()=>{clearTimeout(t);resolve()})})}
const release=queue=>{for(const done of queue.splice(0))done()};
const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
async function until(label,fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(80)}throw Error('timeout '+label)}
const point=selector=>js(s=>{const e=document.querySelector(s);if(!e)return null;e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return e.contains(document.elementFromPoint(x,y))?{x,y}:null},selector);
async function hit(p){assert(p,'native hit test');win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});await sleep(45);win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p})}
async function click(label){await until('enabled '+label,()=>js(l=>[...document.querySelectorAll('button')].some(e=>e.innerText.trim()===l&&!e.disabled&&e.getClientRects().length),label));await t16.probe(label);await hit(await js(l=>{const e=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===l&&!e.disabled&&e.getClientRects().length);e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return e.contains(document.elementFromPoint(x,y))?{x,y}:null},label))}
const group='[role="group"][aria-label="AI 模型中心"]',model='input[aria-label="模型名"]',busy=()=>js(s=>document.querySelector(s)?.getAttribute('aria-busy')==='true',group);
const state=()=>js((g,m)=>{const e=document.querySelector(g);return {busy:e?.getAttribute('aria-busy'),status:!![...e.querySelectorAll('[role=status]')].find(n=>n.innerText.includes('正在读取或保存')),model:document.querySelector(m)?.value,controls:[...e.querySelectorAll('input,select,button')].filter(n=>n.innerText?.trim()!=='收起设置').map(n=>({tag:n.tagName,label:n.getAttribute('aria-label')||n.innerText||n.placeholder||n.type,disabled:n.disabled}))}},group,model);
async function locked(label){const s=await state();assert.equal(s.busy,'true');assert(s.status);assert(s.controls.length>=10);assert(s.controls.every(x=>x.disabled),'editable control during transaction '+JSON.stringify(s.controls));await hit(await point(model));await sleep(100);assert(await js(m=>document.activeElement!==document.querySelector(m),model),'disabled model accepted focus');assert.equal((await state()).model,s.model);report.checks[label]=s;write()}
async function unlocked(label){await until(label,async()=>{const s=await state();return s.busy==='false'&&!s.status&&s.controls.some(x=>x.label==='模型名'&&!x.disabled)});report.checks[label]=await state();write()}
async function capture(name,selector){if(selector)await js(s=>document.querySelector(s)?.scrollIntoView({block:'center',behavior:'instant'}),selector);await js(()=>document.fonts.ready.then(()=>true));await sleep(200);await t16.scan(name);const img=await win.webContents.capturePage();assert(!img.isEmpty());const b=img.toPNG();assert(b.length>10000);const filename=name+'.png';fs.writeFileSync(path.join(out,filename),b);report.screenshots.push({filename,sha256:sha(b),width:img.getSize().width,height:img.getSize().height});write()}
const documentState=async()=>JSON.stringify({doc:await main.store.getResume('runner-fixture'),master:await main.store.getResume('master'),ledger:await main.store.getApplications(),snapshots:await main.store.listSnapshots('runner-fixture')});
async function run(){
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{report.rendererExternal++;write();cb({cancel:true})});
 fs.mkdirSync(main.dataDir,{recursive:true});const settings=path.join(main.dataDir,'.ai-settings.json');
 const initial={profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:true,providerLabel:'Synthetic profile transaction',baseUrl:'http://127.0.0.1:43219/v1',model:'synthetic-lock-initial',contextBudgetChars:60000,maxOutputTokens:4096,timeoutMs:25000};
 fs.writeFileSync(settings,JSON.stringify({schemaVersion:2,activeProfileId:initial.profileId,profiles:[initial]}),{flag:'wx'});
 await main.store.saveResume('master',{...fixture,id:'synthetic-lock-master',title:'合成母库'});await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-lock-doc',title:'合成事务验收'});
 const before=await documentState(),initialHash=sha(fs.readFileSync(settings));
 await main.registerAssetProtocol();
 // Delay delivery, not trust checks or persistence. Preserve the real handler.
 const register=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(channel,handler)=>register(channel,async(...args)=>{if(channel==='ai:listProfiles'){report.reads++;if(holdRead)await hold(reads)}if(channel==='ai:saveSettings'){report.saves++;if(holdSave)await hold(saves)}return handler(...args)});
 main.registerIpcHandlers();ipcMain.handle=register;
 win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);win.show();win.focus();t16=await install(win,out,'profile-lock');
 await until('editor ready',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'));
 assert(await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');if(!e)return false;e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true},palette));
 holdRead=true;await click('诊断优化');await click('AI 润色 Diff');await click('去配置');await until('initial read pending',()=>reads.length>0);
 await locked('initialReadLocked');await capture('01-reading-status',group+' [role=status]');await capture('02-reading-fields',model);
 holdRead=false;release(reads);await unlocked('initialReadReleased');assert.equal((await state()).model,initial.model);assert.equal(sha(fs.readFileSync(settings)),initialHash);await capture('03-ready',model);
 await hit(await point(model));await until('model focused',()=>js(s=>document.activeElement===document.querySelector(s),model));
 await js(s=>document.querySelector(s).select(),model);win.webContents.insertText('synthetic-lock-edited');await until('model updated',()=>js(s=>document.querySelector(s)?.value==='synthetic-lock-edited',model));
 holdSave=true;holdRead=true;await click('保存本地配置');await until('save pending',()=>saves.length>0);await locked('writeLocked');assert.equal(sha(fs.readFileSync(settings)),initialHash);await capture('04-saving',model);
 holdSave=false;release(saves);await until('catalog read pending',()=>reads.length>0);await locked('catalogLocked');const saved=JSON.parse(fs.readFileSync(settings,'utf8')).profiles[0];assert.equal(saved.model,'synthetic-lock-edited');assert.notEqual(saved.revision,initial.revision);await capture('05-catalog-refresh',group+' [role=status]');
 holdRead=false;release(reads);await unlocked('writeReleased');await until('saved message',()=>js(()=>document.body.innerText.includes('配置已保存；密钥由系统加密保护。')));await capture('06-saved',model);
 await hit(await point(model));await until('editor unlocked focus',()=>js(s=>document.activeElement===document.querySelector(s),model));await js(s=>document.querySelector(s).select(),model);win.webContents.insertText('synthetic-lock-unsaved');await until('editable again',()=>js(s=>document.querySelector(s)?.value==='synthetic-lock-unsaved',model));
 await click('测试模型连接');await until('unsaved rejected',()=>js(()=>document.body.innerText.includes('配置已编辑，请先保存或重新读取。')));
 assert.equal(JSON.parse(fs.readFileSync(settings,'utf8')).profiles[0].model,'synthetic-lock-edited');assert.equal(report.saves,1);assert.equal(report.calls,0);assert.equal(report.rendererExternal,0);assert.equal(await documentState(),before);
 report.checks.isolation=true;report.checks.unsavedRejected=true;await t16.finish();report.complete=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e.message||e);write();console.error(report.error);app.exit(1)});
