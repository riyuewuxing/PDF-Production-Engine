let t16;
const t16install=require('./validation-theme-t16-probe.cjs');
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-ai-receipts-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const key='synthetic-only-receipt-test-key',baseUrl='http://127.0.0.1:43219/v1',model='synthetic-receipt-model';
const report={runnerSha:process.env.GITHUB_SHA,checks:{},cases:[],calls:0,externalNetwork:0};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let active=null;
function write(){const s=JSON.stringify(report,null,2);assert(!s.includes(key),'credential in report');fs.writeFileSync(path.join(out,'ai-receipts.json'),s)}
const timer=setTimeout(()=>{report.error='application watchdog';write();app.exit(2)},200000);
global.fetch=async(url,init)=>{
  const body=JSON.parse(String(init?.body||'{}'));
  assert(active&&String(url)===baseUrl+'/chat/completions'&&init.method==='POST'&&init.redirect==='error'&&body.model===model&&new Headers(init.headers).get('authorization')==='Bearer '+key&&JSON.stringify(body.messages)===JSON.stringify(active.expected),'unexpected outbound data/route');
  report.calls++;active.calls++;active.sent=true;
  const kind=active.kind,mode=active.mode;
  if(mode==='cancel'||mode==='stale'){
    await new Promise((resolve,reject)=>{
      const signal=init.signal;
      const handle=setTimeout(resolve,2500);
      const cancel=()=>{clearTimeout(handle);active.aborted=true;reject(new DOMException('aborted','AbortError'))};
      if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
    });
  }
  if(mode==='http')return new Response('PRIVATE_PROVIDER_BODY_SHOULD_NOT_SHOW',{status:429});
  const user=JSON.parse(body.messages[1].content);
  let content;
  if(kind==='single')content=mode==='reject'?'【隐私已省略】':'- 合成实验记录已复核。';
  if(kind==='connection')content='OK';
  if(kind==='whole')content=mode==='reject'?'非 JSON 文本':mode==='empty'?'[]':JSON.stringify([{blockKey:user.blocks[0].blockKey,suggestedText:user.blocks[0].text+'\n- 合成资料复核。',reason:'合成候选',factIds:[user.blocks[0].sources[0].id]}]);
  if(kind==='layout')content=mode==='reject'?'非法版式格式':JSON.stringify({reason:'合成微调',changes:{pagePadding:24,baseFontSize:14,lineHeight:1.2}});
  if(kind==='career')content=mode==='reject'?'【隐私已省略】':'感谢审阅。\n'+user.draftText;
  if(kind==='assistant')content=mode==='reject'?'无效 JSON':JSON.stringify([{blockKey:user.toolResults.list_visible_blocks[0].blockKey,suggestedText:user.toolResults.list_visible_blocks[0].text+'\n- 合成资料复核。',reason:'合成自由任务候选',factIds:[user.toolResults.inspect_block_facts[0].sources[0].id]}]);
  const usage=mode==='unknown'?{}:{prompt_tokens:321,completion_tokens:123,total_tokens:444,prompt_tokens_details:{cached_tokens:32}};
  return new Response(JSON.stringify({model:mode==='unknown'?undefined:'synthetic-returned-model',usage,choices:[{finish_reason:mode==='limit'?'length':mode==='filter'?'content_filter':'stop',message:{content}}]}),{status:200});
};
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
const configs={
  single:{tab:'单段精修',prepare:'生成润色对比 Diff',preview:'[aria-label="AI 数据发送预览"]',confirm:'确认发送给模型',cancelPreview:'取消发送',cancel:'取消单段请求',receipt:'单段调用回执',candidate:'原文 vs 建议 Diff 审阅'},
  whole:{tab:'整卷 JD 改写',prepare:'生成整卷 JD 定向提案',preview:'[aria-label="AI 数据发送预览"]',confirm:'确认发送给模型',cancelPreview:'取消发送',cancel:'取消',receipt:'整卷调用回执',candidate:'合成候选'},
  layout:{tab:'AI 版式优化',prepare:'预览版式请求',preview:'[aria-label="版式 AI 数据发送预览"]',confirm:'确认发送版式请求',cancelPreview:'取消发送',cancel:'取消版式任务',receipt:'版式调用回执',candidate:'版式候选（尚未应用）'},
  assistant:{tab:'AI 自由任务',prepare:'预览 AI 自由任务',preview:'[aria-label="自由任务发送预览"]',confirm:'确认发送自由任务',cancelPreview:'取消预览',cancel:'取消自由任务',receipt:'自由任务调用回执',candidate:'合成自由任务候选'},
  career:{prepare:'预览文案精修请求',preview:'[aria-label="文案 AI 数据发送预览"]',confirm:'确认发送文案给模型',cancelPreview:'取消文案发送',cancel:'取消文案请求',receipt:'文案调用回执',candidate:'候选文案（本地还原）'},
};
async function run(){
  assert(safeStorage.isEncryptionAvailable(),'OS encryption unavailable');
  fs.mkdirSync(main.dataDir,{recursive:true});
  const profile={profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:true,providerLabel:'Synthetic receipt fixture',baseUrl,model,contextBudgetChars:60000,maxOutputTokens:4096,timeoutMs:25000,encryptedApiKey:safeStorage.encryptString(key).toString('base64')};
  fs.writeFileSync(path.join(main.dataDir,'.ai-settings.json'),JSON.stringify({schemaVersion:2,activeProfileId:profile.profileId,profiles:[profile]}),{flag:'wx'});
  await main.store.saveResume('master',{...fixture,id:'synthetic-receipts-master',title:'合成母库'});
  await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-receipts-doc',title:'合成回执验收'});
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);t16=await t16install(win,out,'ai');
  const js=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){throw Error('renderer fixture: '+s.slice(0,100))}};
  const q=sel=>'document.querySelector('+JSON.stringify(sel)+')';
  const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const button=t=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled&&b.getClientRects().length)');
  const click=async t=>{await t16.probe(t);await until('enabled '+t,()=>button(t));assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(t)+'&&!e.disabled&&e.getClientRects().length);if(!b)return false;b.click();return true})()'),'button missing '+t)};
  const setValue=async(sel,value)=>assert(await js('(()=>{const e='+q(sel)+';if(!e)return false;const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}));return true})()'),'input missing '+sel);
  const capture=async(name,sel)=>{await t16.scan(name);await js(q(sel)+'?.scrollIntoView({block:"center",behavior:"instant"})');await sleep(300);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
  await until('editor ready',()=>js('document.querySelector("#basic-field-name")?.value==="演示候选人"'));
  const before=await main.store.getResume('runner-fixture'),beforeMaster=await main.store.getResume('master'),beforeLedger=await main.store.getApplications(),beforeSnapshots=await main.store.listSnapshots('runner-fixture');
  const verifyDisk=async()=>{assert(JSON.stringify(await main.store.getResume('runner-fixture'))===JSON.stringify(before)&&JSON.stringify(await main.store.getResume('master'))===JSON.stringify(beforeMaster)&&JSON.stringify(await main.store.getApplications())===JSON.stringify(beforeLedger)&&JSON.stringify(await main.store.listSnapshots('runner-fixture'))===JSON.stringify(beforeSnapshots),'read-only operations changed disk');report.checks.readOnlyDisk=true};
  const matrix=require('./validation-theme-t08-matrix.cjs');
  const themeState=async()=>({doc:await main.store.getResume('runner-fixture'),master:await main.store.getResume('master'),ledger:await main.store.getApplications(),calls:report.calls});
  let pane='none';
  const enter=async kind=>{
    if(kind==='career'){if(pane!=='career'){await click('求职面试');await click('自荐信 / 话术');pane='career';}return}
    if(pane==='none'||pane==='career'){await click('诊断优化');await click('AI 润色 Diff');await until('AI enabled',()=>has('已启用 · 修改'));pane='diagnose'}
    await click(configs[kind].tab);
    if(kind==='whole')await setValue('textarea[placeholder^="请在此或"]','合成岗位：实验教学经验优先');
    if(kind==='layout')await setValue('textarea[aria-label="AI 版式目标"]','合成：适度紧凑');
    if(kind==='assistant'){await click('协作改写');await setValue('textarea[aria-label="AI 自由任务目标"]','检查合成教育经历');}
  };
  const prepare=async kind=>{
    const c=configs[kind],n=report.calls;await click(c.prepare);
    await until('preview '+kind,()=>js('!!'+q(c.preview)));
    assert(report.calls===n,'sent before confirmation');
    assert(!await js('!!'+q('[aria-label="'+c.receipt+'"]')),'old receipt survived new preview');
    const messages=await js('Array.from(('+q(c.preview)+').querySelectorAll("pre")).map((e,i)=>({role:i===0?"system":"user",content:e.textContent}))');
    assert(messages.length===2&&!JSON.stringify(messages).includes(key),'bad preview scope');
    if(kind==='career'&&!report.checks.careerPreviewMatrix){await matrix(win,out,'career-ai','career-ai-preview',themeState);report.checks.careerPreviewMatrix=true;}
    report.checks.previewNoNetworkAndClearsReceipt=true;
    return messages;
  };
  const evaluate=async(kind,mode)=>{
    const c=configs[kind],sel='[aria-label="'+c.receipt+'"]',expected=await prepare(kind);
    const obs={kind,mode,calls:0};report.cases.push(obs);active={...obs,expected};
    const n=report.calls;
    await click(c.confirm);
    await until('actual request sent',()=>active.sent);
    if(mode==='cancel'){await click(c.cancel);}
    if(mode==='stale'){await click('JD 雷达');await until('stale request aborted',()=>active.aborted);await sleep(100);assert(!await js('!!'+q(sel)),'stale result visible after leaving scope');await click('AI 润色 Diff');await click(c.tab);await until('task ready after stale response',()=>button(c.prepare));assert(!await js('!!'+q(sel)),'old receipt reappeared');report.checks.staleScopeDiscarded=true;}
    else{
      const state=mode==='cancel'?'cancelled':mode==='http'?'unconfirmed':mode==='reject'||mode==='empty'||mode==='limit'||mode==='filter'?'rejected':'received';
      await until('receipt '+kind+' '+mode,()=>js(q(sel)+'?.dataset.attemptState==='+JSON.stringify(state)));
      const rendered=await js(q(sel)+'?.innerText||""');
      obs.state=state;obs.receipt=rendered;
      assert(!rendered.includes('PRIVATE_PROVIDER_BODY_SHOULD_NOT_SHOW')&&!rendered.includes(key),'unsafe receipt');
      if(state==='received'||state==='rejected'){
        if(mode==='unknown')assert(rendered.includes('返回模型：未报告')&&rendered.includes('输入 未报告 / 输出 未报告 / 合计 未报告 tokens'),'missing metadata shown as zero');
        else assert(rendered.includes('synthetic-returned-model')&&rendered.includes('输入 321 / 输出 123 / 合计 444 tokens')&&rendered.includes('缓存命中输入 32')&&rendered.includes('与请求不同'),'reported usage mismatch');
        if(state==='rejected')assert(rendered.includes('未形成可用结果'),'parse rejection not distinguished');
      }else assert(rendered.includes('未知服务端是否已处理或计费')&&!rendered.includes('合计 0 tokens'),'unconfirmed/cancelled incorrectly treated as free');
      if(state!=='received')assert(!await has(c.candidate),'rejected/cancelled candidate still displayed');
      if(state==='received')await until('candidate '+kind,()=>has(c.candidate));
      if(mode==='cancel')assert(active.aborted,'cancel did not reach actual main-process fetch');
      if(['success','reject','cancel','unknown','http','limit','empty','filter'].includes(mode))await capture(kind+'-'+mode,sel);
      if(kind==='career'&&['success','reject','cancel'].includes(mode))await matrix(win,out,'career-ai','career-ai-'+mode,themeState);
      await until('task ready',()=>button(c.prepare));
    }
    assert(report.calls===n+1&&active.calls===1,'unexpected retry or duplicate dispatch');
    obs.calls=active.calls;obs.aborted=!!active.aborted;active=null;
    await verifyDisk();write();
  };
  for(const kind of ['career']){
    await enter(kind);
    await evaluate(kind,'success');
    await evaluate(kind,'reject');
    await evaluate(kind,'cancel');
    report.checks[kind+'States']=true;
    const n=report.calls;await prepare(kind);await click(configs[kind].cancelPreview);assert(report.calls===n&&!await js('!!'+q('[aria-label="'+configs[kind].receipt+'"]')),'preview cancellation retained receipt or sent');
  }
  await verifyDisk();write();
}
app.whenReady().then(run).then(async()=>{await t16.finish();clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();app.exit(1)});
