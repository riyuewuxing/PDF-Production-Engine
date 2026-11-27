const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
const key=process.env.RESUME_STUDIO_LIVE_KEY||'';delete process.env.RESUME_STUDIO_LIVE_KEY;
if(!root||!out||!path.basename(root).startsWith('synthetic-live-ai-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
const report={runnerSha:process.env.GITHUB_SHA,phase:'baseline',credentialAvailable:!!key,observations:[],checks:{}};
function write(){const s=JSON.stringify(report,null,2);if(key&&s.includes(key))throw Error('credential in report');fs.writeFileSync(path.join(out,'live-ai-baseline.json'),s);}
if(!key){report.blocked='No configured test credential';write();process.exit(0);}
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const endpoint='https://api.deepseek.com/v1/chat/completions';
const fetchActual=global.fetch.bind(global);let active=null,calls=0;
function number(v){return Number.isSafeInteger(v)&&v>=0?v:null}
global.fetch=async(url,init)=>{
  const body=JSON.parse(String(init?.body||'{}'));
  if(String(url)!==endpoint||init.method!=='POST'||init.redirect!=='error'||new Headers(init.headers).get('authorization')!=='Bearer '+key||
     !active||++calls>2||body.model!==active.model||body.max_tokens!==64||
     JSON.stringify(body.messages)!==JSON.stringify([{role:'system',content:'Connectivity probe. Reply only OK.'},{role:'user',content:JSON.stringify({task:'connection-probe',message:'synthetic data only'})}]))throw Error('fixture outbound policy rejected');
  active.sent=true;active.thinking=body.thinking?.type??null;
  const start=Date.now();const r=await fetchActual(url,init);active.status=r.status;active.latencyMs=Date.now()-start;
  if(r.ok){
    const v=await r.clone().json();
    active.finishReason=['stop','length','content_filter','tool_calls','insufficient_system_resource'].includes(v.choices?.[0]?.finish_reason)?v.choices[0].finish_reason:'other';
    active.usage={input:number(v.usage?.prompt_tokens),output:number(v.usage?.completion_tokens),total:number(v.usage?.total_tokens),cached:number(v.usage?.prompt_cache_hit_tokens??v.usage?.prompt_tokens_details?.cached_tokens)};
    active.exactOK=v.choices?.[0]?.message?.content?.trim()==='OK';
    active.responseModelMatches=v.model===body.model;
  }
  return r;
};
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const watchdog=setTimeout(()=>{report.blocked='baseline application watchdog';write();app.exit(2)},105000);
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150)}throw Error('timeout '+label)}
async function run(){
  assert(safeStorage.isEncryptionAvailable(),'OS credential encryption unavailable');
  fs.mkdirSync(main.dataDir,{recursive:true});
  const cfg=path.join(main.dataDir,'.ai-settings.json');
  const encryptedApiKey=safeStorage.encryptString(key).toString('base64');
  const profile=model=>({profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:true,providerLabel:'Synthetic live DeepSeek',baseUrl:'https://api.deepseek.com/v1',model,contextBudgetChars:5000,maxOutputTokens:64,timeoutMs:25000,encryptedApiKey});
  const profiles=['deepseek-chat','deepseek-flash'].map(profile);
  fs.writeFileSync(cfg,JSON.stringify({schemaVersion:2,activeProfileId:profiles[0].profileId,profiles}),{flag:'wx'});
  assert(!fs.readFileSync(cfg,'utf8').includes(key),'credential persistence not encrypted');
  await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-live-ai-baseline',title:'Synthetic live AI baseline'});
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=code=>win.webContents.executeJavaScript(code);
  await until('editor',()=>js('!!document.querySelector("#basic-field-name")'));
  const click=async t=>assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(t)+');if(!b||b.disabled)return false;b.click();return true})()'),'control absent '+t);
  const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  await click('诊断优化');await click('AI 润色 Diff');
  await until('saved model',()=>has('已启用 · 修改'));
  const catalog=await js('window.resumeDesktop.ai.listProfiles()');
  assert(!JSON.stringify(catalog).includes(key)&&catalog.profiles.every(p=>p.apiKey===''&&p.hasApiKey),'renderer credential exposure');
  report.checks.credentialMainOnly=true;
  await click('已启用 · 修改');
  for(let i=0;i<profiles.length;i++){
    const p=profiles[i];
    if(i){const sel='select[aria-label="当前模型档案"]';assert(await js('(()=>{const e=document.querySelector('+JSON.stringify(sel)+');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,'+JSON.stringify(p.profileId)+');e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'profile selector missing');await until('second profile selected',()=>js('document.querySelector('+JSON.stringify(sel)+')?.value==='+JSON.stringify(p.profileId)));}
    active={model:p.model,sent:false};report.observations.push(active);
    await click('测试模型连接');
    await until('probe sent',()=>active.sent,5000);
    await until('probe completed',()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==="测试模型连接"&&!b.disabled)'),32000);
    active.uiSuccess=await has('连接成功');active.uiLimit=await has('模型输出达到长度上限');active.uiRejected=await has('请求被模型服务拒绝');active.uiNetwork=await has('模型网络请求失败');active.uiTimeout=await has('模型请求达到超时上限');
    await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==="测试模型连接");b?.scrollIntoView({block:"center"});return true})()');
    const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,'baseline-'+i+'.png'),shot.toPNG());write();
  }
  report.checks.exactTwoAuthorizedRequests=calls===2;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e?.message||'baseline error').split(key).join('[redacted]').slice(0,180);write();app.exit(1)});
