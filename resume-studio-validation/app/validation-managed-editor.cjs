const {app,nativeImage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-contained-editor-'))throw Error('isolated editor fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},observations={};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const watchdog=setTimeout(()=>{console.error('managed editor watchdog');app.exit(2)},105000);
const assert=(v,m)=>{if(!v)throw Error(m)};
const hash=b=>createHash('sha256').update(b).digest('hex');
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150)}throw Error('timeout '+label)}
const report=error=>fs.writeFileSync(path.join(out,'managed-editor-evidence.json'),JSON.stringify({privateBaseSha:'78d2264811a14a6ff8522235b422ccbffcec2126',runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks,observations,...(error?{error:String(error)}:{})},null,2));
async function run(){
  const sentinelDir=path.join(root,'outside-synthetic-data');fs.mkdirSync(sentinelDir);
  const pixels=Buffer.alloc(96*96*4);for(let y=0;y<96;y++)for(let x=0;x<96;x++){
    const i=(y*96+x)*4;pixels[i]=y<48?230:45;pixels[i+1]=x<48?185:90;pixels[i+2]=x<48?50:215;pixels[i+3]=255;
  }
  const png=nativeImage.createFromBitmap(pixels,{width:96,height:96}).toPNG();assert(png.length>100,'invalid synthetic avatar');
  const asset=await main.store.saveAsset({filename:'synthetic-contained.png',dataUrl:'data:image/png;base64,'+png.toString('base64')});
  const original=await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-contained-resume',title:'合成隔离验证简历',basic:{...fixture.basic,name:'合成正常候选人',photo:asset.url}});
  await main.store.saveResume('master',{...fixture,id:'synthetic-contained-master',title:'合成母库'});
  // Two regular hard links expose a mismatch between a lexical path check
  // and an independent managed file. The original bytes must remain intact.
  const externalResume=path.join(sentinelDir,'external.json'),externalPhoto=path.join(sentinelDir,'external.png');
  const originalBytes=Buffer.from(JSON.stringify({...fixture,id:'synthetic-external-link',title:'Synthetic outside document'}));
  fs.writeFileSync(externalResume,originalBytes);fs.writeFileSync(externalPhoto,png);
  const linkedResume=path.join(main.dataDir,'resumes','linked.json'),linkedPhoto=path.join(main.dataDir,'assets','linked.png');
  fs.linkSync(externalResume,linkedResume);fs.linkSync(externalPhoto,linkedPhoto);
  const preserve=()=>{assert(fs.readFileSync(externalResume).equals(originalBytes)&&fs.readFileSync(externalPhoto).equals(png),'external bytes changed');assert(fs.statSync(externalResume).nlink===2&&fs.statSync(externalPhoto).nlink===2,'link replaced or deleted')};
  // A legacy ledger with an explicit .json alias remains a reference.
  const id='synthetic-archive-protected',entryId=randomUUID();
  await main.store.saveApplicationSnapshot({snapshotId:id,applicationId:entryId,resumeSlug:'runner-fixture',document:original});
  const base=await main.store.getApplications();
  await main.store.saveApplications({...base,applications:[{id:entryId,company:'合成受保护投递单位',resumeSlug:'runner-fixture',snapshotId:id+'.json'}]},base.revision);
  const archive=path.join(main.dataDir,'.application-snapshots',id+'.json'),archiveBefore=fs.readFileSync(archive);
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=code=>win.webContents.executeJavaScript(code),has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const click=async label=>assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(label)+');if(!b||b.disabled)return false;b.scrollIntoView({block:"nearest"});b.click();return true})()'),'button missing '+label);
  const capture=async name=>{await js('document.fonts.ready.then(()=>true)');await sleep(350);const image=await win.webContents.capturePage();assert(!image.isEmpty(),'empty capture');fs.writeFileSync(path.join(out,name+'.png'),image.toPNG())};
  const active=()=>js('document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")?.value');
  await until('healthy editor and regular asset',()=>js('!!document.querySelector("#basic-field-name")'));
  if(await active()!=='runner-fixture'){
    assert(await js('(()=>{const e=document.querySelector("select[aria-label=\\"快速切换简历版本\\"]");if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"runner-fixture");e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'version selector absent');
    await until('selected regular version',async()=>await active()==='runner-fixture');
  }
  await until('healthy editor name',()=>js('document.querySelector("#basic-field-name")?.value==="合成正常候选人"'));
  await until('linked-file warning',()=>has('有 1 份简历文件无法读取'));
  assert(await js('(()=>{const e=document.querySelector("details[aria-label=\\"简历文件读取异常\\"]");if(!e)return false;e.open=true;return true})()'),'missing warning');
  assert(await has('linked.json：不是普通文件'),'specific linked file not identified');
  await until('actual local photo decoded by renderer',()=>js('[...document.images].some(i=>i.src.includes('+JSON.stringify(asset.filename)+')&&i.complete&&i.naturalWidth===96)'));
  checks.healthyEditorAndActualManagedPhotoLoaded=true;checks.linkedResumeWarningVisible=true;await capture('02-healthy-editor-linked-warning');
  const read=await js('window.resumeDesktop.resumes.get("linked").then(()=>false,e=>String(e).includes("独立普通文件"))');
  assert(read,'direct IPC returned linked resume');
  const denied=await js('window.resumeDesktop.resumes.save("linked",'+JSON.stringify({...fixture,id:'synthetic-external-link',title:'Synthetic forbidden overwrite'})+').then(()=>false,e=>String(e).includes("独立普通文件"))');
  assert(denied,'direct IPC accepted linked resume write');preserve();checks.directLinkedDocumentReadAndWriteRefused=true;
  const loaded=await js('new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(true);i.onerror=()=>resolve(false);i.src="resume-asset://local/linked.png"})');
  assert(!loaded,'linked asset decoded through actual renderer protocol');preserve();checks.actualAssetProtocolRefusesLinkedFile=true;
  const value='合成正常版本安全保存';
  assert(await js('(()=>{const e=document.querySelector("#basic-field-name");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'edit field unavailable');
  await until('actual editor saved',async()=>(await main.store.getResume('runner-fixture')).basic.name===value);
  preserve();checks.healthySavePreservesExternalFiles=true;
  // Check real IPC deletion guard while existing UI can still open the archive.
  await click('求职面试');await until('real ledger loaded',()=>has('合成受保护投递单位'));
  const blocked=await js('window.resumeDesktop.applications.deleteSnapshot("SYNTHETIC-ARCHIVE-PROTECTED").then(()=>false,e=>String(e).includes("永久快照仍被"))');
  assert(blocked,'case/suffix alias bypassed reference guard');
  assert(fs.readFileSync(archive).equals(archiveBefore),'referenced permanent archive altered');
  assert(await js('window.resumeDesktop.applications.getSnapshot("synthetic-archive-protected.json").then(x=>x.document.id==="synthetic-contained-resume")'),'referenced archive no longer readable');
  checks.permanentArchiveAliasGuardRealIpc=true;await capture('03-referenced-archive-preserved');
  preserve();
  observations.externalResumeSha256=hash(originalBytes);observations.externalPhotoSha256=hash(png);observations.archiveSha256=hash(archiveBefore);observations.managedPhotoSha256=hash(fs.readFileSync(path.join(main.dataDir,'assets',asset.filename)));
  report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
