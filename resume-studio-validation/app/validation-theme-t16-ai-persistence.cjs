// Public T16 common settings persistence gate. Synthetic local fixture only.
// Does not include private quick-setup implementation or real credentials.
const {app,safeStorage,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,phase=process.env.QUEUE_PHASE,pair=Number(process.env.T16_PAIR);
assert(root&&out&&path.basename(root).startsWith('synthetic-ai-persistence-')&&['seed','reopen'].includes(phase)&&[0,1,2,3,4,5].includes(pair));
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),install=require('./validation-theme-t16-probe.cjs');
const palette=pair%2?'highContrast':'classic',variants=['solid','outline','soft','flat','raised','gradient'],key='synthetic-only-public-persistence',baseUrl='http://127.0.0.1:43219/v1',model='synthetic-persistence-model';
const report={sourceSha:process.env.GITHUB_SHA,platform:process.platform,phase,pair,palette,variant:variants[pair],calls:0,unexpected:0,rendererExternal:0,checks:{},screenshots:[]};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const write=()=>{const s=JSON.stringify(report,null,2);assert(!s.includes(key),'synthetic credential in report');fs.writeFileSync(path.join(out,'ai-persistence-'+phase+'.json'),s)};
const watchdog=setTimeout(()=>{report.error='global watchdog exceeded';write();app.exit(2)},200000);
let win,t16,active=false,auth=true;
global.fetch=async(url,init)=>{
 try{
  assert(active);assert.equal(String(url),baseUrl+'/chat/completions');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
  assert.equal(new Headers(init.headers).get('authorization'),auth?'Bearer '+key:null);
  const body=JSON.parse(String(init.body));assert.equal(body.model,model);assert.equal(body.max_tokens,64);assert.equal(body.temperature,0);
  assert.deepEqual(body.messages,[{role:'system',content:'Connectivity probe. Reply only OK.'},{role:'user',content:JSON.stringify({task:'connection-probe',message:'synthetic data only'})}]);
 }catch(e){report.unexpected++;write();throw Error('unexpected synthetic request shape')}
 report.calls++;write();
 return new Response(JSON.stringify({model,usage:{prompt_tokens:12,completion_tokens:2,total_tokens:14},choices:[{finish_reason:'stop',message:{content:'OK'}}]}),{status:200});
};
async function until(label,fn,ms=16000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(80)}throw Error('timeout '+label)}
const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
const visible=label=>js(l=>[...document.querySelectorAll('button')].some(e=>e.innerText.trim()===l&&!e.disabled&&e.getClientRects().length),label);
const hit=async p=>{
 assert(p,'native hit test failed');win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});await sleep(45);win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});
};
const click=async label=>{
 await until('enabled '+label,()=>visible(label));await t16.probe(label);
 await hit(await js(l=>{const e=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===l&&!e.disabled&&e.getClientRects().length);if(!e)return null;e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return e.contains(document.elementFromPoint(x,y))?{x,y}:null},label));
};
const checkbox=async label=>{
 await until('checkbox '+label,()=>js(l=>[...document.querySelectorAll('label')].some(e=>e.innerText.trim()===l&&e.querySelector('input[type=checkbox]')),label));
 await hit(await js(l=>{const e=[...document.querySelectorAll('label')].find(e=>e.innerText.trim()===l)?.querySelector('input[type=checkbox]');if(!e||e.disabled)return null;e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return document.elementFromPoint(x,y)===e?{x,y}:null},label));
};
const inputKey=async()=>{
 const selector='input[placeholder="API Key（Ollama 可留空）"]';
 await until('password input',()=>js(s=>!!document.querySelector(s),selector));
 await hit(await js(s=>{const e=document.querySelector(s);if(!e||e.type!=='password')return null;e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return document.elementFromPoint(x,y)===e?{x,y}:null},selector));
 await until('focused password',()=>js(s=>document.activeElement===document.querySelector(s),selector));
 win.webContents.insertText(key);await until('input accepted',()=>js((s,k)=>document.querySelector(s)?.value===k,selector,key));
};
const info=label=>js(l=>{const e=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===l&&e.getClientRects().length);if(!e)return null;const s=getComputedStyle(e);return {disabled:e.disabled,role:e.dataset.studioSkinRole||null,variant:e.dataset.studioSkin||null,cursor:s.cursor,theme:e.closest('[data-studio-theme]')?.dataset.studioTheme||null}},label);
const capture=async(name,label)=>{
 if(label)await js(l=>{const e=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===l&&e.getClientRects().length);e?.scrollIntoView({block:'center',behavior:'instant'})},label);
 await js(()=>document.fonts.ready.then(()=>true));await sleep(250);await t16.scan(name);
 const img=await win.webContents.capturePage();assert(!img.isEmpty());const png=img.toPNG();assert(png.length>10000);const filename=phase+'-'+name+'.png';fs.writeFileSync(path.join(out,filename),png);report.screenshots.push({filename,sha256:sha(png),width:img.getSize().width,height:img.getSize().height});write();
};
const source=async()=>JSON.stringify({master:await main.store.getResume('master'),doc:await main.store.getResume('runner-fixture'),ledger:await main.store.getApplications(),snapshots:await main.store.listSnapshots('runner-fixture')});
const settingsFile=path.join(main.dataDir,'.ai-settings.json'),hashSettings=()=>sha(fs.readFileSync(settingsFile));
const getProfile=()=>{const raw=fs.readFileSync(settingsFile,'utf8');assert(!raw.includes(key));const c=JSON.parse(raw);assert.equal(c.profiles.length,1);assert.equal(c.activeProfileId,c.profiles[0].profileId);return c.profiles[0]};
const publicView=async(hasKey)=>{
 const data=await js(async()=>{const s=await window.resumeDesktop.ai.getSettings(),c=await window.resumeDesktop.ai.listProfiles();return {settings:s,catalog:c}});
 assert.equal(data.settings.apiKey,'');assert.equal(data.settings.hasApiKey,hasKey);assert(!JSON.stringify(data).includes(key));assert(!JSON.stringify(data).includes('encryptedApiKey'));assert.equal(data.catalog.profiles[0].apiKey,'');assert.equal(data.catalog.profiles[0].hasApiKey,hasKey);
};
const probe=async(expected,withKey)=>{
 auth=withKey;active=true;await click('测试模型连接');await until('one probe',()=>report.calls===expected);
 await until('received receipt',()=>js(()=>document.querySelector('[aria-label="连接测试调用回执"]')?.dataset.attemptState==='received'&&document.body.innerText.includes('连接成功 · 合成探针返回 OK')));
 active=false;assert.equal(report.calls,expected);
};
async function run(){
 assert(safeStorage.isEncryptionAvailable(),'OS encryption unavailable');
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>{report.rendererExternal++;write();cb({cancel:true})});
 fs.mkdirSync(main.dataDir,{recursive:true});
 let initial;
 if(phase==='seed'){
  initial={profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:false,providerLabel:'Synthetic persistence fixture',baseUrl,model,contextBudgetChars:60000,maxOutputTokens:4096,timeoutMs:25000};
  fs.writeFileSync(settingsFile,JSON.stringify({schemaVersion:2,activeProfileId:initial.profileId,profiles:[initial]}),{flag:'wx'});
  await main.store.saveResume('master',{...fixture,id:'synthetic-persistence-master',title:'合成母库'});await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-persistence-doc',title:'合成持久化验收'});
 }else{
  const saved=JSON.parse(fs.readFileSync(path.join(out,'seed-state.json'),'utf8'));
  initial=getProfile();assert.equal(hashSettings(),saved.settingsSha256);assert.equal(sha(await source()),saved.sourceSha256);assert.equal(initial.revision,saved.revision);
  assert.equal(safeStorage.decryptString(Buffer.from(initial.encryptedApiKey,'base64')),key);report.checks.coldRestartCiphertext=true;
 }
 const before=await source(),beforeHash=hashSettings();
 await main.registerAssetProtocol();main.registerIpcHandlers();win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);win.show();win.focus();
 t16=await install(win,out,'persistence');
 await until('editor ready',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'));
 assert(await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');if(!e)return false;e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true},palette));
 await click('诊断优化');await click('AI 润色 Diff');await click(phase==='seed'?'去配置':'已启用 · 修改');
 await until('profile loaded',()=>js(m=>document.querySelector('input[aria-label="模型名"]')?.value===m,model));
 await until('palette applied',async()=> (await info('保存本地配置'))?.theme===palette);
 const saveInfo=await info('保存本地配置');assert.equal(saveInfo.role,'primary');assert.equal(saveInfo.variant,variants[pair]);assert(!saveInfo.disabled);
 if(phase==='seed'){
  const b=await info('测试模型连接');assert(b.disabled&&b.cursor==='not-allowed');report.checks.disabledInitial=true;
  await capture('01-disabled','测试模型连接');
  await inputKey();await checkbox('启用 AI 原地润色接口');
  await until('enabled unsaved probe',()=>visible('测试模型连接'));
  await click('测试模型连接');
  await until('unsaved settings rejected',()=>js(()=>document.body.innerText.includes('请先保存或重新读取')));
  assert.equal(report.calls,0);assert.equal(hashSettings(),beforeHash);report.checks.unsavedRejected=true;
  await capture('02-unsaved-rejected','测试模型连接');
  await click('保存本地配置');
  await until('saved settings',()=>js(()=>document.body.innerText.includes('配置已保存；密钥由系统加密保护。')));
  await until('saved placeholder',()=>js(()=>document.querySelector('input[placeholder="已保存密钥，留空保留"]')?.value===''));
  await until('save complete',()=>visible('保存本地配置'));
  const saved=getProfile();assert(saved.enabled&&saved.encryptedApiKey&&saved.profileId===initial.profileId&&saved.revision!==initial.revision);assert.equal(safeStorage.decryptString(Buffer.from(saved.encryptedApiKey,'base64')),key);assert.equal(report.calls,0);
  await publicView(true);report.checks.encryptedAndSanitized=true;await capture('03-saved','保存本地配置');
  const savedHash=hashSettings();await probe(1,true);assert.equal(hashSettings(),savedHash);await capture('04-success','测试模型连接');
  fs.writeFileSync(path.join(out,'seed-state.json'),JSON.stringify({settingsSha256:savedHash,sourceSha256:sha(before),revision:saved.revision},null,2));
 }else{
  await publicView(true);await until('cold saved placeholder',()=>js(()=>document.querySelector('input[placeholder="已保存密钥，留空保留"]')?.value===''));
  assert.equal(hashSettings(),beforeHash);await capture('01-cold-reopen','保存本地配置');
  await probe(1,true);assert.equal(hashSettings(),beforeHash);await capture('02-saved-probe','测试模型连接');
  await checkbox('保存时清除已有密钥');await click('保存本地配置');
  await until('credential cleared',()=>{const p=getProfile();return p.enabled&&!p.encryptedApiKey&&p.revision!==initial.revision});
  await until('clear saved placeholder',()=>js(()=>document.querySelector('input[placeholder="API Key（Ollama 可留空）"]')?.value===''));
  await until('save complete',()=>visible('保存本地配置'));await publicView(false);report.checks.cleared=true;
  await capture('03-cleared','保存本地配置');const clearHash=hashSettings();await probe(2,false);assert.equal(hashSettings(),clearHash);report.checks.keylessProbe=true;await capture('04-keyless-probe','测试模型连接');
 }
 assert.equal(await source(),before,'configuration operation changed document or ledger');assert.equal(report.unexpected,0);assert.equal(report.rendererExternal,0);report.checks.sourceIsolation=true;report.checks.noExternalNetwork=true;await t16.finish();report.complete=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e.message||e);write();console.error(report.error);app.exit(1)});
