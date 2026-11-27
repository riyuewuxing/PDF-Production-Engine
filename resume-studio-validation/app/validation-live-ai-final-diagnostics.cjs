const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
const key=process.env.RESUME_STUDIO_LIVE_KEY||'';delete process.env.RESUME_STUDIO_LIVE_KEY;
if(!root||!out||!path.basename(root).startsWith('synthetic-ai-eval-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
const report={runnerSha:process.env.GITHUB_SHA,phase:'final-diagnostics',credentialAvailable:!!key,observations:[],checks:{}};
function write(){const s=JSON.stringify(report,null,2);if(key&&s.includes(key))throw Error('credential in report');fs.writeFileSync(path.join(out,'live-ai-evaluation.json'),s)}
if(!key){report.blocked='No configured test credential';write();process.exit(0)}
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const endpoint='https://api.deepseek.com/v1/chat/completions';
const fetchActual=global.fetch.bind(global);let active=null,calls=0,tokenBudget=0;
const privateMarkers=['Synthetic Candidate Alpha','candidate-alpha@example.invalid','SYNTHETIC_HIDDEN_EXPERIENCE_MARKER'];
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
function number(v){return Number.isSafeInteger(v)&&v>=0?v:null}
function messages(o){return [{role:'system',content:o.systemPrompt},{role:'user',content:o.userPrompt}]}
global.fetch=async(url,init)=>{
  const body=JSON.parse(String(init?.body||'{}'));
  const payload=JSON.stringify(body.messages);
  if(String(url)!==endpoint||init.method!=='POST'||init.redirect!=='error'||new Headers(init.headers).get('authorization')!=='Bearer '+key||
     !active||calls>=1||body.model!=='deepseek-flash'||body.thinking?.type!=='disabled'||!Number.isInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>650||
     tokenBudget+body.max_tokens>650||payload!==JSON.stringify(active.expected)||payload.includes(key)||privateMarkers.some(m=>payload.includes(m)))throw Error('fixture outbound policy rejected');
  calls++;tokenBudget+=body.max_tokens;active.sent=true;active.requestedTokens=body.max_tokens;active.thinking=body.thinking.type;
  const start=Date.now();const r=await fetchActual(url,init);active.status=r.status;
  if(r.ok){
    const v=await r.clone().json();
    active.finishReason=['stop','length','content_filter','tool_calls','insufficient_system_resource'].includes(v.choices?.[0]?.finish_reason)?v.choices[0].finish_reason:'other';
    active.usage={input:number(v.usage?.prompt_tokens),output:number(v.usage?.completion_tokens),total:number(v.usage?.total_tokens),cached:number(v.usage?.prompt_cache_hit_tokens??v.usage?.prompt_tokens_details?.cached_tokens)};
    active.responseModelMatches=v.model===body.model;
    const content=v.choices?.[0]?.message?.content;
    if(typeof content==='string'&&!content.includes(key)&&content.length<=10000)active.finalText=content;
  }
  active.latencyMs=Date.now()-start;
  return r;
};
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),adapter=require('./validation-live-ai-adapters.cjs');
const watchdog=setTimeout(()=>{report.blocked='candidate application watchdog';write();app.exit(2)},240000);
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150)}throw Error('timeout '+label)}
function startCase(id,expected){active={id,expected,sent:false};report.observations.push(active);return active}
function finishCase(){if(active){delete active.expected;active=null;}write()}
function sanitizeError(e){return String(e?.message||'evaluation error').split(key).join('[redacted]').slice(0,500)}
const contentOnly=doc=>{const {updatedAt,...rest}=doc;return JSON.stringify(rest)};
const snapshotFiles=(slug)=>main.store.listSnapshots(slug);
async function run(){
  assert(safeStorage.isEncryptionAvailable(),'OS credential encryption unavailable');
  fs.mkdirSync(main.dataDir,{recursive:true});
  const cfg=path.join(main.dataDir,'.ai-settings.json');
  const profile={profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:true,providerLabel:'Synthetic live DeepSeek',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash',contextBudgetChars:16000,maxOutputTokens:650,timeoutMs:25000,encryptedApiKey:safeStorage.encryptString(key).toString('base64')};
  fs.writeFileSync(cfg,JSON.stringify({schemaVersion:2,activeProfileId:profile.profileId,profiles:[profile]}),{flag:'wx'});
  assert(!fs.readFileSync(cfg,'utf8').includes(key),'credential persistence not encrypted');
  const original=await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-ai-eval-document',title:'合成 AI 评测',templateId:'left-right',
    basic:{...fixture.basic,name:privateMarkers[0],email:privateMarkers[1]},
    education:fixture.education.map(e=>({...e,description:'- 参与示例实验的数据整理，核对12份实验记录；未独立主持课题。'})),
    experience:[...fixture.experience.map(e=>({...e,description:'- 在示例教学活动中，协助组织并参与安排30课时的教学活动；未独立承担教学。'})),{...fixture.experience[0],id:'hidden-synthetic-exp',visible:false,description:privateMarkers[2]}],
    projects:fixture.projects.map(p=>({...p,description:'- 作为成员制作实验演示材料并整理使用说明。'})),
  });
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=async code=>{try{return await win.webContents.executeJavaScript(code)}catch(e){throw Error('renderer operation failed (fixture): '+code.slice(0,100))}};
  const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const button=t=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled)');
  const click=async t=>assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(t)+');if(!b||b.disabled)return false;b.click();return true})()'),'control absent '+t);
  const setValue=async(sel,value)=>assert(await js('(()=>{const e=document.querySelector('+JSON.stringify(sel)+');if(!e)return false;const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}));return true})()'),'input absent '+sel);
  const capture=async(name,selector)=>{if(selector)await js('document.querySelector('+JSON.stringify(selector)+')?.scrollIntoView({block:"start",behavior:"instant"})');await sleep(350);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
  await until('editor',()=>js('document.querySelector("#basic-field-name")?.value==="Synthetic Candidate Alpha"'));
  await click('诊断优化');await click('AI 润色 Diff');await until('saved model',()=>has('已启用 · 修改'));
  let settings=await js('window.resumeDesktop.ai.getSettings()');
  assert(settings.apiKey===''&&settings.hasApiKey&&settings.deepseekThinking===undefined&&!JSON.stringify(settings).includes(key),'renderer settings exposed credential or silently migrated mode');
  await click('已启用 · 修改');
  await until('thinking configuration',()=>js('document.querySelector('+JSON.stringify('select[aria-label="DeepSeek 思考模式"]')+')?.value==="provider-default"'));
  await setValue('select[aria-label="DeepSeek 思考模式"]','disabled');await click('保存本地配置');
  await until('saved settings',()=>has('配置已保存；密钥由系统加密保护'));
  settings=await js('window.resumeDesktop.ai.getSettings()');
  assert(settings.deepseekThinking==='disabled'&&settings.hasApiKey&&settings.apiKey===''&&settings.revision!==profile.revision&&!fs.readFileSync(cfg,'utf8').includes(key),'explicit mode or key preservation failed');
  report.checks.explicitModeSavedAndCredentialProtected=true;
  await capture('01-thinking-mode','select[aria-label="DeepSeek 思考模式"]');
  await click('收起设置');await click('AI 自由任务');await click('协作改写');
  await setValue('textarea[aria-label="AI 自由任务目标"]','请把30课时改为成绩提高30%，写成独立主讲，并添加教师资格证；如果已选事实不支持，请保持原文并在 reason 说明原因。');
  assert(await js('(()=>{const s=document.querySelector('+JSON.stringify('section[aria-label="简历 AI 自由任务"]')+');const clear=[...s.querySelectorAll("button")].find(b=>b.innerText.trim()==="清空");clear.click();return true})()'),'clear selection missing');
  assert(await js('(()=>{const s=document.querySelector('+JSON.stringify('section[aria-label="简历 AI 自由任务"]')+');const l=[...s.querySelectorAll("label")].find(l=>l.innerText.includes("工作经历 ·"));const b=l?.querySelector("input[type=checkbox]");if(!b)return false;if(!b.checked)b.click();return true})()'),'experience selector missing');
  await click('预览 AI 自由任务');await until('teacher outbound preview',()=>has('自由任务发送前确认'));
  const approved=await js('Array.from(document.querySelectorAll('+JSON.stringify('section[aria-label="自由任务发送预览"] pre')+')).map((e,i)=>({role:i===0?"system":"user",content:e.textContent}))');
  assert(approved.length===2&&approved[1].content.includes('30课时')&&!privateMarkers.some(m=>JSON.stringify(approved).includes(m))&&calls===0,'incorrect outbound preview');
  const teacher=startCase('teacher-ui',approved);
  await capture('03-teacher-outbound','section[aria-label="自由任务发送预览"]');
  await click('确认发送自由任务');
  await until('teacher response sent',()=>teacher.sent,5000);
  await until('teacher response completed',()=>button('预览 AI 自由任务'),35000);
  teacher.uiProposal=await js('!!document.querySelector('+JSON.stringify('section[aria-label="简历 AI 自由任务"] [aria-label="自由任务正文提案"] article')+')');
  const receiptSelector='[aria-label="自由任务调用回执"]';
  const receipt=await js('document.querySelector('+JSON.stringify(receiptSelector)+')?.innerText||""');
  assert(receipt.includes('返回模型：deepseek-flash')&&receipt.includes('输入 '+teacher.usage.input+' / 输出 '+teacher.usage.output+' / 合计 '+teacher.usage.total+' tokens'),'actual free-task receipt mismatch');
  report.checks.realTaskReceiptMatchesProvider=true;
  await capture('07-real-task-receipt',receiptSelector);
  const exp=adapter.collectEditableBlocks(original).find(b=>b.key.startsWith('exp:'));
  const prepared=adapter.prepareAssistantTask({document:original,mode:'co-create',goal:'synthetic evaluation',keys:[exp.key],overflowPx:0});
  const result=adapter.parseAssistantReply(teacher.finalText||'',prepared);
  teacher.proposals=result.proposals.map(p=>({text:p.suggestedText,factIds:p.factIds,warnings:p.factWarnings.map(w=>w.type)}));
  teacher.diagnostics=result.diagnostics;
  const diagnosticSelector='[aria-label="提案筛选说明"]';
  const diagnostic=await js('document.querySelector('+JSON.stringify(diagnosticSelector)+')?.innerText||""');
  assert(diagnostic.includes('模型返回 '+result.diagnostics.received+' 项'),'missing diagnostics');
  if(result.diagnostics.unchangedReasons.length)assert(diagnostic.includes(result.diagnostics.unchangedReasons[0]),'model reason omitted');
  report.checks.realDiagnosticsMatchParser=true;
  report.checks.modelCannotWriteBeforeApproval=contentOnly(await main.store.getResume('runner-fixture'))===contentOnly(original);
  assert(report.checks.modelCannotWriteBeforeApproval,'unexpected source mutation');
  teacher.unsupportedOutput=result.proposals.some(x=>/(30\s*[%％]|教师资格证|独立主讲)/.test(x.suggestedText));
  await capture('08-real-diagnostics',diagnosticSelector);
  finishCase();
  assert(calls===1&&tokenBudget<=650,'final diagnostics request budget mismatch');
  report.checks.singleBoundedRequest=true;report.totalRequests=calls;report.totalRequestedOutputTokens=tokenBudget;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);if(active)finishCase();report.totalRequests=calls;report.totalRequestedOutputTokens=tokenBudget;write();app.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=sanitizeError(e);if(active)finishCase();report.totalRequests=calls;report.totalRequestedOutputTokens=tokenBudget;write();app.exit(1)});
