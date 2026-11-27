const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,key=process.env.RESUME_STUDIO_LIVE_KEY||'';
delete process.env.RESUME_STUDIO_LIVE_KEY;
if(!root||!out||!path.basename(root).startsWith('synthetic-t47-live-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
const report={runnerSha:process.env.GITHUB_SHA,credentialAvailable:!!key,attempts:0,requestedOutputTokens:0,checks:{},status:'not-run'};
const write=()=>{const text=JSON.stringify(report,null,2);if(key&&text.includes(key))throw Error('secret in evidence');fs.writeFileSync(path.join(out,'live-probe.json'),text)};
if(!key){report.status='blocked-no-test-credential';write();process.exit(0)}
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const timer=setTimeout(()=>{report.status='watchdog';write();app.exit(2)},80000);
const endpoint='https://api.deepseek.com/v1/chat/completions',model='deepseek-flash';
const msgs=[{role:'system',content:'Connectivity probe. Reply only OK.'},{role:'user',content:JSON.stringify({task:'connection-probe',message:'synthetic data only'})}];
const actual=global.fetch.bind(global);
global.fetch=async(url,init)=>{
  const b=JSON.parse(String(init?.body??'{}'));
  assert(report.attempts===0&&String(url)===endpoint&&init.method==='POST'&&init.redirect==='error'&&new Headers(init.headers).get('authorization')==='Bearer '+key,'outbound policy rejected');
  assert(b.model===model&&b.max_tokens===64&&b.thinking?.type==='disabled'&&JSON.stringify(b.messages)===JSON.stringify(msgs),'outbound scope or budget mismatch');
  report.attempts++;report.requestedOutputTokens=b.max_tokens;report.checks.exactSyntheticPayload=true;
  const response=await actual(url,init);report.httpStatus=response.status;return response;
};
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return;}catch{}await sleep(100)}throw Error('timeout '+label)}
async function run(){
  await main.store.saveResume('master',{...fixture,id:'synthetic-live-probe-master',title:'合成测试母库'});
  await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-live-probe-doc',title:'合成测试简历'});
  const source=main.store.resolveResumePath('runner-fixture').filePath,original=fs.readFileSync(source);
  assert(safeStorage.isEncryptionAvailable(),'system encryption unavailable');
  const profile={profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:true,providerLabel:'Synthetic live probe',baseUrl:'https://api.deepseek.com/v1',model,contextBudgetChars:1000,maxOutputTokens:64,timeoutMs:25000,deepseekThinking:'disabled',encryptedApiKey:safeStorage.encryptString(key).toString('base64')};
  const config=path.join(main.dataDir,'.ai-settings.json');
  fs.writeFileSync(config,JSON.stringify({schemaVersion:2,activeProfileId:profile.profileId,profiles:[profile]}),{flag:'wx'});
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(v=>JSON.stringify(v)).join(',')+')');
  const has=t=>js(t=>document.body.innerText.includes(t),t);
  const click=async label=>{await until('button '+label,()=>js(label=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()===label&&!b.disabled),label));assert(await js(label=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===label&&!b.disabled);if(!b)return false;b.scrollIntoView({block:'center'});b.click();return true},label),'missing button '+label)};
  await until('editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
  await click('诊断优化');await click('AI 润色 Diff');await click('已启用 · 修改');
  const publicSettings=await js(()=>window.resumeDesktop.ai.getSettings());
  assert(publicSettings.apiKey===''&&publicSettings.hasApiKey&&!JSON.stringify(publicSettings).includes(key),'public credential exposed');
  report.checks.maskedCredential=true;
  await click('测试模型连接');await until('actual request started',()=>report.attempts===1,5000);
  const sel='[aria-label="连接测试调用回执"]';
  await until('receipt',()=>js(sel=>!!document.querySelector(sel)?.dataset.attemptState,sel),32000);
  const receipt=await js(sel=>({state:document.querySelector(sel)?.dataset.attemptState,text:document.querySelector(sel)?.innerText}),sel);
  assert(!receipt.text.includes(key)&&report.attempts===1&&fs.readFileSync(source).equals(original),'unsafe receipt, retry or source mutation');
  report.checks.oneRequestNoSourceWrite=true;
  report.status=receipt.state==='received'&&await has('连接成功 · 合成探针返回 OK')?'connected':'provider-or-network-not-confirmed';
  report.attemptState=receipt.state;
  report.receipt=receipt.text;
  await js(sel=>document.querySelector(sel)?.scrollIntoView({block:'center'}),sel);
  await sleep(250);const png=await win.webContents.capturePage();assert(!png.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,'live-probe.png'),png.toPNG());
  write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.status='fixture-or-gateway-failed';report.error=String(e?.message??e).split(key).join('[redacted]').slice(0,300);write();app.exit(1)});
