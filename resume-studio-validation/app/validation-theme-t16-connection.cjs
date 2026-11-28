// Public-only synthetic test of the common diagnosis connection controls.
// No private source, private workspace, credential, or live provider is used.
const {app,safeStorage,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
assert(root&&out&&path.basename(root).startsWith('synthetic-ai-connection-'),'isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),install=require('./validation-theme-t16-probe.cjs');
const key='synthetic-only-connection-fixture',baseUrl='http://127.0.0.1:43219/v1',model='synthetic-connection-model';
const pairs=['solid','outline','soft','flat','raised','gradient'];
const variant=pairs[Number(process.env.T16_PAIR)];assert(variant,'invalid pair');
const report={sourceSha:process.env.GITHUB_SHA,platform:process.platform,electron:process.versions.electron,variant,calls:0,aborted:0,unexpected:0,rendererExternal:0,checks:{},screenshots:[]};
let mode='success',t16,win,active=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const write=()=>{const data=JSON.stringify(report,null,2);assert(!data.includes(key),'credential in evidence');fs.writeFileSync(path.join(out,'connection-gate.json'),data)};
const watchdog=setTimeout(()=>{report.error='global watchdog exceeded';write();app.exit(2)},200000);
async function until(label,fn,ms=16000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
global.fetch=async(url,init)=>{
 try{
  assert(active,'request outside active test');
  assert.equal(String(url),baseUrl+'/chat/completions');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
  assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+key);
  const b=JSON.parse(String(init.body));
  assert.equal(b.model,model);assert.equal(b.max_tokens,64);assert.equal(b.temperature,0);
  assert.deepEqual(b.messages,[{role:'system',content:'Connectivity probe. Reply only OK.'},{role:'user',content:JSON.stringify({task:'connection-probe',message:'synthetic data only'})}]);
 }catch(e){report.unexpected++;write();throw new Error('unexpected synthetic transport shape')}
 report.calls++;write();
 if(mode==='cancel'){
  await new Promise((resolve,reject)=>{
   const signal=init.signal;
   const onAbort=()=>{clearTimeout(timer);report.aborted++;write();reject(new DOMException('aborted','AbortError'))};
   const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);reject(Error('cancel watchdog'))},12000);
   if(signal.aborted)onAbort();else signal.addEventListener('abort',onAbort,{once:true});
  });
 }
 return new Response(JSON.stringify({model,usage:{prompt_tokens:12,completion_tokens:2,total_tokens:14},choices:[{finish_reason:'stop',message:{content:'OK'}}]}),{status:200});
};
const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
const visible=label=>js(l=>[...document.querySelectorAll('button')].some(e=>e.innerText.trim()===l&&!e.disabled&&e.getClientRects().length),label);
const get=label=>js(l=>{const e=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===l&&e.getClientRects().length);if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect();return {disabled:e.disabled,type:e.type,variant:e.dataset.studioSkin||null,family:e.dataset.studioSkinFamily||null,role:e.dataset.studioSkinRole||null,cursor:s.cursor,rect:[r.width,r.height],scope:e.closest('[data-studio-surface][data-studio-theme]')?.dataset.studioSurface||null,protected:!!e.closest('.a4-sheet,[data-studio-paper]')}},label);
const inspect=async(label,disabled)=>{
 const r=await get(label);assert(r,'missing button '+label);assert.equal(r.disabled,disabled);assert.equal(r.type,'button');assert.equal(r.variant,variant);assert.equal(r.family,'button');assert.equal(r.role,'normal');assert(r.scope&&!r.protected);assert(r.rect.every(v=>v>0));if(disabled)assert.equal(r.cursor,'not-allowed');return r;
};
const click=async(label)=>{
 await until('enabled '+label,()=>visible(label));await t16.probe(label);
 const p=await js(l=>{
  const e=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===l&&!e.disabled&&e.getClientRects().length);
  if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();
  const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return e.contains(document.elementFromPoint(x,y))?{x,y}:null
 },label);
 assert(p,'native hit test failed '+label);
 win.webContents.sendInputEvent({type:'mouseMove',...p});
 win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});
 win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});
};
const receipt=state=>js(s=>document.querySelector('[aria-label="连接测试调用回执"]')?.dataset.attemptState===s,state);
const capture=async(name,label)=>{
 await js(l=>{const e=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===l&&e.getClientRects().length);e?.scrollIntoView({block:'center',behavior:'instant'})},label);
 await sleep(250);await t16.scan(name);const img=await win.webContents.capturePage();assert(!img.isEmpty());const png=img.toPNG();assert(png.length>10000,'unexpected tiny screenshot');const filename=name+'.png';fs.writeFileSync(path.join(out,filename),png);report.screenshots.push({filename,width:img.getSize().width,height:img.getSize().height,sha256:crypto.createHash('sha256').update(png).digest('hex')});write();
};
async function run(){
 assert(safeStorage.isEncryptionAvailable(),'OS encryption unavailable');
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{report.rendererExternal++;write();callback({cancel:true})});
 fs.mkdirSync(main.dataDir,{recursive:true});
 const profile={profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:true,providerLabel:'Synthetic connection fixture',baseUrl,model,contextBudgetChars:60000,maxOutputTokens:4096,timeoutMs:25000,encryptedApiKey:safeStorage.encryptString(key).toString('base64')};
 const settingsFile=path.join(main.dataDir,'.ai-settings.json');fs.writeFileSync(settingsFile,JSON.stringify({schemaVersion:2,activeProfileId:profile.profileId,profiles:[profile]}),{flag:'wx'});
 await main.store.saveResume('master',{...fixture,id:'synthetic-connection-master',title:'合成母库'});
 await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-connection-doc',title:'合成连接验收'});
 await main.registerAssetProtocol();main.registerIpcHandlers();
 win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);win.show();win.focus();
 t16=await install(win,out,'connection');
 await until('editor ready',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'));
 const disk=async()=>JSON.stringify({doc:await main.store.getResume('runner-fixture'),master:await main.store.getResume('master'),ledger:await main.store.getApplications(),snapshots:await main.store.listSnapshots('runner-fixture'),settings:crypto.createHash('sha256').update(fs.readFileSync(settingsFile)).digest('hex')});
 const before=await disk();
 await click('诊断优化');await until('AI tab',()=>visible('AI 润色 Diff'));await click('AI 润色 Diff');
 await until('AI settings configured',()=>visible('已启用 · 修改'));await click('已启用 · 修改');
 await until('common connection control',()=>visible('测试模型连接'));
 report.checks.ready=await inspect('测试模型连接',false);await capture('01-ready','测试模型连接');
 active=true;mode='success';await click('测试模型连接');await until('one success request',()=>report.calls===1);await until('success receipt',()=>receipt('received'));
 assert(await js(()=>document.body.innerText.includes('连接成功 · 合成探针返回 OK')));assert.equal(report.calls,1);active=false;
 await capture('02-success','测试模型连接');report.checks.success=true;
 active=true;mode='cancel';await click('测试模型连接');await until('second request',()=>report.calls===2);await until('cancel visible',()=>visible('取消连接测试'));
 report.checks.busy=await inspect('测试模型连接',true);report.checks.cancel=await inspect('取消连接测试',false);
 await capture('03-busy','取消连接测试');await click('取消连接测试');
 await until('abort reached transport',()=>report.aborted===1);await until('cancelled receipt',()=>receipt('cancelled'));active=false;
 assert.equal(report.calls,2);assert.equal(report.unexpected,0);assert.equal(report.rendererExternal,0);
 await until('probe enabled again',()=>visible('测试模型连接'));await capture('04-cancelled','测试模型连接');
 assert.equal(await disk(),before,'read-only probe modified persisted data');report.checks.diskUnchanged=true;report.checks.noExternalNetwork=true;
 await t16.finish();report.complete=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e.message||e);write();console.error(report.error);app.exit(1)});
