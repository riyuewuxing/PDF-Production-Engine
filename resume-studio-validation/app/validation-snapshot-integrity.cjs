const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-snapshot-ui-'))throw Error('isolated snapshot workspace required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},observations={};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const watchdog=setTimeout(()=>{console.error('snapshot UI watchdog');app.exit(2)},100000);
const assert=(v,m)=>{if(!v)throw Error(m)};
const digest=b=>createHash('sha256').update(b).digest('hex');
async function until(label,fn,ms=18000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150)}throw Error('timeout '+label)}
const report=error=>fs.writeFileSync(path.join(out,'snapshot-ui-evidence.json'),JSON.stringify({privateBaseSha:'74a017a7760ed5c60fe77aa5877ee8a88d5cba3d',runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks,observations,...(error?{error:String(error)}:{})},null,2));
async function run(){
  const saved=await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-history-ui',title:'合成历史保护原稿',basic:{...fixture.basic,name:'合成当前候选人'}});
  await main.store.saveResume('master',{...fixture,id:'synthetic-history-master',title:'合成母库'});
  const alternate=await main.store.saveResume('alternate',{...fixture,id:'synthetic-history-alternate',title:'合成另一版本',basic:{...fixture.basic,name:'合成另一候选人'}});
  await main.store.createSnapshot('alternate','另一版本唯一历史',undefined,JSON.stringify([alternate.id,alternate.updatedAt]));
  const file=path.join(main.dataDir,'resumes','runner-fixture.json'),original=fs.readFileSync(file);
  const dir=path.join(main.dataDir,'.backups','runner-fixture');fs.mkdirSync(dir,{recursive:true});
  const make=(id,reason,createdAt,doc)=>({meta:{id,slug:'runner-fixture',reason,createdAt,title:doc.title,templateId:doc.templateId,charCount:100},document:doc});
  for(let i=0;i<15;i++){
    const id='history-'+String(i).padStart(2,'0'),reason=i===14?'合成最新有效历史':'合成历史 '+i;
    const historic={...saved,basic:{...saved.basic,name:i===14?'合成历史候选人':'合成旧候选人 '+i}};
    fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify(make(id,reason,new Date(Date.UTC(2020,0,i+1)).toISOString(),historic)));
  }
  const newest=path.join(dir,'history-14.json'),newestBytes=fs.readFileSync(newest);
  const alias=path.join(dir,'alias.json'),invalid=path.join(dir,'invalid.json');
  const aliasBytes=Buffer.from(JSON.stringify(make('history-14','合成错误别名','2000-01-01T00:00:00Z',{...saved,basic:{...saved.basic,name:'错误的别名内容'}})));
  const invalidBytes=Buffer.from(JSON.stringify({...make('invalid','合成坏快照','2099-01-01T00:00:00Z',saved),document:{}}));
  fs.writeFileSync(alias,aliasBytes);fs.writeFileSync(invalid,invalidBytes);
  const preserve=()=>{assert(fs.readFileSync(alias).equals(aliasBytes),'bad alias altered');assert(fs.readFileSync(invalid).equals(invalidBytes),'invalid record altered');assert(fs.readFileSync(newest).equals(newestBytes),'newest original deleted or altered')};
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=code=>win.webContents.executeJavaScript(code),has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const click=async label=>assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(label)+');if(!b||b.disabled)return false;b.scrollIntoView({block:"center"});b.click();return true})()'),'button unavailable '+label);
  const capture=async name=>{await js('document.fonts.ready.then(()=>true)');await sleep(350);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
  const switchTo=async slug=>{
    const ok=await js('(()=>{const e=document.querySelector("select[aria-label=\\"快速切换简历版本\\"]");if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,'+JSON.stringify(slug)+');e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
    assert(ok,'version selector absent');
    await until('selected '+slug,()=>js('document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")?.value==='+JSON.stringify(slug)));
  };
  await until('any initial editor',()=>js('!!document.querySelector("#basic-field-name")'));
  if(await js('document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")?.value')!=='runner-fixture')await switchTo('runner-fixture');
  await until('normal editor',()=>js('document.querySelector("#basic-field-name")?.value==="合成当前候选人"'));
  await click('版本母库');await until('history list',()=>has('历史快照回滚 (15/15)'));
  await until('verified newest visible',()=>has('合成最新有效历史'));
  await until('two retained anomalies visible',()=>has('有 2 份异常快照'));
  const inventory=await js('window.resumeDesktop.snapshots.inventory("runner-fixture")');
  assert(inventory.unreadableCount===2&&inventory.items.length===15,'inventory mismatch');
  assert(!await has('合成错误别名')&&!await has('合成坏快照'),'invalid snapshots exposed as valid');
  checks.realHistoryListExcludesInvalidRecords=true;
  await click('手动创建快照');await until('manual snapshot confirmed',()=>has('已创建本地时间机器快照'));
  const list=await main.store.listSnapshots('runner-fixture');
  assert(list.length===15&&list.some(x=>x.id==='history-14')&&list.some(x=>x.reason==='手动创建快照'),'newest or new record lost');
  assert(!fs.existsSync(path.join(dir,'history-00.json'))&&fs.existsSync(path.join(dir,'history-01.json')),'wrong valid retention target');
  assert(fs.readFileSync(file).equals(original),'manual snapshot changed source');
  preserve();checks.manualCreationRetainsNewestAndOriginals=true;
  await until('anomaly notice retained after creation',()=>has('有 2 份异常快照'));
  await js('(()=>{const e=[...document.querySelectorAll("button")].find(b=>b.innerText.includes("历史快照回滚"));e?.scrollIntoView({block:"start"});return true})()');
  await capture('01-history-valid-retention');
  const revision=JSON.stringify([saved.id,saved.updatedAt]);
  const before=fs.readdirSync(dir).sort();
  const rejected=await js('window.resumeDesktop.snapshots.restore("runner-fixture","alias",'+JSON.stringify(revision)+').then(()=>false,e=>String(e).includes("标识不一致"))');
  assert(rejected,'direct IPC accepted wrong embedded ID');
  assert(JSON.stringify(fs.readdirSync(dir).sort())===JSON.stringify(before)&&fs.readFileSync(file).equals(original),'refused rollback changed disk');
  preserve();checks.invalidDirectIpcRollbackRefusedWithoutSideEffects=true;
  // Exercise real rollback UI and explicit confirmation, not a mocked store.
  await js('(()=>{window.confirm=()=>true;return true})()');
  const clicked=await js('(()=>{const e=[...document.querySelectorAll("span")].find(x=>x.innerText==="合成最新有效历史");const row=e?.parentElement?.parentElement?.parentElement;const b=row?.querySelector("button");if(!b||b.disabled||!b.innerText.includes("回滚"))return false;b.scrollIntoView({block:"center"});b.click();return true})()');
  assert(clicked,'valid history rollback button unavailable');
  await until('actual rollback written',async()=>(await main.store.getResume('runner-fixture')).basic.name==='合成历史候选人');
  await until('UI rollback result',()=>has('已回滚至选定历史快照'));
  const after=await main.store.listSnapshots('runner-fixture');
  const backup=after.find(x=>x.reason==='回滚前自动备份');assert(backup,'pre-rollback snapshot missing');
  const rec=JSON.parse(fs.readFileSync(path.join(dir,backup.id+'.json'),'utf8'));
  assert(rec.document.basic.name==='合成当前候选人'&&rec.document.id===saved.id,'rollback backup does not contain former current document');
  assert(after.length===15,'valid retention cap not maintained');preserve();checks.realRollbackRetainsVerifiedPreRollbackBackup=true;
  await js('(()=>{const e=[...document.querySelectorAll("button")].find(b=>b.innerText.includes("历史快照回滚"));e?.scrollIntoView({block:"start"});return true})()');
  await until('anomaly notice retained after rollback',()=>has('有 2 份异常快照'));
  await capture('02-history-rollback-preserved');
  checks.inventoryNoticePersistsThroughManualCreationAndRollback=true;
  // Exercise an actual late IPC result while switching to another document.
  const originalInventory=main.store.listSnapshotInventory.bind(main.store);let started=false,release;
  const gate=new Promise(r=>release=r);
  main.store.listSnapshotInventory=async slug=>{if(slug==='runner-fixture'&&!started){started=true;await gate;}return originalInventory(slug);};
  try{
    await click('内容编辑');await click('版本母库');await until('delayed inventory entered',()=>started);
    await switchTo('alternate');
    await until('alternate history',()=>has('另一版本唯一历史'));
    assert(await has('历史快照回滚 (1/15)')&&!await has('有 2 份异常快照'),'old inventory visible before response');
    release();await sleep(400);
    assert(await has('另一版本唯一历史')&&await has('历史快照回滚 (1/15)')&&!await has('有 2 份异常快照'),'late inventory replaced another version');
    checks.lateInventoryCannotReplaceSwitchedVersion=true;
    await js('(()=>{const e=[...document.querySelectorAll("button")].find(b=>b.innerText.includes("历史快照回滚"));e?.scrollIntoView({block:"start"});return true})()');
    await capture('03-other-version-history-isolated');
  }finally{release();main.store.listSnapshotInventory=originalInventory;}
  await switchTo('runner-fixture');await until('first version warning restored',()=>has('有 2 份异常快照'));
  // A redirected directory is not an empty history. Keep originals outside the
  // junction temporarily, then restore them; the external target stays intact.
  const held=dir+'.held',outside=path.join(root,'external-snapshot-sentinel');
  fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'PRESERVE');
  fs.renameSync(dir,held);fs.symlinkSync(outside,dir,'junction');
  try{
    win.webContents.reload();await until('any editor after redirect',()=>js('!!document.querySelector("#basic-field-name")'));
    if(await js('document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")?.value')!=='runner-fixture')await switchTo('runner-fixture');
    await until('editor loaded after redirect',()=>js('document.querySelector("#basic-field-name")?.value==="合成历史候选人"'));
    await click('版本母库');await until('explicit history inspection error',()=>has('历史快照检查失败'));
    assert(await has('历史快照目录不安全')&&!await has('暂无磁盘快照'),'failed directory appeared as empty');
    await js('(()=>{const e=[...document.querySelectorAll("button")].find(b=>b.innerText.includes("历史快照回滚"));e?.scrollIntoView({block:"start"});return true})()');
    await capture('04-unsafe-history-directory-error');
    const originalCreate=main.store.createSnapshot.bind(main.store);let completed=false,refused=false;
    main.store.createSnapshot=async(...args)=>{try{return await originalCreate(...args);}catch(e){refused=e.code==='SNAPSHOT_UNSAFE';throw e;}finally{completed=true;}};
    try{await click('手动创建快照');await until('actual unsafe creation returned',()=>completed);assert(refused,'unsafe creation did not fail with domain error');}
    finally{main.store.createSnapshot=originalCreate;}
    assert(JSON.stringify(fs.readdirSync(outside))===JSON.stringify(['keep.txt'])&&fs.readFileSync(path.join(outside,'keep.txt'),'utf8')==='PRESERVE','redirected directory modified');
    checks.unsafeDirectoryIsVisibleAndNeverWritten=true;
  }finally{
    // On Windows a junction is a directory reparse point. Remove only the
    // junction, non-recursively, and verify the actual external sentinel.
    assert(fs.lstatSync(dir).isSymbolicLink(),'expected synthetic junction');
    fs.rmdirSync(dir);
    assert(fs.readFileSync(path.join(outside,'keep.txt'),'utf8')==='PRESERVE','junction cleanup changed external data');
    fs.renameSync(held,dir);
  }
  preserve();
  observations.invalidRecordHashes={alias:digest(aliasBytes),invalid:digest(invalidBytes)};observations.newestSha256=digest(newestBytes);observations.validCount=after.length;observations.allFiles=fs.readdirSync(dir).length;
  report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
