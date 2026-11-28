const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-job-rewrite-'))throw Error('isolated synthetic job rewrite fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const key='synthetic-job-rewrite-secret',baseUrl='http://127.0.0.1:43125/v1',model='synthetic-job-rewrite-model';
const auditContrast=require('./validation-theme-t05-contrast.cjs');
const report={runnerSha:process.env.GITHUB_SHA,checks:{},cases:[],calls:0,actualProviderCalls:0};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const write=()=>{const s=JSON.stringify(report,null,2);assert(!s.includes(key),'credential leaked');fs.writeFileSync(path.join(out,'job-rewrite.json'),s)};
let active=null;
const timer=setTimeout(()=>{report.error='application watchdog';write();process.exit(2)},115000);
const mark=stage=>{report.stage=stage;write();console.log('T06_STAGE '+stage);};
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
    projects:fixture.projects.map(p=>({...p,description:scenarios.general.body})),menuSections:fixture.menuSections.map(x=>x.id==='projects'?{...x,pageBreakBefore:true}:x),skillContent:markers[2]});
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=async s=>{let timer;try{return await Promise.race([win.webContents.executeJavaScript(s),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('renderer call watchdog '+s.slice(0,160))),5000)})])}catch(e){throw Error('renderer operation '+s.slice(0,110)+': '+e.message)}finally{clearTimeout(timer)}};
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
      mark(id+'-select');await selectTheme(id);assert(await applyDisabled(),'theme switch enabled unapproved apply');assert(report.calls===n,'theme switch caused request');
      const inline=await imageProof(cmpSelector,null);
      await capture('t05-'+id+'-inline',cmpSelector);
      await js('(()=>{const b=[...document.querySelector('+JSON.stringify(cmpSelector)+').querySelectorAll("button")].find(x=>x.innerText.trim()==="展开全屏 PDF 对照");b.focus();return true})()');
      mark(id+'-open');await click('展开全屏 PDF 对照',cmpSelector);await until('real portal images',()=>js('document.querySelector('+JSON.stringify(portalSelector)+')?.querySelectorAll("img").length===2'));
      await js('Promise.all([...document.querySelector('+JSON.stringify(portalSelector)+').querySelectorAll("img")].map(i=>i.decode())).then(()=>true)');await sleep(250);
      mark(id+'-surface');const portal=await surfaceProof(portalSelector,id,expectedBg[id]);assert(portal.bodyParent,'portal not isolated');
      await capture('t05-'+id+'-portal',portalSelector);
      const images=await imageProof(portalSelector,'t05-'+id+'-portal-paper');
      assert(JSON.stringify(images.map(i=>i.sourceSha))===JSON.stringify(inline.map(i=>i.sourceSha)),'portal source differs from inline');
      if(id!=='classic'){const ref=report.themePortal.classic;assert(JSON.stringify(images)===JSON.stringify(ref.images),'portal source/geometry/pixels changed '+id);assert(JSON.stringify(inline)===JSON.stringify(ref.inline),'inline source/geometry changed '+id);}
      report.themePortal[id]={portal,images,inline,contrast:await auditContrast(win,portalSelector,id+'-portal')};
      mark(id+'-native-focus');win.webContents.focus();
      const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode:'Enter',modifiers});await sleep(60);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(100);};
      const focused=()=>js('(()=>{const e=document.activeElement;return {inside:!!e.closest('+JSON.stringify(portalSelector)+'),label:e.getAttribute("aria-label")||e.innerText?.trim()?.slice(0,80)||"",tag:e.tagName}})()');
      mark(id+'-initial');const initial=await focused();
      const expected=await js('Array.from(document.querySelector('+JSON.stringify(portalSelector)+').querySelectorAll(\'button:not(:disabled),[tabindex]:not([tabindex="-1"])\')).filter(e=>e.tabIndex>=0&&e.getClientRects().length).map(e=>e.getAttribute("aria-label")||e.innerText.trim())');
      assert(expected.length>=3&&expected.includes('原版 PDF 滚动区域')&&expected.includes('候选 PDF 滚动区域'),'missing scroll controls');
      assert(initial.inside&&initial.label==='关闭全屏对照','initial focus missing');
      const forward=[],reverse=[];
      const origin=expected.indexOf(initial.label);
      mark(id+'-forward');for(let k=1;k<=expected.length;k++){await press('Tab');const f=await focused();forward.push(f);assert(f.inside&&f.label===expected[(origin+k)%expected.length],'forward focus escaped '+id+' '+JSON.stringify(f));}
      mark(id+'-reverse');for(let k=1;k<=expected.length;k++){await press('Tab',['shift']);const f=await focused();reverse.push(f);assert(f.inside&&f.label===expected[(origin-k+expected.length)%expected.length],'reverse focus escaped '+id);}
      // Programmatic focus outside is redirected without triggering approval.
      mark(id+'-outside-focus');await js('document.querySelector('+JSON.stringify(sourceSel)+').focus();true');assert((await focused()).inside,'background focus escaped');
      // Verify trusted key events reach this modal and are canceled before window-level shortcuts.
      await js('window.__t06Keys=[];document.addEventListener("keydown",window.__t06Audit=e=>{if(e.ctrlKey&&["k","s"].includes(e.key.toLowerCase()))window.__t06Keys.push({key:e.key.toLowerCase(),trusted:e.isTrusted,prevented:e.defaultPrevented})},true);true');
      mark(id+'-shortcut');await press('K',['control']);assert(await js('!!document.querySelector('+JSON.stringify(portalSelector)+')&&!document.querySelector(\'[aria-label="全局命令面板"]\')'),'command palette opened over portal');
      await press('S',['control']);
      const keyAudit=await js('document.removeEventListener("keydown",window.__t06Audit,true);window.__t06Keys');
      assert(JSON.stringify(keyAudit)===JSON.stringify([{key:'k',trusted:true,prevented:true},{key:'s',trusted:true,prevented:true}]),'read-only shortcuts not canceled '+JSON.stringify(keyAudit));
      await noWrite();
      // Real keyboard scroll of original PDF, not CSS or synthetic scrolling.
      const scrollSel='[aria-label="原版 PDF 滚动区域"]';
      const target=await js('(()=>{const e=document.querySelector('+JSON.stringify(scrollSel)+');return {top:e.scrollTop,range:e.scrollHeight-e.clientHeight}})()');
      assert(target.range>0,'original PDF scroll region has no scrollable content');
      for(let k=0;k<expected.length&&(await focused()).label!=='原版 PDF 滚动区域';k++)await press('Tab');
      assert((await focused()).label==='原版 PDF 滚动区域','keyboard cannot reach paper scroll region');
      mark(id+'-page-down');await press('PageDown');await until('real keyboard paper scroll',()=>js('document.querySelector('+JSON.stringify(scrollSel)+').scrollTop>'+target.top),2500);
      const paperScroll=await js('document.querySelector('+JSON.stringify(scrollSel)+').scrollTop');
      await js('document.querySelector('+JSON.stringify(scrollSel)+').scrollTop=0;true');
      mark(id+'-escape');await press('Escape');await until('escape closes portal',()=>js('!document.querySelector('+JSON.stringify(portalSelector)+')'));
      const returned=await focused();assert(returned.label==='展开全屏 PDF 对照','Escape did not restore opener '+id+' '+JSON.stringify(returned));
      mark(id+'-enter');await press('Enter');await until('Enter reopens portal',()=>js('!!document.querySelector('+JSON.stringify(portalSelector)+')'));
      assert((await focused()).label==='关闭全屏对照','reopen focus missing');
      mark(id+'-mouse');const rect=await js('(()=>{const b=[...document.querySelector('+JSON.stringify(portalSelector)+').querySelectorAll("button")].find(e=>e.innerText.trim()==="关闭全屏对照"),r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()');
      win.webContents.sendInputEvent({type:'mouseDown',...rect,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...rect,button:'left',clickCount:1});await until('button closes portal',()=>js('!document.querySelector('+JSON.stringify(portalSelector)+')'));
      const buttonReturn=await focused();assert(buttonReturn.label==='展开全屏 PDF 对照','button did not restore opener');
      mark(id+'-space');await press('Space');await until('Space reopens portal',()=>js('!!document.querySelector('+JSON.stringify(portalSelector)+')'));
      mark(id+'-multipage');
      const pageInfo=()=>js('(()=>{const d=document.querySelector('+JSON.stringify(portalSelector)+'),b=[...d.querySelectorAll("button")];return {text:d.querySelector("header").innerText,prev:b.find(e=>e.innerText==="上一页").disabled,next:b.find(e=>e.innerText==="下一页").disabled,active:document.activeElement?.innerText,activeDisabled:document.activeElement?.disabled===true,activeInside:d.contains(document.activeElement)}})()');
      const firstPage=await pageInfo();assert(firstPage.prev&&!firstPage.next&&firstPage.text.includes('第 1/2 页'),'fixture not exactly two actual PDF pages '+JSON.stringify(firstPage));
      for(let k=0;k<expected.length&&(await focused()).label!=='下一页';k++)await press('Tab');
      assert((await focused()).label==='下一页','keyboard next page inaccessible');await press('Enter');
      await until('actual second page',async()=>{const p=await pageInfo();return !p.prev&&p.next&&p.text.includes('第 2/2 页')});
      const secondPage=await pageInfo();assert(secondPage.activeInside&&!secondPage.activeDisabled,'focus lost after next became disabled '+JSON.stringify(secondPage));
      await js('Promise.all([...document.querySelector('+JSON.stringify(portalSelector)+').querySelectorAll("img")].map(i=>i.decode())).then(()=>true)');await sleep(250);
      await capture('t06-'+id+'-page2',portalSelector);const secondImages=await imageProof(portalSelector,'t06-'+id+'-page2-paper');
      assert(secondImages.every((x,i)=>x.sourceSha!==images[i].sourceSha),'second page not independently rendered');
      if(id!=='classic')assert(JSON.stringify(secondImages)===JSON.stringify(report.themePortal.classic.secondImages),'second page pixels differ by theme');
      for(let k=0;k<expected.length&&(await focused()).label!=='上一页';k++)await press('Tab');
      assert((await focused()).label==='上一页','keyboard previous page inaccessible');await press('Space');
      await until('actual first page restored',async()=>{const p=await pageInfo();return p.prev&&!p.next&&p.text.includes('第 1/2 页')});
      const restoredPage=await pageInfo();assert(restoredPage.activeInside&&!restoredPage.activeDisabled,'focus lost after previous became disabled '+JSON.stringify(restoredPage));
      report.themePortal[id].secondImages=secondImages;report.themePortal[id].pagination={firstPage,secondPage,restoredPage};write();
      await press('Escape');await until('second Escape closes portal',()=>js('!document.querySelector('+JSON.stringify(portalSelector)+')'));
      assert((await focused()).label==='展开全屏 PDF 对照','repeated focus restoration failed');
      report.themePortal[id].keyboard={initial,expected,forward,reverse,returned,buttonReturn,backgroundFocusContained:true,shortcutBlocked:true,keyAudit,paperScroll,enterReopen:true,spaceReopen:true,repeatedReturn:true};write();
      assert(await applyDisabled(),'closing portal enabled approval');await noWrite();
    }
    await selectTheme('classic');report.checks.themePortalExact=true;report.checks.portalKeyboardGate=true;report.checks.multipageKeyboardGate=true;report.portalKeyboardDiagnostic=themes.map(id=>({id,...report.themePortal[id].keyboard}));write();
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
  mark('general-analyze');await analyze('general');mark('general-open');await open('general');mark('general-success');await success('general');mark('general-pdf');await pdfReview('general');mark('general-after-matrix');
  assert(report.calls===2&&report.checks.portalKeyboardGate&&report.checks.themePortalExact,'focused fixture gate not complete');await noWrite();report.checks.noRealNetwork=true;mark('complete');

}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e?.message||'fixture failure').split(key).join('[redacted]').slice(0,500);write();process.exit(1)});
