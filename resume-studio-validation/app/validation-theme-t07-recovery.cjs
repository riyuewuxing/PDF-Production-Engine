const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,mode=process.env.RESUME_STUDIO_LIST_MODE;
if(!root||!out||!['mixed','all-corrupt'].includes(mode)||!path.basename(root).startsWith('synthetic-list-'))throw Error('isolated list fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},observations={};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>{console.error('list recovery watchdog expired '+mode);app.exit(2);},105000);
const digest=b=>createHash('sha256').update(b).digest('hex');
const expect=(v,msg)=>{if(!v)throw Error(msg)};
async function until(label,fn,limit=15000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await sleep(150);}throw Error('timeout '+label);}
const report=error=>fs.writeFileSync(path.join(out,'list-recovery-evidence.json'),JSON.stringify({privateBaseSha:'fae130c17f33141f6fff81a95fc7ad4c37143887',runnerSha:process.env.GITHUB_SHA,platform:process.platform,mode,checks,observations,...(error?{error:String(error)}:{})},null,2));
async function run(){
  await main.store.saveResume('master',{...fixture,id:'synthetic-list-master',title:'合成母库'});
  const good=await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-list-good',title:'合成正常简历',basic:{...fixture.basic,name:'合成正常候选人'}});
  const damaged=new Map();
  function corrupt(file,bytes){fs.writeFileSync(file,bytes);damaged.set(file,digest(fs.readFileSync(file)));}
  corrupt(path.join(main.dataDir,'master.json'),'{damaged synthetic master');
  if(mode==='mixed'){
    corrupt(path.join(main.dataDir,'resumes','broken.json'),'{broken synthetic version');
    corrupt(path.join(main.dataDir,'resumes','invalid.json'),'{"schemaVersion":999}');
  }else{
    corrupt(path.join(main.dataDir,'resumes','runner-fixture.json'),'{broken synthetic preferred');
    const child=spawnSync('node',['-e','process.exit(0)'],{timeout:10000,windowsHide:true});
    expect(child.status===0&&child.pid>0,'could not establish an exited synthetic draft owner');
    try{process.kill(child.pid,0);throw Error('synthetic owner unexpectedly alive')}catch(e){if(e.code!=='ESRCH')throw e}
    const draftDir=path.join(root,'.resume-studio-drafts-v1');fs.mkdirSync(draftDir);
    const id=randomUUID();
    const record={version:1,id,token:randomUUID(),session:randomUUID(),ownerPid:child.pid,createdAt:new Date().toISOString(),input:{kind:'resume',slug:'runner-fixture',baseRevision:JSON.stringify([good.id,good.updatedAt]),data:{...good,basic:{...good.basic,name:'合成待恢复候选人'}}}};
    fs.writeFileSync(path.join(draftDir,id+'.json'),JSON.stringify(record));
    observations.syntheticExitedOwner=child.pid;
  }
  const originalFiles=()=>{for(const [file,sha] of damaged)expect(digest(fs.readFileSync(file))===sha,'damaged original changed '+path.basename(file));};
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=code=>win.webContents.executeJavaScript(code);
  const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const warning='details[aria-label="简历文件读取异常"]';
  const active=()=>js('document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")?.value||""');
  const capture=async name=>{await js('document.fonts.ready.then(()=>true)');await sleep(350);const shot=await win.webContents.capturePage();expect(!shot.isEmpty(),'empty capture');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG());};
  const click=async label=>{const ok=await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(label)+');if(!b||b.disabled)return false;b.click();return true})()');expect(ok,'button missing '+label);};
  const openIssues=async()=>{expect(await js('(()=>{const e=document.querySelector('+JSON.stringify(warning)+');if(!e)return false;e.open=true;return true})()'),'issue details absent');};

  const audit=require('./validation-theme-t05-contrast.cjs');
  const themes=['classic','dark','light','warm'];
  const verify=async(region,id,label)=>{
    const sel='[data-studio-region="'+region+'"]';
    await until('scope '+region+' '+id,()=>js('document.querySelector('+JSON.stringify(sel)+')?.dataset.studioTheme==='+JSON.stringify(id)));
    const state=await js('('+function(sel){const e=document.querySelector(sel),s=getComputedStyle(e);return {theme:e.dataset.studioTheme,bg:s.backgroundColor,fg:s.color,status:e.dataset.studioStatus||null,text:e.innerText,buttons:[...e.querySelectorAll('button')].map(b=>[b.innerText,b.disabled])}}.toString()+')('+JSON.stringify(sel)+')');
    const statusColors={dark:'rgb(66, 44, 21)',light:'rgb(254, 243, 199)',warm:'rgb(254, 243, 199)'};
    const panelColors={dark:'rgb(17, 24, 39)',light:'rgb(255, 255, 255)',warm:'rgb(251, 247, 238)'};
    if(id!=='classic')expect(state.bg===(state.status==='warning'?statusColors[id]:panelColors[id]),'wrong scope color '+JSON.stringify(state));
    const contrast=await audit(win,sel,label+'-'+id);observations.themeMatrix??={};observations.themeMatrix[label+'-'+id]={state,contrast};report();
    if(id!=='classic')expect(!contrast.failures.length,'contrast '+label+' '+id+' '+JSON.stringify(contrast.failures.slice(0,5)));
  };
  const chooseTheme=async id=>{
    expect(await js('('+function(id){const e=document.querySelector('select[aria-label="切换工作台主题"]');if(!e)return false;e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true}.toString()+')('+JSON.stringify(id)+')'),'theme selector missing');
    await until('theme selected',()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==='+JSON.stringify(id)));
  };
  if(mode==='mixed'){
    await until('normal editor with damaged siblings',()=>js('!!document.querySelector("#basic-field-name")'));
    expect(await active()==='runner-fixture','unexpected active slug');
    await until('visible issue summary',()=>has('有 3 份简历文件无法读取'));
    await openIssues();
    expect(await has('broken.json：JSON 损坏')&&await has('master.json：JSON 损坏')&&await has('invalid.json：数据格式不符合规范'),'specific damaged entries not visible');
    checks.healthyEditorLoadsWithExplicitDamagedEntries=true;await capture('01-mixed-damage-warning');
    for(const id of themes){await chooseTheme(id);await verify('resume-list-warning',id,'mixed-warning');await capture('mixed-warning-'+id);originalFiles();}
    checks.themeMixedWarning=true;
    const value='正常版本仍可保存';
    expect(await js('(()=>{const e=document.querySelector("#basic-field-name");if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'name field missing');
    await until('healthy edit written',async()=>(await main.store.getResume('runner-fixture')).basic.name===value);
    originalFiles();checks.healthyEditSavedAndAllDamagedFilesUnchanged=true;await capture('02-healthy-edit-saved');
  }else{
    await until('explicit no usable document',()=>has('无法加载本地简历'));
    await until('visible issue summary',()=>has('有 2 份简历文件无法读取'));
    await until('recovery draft visible',()=>has('本地自动恢复草稿 1 份'));
    await openIssues();expect(await has('master.json：JSON 损坏')&&await has('runner-fixture.json：JSON 损坏'),'damaged originals not identified');
    await click('检查恢复草稿');await until('unreadable recovery basis',()=>has('无法核对原版本'));
    checks.allCorruptErrorStillExposesDraftRecovery=true;await capture('03-all-corrupt-recovery-entry');
    for(const id of themes){
      // Seed only the documented renderer preference, as though chosen during a prior healthy session.
      await js('localStorage.setItem("resume-studio-ui-theme-v1",'+JSON.stringify(JSON.stringify({schemaVersion:1,activePreset:id}))+');true');
      win.webContents.reload();await until('persisted error screen',()=>js('document.querySelector(\'[data-studio-region="startup-error"]\')?.dataset.studioTheme==='+JSON.stringify(id)));
      await until('recovery draft visible again',()=>has('本地自动恢复草稿 1 份'));
      await openIssues();await click('检查恢复草稿');await until('draft state again',()=>has('无法核对原版本'));
      await click('查看草稿内容');await until('actual draft preview',()=>has('本地草稿原始 JSON'));
      await verify('startup-error',id,'startup-error');await verify('resume-list-warning',id,'startup-warning');await verify('recovery-drafts',id,'draft-preview');await capture('startup-draft-'+id);
      originalFiles();
    }
    checks.themeStartupAndDraft=true;
    await js('(()=>{window.confirm=()=>true;return true})()');await click('恢复为新简历');
    await until('recovered copy loaded',()=>js('document.querySelector("#basic-field-name")?.value==="合成待恢复候选人"'));
    let list=await main.store.listResumes();
    expect(list.resumes.length===1&&list.issues?.length===2,'unexpected listing after recovery');
    const copy=list.resumes[0],recovered=await main.store.getResume(copy.slug);
    expect(recovered.id!==good.id&&recovered.basic.name==='合成待恢复候选人'&&copy.title.includes('恢复草稿'),'copy not independent');
    originalFiles();checks.recoveredDraftIndependentOfCorruptOriginals=true;await capture('04-restored-independent-copy');
    win.webContents.reload();
    await until('recovered copy reloads',()=>js('document.querySelector("#basic-field-name")?.value==="合成待恢复候选人"'));
    expect(await active()===copy.slug,'reload did not select recovered copy');
    await until('persistent warning',()=>has('有 2 份简历文件无法读取'));await openIssues();
    originalFiles();checks.reloadedCopyRemainsUsableAndOriginalsUnchanged=true;await capture('05-reloaded-copy-warning');
  }
  observations.damagedOriginalCount=damaged.size;
  report();
}
app.whenReady().then(run).then(()=>{clearTimeout(deadline);app.exit(0)}).catch(e=>{clearTimeout(deadline);console.error(e);report(e);app.exit(1)});
