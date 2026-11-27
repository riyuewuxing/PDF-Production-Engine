const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
const mode=process.env.RESUME_STUDIO_JOB_AI_MODE;
const real=mode==='live',replay=false;
const recorded=replay?require('./validation-job-ai-replay.json'):null;
const key=real?(process.env.RESUME_STUDIO_LIVE_KEY||''):'synthetic-job-evidence-key';
delete process.env.RESUME_STUDIO_LIVE_KEY;
if(!['mock','live','replay'].includes(mode)||!root||!out||!path.basename(root).startsWith('synthetic-job-ai-'))throw Error('isolated synthetic fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
const report={runnerSha:process.env.GITHUB_SHA,mode,phase:'compound-conditions',credentialAvailable:!!key,observations:[],checks:{}};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
function write(){const s=JSON.stringify(report,null,2);if(key&&s.includes(key))throw Error('credential in report');fs.writeFileSync(path.join(out,'job-ai-'+mode+'.json'),s)}
if(!key){report.blocked='authorized test credential unavailable';write();process.exit(1)}
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const baseUrl=real?'https://api.deepseek.com/v1':'http://127.0.0.1:43123/v1',model=real?'deepseek-flash':'synthetic-job-ai';
const endpoint=baseUrl+'/chat/completions',fetchActual=global.fetch.bind(global);
let active=null,calls=0,tokenBudget=0;
const privateMarkers=['Synthetic Candidate Beta','candidate-beta@example.invalid','SYNTHETIC_HIDDEN_EXPERIENCE_MARKER','SYNTHETIC_UNSELECTED_SKILL','SYNTHETIC_LOCAL_ONLY_FACT_MARKER','SYNTHETIC_LOCAL_ONLY_EVIDENCE_REF','synthetic-job-ai-document','hidden-synthetic-exp','edu-demo','exp-demo','proj-demo'];
const safeNumber=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const mockRow=(requirementId,assessment,citations,missing=[])=>({requirementId,assessment,citations,reason:'合成核对建议',missing});
global.fetch=async(url,init)=>{
  const body=JSON.parse(String(init?.body||'{}')),payload=JSON.stringify(body.messages);
  assert(active&&String(url)===endpoint&&init.method==='POST'&&init.redirect==='error'&&new Headers(init.headers).get('authorization')==='Bearer '+key&&body.model===model&&(!real||body.thinking?.type==='disabled')&&Number.isInteger(body.max_tokens)&&body.max_tokens>0&&body.max_tokens<=1200&&calls<2&&tokenBudget+body.max_tokens<=2400&&payload===JSON.stringify(active.expected)&&!payload.includes(key)&&!privateMarkers.some(m=>payload.includes(m)),'fixture outbound policy rejected');
  calls++;tokenBudget+=body.max_tokens;active.sent=true;active.requestedTokens=body.max_tokens;
  const started=Date.now();let response;
  if(real)response=await fetchActual(url,init);
  else if(replay){
    const record=recorded.cases[active.id];
    assert(record&&crypto.createHash('sha256').update(record.content).digest('hex')===record.sha256,'recorded live response hash differs');
    response=new Response(JSON.stringify({model:recorded.model,usage:{prompt_tokens:record.usage.input,completion_tokens:record.usage.output,total_tokens:record.usage.total,prompt_tokens_details:{cached_tokens:record.usage.cached}},choices:[{finish_reason:'stop',message:{content:record.content}}]}),{status:200});
  }else{
    const u=JSON.parse(body.messages[1].content);
    assert(u.task==='job-evidence-v1'&&u.requirements.length===3&&u.sources.length===2,'unexpected mock task scope');
    const rows=[
      mockRow('R1','supported',[{evidenceId:'E1',quote:active.id==='bad-quote'?'不存在的博士学历':'硕士'}]),
      mockRow('R2','gap',[],['高中物理教师资格证']),
      mockRow('R3','supported',[{evidenceId:'E2',quote:'独立主讲'}]),
    ];
    response=new Response(JSON.stringify({model:'synthetic-job-ai-returned',usage:{prompt_tokens:500,completion_tokens:180,total_tokens:680,prompt_tokens_details:{cached_tokens:100}},choices:[{finish_reason:'stop',message:{content:JSON.stringify(rows)}}]}),{status:200});
  }
  active.status=response.status;
  if(response.ok){const v=await response.clone().json();active.finishReason=v.choices?.[0]?.finish_reason;active.usage={input:safeNumber(v.usage?.prompt_tokens),output:safeNumber(v.usage?.completion_tokens),total:safeNumber(v.usage?.total_tokens),cached:safeNumber(v.usage?.prompt_cache_hit_tokens??v.usage?.prompt_tokens_details?.cached_tokens)};active.responseModel=v.model;const text=v.choices?.[0]?.message?.content;if(typeof text==='string'&&!text.includes(key)&&text.length<=14000)active.finalText=text;}
  active.latencyMs=Date.now()-started;return response;
};
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),adapter=require('./validation-job-ai-adapters.cjs');
const watchdog=setTimeout(()=>{report.blocked='job AI application watchdog';if(active)delete active.expected;report.calls=calls;report.requestedOutputBudget=tokenBudget;write();app.exit(2)},180000);
async function until(label,fn,ms=18000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(120)}throw Error('timeout '+label)}
const scenarios=[
  {id:'teacher-compound',source:'须具备物理学或教育学硕士学位；不要求独立主讲经历，但须具备辅助教学经历；报名时年龄不超过35周岁。',keys:['edu:','exp:'],expected:[['supported'],['supported'],['gap','uncertain']]},
  {id:'research-compound',source:'须有实验记录整理经历，且至少独立主持1项课题；使用 Python 或 R 清洗数据者优先；须有连续三年以上软件开发管理经验。',keys:['edu:','proj:'],expected:[['partial','gap','uncertain'],['supported'],['gap','uncertain']]},
];
async function run(){
  assert(safeStorage.isEncryptionAvailable(),'OS credential encryption unavailable');
  fs.mkdirSync(main.dataDir,{recursive:true});
  const cfg=path.join(main.dataDir,'.ai-settings.json');
  const profile={profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:true,providerLabel:'Synthetic job AI '+mode,baseUrl,model,contextBudgetChars:16000,maxOutputTokens:1200,timeoutMs:25000,...(real?{deepseekThinking:'disabled'}:{}),encryptedApiKey:safeStorage.encryptString(key).toString('base64')};
  fs.writeFileSync(cfg,JSON.stringify({schemaVersion:2,activeProfileId:profile.profileId,profiles:[profile]}),{flag:'wx'});
  assert(!fs.readFileSync(cfg,'utf8').includes(key),'fixture credential stored in plaintext');
  await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-job-ai-document',title:'合成岗位证据评测',templateId:'left-right',
    basic:{...fixture.basic,name:privateMarkers[0],email:privateMarkers[1]},
    education:fixture.education.map(e=>({...e,major:'物理学',degree:'硕士',description:'参与整理12份实验记录；未独立主持课题。'})),
    experience:[...fixture.experience.map(e=>({...e,description:'协助组织30课时教学活动，未独立主讲。'})),{...fixture.experience[0],id:'hidden-synthetic-exp',visible:false,description:privateMarkers[2]}],
    projects:fixture.projects.map(p=>({...p,description:'使用 Python 清洗数据；参与小组开发。'})),skillContent:privateMarkers[3],
  });
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=async code=>{try{return await win.webContents.executeJavaScript(code)}catch(e){throw Error('fixture renderer operation failed: '+code.slice(0,100))}};
  const q=sel=>'document.querySelector('+JSON.stringify(sel)+')';
  const button=t=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled)');
  const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const click=async t=>{await until('enabled '+t,()=>button(t));assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(t)+'&&!e.disabled);if(!b)return false;b.click();return true})()'),'button absent '+t)};
  const setValue=async(sel,value)=>assert(await js('(()=>{const e='+q(sel)+';if(!e)return false;const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}));return true})()'),'input absent '+sel);
  const panel='details[aria-label="岗位 AI 证据分析"]',preview='section[aria-label="岗位 AI 发送预览"]',result='section[aria-label="岗位 AI 分析结果"]';
  const capture=async(name,selector)=>{if(selector)await js(q(selector)+'?.scrollIntoView({block:"start",behavior:"instant"})');await sleep(400);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
  const choose=async prefix=>assert(await js('(()=>{const boxes=[...('+q(panel)+').querySelectorAll("input[type=checkbox]")].filter(e=>e.getAttribute("aria-label")?.startsWith('+JSON.stringify(prefix)+'));if(boxes.length!==1||boxes[0].disabled)return false;if(!boxes[0].checked)boxes[0].click();return true})()'),'selection unavailable '+prefix);
  await until('editor',()=>js('document.querySelector("#basic-field-name")?.value==="Synthetic Candidate Beta"'));
  const before=await main.store.getResume('runner-fixture');
  let bank=await js('window.resumeDesktop.facts.get()');
  const newFact={slug:'runner-fixture',docRevision:JSON.stringify([before.id,before.updatedAt]),blockKey:'edu:'+before.education[0].id,bankRevision:bank.revision,fact:{kind:'credential',assertion:privateMarkers[4],value:'',unit:'',timeframe:'2025',evidenceRef:privateMarkers[5],sensitivity:'local-only'},confirmation:'CONFIRM_SELF_REPORTED_FACT'};
  bank=await js('window.resumeDesktop.facts.add('+JSON.stringify(newFact)+')');
  assert(bank.records.some(r=>r.assertion===privateMarkers[4]&&r.sensitivity==='local-only'),'local-only test fact absent');
  const beforeLedger=await main.store.getApplications(),beforeSnapshots=await main.store.listSnapshots('runner-fixture');
  const verifyReadOnly=async()=>{
    assert(JSON.stringify(await main.store.getResume('runner-fixture'))===JSON.stringify(before),'resume unexpectedly modified');
    assert(JSON.stringify(await main.store.getApplications())===JSON.stringify(beforeLedger),'application ledger unexpectedly modified');
    assert(JSON.stringify(await js('window.resumeDesktop.facts.get()'))===JSON.stringify(bank),'fact bank unexpectedly modified');
    assert(JSON.stringify(await main.store.listSnapshots('runner-fixture'))===JSON.stringify(beforeSnapshots),'snapshot unexpectedly created');
    report.checks.readOnlyDiskVerified=true;
  };
  await click('诊断优化');await click('JD 雷达');
  const begin=async(s)=>{
    await setValue('textarea[placeholder^="例如：招聘高中物理教师"]',s.source);
    await click('分析岗位原文');
    await until('job panel',()=>js('!!'+q(panel)));
    assert(await js(q(panel)+'.open===false'),'AI panel should not displace offline default');
    await js(q(panel)+'.open=true');
    await click('读取已保存岗位 AI 模型');
    await until('model loaded',()=>has('Synthetic job AI '+mode+' · '+model));
    await click('选择全部条款');
    for(const key of s.keys)await choose(key==='edu:'?'AI 自述 教育经历':key==='exp:'?'AI 自述 工作经历':'AI 自述 项目经历');
    await click('加载 / 刷新岗位事实依据');
    await until('independent local facts loaded',()=>has('已加载本地有效原始事实'));
    await until('AI preview ready',()=>button('预览岗位 AI 分析'));
  };
  const getPreview=async(s)=>{
    const n=calls;
    await click('预览岗位 AI 分析');
    await until('outbound confirmation',()=>js('!!'+q(preview)));
    assert(calls===n,'provider called before user confirmation');
    const messages=await js('Array.from(('+q(preview)+').querySelectorAll("pre")).map((e,i)=>({role:i===0?"system":"user",content:e.textContent}))');
    assert(messages.length===2&&!privateMarkers.some(m=>JSON.stringify(messages).includes(m))&&!JSON.stringify(messages).includes(key),'preview leaked unauthorized fixture data');
    const p=JSON.parse(messages[1].content);
    const clauseIds=adapter.splitJobRequirements(s.source).map(c=>c.id),evidenceIds=adapter.collectJobAiEvidence(before).filter(e=>s.keys.some(k=>e.id.startsWith('resume:'+k))).map(e=>e.id);
    const prepared=adapter.prepareJobAiReview({document:before,source:s.source,clauseIds,evidenceIds});
    assert(messages[0].content===prepared.options.systemPrompt&&messages[1].content===prepared.options.userPrompt&&p.requirements.length===3&&p.sources.length===2,'actual preview scope differs from selected fixture');
    report.checks.exactScopedPreview=true;
    return {messages,prepared};
  };
  const endCase=()=>{if(active)delete active.expected;active=null;report.calls=calls;report.requestedOutputBudget=tokenBudget;write()};
  const evaluate=async(s,id,expectBad=false)=>{
    const {messages,prepared}=await getPreview(s);
    const obs={id,expected:messages,sent:false,expectedAssessments:s.expected};active=obs;report.observations.push(obs);
    const old=calls;await capture(id+'-preview',preview);await click('确认发送岗位 AI 分析');
    await until('request settled',async()=>await button('预览岗位 AI 分析'),33000);
    assert(calls===old+1&&obs.sent,'expected one actual gateway request');
    obs.uiResult=await js('!!'+q(result));obs.uiError=await js(q(panel)+'.querySelector("[role=alert]")?.innerText||""');
    if(expectBad){
      assert(!obs.uiResult&&obs.uiError.includes('逐字原文'),'invalid citation was not rejected');
      report.checks.badQuoteRejected=true;await capture(id+'-rejected',panel);await verifyReadOnly();endCase();return;
    }
    if(obs.uiResult){
      const rows=adapter.parseJobAiReview(obs.finalText||'',prepared);
      const dom=await js('Array.from(('+q(result)+').querySelectorAll("article")).map(e=>({model:e.dataset.modelAssessment,review:e.dataset.reviewAssessment,text:e.innerText}))');
      assert(dom.length===rows.length&&rows.every((r,i)=>dom[i].model===r.assessment&&dom[i].review===r.reviewAssessment&&dom[i].text.includes(r.clause.quote)&&r.citations.every(c=>dom[i].text.includes(c.quote))),'UI rows differ from grounded parser');
      obs.rows=rows.map((r,i)=>({requirement:r.clause.quote,modelAssessment:r.assessment,reviewAssessment:r.reviewAssessment,expected:s.expected[i],expectedMatch:s.expected[i].includes(r.reviewAssessment),reason:r.reason,missing:r.missing,citations:r.citations.map(c=>({label:c.evidence.label,quote:c.quote,context:c.context,caution:c.caution,qualifierClipped:c.qualifierClipped}))}));
      obs.qualityMatched=obs.rows.filter(r=>r.expectedMatch).length;
      obs.qualityTotal=obs.rows.length;
      const receipt=await js(q('[aria-label="岗位 AI 调用回执"]')+'?.innerText||""');
      if(obs.usage?.total!==null)assert(receipt.includes('合计 '+obs.usage.total+' tokens'),'receipt usage mismatch');
      report.checks.receiptAndRowsMatch=true;
      const pendingList=await js(q('[aria-label="岗位待补材料清单"]')+'?.innerText||""');
      const gapRows=rows.filter(r=>['gap','partial','uncertain'].includes(r.reviewAssessment));
      assert(pendingList.includes('待补材料与待核实项 · '+gapRows.length+' 条')&&gapRows.every(r=>pendingList.includes(r.clause.quote)&&r.missing.every(m=>pendingList.includes(m))),'action list differs from grounded rows');
      report.checks.actionListMatches=true;
      await capture(id+'-result',result);
      await capture(id+'-action-list','[aria-label="岗位待补材料清单"]');
      if(mode==='mock'){
        assert(rows[2].assessment==='supported'&&rows[2].reviewAssessment==='uncertain'&&rows[2].citations[0].qualifierClipped&&dom[2].text.includes('未独立主讲'),'clipped qualifier not isolated');
        report.checks.clippedQualifierDemoted=true;
        await capture(id+'-clipped','article[aria-label="岗位 AI 建议 3"]');
      }
      assert(await js('(()=>{const b=('+q(result)+').querySelector("article:last-child button");if(!b||b.disabled)return false;b.click();return true})()'),'manual review navigation unavailable');
      await until('manual review original',()=>js(q('[aria-label="岗位条款原文"]')+'?.innerText==='+JSON.stringify(rows[rows.length-1].clause.quote)));
      assert(await js(q('select[aria-label="岗位核对结果"]')+'?.value==="unchecked"')&&await has('已记录 0 条'),'AI result auto-approved manual review');
      report.checks.noAutoApproval=true;
      await capture(id+'-manual-review','[aria-label="岗位条款原文"]');
    }else{
      assert(real&&!!obs.uiError,'model result absent without explicit failure');
      obs.qualityMatched=0;obs.qualityTotal=3;
      await capture(id+'-explicit-failure',panel);
    }
    await verifyReadOnly();endCase();
  };
  if(real||replay){
    for(const s of scenarios){await begin(s);await evaluate(s,s.id);if(report.observations.at(-1)?.status===401||report.observations.at(-1)?.status===403||report.observations.at(-1)?.status===429)break;}
    report.checks.twoCompoundRequests=calls===2;
    if(replay){assert(calls===3&&report.observations.every(o=>o.qualityMatched===3),'recorded role replay did not match all nine expected outcomes');report.checks.recordedResponsesReplayed=true;report.recordedSourceRun=recorded.sourceRun;}
  }else{
    const s=scenarios[0];
    await begin(s);
    await getPreview(s);await click('取消岗位发送');assert(calls===0&&!await js('!!'+q(preview)),'cancelled preview sent request');
    report.checks.cancelPreviewNoNetwork=true;
    await getPreview(s);await click('清空自述');assert(calls===0&&!await js('!!'+q(preview)),'changed choice retained preview');
    report.checks.selectionInvalidatesPreview=true;
    for(const k of s.keys)await choose(k==='edu:'?'AI 自述 教育经历':'AI 自述 工作经历');
    await getPreview(s);
    const originalSettings=await js('window.resumeDesktop.ai.getSettings()');
    await js('window.resumeDesktop.ai.saveSettings('+JSON.stringify({...originalSettings,maxOutputTokens:1190})+')');
    await click('确认发送岗位 AI 分析');
    await until('stale model refused',()=>has('已保存模型档案发生变化'));
    assert(calls===0,'stale model called provider');report.checks.staleModelRejected=true;
    await click('读取已保存岗位 AI 模型');await until('reloaded model',()=>button('预览岗位 AI 分析'));
    await evaluate(s,'valid-mock');
    await evaluate(s,'bad-quote',true);
    await setValue('textarea[placeholder^="例如：招聘高中物理教师"]',s.source+'新条件');
    await until('source invalidates panel',()=>js('!'+q(panel)));report.checks.sourceInvalidatesResult=true;
    assert(calls===2,'mock call count mismatch');
  }
  await verifyReadOnly();
  report.calls=calls;report.requestedOutputBudget=tokenBudget;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e?.message||'fixture error').split(key).join('[redacted]').slice(0,300);if(active)delete active.expected;report.calls=calls;report.requestedOutputBudget=tokenBudget;write();app.exit(1)});
