let t16;
const t16install=require('./validation-theme-t16-probe.cjs');
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out)throw Error('isolated paths required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
const userData=path.join(root,'userData');fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData);app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),manifest=require('./runner-manifest.json');
const checks={};const matrix=require('./validation-theme-t06-dialog-matrix.cjs');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>{console.error('comparison native watchdog expired');app.exit(2);},180000);
async function until(label,fn,limit=15000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('timed out: '+label);}
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function inventory(files,dir){
 const entries=fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()).map(x=>path.join(dir,x.name));
 return Object.fromEntries([...files,...entries].sort().map(f=>[path.relative(root,f),sha(fs.readFileSync(f))]));
}
async function run(){
 const store=main.store;
 const relative=path.relative(path.resolve(root),path.resolve(store.resumesDir));assert(!relative.startsWith('..')&&!path.isAbsolute(relative),'store escaped isolated root');
 const historical=await store.saveResume('runner-fixture',{
   ...fixture,id:'synthetic-compare-38',title:'基准合成版本',
   basic:{...fixture.basic,name:'合成候选甲',email:'history@example.invalid',phone:'HIDDEN_PHONE_HISTORY_38',fieldOrder:[
    {id:'f-name',key:'name',label:'姓名',visible:true},{id:'f-title',key:'title',label:'意向岗位',visible:true},{id:'f-email',key:'email',label:'邮箱',visible:true},{id:'f-phone',key:'phone',label:'电话',visible:false}
   ],customFields:[{id:'field-private',label:'私有字段',value:'HIDDEN_CUSTOM_HISTORY_38',visible:false}]},
   education:[{id:'edu-a',school:'甲示例学院',description:'HISTORY_COURSE_38'},{id:'edu-b',school:'乙示例学院',description:'B_COURSE_38'}],
   menuSections:[...fixture.menuSections.map(s=>s.id==='selfEvaluation'?{...s,enabled:false}:s),{id:'private-section',title:'HIDDEN_LABEL_HISTORY_38',enabled:false,order:6}],
   customData:{'private-section':[{id:'private-item',title:'HIDDEN_TITLE_HISTORY_38',description:'HIDDEN_BODY_HISTORY_38'}]},
   skillContent:'HISTORY_SKILL_38',selfEvaluationContent:'HIDDEN_EVAL_HISTORY_38'
 });
 const snap=await store.createSnapshot('runner-fixture','合成历史基准');
 const current=await store.saveResume('runner-fixture',{...historical,title:'当前合成版本',basic:{...historical.basic,email:'baseline@example.invalid',phone:'HIDDEN_PHONE_BASE_38',customFields:[{...historical.basic.customFields[0],value:'HIDDEN_CUSTOM_BASE_38'}]},education:[{...historical.education[0],description:'BASE_COURSE_38'},historical.education[1]],skillContent:'BASE_SKILL_38',selfEvaluationContent:'HIDDEN_EVAL_BASE_38',customData:{'private-section':[{...historical.customData['private-section'][0],title:'HIDDEN_TITLE_BASE_38',description:'HIDDEN_BODY_BASE_38'}]}});
 const target=await store.saveResume('target-compare',{
   ...current,id:'synthetic-target-38',title:'对照合成版本',templateId:'teacher-table-classic',
   basic:{...current.basic,email:'target@example.invalid',phone:'HIDDEN_PHONE_TARGET_38',photo:'data:image/png;base64,NEVER_SHOW_PHOTO_BYTES_38',photoConfig:{...current.basic.photoConfig,visible:false},customFields:[{...current.basic.customFields[0],value:'HIDDEN_CUSTOM_TARGET_38'}]},
   menuSections:current.menuSections.map(s=>s.id==='skills'?{...s,pageBreakBefore:true}:s.id==='private-section'?{...s,title:'HIDDEN_LABEL_TARGET_38'}:s),
   education:[{...current.education[1],description:'B_COURSE_CHANGED_38'},{...current.education[0],description:'TARGET_COURSE_38'},{...current.education[0],id:'edu-c',school:'丙示例学院',description:'NEW_COURSE_38'}],
   experience:[],
   projects:[...current.projects,{...current.projects[0],name:'重复ID项目'},...Array.from({length:30},(_,i)=>({id:'added-'+i,name:'新增合成项目 '+i,description:'ADDED_PROJECT_38_'+i,link:i===29?'https://example.invalid/DO_NOT_FETCH_COMPARE_38':''}))],
   skillContent:'TARGET_SKILL_38',selfEvaluationContent:'HIDDEN_EVAL_TARGET_38',
   customData:{'private-section':[{...current.customData['private-section'][0],title:'HIDDEN_TITLE_TARGET_38',description:'HIDDEN_BODY_TARGET_38'}]},
   globalSettings:{...current.globalSettings,themeColor:'#2468ac',baseFontSize:16}
 });
 const master=await store.saveResume('master',{...current,id:'synthetic-master-38',title:'合成母库',skillContent:'MASTER_ONLY_SKILL_38'});
 const currentFile=store.resolveResumePath('runner-fixture').filePath,targetFile=store.resolveResumePath('target-compare').filePath,masterFile=store.resolveResumePath('master').filePath,dir=path.join(store.backupsDir,'runner-fixture');
 const snapFile=path.join(dir,snap.id+'.json'),foreignFile=path.join(dir,'foreign-doc.json');
 fs.writeFileSync(foreignFile,JSON.stringify({meta:{...snap,id:'foreign-doc',reason:'合成异身份记录'},document:{...historical,id:'another-doc',basic:{...historical.basic,name:'FOREIGN_PRIVATE_CONTENT_38'}}}));
 const files=[currentFile,targetFile,masterFile];
 let state=inventory(files,dir);const unchanged=()=>assert(JSON.stringify(inventory(files,dir))===JSON.stringify(state),'comparison unexpectedly changed a document or history file');
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);t16=await t16install(win,out,'version-comparison');
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const active=()=>js(()=>document.querySelector('select[aria-label="快速切换简历版本"]')?.value||'');
 const click=async label=>{await t16.probe(label);if(!await js(label=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===label);if(!b||b.disabled)return false;b.click();return true;},label))throw Error('button missing: '+label);};
 const modal=()=>js(()=>!!document.querySelector('[role="dialog"][aria-label="只读版本差异对照"]'));
 const dialogText=()=>js(()=>document.querySelector('[role="dialog"][aria-label="只读版本差异对照"]')?.textContent??'');
 const has=async text=>(await dialogText()).includes(text);
 const select=async(label,value)=>assert(await js((label,value)=>{const el=document.querySelector('select[aria-label="'+label+'"]');if(!el||![...el.options].some(o=>o.value===value))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));return true;},label,value),'select missing '+label+' '+value);
 const capture=async name=>{await t16.scan(name);await js(()=>document.fonts.ready.then(()=>true));await sleep(250);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty capture');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG());};
 const open=async()=>{await click('对比版本 / 历史快照');await until('compare modal',modal);};
 const close=async()=>{await click('关闭对照');await until('compare closed',async()=>!await modal());};
 const read=async()=>{await click('读取并对比');await until('read completed',()=>js(()=>[...document.querySelectorAll('[role="dialog"] button')].some(b=>b.innerText.trim()==='读取并对比'&&!b.disabled)));};
 const reveal=async()=>assert(await js(()=>{const el=[...document.querySelectorAll('[role="dialog"] label')].find(l=>l.textContent.includes('显示隐藏原值'));const input=el?.querySelector('input');if(!input)return false;input.click();return true;}),'hidden opt-in missing');
 let externalAttempts=0;
 win.webContents.session.webRequest.onBeforeRequest({urls:['https://example.invalid/*']},(_details,cb)=>{externalAttempts++;cb({cancel:true});});
 await until('initial editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 if(await active()!=='runner-fixture'){await select('快速切换简历版本','runner-fixture');await until('active baseline',async()=>await active()==='runner-fixture'&&await js(()=>document.querySelector('#basic-field-name')?.value==='合成候选甲'));}
 state=inventory(files,dir);
 await click('版本母库');await until('comparison entry',()=>js(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='对比版本 / 历史快照'&&!b.disabled)));
 await open();assert(await has('只比较存储字段和结构'),'no read prompt');await read();
 await until('unchanged result',()=>has('所比较的存储内容、结构和样式字段没有差异'));
 unchanged();assert(await active()==='runner-fixture','comparison switched active slug');
 checks.exactSameDiskNoDiff=true;await capture('01-unchanged-current-disk');
 await select('对照来源','disk:target-compare');await read();await until('target comparison',()=>has('target@example.invalid'));
 let text=await dialogText();
 assert(text.includes('baseline@example.invalid')&&text.includes('target@example.invalid')&&text.includes('身份歧义 3')&&text.includes('对照移除 1'),'structured difference summary wrong');
 assert(!/HIDDEN_(PHONE|CUSTOM|EVAL|TITLE|BODY|LABEL)_(BASE|TARGET)_38|NEVER_SHOW_PHOTO_BYTES_38/.test(text),'hidden or asset bytes leaked before explicit opt-in');
 assert(text.includes('引用发生变化，未读取资产'),'asset reference change omitted');
 unchanged();checks.savedVersionStructuredDiffAndDefaultMask=true;await capture('02-saved-version-diff');
 await matrix(win,out,'version-compare-dialog','compare-masked');unchanged();checks.themeCompareMasked=true;
 await reveal();await until('explicit hidden value',()=>has('HIDDEN_PHONE_TARGET_38'));
 assert(!(await dialogText()).includes('NEVER_SHOW_PHOTO_BYTES_38'),'asset bytes exposed after hidden opt-in');
 await matrix(win,out,'version-compare-dialog','compare-revealed');unchanged();checks.themeCompareRevealed=true;
 await capture('03-explicit-hidden-value');await reveal();assert(!(await dialogText()).includes('HIDDEN_PHONE_TARGET_38'),'hidden remask failed');
 checks.explicitHiddenToggleAndAssetMask=true;
 await click('样式');await until('style filter',()=>has('teacher-table-classic'));
 assert(!(await dialogText()).includes('target@example.invalid')&&(await dialogText()).includes('#2468ac'),'style category includes content or misses changes');
 await capture('04-style-diff');checks.styleFilter=true;
 await click('结构');await until('structure filter',()=>has('栏目前分页'));assert(!(await dialogText()).includes('target@example.invalid'),'structure category includes content');
 await capture('05-structure-diff');checks.structureFilter=true;
 await click('全部');await select('差异类型','added');
 await until('added page',()=>has('1/2 页'));await click('下一页');await until('second page',()=>has('2/2 页'));
 assert((await dialogText()).includes('ADDED_PROJECT_38_29'),'last added record absent from second page');
 assert((await dialogText()).includes('https://example.invalid/DO_NOT_FETCH_COMPARE_38'),'literal link text absent');
 assert(!await js(()=>!!document.querySelector('[role="dialog"] a[href*="example.invalid"]')),'comparison made URL executable link');
 await capture('06-added-pagination');checks.paginationAndLiteralLinks=true;
 await select('差异类型','ambiguous');await until('ambiguity filter',()=>has('身份歧义'));assert(await js(()=>document.querySelectorAll('[data-comparison-row="ambiguous"]').length===3),'ambiguity rows paired or missing');
 await capture('07-ambiguous-identities');checks.ambiguousRowsSeparate=true;
 await select('对照来源','disk:master');await read();await until('master comparison',()=>has('MASTER_ONLY_SKILL_38'));assert(await active()==='runner-fixture','master comparison switched active');
 checks.masterComparison=true;unchanged();
 await select('对照来源','snapshot:'+snap.id);await read();await until('snapshot comparison',()=>has('history@example.invalid'));
 text=await dialogText();assert(text.includes('HISTORY_SKILL_38')&&text.includes('快照创建时间')&&!text.includes('HIDDEN_PHONE_HISTORY_38'),'snapshot comparison incorrect');
 await capture('08-history-read-only');checks.historyComparisonWithoutRestore=true;unchanged();
 await select('对照来源','snapshot:foreign-doc');await read();await until('foreign identity refusal',()=>has('属于另一份简历'));
 assert(!(await dialogText()).includes('FOREIGN_PRIVATE_CONTENT_38'),'foreign snapshot leaked');
 await capture('09-foreign-snapshot-refusal');checks.foreignSnapshotRefused=true;unchanged();
 const stale=await js(async id=>{try{await window.resumeDesktop.snapshots.getForComparison('runner-fixture',id+'.json');return false;}catch{return true;}},snap.id);
 assert(stale,'IPC accepted filename alias');checks.ipcAliasRejected=true;
 // External disk change deliberately introduced by the test, not by comparison.
 await store.saveResume('runner-fixture',{...current,title:'外部磁盘更新',basic:{...current.basic,email:'external-disk@example.invalid'}});
 state=inventory(files,dir);
 await select('对照来源','disk:runner-fixture');await read();await until('memory vs external disk',()=>has('external-disk@example.invalid'));
 assert((await dialogText()).includes('baseline@example.invalid')&&(await dialogText()).includes('外部磁盘更新'),'compare silently flushed current memory');
 unchanged();checks.memoryVsDiskNoFlush=true;await capture('10-memory-versus-disk');
 // Verify global keyboard shortcuts do not trigger saves or command palette from dialog.
 const keys=await js(()=>{const d=document.querySelector('[role="dialog"][aria-label="只读版本差异对照"]'),el=d?.querySelector('select');if(!el)return false;const a=new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}),b=new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true});el.dispatchEvent(a);el.dispatchEvent(b);return a.defaultPrevented&&b.defaultPrevented;});
 assert(keys,'modal did not prevent global keyboard commands');unchanged();checks.shortcutIsolation=true;
 const debug=win.webContents.debugger;
 try{
  debug.attach('1.3');await debug.sendCommand('Emulation.setDeviceMetricsOverride',{width:650,height:800,deviceScaleFactor:1,mobile:false});
  await until('narrow viewport',()=>js(()=>innerWidth===650));
  assert(await js(()=>{const d=document.querySelector('[role="dialog"][aria-label="只读版本差异对照"]'),s=d?.querySelector('[data-version-compare-scroll]');return !!s&&s.clientHeight>100&&d.scrollWidth<=innerWidth+2;}),'narrow comparison results clipped');
  await capture('11-narrow-viewport');checks.narrowComparison=true;
 }finally{if(debug.isAttached()){await debug.sendCommand('Emulation.clearDeviceMetricsOverride').catch(()=>{});debug.detach();}}
 await until('wide viewport restored',()=>js(()=>innerWidth>=768));
 // Closing or turning on the privacy redaction mode must discard raw comparison output.
 await close();
 // The row-specific comparison action must select the exact snapshot without triggering rollback.
 const directOpened=await js(()=>{const row=[...document.querySelectorAll('button[aria-label^="对比历史快照"]')].find(b=>b.parentElement?.textContent.includes('合成历史基准'));if(!row||row.disabled)return false;row.click();return true;});
 assert(directOpened,'direct historical comparison button missing');
 await until('direct snapshot comparison',modal);
 assert(await js(id=>document.querySelector('select[aria-label="对照来源"]')?.value==='snapshot:'+id,snap.id),'direct action selected wrong historical record');
 await read();await until('direct snapshot read',()=>has('history@example.invalid'));unchanged();checks.directSnapshotEntryReadOnly=true;await close();
 await click('隐私脱敏');
 await until('privacy comparison gate',()=>js(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='对比版本 / 历史快照'&&b.disabled)));
 assert(!await modal(),'comparison visible in redaction mode');await capture('12-redaction-disabled');checks.redactionBlocksRawComparison=true;
 await click('脱敏模式中');await open();await select('对照来源','disk:target-compare');await read();await until('comparison after reopening',()=>has('target@example.invalid'));
 assert(!(await dialogText()).includes('HIDDEN_PHONE_TARGET_38'),'hidden opt-in persisted after modal closed');
 // State transition while modal is open (programmatic click as test harness).
 assert(await js(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='隐私脱敏');if(!b)return false;b.click();return true;}),'redaction control missing');
 await until('modal removed when redaction activated',async()=>!await modal());
 checks.redactionClosesExistingModal=true;unchanged();
 assert(externalAttempts===0,'comparison attempted remote request');checks.noExternalLinkFetch=true;
 assert(await active()==='runner-fixture','active version changed');assert(fs.readFileSync(snapFile).length>0,'snapshot removed');
 checks.allDocumentAndSnapshotHashesUnchanged=true;
 await click('脱敏模式中');await click('从母库 (master.json) 挑选经历合并到当前版本');
 await until('master merge loaded',()=>js(()=>!!document.querySelector('[data-studio-region="master-merge-dialog"] button.w-full')));
 assert(await js(()=>{const root=document.querySelector('[data-studio-region="master-merge-dialog"]'),b=root.querySelector('button.w-full');if(!b||b.disabled)return false;b.click();return true}),'master selection absent');
 await until('selected one',()=>js(()=>document.querySelector('[data-studio-region="master-merge-dialog"]').innerText.includes('已选择 1 项')));
 await matrix(win,out,'master-merge-dialog','master-selected');unchanged();
 assert(await js(()=>{const e=document.querySelector('button[aria-label="关闭母库挑选弹窗"]');if(!e)return false;e.click();return true}),'merge close absent');
 await until('merge closed',()=>js(()=>!document.querySelector('[data-studio-region="master-merge-dialog"]')));
 unchanged();checks.themeMasterSelectionCancelNoWrite=true;
 fs.writeFileSync(path.join(out,'version-compare-native.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,sourceSha:manifest.sourceSha,platform:process.platform,checks,verifiedHashes:state,synthetic:{currentId:current.id,targetId:target.id,masterId:master.id}},null,2));
}
app.whenReady().then(run).then(async()=>{await t16.finish();clearTimeout(deadline);app.exit(0);}).catch(e=>{clearTimeout(deadline);console.error(e);fs.writeFileSync(path.join(out,'version-compare-failure.json'),JSON.stringify({checks,error:String(e)},null,2));app.exit(1);});
