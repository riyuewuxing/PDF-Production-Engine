const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-job-rewrite-'))throw Error('isolated synthetic job rewrite fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const key='synthetic-job-rewrite-secret',baseUrl='http://127.0.0.1:43125/v1',model='synthetic-job-rewrite-model';
const report={runnerSha:process.env.GITHUB_SHA,checks:{},cases:[],calls:0,actualProviderCalls:0};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const write=()=>{const s=JSON.stringify(report,null,2);assert(!s.includes(key),'credential leaked');fs.writeFileSync(path.join(out,'job-rewrite.json'),s)};
let active=null;
const timer=setTimeout(()=>{report.error='application watchdog';write();app.exit(2)},300000);
const markers=['PRIVATE_CANDIDATE_SYNTHETIC','private-candidate@example.invalid','UNSELECTED_SKILLS_SYNTHETIC','HIDDEN_BODY_SYNTHETIC','LOCAL_FACT_SYNTHETIC','LOCAL_EVIDENCE_SYNTHETIC','MODEL_REASON_INJECTION_SYNTHETIC','MODEL_MISSING_INJECTION_SYNTHETIC','synthetic-job-rewrite-doc','edu-demo','exp-demo','proj-demo','hidden-row'];
const scenarios={
 teacher:{source:'须具备组织教学活动经历；须持高中物理教师资格证；必须具备独立主讲经验；硕士优先。',target:'工作经历',quote:'协助组织30课时',index:1,body:'协助组织30课时教学活动，未独立主讲。',next:'协助组织30课时的教学活动；未独立主讲。',rows:[['partial','E2','协助组织30课时',['独立教学范围待核实']],['gap',null,null,['高中物理教师资格证']],['supported','E2','独立主讲',[]],['supported','E1','硕士',[]]]},
 research:{source:'须有整理实验记录经历；必须独立主持课题；SCI论文优先。',target:'教育经历',quote:'参与整理12份实验记录',index:0,body:'参与整理12份实验记录；未独立主持课题。',next:'参与整理12份实验记录，未独立主持课题。',rows:[['supported','E1','参与整理12份实验记录',[]],['supported','E1','独立主持课题',[]],['gap',null,null,['论文成果待核实']]]},
 general:{source:'须具备 Python 数据清洗能力；须独立负责开发团队；不要求销售经验。',target:'项目经历',quote:'使用 Python 清洗数据',index:2,body:'使用 Python 清洗数据；参与小组开发。',next:'使用 Python 进行数据清洗；参与小组开发。',rows:[['supported','E3','使用 Python 清洗数据',[]],['gap',null,null,['团队负责经验']],['not-requirement',null,null,[]]]},
};
global.fetch=async(url,init)=>{
  const payload=JSON.parse(String(init?.body||'{}'));
  assert(active&&String(url)===baseUrl+'/chat/completions'&&init.method==='POST'&&init.redirect==='error'&&new Headers(init.headers).get('authorization')==='Bearer '+key&&payload.model===model&&JSON.stringify(payload.messages)===JSON.stringify(active.expected),'unexpected request/route/payload');
  assert(!JSON.stringify(payload).includes(key)&&!markers.slice(0,6).some(m=>JSON.stringify(payload).includes(m))&&!JSON.stringify(payload).includes('factBinding'),'private or local-only data sent');
  report.calls++;active.sent=true;active.calls++;
  const a=active,s=scenarios[a.scenario],u=JSON.parse(payload.messages[1].content);
  if(a.phase==='rewrite')assert(!markers.slice(6).some(m=>JSON.stringify(payload).includes(m)),'model injection or internal id propagated');
  if(a.mode==='cancel'||a.mode==='stale-source'){
    await new Promise((resolve,reject)=>{
      const h=setTimeout(resolve,3500),stop=()=>{clearTimeout(h);a.aborted=true;reject(new DOMException('aborted','AbortError'));};
      if(init.signal.aborted)stop();else init.signal.addEventListener('abort',stop,{once:true});
    });
  }
  let content;
  if(a.phase==='analysis'){
    assert(u.task==='job-evidence-v1'&&u.sources.length===3&&u.requirements.length===s.rows.length,'analysis scope mismatch');
    content=JSON.stringify(s.rows.map(([assessment,evidenceId,quote,missing],i)=>({requirementId:'R'+(i+1),assessment,citations:evidenceId?[{evidenceId,quote}]:[],reason:'MODEL_REASON_INJECTION_SYNTHETIC',missing:missing.map(x=>x+' MODEL_MISSING_INJECTION_SYNTHETIC')})));
  }else{
    assert(u.mode==='co-create'&&u.toolResults.list_visible_blocks.length===1&&u.toolResults.inspect_block_facts.length===1&&u.toolResults.list_visible_blocks[0].blockKey==='B1'&&u.toolResults.list_visible_blocks[0].text===s.body&&u.jdText===s.source.split('；')[0]+'；','rewrite scope mismatch');
    const f=u.toolResults.inspect_block_facts[0].sources[0];
    content=JSON.stringify([{blockKey:'B2',suggestedText:'UNAUTHORIZED_MODEL_OUTPUT',reason:'越权目标',factIds:[]},...(a.mode==='unauthorized-only'?[]:[{blockKey:'B1',suggestedText:s.next,reason:'合成单段表达调整',factIds:[f.id]}])]);
  }
  return new Response(JSON.stringify({model:'synthetic-job-rewrite-returned',usage:{prompt_tokens:370,completion_tokens:130,total_tokens:500,prompt_tokens_details:{cached_tokens:20}},choices:[{message:{content},finish_reason:'stop'}]}),{status:200});
};
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
async function until(label,fn,ms=20000){const stop=Date.now()+ms;while(Date.now()<stop){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
async function run(){
  assert(safeStorage.isEncryptionAvailable(),'OS encryption unavailable');fs.mkdirSync(main.dataDir,{recursive:true});
  const profile={profileId:crypto.randomUUID(),revision:crypto.randomUUID(),enabled:true,providerLabel:'Synthetic job rewrite fixture',baseUrl,model,contextBudgetChars:20000,maxOutputTokens:1600,timeoutMs:25000,encryptedApiKey:safeStorage.encryptString(key).toString('base64')};
  fs.writeFileSync(path.join(main.dataDir,'.ai-settings.json'),JSON.stringify({schemaVersion:2,activeProfileId:profile.profileId,profiles:[profile]}),{flag:'wx'});
  await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-job-rewrite-doc',title:'合成岗位定向改写',templateId:'minimal-ats',
    basic:{...fixture.basic,name:markers[0],email:markers[1]},education:fixture.education.map(e=>({...e,description:scenarios.research.body})),
    experience:[...fixture.experience.map(e=>({...e,description:scenarios.teacher.body})),{...fixture.experience[0],id:'hidden-row',visible:false,description:markers[3]}],
    projects:fixture.projects.map(p=>({...p,description:scenarios.general.body})),skillContent:markers[2]});
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){throw Error('renderer operation '+s.slice(0,110))}};
  const q=sel=>'document.querySelector('+JSON.stringify(sel)+')';
  const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const button=(t,scope='body')=>js('[...('+q(scope)+')?.querySelectorAll("button")||[]].some(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled&&b.getClientRects().length)');
  const click=async(t,scope='body')=>{await until('enabled '+t,()=>button(t,scope));assert(await js('(()=>{const b=[...('+q(scope)+').querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(t)+'&&!e.disabled&&e.getClientRects().length);if(!b)return false;b.click();return true})()'),'button missing '+t)};
  const setValue=async(sel,value)=>assert(await js('(()=>{const e='+q(sel)+';if(!e)return false;const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}));return true})()'),'input missing '+sel);
  const capture=async(name,sel)=>{await js(q(sel)+'?.scrollIntoView({block:"start",behavior:"instant"})');await sleep(200);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
  const checkLabel=async(part,scope)=>assert(await js('(()=>{const l=[...('+q(scope)+').querySelectorAll("label")].find(e=>e.innerText.includes('+JSON.stringify(part)+'));const b=l?.querySelector("input[type=checkbox]");if(!b||b.disabled)return false;if(!b.checked)b.click();return true})()'),'checkbox unavailable '+part);
  const panel='details[aria-label="岗位 AI 证据分析"]',result='section[aria-label="岗位 AI 分析结果"]',preview='section[aria-label="岗位 AI 发送预览"]',rewrite='section[aria-label="岗位定向改写工作区"]',draftScope='[aria-label="岗位定向改写范围"]',rp='section[aria-label="岗位改写发送预览"]',proposal='[aria-label="岗位改写正文提案"]',receipt='[aria-label="岗位改写调用回执"]',sourceSel='textarea[placeholder^="例如：招聘高中物理教师"]';
  const applyDisabled=()=>js('[...('+q(rewrite)+').querySelectorAll("button")].find(b=>b.innerText.includes("应用已核对提案"))?.disabled===true');

  const phase=process.env.STUDIO_THEME_PHASE||'candidate';
  const themes=['classic','dark','light','warm'];
  const cmpSelector='section[aria-label="真实 PDF 前后对照"]',portalSelector='[role="dialog"][aria-label="全屏 PDF 对照"]';
  async function selectTheme(id){
    const ok=await js('(()=>{const e=document.querySelector(\'select[aria-label="切换工作台主题"]\');if(!e)return false;e.value='+JSON.stringify(id)+';e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
    assert(ok,'theme control absent');await until('theme switched '+id,()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==='+JSON.stringify(id)));await sleep(250);
  }
  async function imageProof(sel,label){
    const info=await js('('+function(sel){
      const e=document.querySelector(sel);const nodes=[...e.querySelectorAll('img')];
      return nodes.map(img=>{const r=img.getBoundingClientRect(),c=getComputedStyle(img),p=img.parentElement.getBoundingClientRect();const x=Math.max(Math.ceil(r.left)+2,Math.ceil(p.left)+2,0),y=Math.max(Math.ceil(r.top)+2,Math.ceil(p.top)+2,0),right=Math.min(Math.floor(r.right)-2,Math.floor(p.right)-2,innerWidth-2),bottom=Math.min(Math.floor(r.bottom)-2,Math.floor(p.bottom)-2,innerHeight-2);return {src:img.src,complete:img.complete,natural:[img.naturalWidth,img.naturalHeight],rect:[r.width,r.height],filter:c.filter,opacity:c.opacity,transform:c.transform,crop:{x,y,width:right-x,height:bottom-y}};});
    }.toString()+')('+JSON.stringify(sel)+')');
    assert(info.length===2&&info.every(i=>i.complete&&i.natural[0]>100&&i.filter==='none'&&i.opacity==='1'&&i.transform==='none'),'image renderer changed');
    const rows=[];
    for(let i=0;i<info.length;i++){const item=info[i],{src,crop,...rest}=item;const row={...rest,sourceSha:crypto.createHash('sha256').update(src).digest('hex')};if(label){assert(crop.width>100&&crop.height>100,'portal image not visible');const shot=await win.webContents.capturePage(crop);assert(!shot.isEmpty(),'image crop empty');fs.writeFileSync(path.join(out,label+'-'+i+'.png'),shot.toPNG());row.pixelSha=crypto.createHash('sha256').update(shot.toBitmap()).digest('hex');row.cropSize=shot.getSize();}rows.push(row);}
    return rows;
  }
  async function surfaceProof(sel,id,expected){
    const s=await js('('+function(sel){const el=document.querySelector(sel);if(!el)throw Error('missing surface');const c=getComputedStyle(el);return {id:el.dataset.studioTheme||null,zone:el.dataset.studioSurface||null,bg:c.backgroundColor,fg:c.color,scroll:[el.clientWidth,el.scrollWidth],bodyParent:el.parentElement===document.body};}.toString()+')('+JSON.stringify(sel)+')');
    if(phase==='candidate'){assert(s.id===id&&s.zone==='panel','scope mismatch '+sel+' '+id);if(id!=='classic')assert(s.bg===expected,'unexpected background '+id+' '+JSON.stringify(s));}
    return s;
  }
  const expectedBg={dark:'rgb(17, 24, 39)',light:'rgb(255, 255, 255)',warm:'rgb(251, 247, 238)'};
  async function portalMatrix(){
    const n=report.calls;
    report.themePortal={};
    for(const id of themes){
      await selectTheme(id);assert(await applyDisabled(),'theme switch enabled unapproved apply');assert(report.calls===n,'theme switch caused request');
      const inline=await imageProof(cmpSelector,null);
      await capture('t05-'+id+'-inline',cmpSelector);
      await click('展开全屏 PDF 对照',cmpSelector);await until('real portal images',()=>js('document.querySelector('+JSON.stringify(portalSelector)+')?.querySelectorAll("img").length===2'));
      await js('Promise.all([...document.querySelector('+JSON.stringify(portalSelector)+').querySelectorAll("img")].map(i=>i.decode())).then(()=>true)');await sleep(250);
      const portal=await surfaceProof(portalSelector,id,expectedBg[id]);assert(portal.bodyParent,'portal not isolated');
      await capture('t05-'+id+'-portal',portalSelector);
      const images=await imageProof(portalSelector,'t05-'+id+'-portal-paper');
      assert(JSON.stringify(images.map(i=>i.sourceSha))===JSON.stringify(inline.map(i=>i.sourceSha)),'portal source differs from inline');
      if(id!=='classic'){const ref=report.themePortal.classic;assert(JSON.stringify(images)===JSON.stringify(ref.images),'portal source/geometry/pixels changed '+id);assert(JSON.stringify(inline)===JSON.stringify(ref.inline),'inline source/geometry changed '+id);}
      report.themePortal[id]={portal,images,inline};
      await click('关闭全屏对照',portalSelector);await until('portal closed',()=>js('!document.querySelector('+JSON.stringify(portalSelector)+')'));
      assert(await applyDisabled(),'closing portal enabled approval');await noWrite();
    }
    await selectTheme('classic');report.checks.themePortalExact=true;write();
  }
  await until('editor',()=>js('document.querySelector("#basic-field-name")?.value==='+JSON.stringify(markers[0])));
  const before=await main.store.getResume('runner-fixture');
  let bank=await js('window.resumeDesktop.facts.get()');
  bank=await js('window.resumeDesktop.facts.add('+JSON.stringify({slug:'runner-fixture',docRevision:JSON.stringify([before.id,before.updatedAt]),blockKey:'edu:'+before.education[0].id,bankRevision:bank.revision,fact:{kind:'other',assertion:markers[4],value:'',unit:'',timeframe:'',evidenceRef:markers[5],sensitivity:'shareable'},confirmation:'CONFIRM_SELF_REPORTED_FACT'})+')');
  const ledger=await main.store.getApplications(),snapshots=await main.store.listSnapshots('runner-fixture');
  const noWrite=async()=>{assert(JSON.stringify(await main.store.getResume('runner-fixture'))===JSON.stringify(before),'unexpected resume change');assert(JSON.stringify(await main.store.getApplications())===JSON.stringify(ledger)&&JSON.stringify(await js('window.resumeDesktop.facts.get()'))===JSON.stringify(bank)&&JSON.stringify(await main.store.listSnapshots('runner-fixture'))===JSON.stringify(snapshots),'unexpected ledger/fact/snapshot change');report.checks.readOnlyBeforeApproval=true};
  const getMessages=sel=>js('Array.from(('+q(sel)+').querySelectorAll("pre")).map((e,i)=>({role:i===0?"system":"user",content:e.textContent}))');
  const start=(scenario,phase,mode,expected)=>{const a={scenario,phase,mode,calls:0,sent:false,expected};active=a;return a};
  const finish=a=>{assert(a.calls===1,'request duplicated or absent');const {expected,...entry}=a;report.cases.push(entry);active=null;write()};
  await click('诊断优化');await click('JD 雷达');
  const analyze=async name=>{
    const s=scenarios[name],n=report.calls;
    await setValue(sourceSel,s.source);await click('分析岗位原文');await until('job panel',()=>js('!!'+q(panel)));await js(q(panel)+'.open=true');
    await click('读取已保存岗位 AI 模型',panel);await until('model ready',()=>has('Synthetic job rewrite fixture · '+model));await click('选择全部条款',panel);
    for(const prefix of ['AI 自述 教育经历','AI 自述 工作经历','AI 自述 项目经历']){
      assert(await js('(()=>{const b=[...('+q(panel)+').querySelectorAll("input")].find(e=>e.getAttribute("aria-label")?.startsWith('+JSON.stringify(prefix)+'));if(!b||b.disabled)return false;if(!b.checked)b.click();return true})()'),'evidence missing '+prefix);
    }
    await click('预览岗位 AI 分析',panel);await until('analysis preview',()=>js('!!'+q(preview)));assert(report.calls===n,'analysis sent without confirmation');
    const messages=await getMessages(preview);const a=start(name,'analysis','success',messages);
    await click('确认发送岗位 AI 分析',preview);await until('analysis results',()=>js('!!'+q(result)));finish(a);
    const targets=await js('Array.from(('+q(result)+').querySelectorAll("article")).map(a=>Array.from(a.querySelectorAll("button")).filter(b=>b.innerText.startsWith("准备本段定向改写")).map(b=>b.innerText))');
    assert(targets.length===s.rows.length&&targets[0].length===1&&targets[0][0].includes(s.target)&&targets.slice(1).every(t=>t.length===0),'invalid or missing rewrite target '+JSON.stringify(targets));
    report.checks[name+'TargetGating']=true;await capture(name+'-analysis',result);await noWrite();
  };
  const open=async name=>{
    const s=scenarios[name],n=report.calls;
    const label=await js('Array.from(('+q(result)+').querySelectorAll("button")).find(b=>b.innerText.startsWith("准备本段定向改写"))?.innerText');
    assert(label?.includes(s.target),'target missing '+name);await click(label,result);
    await until('guided workspace',()=>js('!!'+q(rewrite)));assert(report.calls===n,'opening draft contacted model');
    assert(await js(q(draftScope)+'?.innerText.includes('+JSON.stringify(s.target)+')')&&await js(q(draftScope)+'?.innerText.includes('+JSON.stringify(s.source.split('；')[0]+'；')+')'),'local scope mismatch');
    assert(!await js('!!('+q(rewrite)+').querySelector("textarea[aria-label=\\"AI 自由任务目标\\"]")')&&!await js('Array.from(('+q(rewrite)+').querySelectorAll("button")).some(b=>["问答","制定计划","协作改写","分步工作","全选可见段落","加载 / 刷新事实库"].includes(b.innerText.trim()))'),'guided controls can expand scope');
    report.checks.fixedScopeNoAutomaticSend=true;
    await capture(name+'-draft',rewrite);
  };
  const prepare=async name=>{
    const n=report.calls;await click('预览本段定向改写',rewrite);await until('rewrite preview',()=>js('!!'+q(rp)));assert(report.calls===n,'rewrite sent before confirmation');
    const messages=await getMessages(rp),u=JSON.parse(messages[1].content),s=scenarios[name];
    assert(messages.length===2&&u.mode==='co-create'&&u.jdText===s.source.split('；')[0]+'；'&&u.toolResults.list_visible_blocks.length===1&&u.toolResults.list_visible_blocks[0].text===s.body&&u.toolResults.inspect_block_facts.length===1&&u.toolResults.inspect_block_facts[0].sources.every(f=>f.scope!=='record'),'preview scope mismatch');
    assert(!markers.some(m=>JSON.stringify(messages).includes(m)),'preview privacy leak or untrusted carry-over');
    for(const other of Object.values(scenarios))if(other!==s)assert(!messages[1].content.includes(other.body),'unselected body present');
    assert(!messages[1].content.includes(s.source.split('；')[1]),'extra JD clause present');
    report.checks.exactNewPreviewScope=true;await capture(name+'-preview',rp);
    return messages;
  };
  const send=async(name,mode,expected)=>{
    const a=start(name,'rewrite',mode,expected);
    await click('确认发送本段改写',rp);await until('rewrite actual dispatch',()=>a.sent);
    return a;
  };
  const close=()=>click('关闭定向改写',rewrite);
  const success=async(name,mode='success')=>{
    const a=await send(name,mode,await prepare(name));
    const state=mode==='unauthorized-only'?'rejected':'received';await until('rewrite receipt '+state,()=>js(q(receipt)+'?.dataset.attemptState==='+JSON.stringify(state)));
    assert(await has('未授权目标 1')&&!await has('UNAUTHORIZED_MODEL_OUTPUT'),'unauthorized target displayed');
    assert(await applyDisabled(),'apply enabled without manual approval');finish(a);await noWrite();
    if(mode==='success')await capture(name+'-proposal',proposal);
    report.checks.unauthorizedTargetDiscarded=true;
  };
  const pdfReview=async name=>{
    const n=report.calls;
    await checkLabel('已核对本条原文',rewrite);assert(await applyDisabled(),'fact-only approval enabled apply');
    await click('试渲染已选正文提案',rewrite);await until('real PDF preview',()=>js('!!'+q('section[aria-label="真实 PDF 前后对照"]')),45000);
    assert(await applyDisabled(),'PDF generated without explicit approval enabled apply');
    if(!report.themePortal)await portalMatrix();
    await checkLabel('已检查正文修改后的真实 PDF 页面',rewrite);assert(await button('应用已核对提案（1）',rewrite),'PDF-approved apply unavailable');
    assert(report.calls===n,'PDF review called model');await noWrite();await capture(name+'-pdf','section[aria-label="真实 PDF 前后对照"]');report.checks.factAndPdfGates=true;
  };
  await analyze('teacher');
  // A manually recorded local review must survive opening, cancelling and closing the guided rewrite.
  await js('(()=>{const row=('+q(result)+').querySelectorAll("article")[1];row.querySelector("button").click()})()');
  await until('manual original',()=>js(q('[aria-label="岗位条款原文"]')+'?.innerText.includes("高中物理教师资格证")'));
  await setValue('select[aria-label="岗位核对结果"]','gap');await setValue('textarea[aria-label="岗位核对说明"]','合成人工核对说明');
  await click('记录本条人工核对');await until('manual record',()=>has('已记录 1 条'));
  await open('teacher');let messages=await prepare('teacher');const n=report.calls;await click('取消改写预览',rp);assert(report.calls===n&&!await js('!!'+q(rp)),'cancel preview sent');await close();
  assert(await has('已记录 1 条')&&await has('合成人工核对说明'),'manual session lost on close');report.checks.manualReviewPreserved=true;
  await open('teacher');messages=await prepare('teacher');let a=await send('teacher','cancel',messages);await click('取消本段改写',rewrite);
  await until('cancel receipt',()=>js(q(receipt)+'?.dataset.attemptState==="cancelled"'));assert(a.aborted&&!await js('!!'+q(proposal)),'cancelled result or fetch still active');await capture('teacher-cancelled',receipt);finish(a);await close();await noWrite();report.checks.cancelAbortsActualRequest=true;
  await open('teacher');await success('teacher','unauthorized-only');await close();
  await analyze('research');await open('research');await success('research');await close();await open('research');messages=await prepare('research');a=await send('research','stale-source',messages);
  await setValue(sourceSel,scenarios.research.source+'附加新条款');await until('source invalidates workspace',()=>js('!'+q(rewrite)));await until('stale fetch aborted',()=>a.aborted);
  finish(a);await noWrite();report.checks.staleSourceAbortsAndDiscards=true;
  await analyze('general');await open('general');await success('general');await pdfReview('general');
  const saved=await js('window.resumeDesktop.ai.getSettings()');await js('window.resumeDesktop.ai.saveSettings('+JSON.stringify({...saved,maxOutputTokens:1500})+')');
  const beforeStale=report.calls;await click('应用已核对提案（1）',rewrite);
  await until('stale settings blocked apply',()=>has('岗位定向改写的已保存模型档案已变化'));assert(report.calls===beforeStale&&await applyDisabled(),'stale profile allowed application');await capture('general-stale-profile',rewrite);await noWrite();report.checks.staleProfileBlocksApply=true;await close();
  await open('general');await prepare('general');const oldCalls=report.calls;await click('确认发送本段改写',rp);
  await until('stale model refused before network',()=>has('岗位定向改写的已保存模型档案已变化'));
  assert(report.calls===oldCalls&&await js(q(receipt)+'?.dataset.attemptState==="unconfirmed"'),'stale profile reached network or produced a result');await noWrite();report.checks.staleProfileBlocksSend=true;await close();
  // Reanalyse with current profile; approved rewrite changes exactly one body and creates a real prewrite snapshot.
  await analyze('teacher');await open('teacher');await success('teacher');await pdfReview('teacher');const beforeApplyCalls=report.calls;
  // A new unsaved manual draft must require explicit confirmation before it can be invalidated.
  await setValue('textarea[aria-label="岗位核对说明"]','尚未记录的合成人工草稿');
  await js('window.__guidedConfirm=[];window.confirm=s=>{window.__guidedConfirm.push(s);return false};true');
  await click('应用已核对提案（1）',rewrite);await until('manual invalidation confirmation',()=>js('window.__guidedConfirm.some(s=>s.includes("未记录草稿"))'));
  assert(await button('应用已核对提案（1）',rewrite)&&await js(q('textarea[aria-label="岗位核对说明"]')+'?.value==="尚未记录的合成人工草稿"'),'cancelled confirmation lost draft or candidate');
  await noWrite();report.checks.manualDraftInvalidationRequiresConfirmation=true;
  await js('window.confirm=s=>{window.__guidedConfirm.push(s);return true};true');
  // Let a real prewrite snapshot complete, then change the manual review before the IPC result.
  // This must discard the old body application even though the explicitly authorized backup exists.
  const originalSnapshot=main.store.createSnapshot.bind(main.store);
  let snapshotReached=false,releaseSnapshot;
  main.store.createSnapshot=async(...args)=>{
    const v=await originalSnapshot(...args);
    if(args[1]==='岗位定向改写前快照'&&!snapshotReached){
      snapshotReached=true;
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('snapshot test watchdog')),10000);releaseSnapshot=()=>{clearTimeout(timer);resolve()};});
    }
    return v;
  };
  await click('应用已核对提案（1）',rewrite);await until('actual prewrite snapshot',()=>snapshotReached&&!!releaseSnapshot);
  await setValue('textarea[aria-label="岗位核对说明"]','在快照过程中变化的人工草稿');
  releaseSnapshot();main.store.createSnapshot=originalSnapshot;
  await until('changed manual draft blocks apply',()=>has('人工岗位核对已变化或仍在保存'));
  assert(JSON.stringify(await main.store.getResume('runner-fixture'))===JSON.stringify(before)&&await js(q('textarea[aria-label="岗位核对说明"]')+'?.value==="在快照过程中变化的人工草稿"')&&report.calls===beforeApplyCalls,'manual review race changed body or lost draft');
  const afterRaceSnapshots=await main.store.listSnapshots('runner-fixture');
  assert(afterRaceSnapshots.length===snapshots.length+1,'expected one authorized backup for interrupted application');
  report.checks.manualDraftRaceRejectsBodyWrite=true;await capture('teacher-manual-race',rewrite);
  await click('应用已核对提案（1）',rewrite);
  await until('saved guided body',async()=> (await main.store.getResume('runner-fixture')).experience[0].description===scenarios.teacher.next,30000);
  const after=await main.store.getResume('runner-fixture'),expected={...before,updatedAt:after.updatedAt,experience:before.experience.map((x,i)=>i===0?{...x,description:scenarios.teacher.next}:x)};
  assert(JSON.stringify(after)===JSON.stringify(expected),'protected or unrelated fields changed');
  const finalSnapshots=await main.store.listSnapshots('runner-fixture');assert(finalSnapshots.length===snapshots.length+2&&finalSnapshots.filter(s=>s.reason==='岗位定向改写前快照').length===2,'missing prewrite snapshot');
  for(const s of finalSnapshots.filter(s=>s.reason==='岗位定向改写前快照')){const record=JSON.parse(fs.readFileSync(path.join(main.store.backupsDir,'runner-fixture',s.id+'.json'),'utf8'));assert(JSON.stringify(record.document)===JSON.stringify(before),'snapshot bytes differ from original baseline');}
  report.checks.actualSnapshotContentVerified=true;
  assert(JSON.stringify(await main.store.getApplications())===JSON.stringify(ledger)&&JSON.stringify(await js('window.resumeDesktop.facts.get()'))===JSON.stringify(bank)&&report.calls===beforeApplyCalls,'apply changed ledger/facts or called provider');
  assert(!await js('!!'+q(rewrite))&&await has('原岗位核对会话因简历变化失效'),'stale workspace or missing editor submission feedback');
  await capture('teacher-applied','[role="status"]');
  // Real Undo of the authorized edit must restore the original content and remove stale success feedback.
  await js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"z",code:"KeyZ",ctrlKey:true,bubbles:true,cancelable:true}));true');
  await until('guided edit undo',async()=> (await main.store.getResume('runner-fixture')).experience[0].description===scenarios.teacher.body,30000);
  const undone=await main.store.getResume('runner-fixture');assert(JSON.stringify({...undone,updatedAt:before.updatedAt})===JSON.stringify(before)&&!await has('原岗位核对会话因简历变化失效'),'undo or status scope incorrect');
  report.checks.realUndoRestoresBodyAndClearsFeedback=true;
  report.checks.exactSingleBodyWrite=true;report.checks.prewriteSnapshotCreated=true;report.checks.applyInvalidatesOldReview=true;
  report.checks.noRealNetwork=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e?.message||'fixture failure').split(key).join('[redacted]').slice(0,500);write();app.exit(1)});
