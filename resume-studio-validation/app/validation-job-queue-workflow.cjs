const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,phase=process.env.QUEUE_PHASE;
if(!root||!out||!path.basename(root).startsWith('synthetic-queue-workflow-')||!['main','restart'].includes(phase))throw Error('isolated workflow fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},observations={},sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const watchdog=setTimeout(()=>{console.error('workflow watchdog '+phase);report(Error('watchdog'));app.exit(2)},270000);
const assert=(v,m)=>{if(!v)throw Error(m)};
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
function report(error){fs.writeFileSync(path.join(out,'workflow-'+phase+'.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,phase,checks,observations,...(error?{error:String(error)}:{})},null,2))}
const canonical=doc=>JSON.stringify(doc,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
async function run(){
 const store=main.store,slugA='runner-fixture',slugC='queue-c',companies=['合成工作流甲校','合成工作流乙校','合成工作流丙校'],role='物理教师',jd='  必须具备教师资格。\n硕士优先。  ';
 const ledger=()=>store.getApplications(),ledgerBytes=()=>fs.readFileSync(store.applicationsPath),source=slug=>store.resolveResumePath(slug).filePath,sourceHash=slug=>sha(fs.readFileSync(source(slug)));
 const row=async i=>(await ledger()).jobQueue?.find(t=>t.company===companies[i]);
 if(phase==='main'){
   await store.saveResume('master',{...fixture,id:'synthetic-workflow-master',title:'合成母库'});
   await store.saveResume(slugC,{...fixture,id:'synthetic-workflow-c',title:'合成工作流丙简历',basic:{...fixture.basic,name:'合成丙候选人'}});
   await store.saveResume(slugA,{...fixture,id:'synthetic-workflow-a',title:'合成工作流原稿',basic:{...fixture.basic,name:'合成甲乙候选人'}});
   const base=await ledger();await store.saveApplications({...base,applications:[{id:'ordinary-workflow-history',company:'合成通用历史',resumeSlug:slugA}],coverLetters:[{id:'ordinary-letter',title:'合成通用信',company:'合成通用单位',bodyText:'通用历史正文'}]},base.revision);
 }
 const originalHashes=[sourceHash(slugA),sourceHash(slugC)],initialHash=sha(ledgerBytes());
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(v=>JSON.stringify(v)).join(',')+')');
 const has=t=>js(t=>document.body.innerText.includes(t),t);
 const enabled=label=>js(label=>[...document.querySelectorAll('button')].some(b=>(b.getAttribute('aria-label')===label||b.innerText.trim()===label)&&!b.disabled),label);
 const click=async label=>{await until('button '+label,()=>enabled(label));assert(await js(label=>{const b=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===label||b.innerText.trim()===label)&&!b.disabled);if(!b)return false;b.scrollIntoView({block:'center'});b.click();return true},label),'missing '+label)};
 const fill=async(label,value)=>{assert(await js((label,value)=>{const e=[...document.querySelectorAll('input,textarea,select')].find(e=>e.getAttribute('aria-label')===label);if(!e||e.disabled||e.readOnly)return false;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return true},label,value),'missing input '+label)};
 const capture=async(name,selector)=>{if(selector)await js(sel=>document.querySelector(sel)?.scrollIntoView({block:'center'}),selector);await js(()=>document.fonts.ready.then(()=>true));await sleep(180);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
 const switchTo=async slug=>{
   await until('version selector',()=>js(()=>!!document.querySelector('select[aria-label="快速切换简历版本"]')));
   const active=await js(()=>document.querySelector('select[aria-label="快速切换简历版本"]').value);
   if(active!==slug)await fill('快速切换简历版本',slug);
   await until('switch '+slug,()=>js(slug=>document.querySelector('select[aria-label="快速切换简历版本"]').value===slug,slug));
   await until('correct selected document',()=>js(name=>document.body.innerText.includes(name)||document.querySelector('#basic-field-name')?.value===name,slug===slugA?'合成甲乙候选人':'合成丙候选人'));
 };
 const queue=async()=>{await click('求职面试');await click('岗位队列');await until('queue',()=>has('本地岗位任务队列'))};
 const openTask=async i=>{await click('核对岗位流程 '+companies[i]+' '+role);await until('confirmation',()=>has('确认进入：'+companies[i]));await click('确认进入该岗位流程');await until('fixed workflow',async()=>await has('固定岗位材料流程')&&await has(companies[i]+' · '+role))};
 const selectTab=async(name,selector)=>{await click('岗位流程 '+name);await until('workflow module '+name,()=>js(sel=>!!document.querySelector(sel),selector))};
 const currentModal=()=>js(()=>!!document.querySelector('[role="dialog"][aria-label="记入投递并锁定永久快照"]'));
 const readFiles=()=>new Set(fs.existsSync(main.exportsDir)?fs.readdirSync(main.exportsDir):[]);
 const onePdf=before=>{const names=fs.readdirSync(main.exportsDir).filter(n=>n.endsWith('.pdf')&&!before.has(n));assert(names.length===1,'expected one new PDF, got '+names);const f=path.join(main.exportsDir,names[0]),b=fs.readFileSync(f);assert(b.subarray(0,5).toString()==='%PDF-'&&b.length>1000,'actual pdf missing');return {file:f,bytes:b,sha256:sha(b)}};
 const register=async i=>{
   await fill('队列单位',companies[i]);await fill('队列岗位',role);await fill('队列岗位原文',jd);await click('核对任务绑定');await until('registration confirmation',()=>has('确认登记：'+companies[i]));
   await click('确认登记岗位任务');await until('persisted registration',async()=>!!await row(i));await click('开始岗位 '+companies[i]+' '+role);
   await until('prepared '+i,async()=>(await row(i))?.status==='prepared'&&await enabled('核对岗位流程 '+companies[i]+' '+role));
 };
 if(phase==='main'){
   await switchTo(slugA);await queue();
   await register(0);await register(1);
   // Switch only by the user's explicit version selector, never by queue entry.
   await switchTo(slugC);await queue();await register(2);
   await switchTo(slugA);await queue();
   assert(!await enabled('核对岗位流程 '+companies[2]+' '+role),'other version workflow enabled');
   const a=await row(0),b=await row(1),c=await row(2);
   assert(a.slug===b.slug&&a.docId===b.docId&&a.jdText===b.jdText&&a.role===b.role&&a.id!==b.id&&c.slug!==a.slug,'same-doc isolation fixture wrong');
   const before=sha(ledgerBytes());
   await click('核对岗位流程 '+companies[0]+' '+role);await until('workflow confirmation',()=>has('确认进入：'+companies[0]));
   await capture('01-confirm-workflow','[aria-label="确认固定岗位流程"]');
   await click('取消进入流程');assert(!await has('固定岗位材料流程')&&sha(ledgerBytes())===before,'cancel opened/wrote');
   await click('核对岗位流程 '+companies[0]+' '+role);await until('workflow confirmation again',()=>has('确认进入：'+companies[0]));
   await click('隐私脱敏');await until('redaction',()=>has('脱敏预览开启时隐藏岗位队列'));assert(!await has(companies[0]),'redaction exposed pending scope');
   await click('脱敏模式中');await until('queue after redaction',()=>has('本地岗位任务队列'));assert(!await has('确认进入：'+companies[0]),'old confirmation survived privacy toggle');
   await openTask(0);assert(sha(ledgerBytes())===before,'enter workflow wrote formal data');checks.confirmCancelAndOtherVersionGate=true;
   await click('分析岗位原文');await until('clause visible',()=>has('必须具备教师资格。'));
   await fill('岗位条件类型','mandatory');await fill('岗位核对结果','gap');await fill('岗位核对说明','甲校独立核对备注');await click('记录本条人工核对');await until('manual review',()=>has('已记录 1 条'));
   await click('保存本次核对到本地');await until('scoped review persisted',async()=>(await ledger()).jobReviews?.some(r=>r.queueTaskId===a.id)&&await has('已确认保存本地岗位核对档案'));
   const archive=(await ledger()).jobReviews.find(r=>r.queueTaskId===a.id);
   assert(archive.source===jd&&archive.docId===a.docId&&archive.rows[0].review.note==='甲校独立核对备注','review not scoped');
   checks.manualReviewArchiveScoped=true;await capture('02-manual-review','[aria-label="岗位核对记录"]');
   await selectTab('自荐信 / 话术','[aria-label="岗位自荐信正文"]');
   await fill('岗位自荐信正文','甲校独立自荐信正文：本人核对的合成稿。');await fill('岗位自荐信版本名','甲校独立信');
   await click('保存岗位自荐信');await until('scoped letter',async()=>(await ledger()).coverLetters.some(l=>l.queueTaskId===a.id&&l.title==='甲校独立信')&&await has('已保存本岗位自荐信版本'));
   let files=readFiles();await click('导出岗位自荐信 PDF');await until('actual letter pdf',()=>has('自荐信已导出：'));const letter=onePdf(files);
   fs.writeFileSync(path.join(out,'expected-letter.pdf'),letter.bytes);
   checks.scopedLetterAndRealPdf=true;observations.letterSha256=letter.sha256;await capture('03-letter','[aria-label="岗位自荐信正文"]');
   await selectTab('岗位面试','[aria-label="面试练习目标岗位"]');await until('practice ready',()=>js(()=>!!document.querySelector('[aria-label="面试答案 1"]:not([disabled])')));
   await fill('面试答案 1','甲校独立面试回答');await until('scoped answer persisted',async()=>Object.entries((await ledger()).interviewAnswers).some(([k,v])=>k.startsWith('interview-practice-queue-v1:')&&k.includes(a.id)&&v==='甲校独立面试回答'));
   await until('practice clean',()=>enabled('岗位流程 PDF / 投递包'));await capture('04-interview','[aria-label="面试答案 1"]');
   checks.scopedInterviewAnswer=true;
   await selectTab('PDF / 投递包','button');await until('materials',()=>has('原稿 PDF 与本地投递台账'));
   files=readFiles();await click('导出岗位原稿 PDF');await until('actual scoped PDF',()=>has('原稿 PDF 已导出并取得字节凭证'),35000);const pdf=onePdf(files);
   assert(await has(pdf.sha256),'actual receipt not displayed');await click('核对并归档岗位 PDF');await until('queue quick log',currentModal);
   assert(await js(({company,role,jd})=>{const m=document.querySelector('[role="dialog"][aria-label="记入投递并锁定永久快照"]');const inputs=m.querySelectorAll('input');return inputs[0].value===company&&inputs[0].readOnly&&inputs[1].value===role&&inputs[1].readOnly&&m.querySelector('textarea').value===jd&&m.querySelector('textarea').readOnly&&m.querySelector('[aria-label="初始投递状态"]').value==='wishlist'}, {company:companies[0],role,jd}),'wrong quick log target/default status');
   const beforeCancel=sha(ledgerBytes());await capture('05-frozen-quick-log','[role="dialog"]');
   await click('关闭记入投递弹窗');await until('modal closed',async()=>!await currentModal());assert(sha(ledgerBytes())===beforeCancel,'cancel archived');
   await click('核对并归档岗位 PDF');await until('queue log reopened',currentModal);
   const altered=Buffer.from(pdf.bytes);altered[altered.length-10]^=1;fs.writeFileSync(pdf.file,altered);
   await click('确认记入并锁定快照');await until('changed receipt rejected',()=>has('PDF 已变更、缺失或无法核验'));
   assert(sha(ledgerBytes())===beforeCancel&&await currentModal(),'changed PDF archived');
   await capture('05b-rejected-tampered-pdf','[role="dialog"]');
   fs.writeFileSync(pdf.file,pdf.bytes);await click('刷新岗位归档台账');await until('refresh ack',()=>has('已刷新磁盘台账'));
   assert(await currentModal()&&await has(pdf.sha256)&&await has(companies[0])&&sha(ledgerBytes())===beforeCancel,'refresh lost frozen archive context or wrote');
   await capture('05c-refresh-preserved-dialog','[role="dialog"]');
   await click('确认记入并锁定快照');await until('archive ack',async()=>!await currentModal()&&(await ledger()).applications.some(e=>e.queueTaskId===a.id));
   let current=await ledger(),entry=current.applications.find(e=>e.queueTaskId===a.id),snap=await store.getApplicationSnapshot(entry.snapshotId);
   assert(entry.company===companies[0]&&entry.role===role&&entry.jdText===jd&&entry.status==='wishlist'&&entry.appliedDate===''&&entry.atsScore===null&&entry.pdfReceipt.sha256===pdf.sha256&&snap.meta.queueTaskId===a.id&&sha(Buffer.from(canonical(snap.document)))===a.documentSha256,'incorrect scoped snapshot or receipt');
   assert(JSON.stringify(entry.pdfReceipt)===JSON.stringify(snap.meta.pdfReceipt),'snapshot receipt mismatch');
   checks.actualScopedPdfCancelTamperAndArchive=true;observations.receipt=entry.pdfReceipt;await capture('06-pdf-archive','[aria-label="岗位归档 '+entry.id+'"]');
   const logHash=sha(ledgerBytes()),snapshotFile=path.join(store.appSnapshotsDir,entry.snapshotId+'.json'),snapHash=sha(fs.readFileSync(snapshotFile));
   const target=path.join(root,'scoped-package.zip');let cancel=true,dialogCalls=[];
   const originalMessage=dialog.showMessageBox,originalOpen=dialog.showOpenDialog,originalSave=dialog.showSaveDialog;
   dialog.showMessageBox=async(_owner,opts)=>{dialogCalls.push(opts.title);assert(opts.detail.includes(companies[0])&&!opts.detail.includes(companies[1]),'wrong native package target');return {response:opts.title==='选择投递包内容'?(cancel?2:1):0,checkboxChecked:false}};
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[letter.file]});
   dialog.showSaveDialog=async(_owner,opts)=>{assert(opts.filters[0].extensions[0]==='zip','wrong zip filter');return {canceled:false,filePath:target}};
   try{
     await click('制作本岗位投递包 ZIP');await until('package cancel',()=>has('已取消制作投递包'));assert(!fs.existsSync(target)&&sha(ledgerBytes())===logHash&&dialogCalls.length===1,'cancel package mutated files');
     cancel=false;dialogCalls=[];await click('制作本岗位投递包 ZIP');await until('actual zip',async()=>await has('投递包已制作：')&&fs.existsSync(target),35000);
     assert(dialogCalls.length===2&&sha(ledgerBytes())===logHash&&sha(fs.readFileSync(snapshotFile))===snapHash,'ZIP mutated ledger or snapshot');
   }finally{dialog.showMessageBox=originalMessage;dialog.showOpenDialog=originalOpen;dialog.showSaveDialog=originalSave}
   fs.copyFileSync(target,path.join(out,'actual-scoped-package.zip'));fs.writeFileSync(path.join(out,'expected-resume.pdf'),pdf.bytes);
   observations.zipSha256=sha(fs.readFileSync(target));checks.realScopedZipWithInjectedDialogSelections=true;await capture('07-package','[aria-label="岗位归档 '+entry.id+'"]');
   await click('返回岗位队列');await until('queue restored',()=>has('本地岗位任务队列'));await openTask(1);
   assert(!await has('甲校独立核对备注')&&!await has('甲校独立信')&&!await has('甲校独立面试回答'),'job A leaked into B');
   await click('分析岗位原文');await until('B review',()=>has('已记录 0 条'));
   await selectTab('自荐信 / 话术','[aria-label="岗位自荐信正文"]');
   assert(await js(()=>document.querySelector('[aria-label="岗位自荐信正文"]').value.includes('合成工作流乙校')&&!document.querySelector('[aria-label="岗位自荐信正文"]').value.includes('甲校独立自荐信正文')),'B received A letter');
   await selectTab('岗位面试','[aria-label="面试练习目标岗位"]');await until('B practice',()=>js(()=>!!document.querySelector('[aria-label="面试答案 1"]:not([disabled])')));
   assert(await js(()=>document.querySelector('[aria-label="面试答案 1"]').value===''&&document.querySelector('[aria-label="面试练习依据"]').options.length===1),'B received A answer/archive');
   await fill('面试答案 1','乙校独立面试回答');await until('B answer saved',async()=>Object.entries((await ledger()).interviewAnswers).some(([k,v])=>k.includes(b.id)&&v==='乙校独立面试回答'));
   await until('B clean',()=>enabled('岗位流程 PDF / 投递包'));await selectTab('PDF / 投递包','button');await until('B materials',()=>has('原稿 PDF 与本地投递台账'));
   assert(!await has('永久快照 '+entry.snapshotId),'B received A application');
   checks.sameDocumentSameRoleJobIsolation=true;await capture('08-isolated-job-b');
   // Actual trusted IPC refuses using a scoped PDF capability for another
   // task, even when both tasks share the exact document and JD.
   const rejection=await js(async ({a,b,doc,revision})=>{
     const issued=await window.resumeDesktop.pdf.export({slug:a.slug,document:doc,queueScope:{taskId:a.id,ledgerRevision:revision},saveAs:false});
     if(!issued.pdfReceiptToken)return {error:'no token'};
     try{await window.resumeDesktop.applications.log({entry:{id:crypto.randomUUID(),queueTaskId:b.id,company:b.company,role:b.role,resumeSlug:b.slug,jdText:b.jdText,status:'wishlist',exportedFilePath:issued.filePath},document:doc,pdfReceiptToken:issued.pdfReceiptToken});return {rejected:false}}
     catch(e){return {rejected:true,message:String(e)}}
   },{a,b,doc:await store.getResume(slugA),revision:(await ledger()).revision});
   assert(rejection.rejected&&!(await ledger()).applications.some(e=>e.queueTaskId===b.id),'cross-job token accepted');
   checks.realIpcCrossTaskTokenRejected=true;
   await click('隐私脱敏');await until('workflow redacted',()=>has('脱敏预览开启时隐藏岗位队列'));assert(!await has(companies[1]),'workflow raw data leaked');
   await click(await js(()=>[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('投递追踪 ('))?.innerText.trim()));
   assert(!await has(companies[0]),'redacted tracker exposed scoped record');await capture('09-redacted-tracker');checks.redactionTrackerAndWorkflow=true;
   await click('脱敏模式中');await until('tracker restored',()=>has(companies[0]));
   await click('只读复盘 '+companies[0]);await until('permanent snapshot review',()=>js(()=>!!document.querySelector('[role="dialog"][aria-label="永久投递快照只读复盘"]')));await capture('10-permanent-review');
   assert(sha(fs.readFileSync(snapshotFile))===snapHash,'review mutated snapshot');
   assert(sourceHash(slugA)===originalHashes[0]&&sourceHash(slugC)===originalHashes[1],'source documents mutated');
   const final=await ledger();assert(final.applications.length===2&&final.jobQueue.every(t=>t.status==='prepared'),'unexpected application or task state');
   fs.writeFileSync(path.join(out,'restart-expected.json'),JSON.stringify({ledgerHash:sha(ledgerBytes()),sourceHashes:originalHashes,taskIds:[a.id,b.id,c.id],applicationId:entry.id,snapshotId:entry.snapshotId,snapshotHash:snapHash},null,2));
   checks.permanentReviewAndOriginalBytes=true;
 }else{
   const expected=JSON.parse(fs.readFileSync(path.join(out,'restart-expected.json'),'utf8'));assert(initialHash===expected.ledgerHash&&JSON.stringify(originalHashes)===JSON.stringify(expected.sourceHashes),'restart bytes differ');
   await switchTo(slugA);await queue();await until('prepared rows',()=>enabled('核对岗位流程 '+companies[0]+' '+role));assert(!await has('固定岗位材料流程')&&sha(ledgerBytes())===initialHash,'cold restart entered workflow or wrote');
   await openTask(0);assert(await has('甲校独立核对备注')||await has('本地核对档案'), 'review archives absent');
   await selectTab('自荐信 / 话术','[aria-label="岗位自荐信正文"]');await until('saved A letter',()=>has('甲校独立信'));await click('载入此岗位历史自荐信');
   assert(await js(()=>document.querySelector('[aria-label="岗位自荐信正文"]').value.includes('甲校独立自荐信正文')),'cold restart letter missing');
   await selectTab('岗位面试','[aria-label="面试练习目标岗位"]');await until('saved A answer',()=>js(()=>document.querySelector('[aria-label="面试答案 1"]')?.value==='甲校独立面试回答'));
   checks.coldRestartScopedHistory=true;await capture('11-reopened-practice','[aria-label="面试答案 1"]');
   await click('返回岗位队列');await until('queue restored',()=>has('本地岗位任务队列'));
   const doc=await store.getResume(slugA);fs.writeFileSync(source(slugA),JSON.stringify({...doc,title:'合成同修订号外部变更'}));const changed=sourceHash(slugA);
   await click('核对岗位流程 '+companies[0]+' '+role);await until('stale refused',()=>has('岗位任务绑定的磁盘简历已变化'));
   assert(sha(ledgerBytes())===initialHash&&sourceHash(slugA)===changed&&!await has('固定岗位材料流程'),'stale workflow opened/wrote');
   checks.staleSourceRefusedNoWrite=true;await capture('12-stale-refused');
   await switchTo(slugC);await queue();await openTask(2);
   assert(sha(ledgerBytes())===initialHash&&sourceHash(slugC)===originalHashes[1],'other version stale contamination');
   const beforeZoom=await js(()=>window.innerWidth);win.webContents.setZoomFactor(1.3);await sleep(300);
   const narrow=await js(()=>({width:window.innerWidth,height:window.innerHeight,scrollWidth:document.documentElement.scrollWidth}));
   assert(narrow.width<beforeZoom,'narrow CSS viewport not exercised');observations.narrowCssViewport=narrow;await capture('13-narrow-viewport','[aria-label="固定岗位材料流程"]');checks.otherVersionStillUsableAndNarrowViewport=true;
 }
 observations.ledgerSha256=sha(ledgerBytes());observations.sourceSha256=[sourceHash(slugA),sourceHash(slugC)];report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
