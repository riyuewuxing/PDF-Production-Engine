const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const data=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!data||!out||!path.basename(data).startsWith('synthetic-interview-'))throw Error('isolated synthetic fixture required');
fs.mkdirSync(data,{recursive:true});fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(data,'profile'));app.disableHardwareAcceleration();
let network=0;
global.fetch=async()=>{network++;throw Error('interview practice must not use network')};
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),adapter=require('./validation-interview-adapters.cjs');
const report={runnerSha:process.env.GITHUB_SHA,checks:{},network:0};
const write=()=>{report.network=network;fs.writeFileSync(path.join(out,'interview-practice.json'),JSON.stringify(report,null,2))};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const timer=setTimeout(()=>{report.error='actual interview practice watchdog';write();app.exit(2)},200000);
async function until(label,fn,ms=18000){const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return}catch(e){if(String(e.message).startsWith('ASSERT:'))throw e}await sleep(100)}throw Error('timeout '+label)}
const names={a:'参与甲项目，核对12份实验记录；未独立主持。',b:'参与乙项目，清洗5份数据；协作完成。',changed:'甲项目已修订：参与核对12份实验记录。',hidden:'HIDDEN_SYNTHETIC_BODY',private:'PRIVATE_SYNTHETIC_NAME'};
const slug='runner-fixture',docId='synthetic-interview-A',other='other-version',archiveId='00000000-0000-4000-8000-000000000035';
const oldAnswer='旧版无身份的STAR答案',answerA='甲：本人核对12份记录，未独立主持',answerB='乙：协作清洗5份数据',answerNew='甲：修订后仅说明本人核对',answerArchive='资格证明仍待核实，不声称已取得',conflictAnswer='冲突时本地草稿须保留';
const legacyKey=slug+':q-proj-1';
const source='须持教师资格证；\n须具备整理实验记录的经历；不要求班主任经历。';
async function run(){
  const doc={...fixture,id:docId,title:'合成面试练习',basic:{...fixture.basic,name:names.private,title:'科研助理'},education:fixture.education.map(e=>({...e,major:'物理学',description:'参与整理实验记录'})),
    projects:[{...fixture.projects[0],id:'same-title-a',name:'同名合成项目',role:'成员',description:names.a},{...fixture.projects[0],id:'same-title-b',name:'同名合成项目',role:'成员',description:names.b},{...fixture.projects[0],id:'hidden',name:'隐含项目',visible:false,description:names.hidden}],experience:fixture.experience.map(e=>({...e,description:'协助组织教学活动，未独立主讲'}))};
  await main.store.saveResume(slug,doc);
  await main.store.saveResume(other,{...doc,id:'synthetic-interview-B',title:'合成另一简历',basic:{...doc.basic,name:'OTHER_SYNTHETIC_NAME'}});
  let original=await main.store.getResume(slug);const otherOriginal=await main.store.getResume(other);
  const clauses=adapter.splitJobRequirements(source),firstEnd=source.indexOf('\n');
  const origin={version:1,fileName:'synthetic-interview-notice.pdf',sha256:'a'.repeat(64),totalPages:3,pages:[{page:1,start:0,end:firstEnd},{page:3,start:firstEnd+1,end:source.length}]};
  const archive={reviewVersion:1,id:archiveId,slug,docId,documentRevision:JSON.stringify([original.id,original.updatedAt]),factRevision:null,basisHash:await adapter.jobReviewBasisHash(original,null,source,origin),source,pdfOrigin:origin,createdAt:'2026-11-27T00:00:00Z',applicationId:null,snapshotId:null,rows:[
    {clauseId:clauses[0].id,review:{priority:'mandatory',outcome:'gap',evidenceIds:[],note:'待核对证书原件'}},
    {clauseId:clauses[1].id,review:{priority:'preferred',outcome:'supported',evidenceIds:['resume:proj:same-title-a'],note:'本人曾核对自述'}},
    {clauseId:clauses[2].id,review:{priority:'not-requirement',outcome:'unchecked',evidenceIds:[],note:''}}
  ]};
  let ledger=await main.store.getApplications();
  ledger=await main.store.saveApplications({...ledger,interviewAnswers:{[legacyKey]:oldAnswer,'other-version:q-proj-1':'另一旧版答案'},jobReviews:[archive]},ledger.revision);
  const archiveOriginal=JSON.stringify(ledger.jobReviews),appsOriginal=JSON.stringify(ledger.applications),lettersOriginal=JSON.stringify(ledger.coverLetters);
  const beforeSnapshots=await main.store.listSnapshots(slug);
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=async expression=>{try{return await win.webContents.executeJavaScript(expression)}catch(e){throw Error('renderer '+expression.slice(0,100))}};
  const q=sel=>'document.querySelector('+JSON.stringify(sel)+')',panel='[aria-label="本地面试练习"]',roleSel='input[aria-label="面试练习目标岗位"]',basisSel='select[aria-label="面试练习依据"]',history='details[aria-label="面试历史草稿"]',version='select[aria-label="快速切换简历版本"]';
  const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const click=async t=>{await until('enabled '+t,()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled&&b.getClientRects().length)'));assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled&&b.getClientRects().length);if(!b)return false;b.click();return true})()'),'button missing '+t)};
  const setValue=async(sel,value)=>assert(await js('(()=>{const e='+q(sel)+';if(!e||e.disabled)return false;const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:e.tagName==="INPUT"?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}));return true})()'),'input missing '+sel);
  const capture=async(name,sel)=>{await js(q(sel)+'?.scrollIntoView({block:"start",behavior:"instant"})');await sleep(250);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
  const rowFor=marker=>'Array.from(document.querySelectorAll('+JSON.stringify(panel+' article[aria-label^="面试练习题 "]')+')).find(a=>a.textContent.includes('+JSON.stringify(marker)+'))';
  const answerFor=marker=>js(rowFor(marker)+'?.querySelector("textarea")?.value');
  const setAnswer=async(marker,value)=>assert(await js('(()=>{const a='+rowFor(marker)+';const e=a?.querySelector("textarea");if(!e||e.disabled)return false;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));return true})()'),'question missing '+marker);
  const openHistory=async()=>{await until('history present',()=>js('!!'+q(history)));await js(q(history)+'.open=true');};
  const oldInHistory=value=>js('Array.from(('+q(history)+')?.querySelectorAll("textarea[readonly]")||[]).some(e=>e.value==='+JSON.stringify(value)+')');
  const activeAnswers=()=>js('Array.from(document.querySelectorAll('+JSON.stringify(panel+' article[aria-label^="面试练习题 "] textarea')+')).map(e=>e.value)');
  const stored=async value=>Object.values((await main.store.getApplications()).interviewAnswers).includes(value);
  const readKeys=async()=>Object.entries((await main.store.getApplications()).interviewAnswers).filter(([k])=>k.startsWith('interview-practice-v2:')).map(([k,v])=>({key:k,meta:adapter.parsePracticeKey(k),answer:v}));
  const ready=()=>until('practice loaded',()=>js('!!'+q(panel+' article[aria-label^="面试练习题 "] textarea:not(:disabled)')));
  async function enter(s=slug){
    await until('editor version',()=>js('!!'+q(version)));
    if(await js(q(version)+'?.value')!==s){await setValue(version,s);await until('version switched',()=>js(q(version)+'?.value==='+JSON.stringify(s)+'&&document.querySelector(".studio-shell")?.getAttribute("aria-busy")==="false"'));}
    await click('求职面试');await click('面试追问');await ready();
  }
  const reload=async(s=slug)=>{win.webContents.reload();await until('renderer reload',()=>js('!!document.querySelector("#basic-field-name")&&!!'+q(version)));await enter(s);};
  const updateDoc=async transform=>{const d=await main.store.getResume(slug);return main.store.saveResume(slug,transform(d),{requireExisting:true,expectedRevision:JSON.stringify([d.id,d.updatedAt])});};
  const checkReadOnly=async expectedDoc=>{
    const l=await main.store.getApplications();
    assert(JSON.stringify(await main.store.getResume(slug))===JSON.stringify(expectedDoc)&&JSON.stringify(await main.store.getResume(other))===JSON.stringify(otherOriginal),'practice changed resume');
    assert(JSON.stringify(l.applications)===appsOriginal&&JSON.stringify(l.coverLetters)===lettersOriginal&&JSON.stringify(await main.store.listSnapshots(slug))===JSON.stringify(beforeSnapshots),'practice modified other ledger fields/snapshots');
    assert(network===0,'network called');report.checks.resumeOtherLedgerAndNetworkUnchanged=true;
  };
  await enter();
  assert(await has('当前目标：科研助理')&&await has('研究方法、可复现性')&&!await has('电磁感应')&&!await has(names.hidden),'incorrect research mode');
  assert((await activeAnswers()).every(v=>v===''),'legacy draft attached automatically');
  await openHistory();assert(await oldInHistory(oldAnswer)&&!await oldInHistory('另一旧版答案'),'legacy history incorrectly scoped');
  report.checks.legacyNotAutoApplied=true;await capture('01-research-legacy',history);
  await setValue(roleSel,'英语教师');await ready();assert(await has('请选择目标学科')&&!await has('电磁感应'),'English teacher received physics question');
  await setValue(roleSel,'高中物理教师');await ready();assert(await has('电磁感应'),'physics teacher mode absent');
  await setValue(roleSel,'数据分析师');await ready();assert(await has('最核心的岗位能力')&&!await has('电磁感应')&&!await has('研究方法、可复现性'),'general role inferred from background');
  await setValue(roleSel,'');await ready();report.checks.explicitRoleClassification=true;
  await js('(()=>{const a='+rowFor(names.a)+';a.querySelector("details").open=true;return true})()');
  await setAnswer(names.a,answerA);await setAnswer(names.b,answerB);
  await until('both answers persisted',async()=>await stored(answerA)&&await stored(answerB));
  const keys=await readKeys(),keyA=keys.find(x=>x.answer===answerA),keyB=keys.find(x=>x.answer===answerB);
  assert(keyA.meta.identity==='block:proj:same-title-a'&&keyB.meta.identity==='block:proj:same-title-b'&&keyA.key!==keyB.key,'same-name projects not isolated');
  assert(!JSON.stringify(keys).includes(names.private)&&!JSON.stringify(keys).includes(names.hidden),'private or hidden text in stored keys');
  await capture('02-source-and-draft',panel+' article[aria-label="面试练习题 2"]');
  report.checks.sameNameSeparatePersistedKeys=true;await checkReadOnly(original);
  await setValue(roleSel,'数据分析师');await ready();assert(await answerFor(names.a)===''&&await answerFor(names.b)==='','cross-role answer reused');
  await openHistory();assert(await oldInHistory(answerA)&&await oldInHistory(answerB),'previous role lost');
  await setValue(roleSel,'');await ready();assert(await answerFor(names.a)===answerA&&await answerFor(names.b)===answerB,'return to same role failed');
  report.checks.roleChangeAndReturn=true;
  original=await updateDoc(d=>({...d,projects:[d.projects[1],d.projects[0],d.projects[2]]}));await reload();
  assert(await answerFor(names.a)===answerA&&await answerFor(names.b)===answerB,'reordering attached wrong answer');
  report.checks.reorderStable=true;await capture('03-reordered',panel+' article[aria-label="面试练习题 2"]');
  original=await updateDoc(d=>({...d,projects:d.projects.map(p=>p.id==='same-title-a'?{...p,description:names.changed}:p)}));await reload();
  assert(await answerFor(names.changed)===''&&await answerFor(names.b)===answerB,'changed body used old answer or reset unrelated project');
  await openHistory();assert(await oldInHistory(answerA),'old answer lost after source change');await capture('04-source-changed-history',history);
  await setAnswer(names.changed,answerNew);await until('new draft saved',()=>stored(answerNew));report.checks.changedSourceCreatesNewDraft=true;
  // Historical archive deliberately stale after edits: only historical clauses and notes are shown.
  await setValue(basisSel,archiveId);await ready();
  assert(await js('document.querySelectorAll('+JSON.stringify(panel+' article[aria-label^="面试练习题 "]')+').length===2'),'archive nonrequirement became interview question');
  assert(await has('历史档案原文')&&await has('当时本人标记存在缺口')&&await has('当时本人标记已有自述依据')&&await has('PDF 第 1 页')&&await has('PDF 第 3 页')&&await has('待核对证书原件')&&!await has('不要求班主任经历。'),'archive provenance wrong');
  assert((await activeAnswers()).every(x=>x===''),'archive reused current practice answer');
  await setAnswer(clauses[0].quote,answerArchive);await until('archive draft persisted',()=>stored(answerArchive));await capture('05-historical-archive',panel+' article[aria-label="面试练习题 1"]');
  const arcKey=(await readKeys()).find(k=>k.answer===answerArchive);
  assert(arcKey.meta.identity.startsWith('archive:'+archiveId+':')&&arcKey.meta.question.includes(clauses[0].quote),'archive answer missing precise source label');
  assert(JSON.stringify((await main.store.getApplications()).jobReviews)===archiveOriginal,'archive was mutated');
  report.checks.historicalArchiveExactQuoteAndStatus=true;
  await setValue(basisSel,'');await ready();assert(await answerFor(names.changed)===answerNew&&await answerFor(names.b)===answerB,'current scope lost after archive');
  await setValue(basisSel,archiveId);await ready();assert(await answerFor(clauses[0].quote)===answerArchive,'archive answer not restored');
  report.checks.archiveAndCurrentScopeIsolation=true;
  await setValue(basisSel,'');await ready();
  // Real cross-version UI and save/reload; identical block IDs are not identity.
  await enter(other);assert((await activeAnswers()).every(x=>x===''),'other document reused draft');
  assert(!await oldInHistory(answerA)&&!await oldInHistory(answerNew),'v2 draft leaked into another document');
  await enter(slug);assert(await answerFor(names.changed)===answerNew&&await answerFor(names.b)===answerB,'return to document lost draft');
  report.checks.crossVersionSameBlockIdsIsolated=true;
  // Actual ledger CAS rejection preserves unsaved scope-specific answer.
  const beforeConflict=await main.store.getApplications();
  await main.store.saveApplications({...beforeConflict,interviewAnswers:{...beforeConflict.interviewAnswers,'external-synthetic-key':'external write'}},beforeConflict.revision);
  await setAnswer(names.changed,conflictAnswer);await until('ledger conflict',()=>has('投递台账已被其他操作更新'));
  assert(await answerFor(names.changed)===conflictAnswer&&!await stored(conflictAnswer)&&await stored('external write'),'conflict lost draft or overwrote external disk');
  await capture('06-cas-conflict',panel+' article[aria-label="面试练习题 3"]');report.checks.ledgerCasPreservesDraft=true;
  // Explicitly discard only synthetic unsaved conflict draft; existing saved drafts stay.
  await js('window.confirm=()=>true;true');await click('重载磁盘台账');await until('disk reloaded',async()=>await answerFor(names.changed)===answerNew&&!await has('投递台账已被其他操作更新'));
  const l=await main.store.getApplications();await main.store.saveApplications({...l,jobReviews:[]},l.revision);await reload();
  assert(!await js('Array.from(('+q(basisSel)+').options).some(o=>o.value==='+JSON.stringify(archiveId)+')'),'deleted archive still selectable');
  await openHistory();assert(await oldInHistory(answerArchive)&&await oldInHistory(answerA)&&await oldInHistory(oldAnswer),'historical draft disappeared after archive removal');
  report.checks.deletedArchiveDraftPreserved=true;await capture('07-deleted-archive-history',history);
  await checkReadOnly(original);
  const finalLedger=await main.store.getApplications();
  assert(finalLedger.interviewAnswers[legacyKey]===oldAnswer&&finalLedger.interviewAnswers[keyA.key]===answerA&&finalLedger.interviewAnswers[keyB.key]===answerB&&finalLedger.interviewAnswers[arcKey.key]===answerArchive&&await stored(answerNew),'persisted history was destroyed');
  report.checks.legacyAndScopedDiskReadback=true;report.keys=(await readKeys()).map(k=>({identity:k.meta.identity,role:k.meta.role,digest:k.meta.digest,answer:k.answer}));
  write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e?.message||'fixture error').slice(0,500);write();app.exit(1)});
