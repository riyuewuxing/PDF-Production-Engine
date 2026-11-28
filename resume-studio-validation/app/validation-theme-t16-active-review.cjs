let t16;
const t16install=require('./validation-theme-t16-probe.cjs');
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out)throw Error('isolated paths required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
const userData=path.join(root,'userData');fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData);app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),manifest=require('./runner-manifest.json');
const checks={},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const watchdog=setTimeout(()=>{console.error('application review native watchdog');app.exit(2);},200000);
async function until(label,fn,limit=15000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('timed out '+label);}
const assert=(v,m)=>{if(!v)throw Error(m)};
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
async function run(){
 const store=main.store,relative=path.relative(path.resolve(root),path.resolve(store.resumesDir));
 assert(!relative.startsWith('..')&&!path.isAbsolute(relative),'store not isolated');
 const original=await store.saveResume('runner-fixture',{
  ...fixture,id:'synthetic-review-doc-39',title:'封存合成原稿',
  basic:{...fixture.basic,name:'合成候选甲',email:'sealed@example.invalid',phone:'HIDDEN_SEALED_PHONE_39',fieldOrder:[
   {id:'name',key:'name',label:'姓名',visible:true},{id:'title',key:'title',label:'职位',visible:true},{id:'email',key:'email',label:'邮箱',visible:true},{id:'phone',key:'phone',label:'电话',visible:false}
  ]},skillContent:'SEALED_SKILL_39',
  education:[{id:'edu-a',school:'合成甲学院',description:'SEALED_COURSE_39'}]
 });
 const createEntry=(company,slug,doc,filePath='')=>store.logApplication({entry:{id:crypto.randomUUID(),company,role:'物理教师',resumeSlug:slug,exportedFilePath:filePath,atsScore:65,updatedAt:'2026-01-01T00:00:00Z'},document:doc});
 const good=await createEntry('合成已投学校','runner-fixture',original,path.join(root,'not-present.pdf'));
 const current=await store.saveResume('runner-fixture',{...original,title:'当前合成稿',templateId:'teacher-table-classic',basic:{...original.basic,email:'current@example.invalid',phone:'HIDDEN_CURRENT_PHONE_39'},skillContent:'CURRENT_SKILL_39',education:[{...original.education[0],description:'CURRENT_COURSE_39'},{id:'edu-b',school:'合成乙学院',description:'NEW_COURSE_39'}],globalSettings:{...original.globalSettings,themeColor:'#2468ac'}});
 const other=await store.saveResume('other-compare',{...current,id:'other-doc-39',title:'其他磁盘合成版本',basic:{...current.basic,email:'other@example.invalid'},skillContent:'OTHER_SKILL_39'});
 const master=await store.saveResume('master',{...current,id:'master-doc-39',title:'合成母库',skillContent:'MASTER_SKILL_39'});
 const goneDoc=await store.saveResume('gone-version',{...original,id:'gone-doc-39',title:'已移除关联封存稿',basic:{...original.basic,email:'gone-archive@example.invalid'},skillContent:'GONE_SKILL_39'});
 const gone=await createEntry('合成已移除学校','gone-version',goneDoc);
 await store.deleteResume('gone-version',JSON.stringify([goneDoc.id,goneDoc.updatedAt]));
 const bad=await createEntry('合成异常学校','runner-fixture',{...original,basic:{...original.basic,email:'FOREIGN_ARCHIVE_PRIVATE_39'}});
 const missing=await createEntry('合成缺失学校','runner-fixture',original);
 const legacyId='legacy-review-39',legacyApp='legacy-application-39';
 await store.saveApplicationSnapshot({snapshotId:legacyId,applicationId:legacyApp,resumeSlug:'runner-fixture',document:original});
 const ledger0=await store.getApplications();
 const legacy={id:legacyApp,company:'合成兼容学校',role:'物理教师',resumeSlug:'runner-fixture',status:'applied',snapshotId:legacyId+'.json',exportedFilePath:'',atsScore:null};
 const manual={id:'manual-app-39',company:'合成手工记录',role:'物理教师',resumeSlug:'runner-fixture',status:'wishlist',snapshotId:'',exportedFilePath:'',atsScore:null};
 await store.saveApplications({...ledger0,applications:[...ledger0.applications,legacy,manual]},ledger0.revision);
 const archive=id=>path.join(store.appSnapshotsDir,id+'.json');
 const badFile=archive(bad.entry.snapshotId),badOriginal=fs.readFileSync(badFile,'utf8'),badRecord=JSON.parse(badOriginal);
 fs.writeFileSync(badFile,JSON.stringify({...badRecord,meta:{...badRecord.meta,applicationId:'foreign-application-39'}}));
 fs.rmSync(archive(missing.entry.snapshotId));
 const currentFile=store.resolveResumePath('runner-fixture').filePath,otherFile=store.resolveResumePath('other-compare').filePath,masterFile=store.resolveResumePath('master').filePath;
 const files=[currentFile,otherFile,masterFile,store.applicationsPath];
 const inventory=()=>{const fsnap=fs.readdirSync(store.appSnapshotsDir).filter(n=>n.endsWith('.json')).map(n=>path.join(store.appSnapshotsDir,n));const all=[...files,...fsnap].sort();return Object.fromEntries(all.map(f=>[path.relative(root,f),sha(f)]));};
 let before=inventory(),resumesBefore=fs.readdirSync(store.resumesDir).sort();
 const unchanged=()=>{assert(JSON.stringify(inventory())===JSON.stringify(before),'review changed document, ledger or permanent archive bytes');assert(JSON.stringify(fs.readdirSync(store.resumesDir).sort())===JSON.stringify(resumesBefore),'review created or removed editable versions');};
 let linkedReads=0,holdNext=false,heldRelease=null;const rawRead=store.getLinkedApplicationSnapshot.bind(store);store.getLinkedApplicationSnapshot=async input=>{linkedReads++;const record=await rawRead(input);if(holdNext){holdNext=false;await new Promise(resolve=>{heldRelease=resolve});heldRelease=null;}return record};
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);t16=await t16install(win,out,'review');
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const active=()=>js(()=>document.querySelector('select[aria-label="快速切换简历版本"]')?.value||'');
 const click=async label=>{await t16.probe(label);return assert(await js(label=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()===label);if(!b||b.disabled)return false;b.click();return true;},label),'button missing '+label);};
 const reviewSelector='[role="dialog"][aria-label="永久投递快照只读复盘"]';
 const modal=()=>js(sel=>!!document.querySelector(sel),reviewSelector);
 const text=()=>js(sel=>document.querySelector(sel)?.textContent??'',reviewSelector);
 const has=async s=>(await text()).includes(s);
 const rowAction=async(company,action)=>assert(await js((company,action)=>{
   const b=document.querySelector('button[aria-label="只读复盘 '+company+'"]');
   const target=action==='review'?b:[...b?.parentElement?.querySelectorAll('button')??[]].find(x=>x.innerText.trim()==='克隆回工作台');
   if(!target||target.disabled)return false;target.scrollIntoView({block:'center'});target.click();return true;
 },company,action),'row action unavailable '+company+' '+action);
 const select=async(label,value)=>assert(await js((label,value)=>{const el=document.querySelector('select[aria-label="'+label+'"]');if(!el||![...el.options].some(o=>o.value===value))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));return true;},label,value),'missing selection '+value);
 const open=async company=>{await rowAction(company,'review');await until('review modal',modal);};
 const read=async()=>{await click('读取并对比');await until('review read done',()=>js(sel=>[...document.querySelectorAll(sel+' button')].some(b=>b.innerText.trim()==='读取并对比'&&!b.disabled),reviewSelector));};
 const close=async()=>{await click('关闭对照');await until('review closed',async()=>!await modal());};
 const capture=async name=>{await t16.scan(name);await js(()=>document.fonts.ready.then(()=>true));await sleep(250);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG());};
 const reveal=async()=>assert(await js(sel=>{const label=[...document.querySelectorAll(sel+' label')].find(l=>l.textContent.includes('显示隐藏原值'));const input=label?.querySelector('input');if(!input)return false;input.click();return true;},reviewSelector),'hidden opt-in unavailable');
 await until('initial editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 if(await active()!=='runner-fixture'){await select('快速切换简历版本','runner-fixture');await until('active baseline',async()=>await active()==='runner-fixture'&&await js(()=>document.querySelector('#basic-field-name')?.value==='合成候选甲'));}
 await click('求职面试');
 await until('ledger loaded',()=>js(()=>!!document.querySelector('button[aria-label="只读复盘 合成已投学校"]:not([disabled])')));
 before=inventory();resumesBefore=fs.readdirSync(store.resumesDir).sort();
 assert(!await js(()=>!!document.querySelector('button[aria-label="只读复盘 合成手工记录"]')),'manual unsealed row has review action');
 assert(await js(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='关联 PDF'&&b.title.includes('未核验'))),'PDF path falsely labeled verified');
 await capture('01-career-review-entry');await require('./validation-theme-t08-matrix.cjs')(win,out,'career-main','tracker',()=>inventory());
 const readsBefore=linkedReads;await open('合成已投学校');assert(linkedReads===readsBefore,'opened modal automatically read archive');
 await read();await until('sealed vs current',()=>has('current@example.invalid'));
 let content=await text();
 assert(content.includes('sealed@example.invalid')&&content.includes('左 · 冻结基准（永久投递原稿）')&&content.includes('右 · 冻结对照（内存稿）')&&content.includes('封存时间'),'review direction or source labels wrong');
 assert(content.includes('对照新增 1')&&content.includes('PDF 路径，但本次不读取或核验 PDF 字节')&&content.includes('不是已发送/送达证明'),'difference summary or PDF limitation missing');
 assert(!/HIDDEN_(SEALED|CURRENT)_PHONE_39/.test(content),'hidden archive values leaked');
 assert(await active()==='runner-fixture','review switched version');unchanged();
 checks.sealedToCurrentReadOnly=true;checks.manualRowAndPdfPathHonesty=true;await capture('02-sealed-to-current');
 assert(await js(sel=>{const l=document.querySelector(sel+' [data-compare-side="before"]'),r=document.querySelector(sel+' [data-compare-side="after"]');return l?.textContent.includes('封存合成原稿')&&r?.textContent.includes('当前合成稿')},reviewSelector),'left right content direction wrong');
 await reveal();await until('explicit hidden reveal',()=>has('HIDDEN_SEALED_PHONE_39'));await capture('03-hidden-reveal');await reveal();assert(!await has('HIDDEN_SEALED_PHONE_39'),'re-mask failed');
 checks.hiddenValuesExplicit=true;
 await click('样式');await until('style filter',()=>has('teacher-table-classic'));assert(await has('#2468ac')&&!await has('current@example.invalid'),'style filter failure');
 await capture('04-style-only');checks.styleFilter=true;
 await select('对照来源','disk:other-compare');await read();await until('different disk compare',()=>has('other@example.invalid'));
 assert(await has('对照稿不是台账原关联版本')&&await has('右 · 冻结对照（磁盘版本）'),'unrelated document warning absent');
 assert(await active()==='runner-fixture','disk comparison switched version');unchanged();await capture('05-other-disk-review');checks.explicitOtherDisk=true;
 await select('对照来源','disk:master');await read();await until('master compare',()=>has('MASTER_SKILL_39'));unchanged();checks.masterComparison=true;
 await close();await open('合成已移除学校');assert(await has('关联版本不在当前可用列表'),'missing linked version warning absent');
 await read();await until('gone archive compare',()=>has('gone-archive@example.invalid'));assert(await has('GONE_SKILL_39'),'archive missing after original deletion');unchanged();
 assert(!fs.existsSync(store.resolveResumePath('gone-version').filePath),'review restored deleted version');await capture('06-gone-version-review');checks.deletedOriginalStillReviewable=true;
 await close();await open('合成兼容学校');await read();await until('legacy suffix',()=>has('sealed@example.invalid'));unchanged();checks.persistedLegacyAliasReview=true;await close();
 await open('合成异常学校');await read();await until('mismatched identity',()=>has('永久快照与台账身份'));
 assert(!await has('FOREIGN_ARCHIVE_PRIVATE_39'),'foreign archive content exposed');await capture('07-mismatched-archive-refusal');unchanged();checks.mismatchedArchiveFailsClosed=true;await close();
 await rowAction('合成异常学校','clone');await until('invalid clone refusal',()=>js(()=>document.body.innerText.includes('永久快照与台账身份')));
 unchanged();checks.invalidCloneRefused=true;
 await open('合成缺失学校');await read();await until('missing archive refusal',()=>has('未找到永久投递快照'));
 await capture('08-missing-archive-refusal');unchanged();checks.missingArchiveFailsClosed=true;await close();
 await open('合成已投学校');await read();await until('valid review before ledger update',()=>has('sealed@example.invalid'));
 // External persisted change is deliberate fixture intervention, not a review mutation.
 const ledger=await store.getApplications();await store.saveApplications({...ledger,applications:ledger.applications.map(a=>a.id===good.entry.id?{...a,status:'interview'}:a)},ledger.revision);
 before=inventory();await read();await until('stale ledger refusal',()=>has('磁盘投递台账已变化'));
 assert(!await has('sealed@example.invalid'),'stale successful result retained');unchanged();await capture('09-stale-ledger-refusal');checks.staleRevisionClearsResult=true;await close();
 await rowAction('合成已投学校','clone');await until('stale clone refusal',()=>js(()=>document.body.innerText.includes('磁盘投递台账已变化')));
 unchanged();checks.staleCloneRefused=true;
 await click('刷新磁盘台账');await until('fresh ledger loaded',()=>js(()=>document.querySelector('select[aria-label="合成已投学校 状态"]')?.value==='interview'));
 await open('合成已投学校');await read();await until('fresh review',()=>has('sealed@example.invalid'));unchanged();checks.explicitLedgerRefresh=true;
 const alias=await js(async({id,snapshotId,rev})=>{try{await window.resumeDesktop.applications.getLinkedSnapshot({applicationId:id,snapshotId:snapshotId+'.json',ledgerRevision:rev});return false}catch{return true}}, {id:good.entry.id,snapshotId:good.entry.snapshotId,rev:(await store.getApplications()).revision});
 assert(alias,'caller-created alias accepted by IPC');checks.ipcCallerAliasRejected=true;
 const debug=win.webContents.debugger;
 try{debug.attach('1.3');await debug.sendCommand('Emulation.setDeviceMetricsOverride',{width:650,height:800,deviceScaleFactor:1,mobile:false});await until('narrow viewport',()=>js(()=>innerWidth===650));
   assert(await js(sel=>{const d=document.querySelector(sel),s=d?.querySelector('[data-version-compare-scroll]');return !!s&&s.clientHeight>100&&d.scrollWidth<=innerWidth+2},reviewSelector),'narrow comparison clipped');
   await capture('10-narrow-review');checks.narrowReview=true;
 }finally{if(debug.isAttached()){await debug.sendCommand('Emulation.clearDeviceMetricsOverride').catch(()=>{});debug.detach();}}
 await until('wide viewport',()=>js(()=>innerWidth>=768));
 // Redaction must discard raw comparison and gate both reading/clone and PDF.
 assert(await js(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='隐私脱敏');if(!b)return false;b.click();return true}),'redaction control missing');
 await until('redaction closes review',async()=>!await modal());
 assert(await js(()=>document.querySelector('button[aria-label="只读复盘 合成已投学校"]')?.disabled&&[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='克隆回工作台'||b.innerText.trim()==='关联 PDF').every(b=>b.disabled)),'redaction left raw actions enabled');
 await capture('11-redaction-gate');checks.redactionBlocksAndCloses=true;unchanged();
 await click('脱敏模式中');await until('raw review re-enabled',()=>js(()=>!!document.querySelector('button[aria-label="只读复盘 合成已投学校"]:not([disabled])')));
 // Deliberately hold a completed trusted read response, so explicit cancellation and
 // leaving the tracker can be tested without changing production read logic.
 holdNext=true;await rowAction('合成已投学校','clone');await until('held linked read',()=>heldRelease!==null);
 await until('cancel control',()=>js(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='取消读取快照'&&!b.disabled)));
 await capture('12-clone-read-cancel');await click('取消读取快照');
 await until('cancelled clone feedback',()=>js(()=>document.body.innerText.includes('已取消读取永久快照')));
 const releaseA=heldRelease;releaseA();await until('held response settled',()=>heldRelease===null);
 unchanged();assert(await active()==='runner-fixture','cancelled read switched version');checks.explicitCloneReadCancellation=true;
 holdNext=true;await rowAction('合成已投学校','clone');await until('second held read',()=>heldRelease!==null);
 await click('自荐信 / 话术');await until('context change cancels read',()=>js(()=>document.body.innerText.includes('已取消读取永久快照')));
 const releaseB=heldRelease;releaseB();await until('second held response settled',()=>heldRelease===null);
 unchanged();assert(await active()==='runner-fixture','late read created version after context change');
 assert(await js(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('投递追踪 ('));if(!b)return false;b.click();return true}),'tracker return missing');
 await until('tracker restored',()=>js(()=>!!document.querySelector('button[aria-label="只读复盘 合成已投学校"]:not([disabled])')));
 checks.cloneReadContextChangeCancellation=true;
 // Only an explicit valid clone action may create a new independently identified version.
 await rowAction('合成已移除学校','clone');let createdSlug,created;
 await until('valid clone created',async()=>{createdSlug=await active();if(!createdSlug||createdSlug==='runner-fixture'||createdSlug==='master'||createdSlug==='gone-version')return false;const f=store.resolveResumePath(createdSlug).filePath;if(!fs.existsSync(f))return false;created=JSON.parse(fs.readFileSync(f,'utf8'));return created.basic.email==='gone-archive@example.invalid';});
 assert(created.id!==goneDoc.id&&created.title==='合成已移除学校-物理教师-复盘版'&&created.skillContent==='GONE_SKILL_39','clone identity, title or archived content mismatch');
 assert(fs.readdirSync(store.resumesDir).filter(n=>n.endsWith('.json')).length===resumesBefore.filter(n=>n.endsWith('.json')).length+1,'clone created unexpected number of copies');
 assert(JSON.stringify(inventory())===JSON.stringify(before),'explicit clone mutated original ledger or archive');
 assert(!fs.existsSync(store.resolveResumePath('gone-version').filePath),'clone restored deleted slug instead of independent copy');
 checks.validCloneIndependentCopy=true;checks.allOriginalHashesPreserved=true;await capture('13-cloned-independent-copy');
 fs.writeFileSync(path.join(out,'application-review-native.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,sourceSha:manifest.sourceSha,platform:process.platform,checks,linkedReads,originalHashes:before,created:{slug:createdSlug,id:created.id,title:created.title}},null,2));
}
app.whenReady().then(run).then(async()=>{await t16.finish();clearTimeout(watchdog);app.exit(0)}).catch(error=>{clearTimeout(watchdog);console.error(error);fs.writeFileSync(path.join(out,'application-review-failure.json'),JSON.stringify({checks,error:String(error)},null,2));app.exit(1)});
