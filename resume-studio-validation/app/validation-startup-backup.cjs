const {app,dialog}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-list-backup-'))throw Error('isolated startup backup fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},observations={};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const digest=b=>createHash('sha256').update(b).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m)};
const parent=fs.mkdtempSync(path.join(path.dirname(root),'synthetic-list-backup-parent-'));
const originalDialog=dialog.showOpenDialog;
let childPid=null;
const deadline=setTimeout(()=>{console.error('startup backup watchdog expired');if(childPid)try{process.kill(childPid)}catch{};app.exit(2)},165000);
async function until(label,fn,ms=18000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150)}throw Error('timeout '+label)}
const report=error=>fs.writeFileSync(path.join(out,'startup-backup-evidence.json'),JSON.stringify({privateBaseSha:'926b260213aa156d420dc8f09af815d87f8805c9',runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks,observations,...(error?{error:String(error)}:{})},null,2));
async function run(){
  await main.store.saveResume('master',{...fixture,id:'synthetic-backup-master',title:'合成备份母库'});
  await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-backup-resume',title:'合成备份简历',basic:{...fixture.basic,name:'合成备份候选人'}});
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setContentSize(1080,650);
  const js=code=>win.webContents.executeJavaScript(code),has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const click=async label=>{assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(label)+');if(!b||b.disabled)return false;b.scrollIntoView({block:"nearest"});b.click();return true})()'),'button missing '+label)};
  const namedCheck=async label=>{assert(await js('(()=>{const e=[...document.querySelectorAll("input[type=checkbox]")].find(x=>x.getAttribute("aria-label")==='+JSON.stringify(label)+');if(!e||e.disabled)return false;e.scrollIntoView({block:"nearest"});if(!e.checked)e.click();return e.checked})()'),'checkbox unavailable '+label)};
  const disabled=label=>js('[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(label)+')?.disabled===true');
  const capture=async name=>{await js('document.fonts.ready.then(()=>true)');await sleep(350);const image=await win.webContents.capturePage();assert(!image.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),image.toPNG())};
  const visible=selector=>js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return false;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0||r.top<0||r.bottom>innerHeight+1||r.left<0||r.right>innerWidth+1)return false;for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowY)&&(r.top<b.top-1||r.bottom>b.bottom+1))return false;}const center=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!center&&(center===e||e.contains(center));})()');
  await until('healthy source editor ready',()=>js('!!document.querySelector("#basic-field-name")'));
  // Generate a real checked backup through production IPC before damage.
  dialog.showOpenDialog=async(_owner,options)=>{assert(options.properties.includes('openDirectory'),'expected directory chooser');return {canceled:false,filePaths:[parent]}};
  const backup=await js('window.resumeDesktop.workspaceBackup.create()');assert(backup?.folder&&backup.fileCount===2,'unexpected initial backup');
  const manifestPath=path.join(backup.folder,'workspace-backup-v1.json'),manifestBytes=fs.readFileSync(manifestPath),manifest=JSON.parse(manifestBytes);
  const validOriginals=new Map(manifest.files.map(f=>[f.path,fs.readFileSync(path.join(backup.folder,'data',...f.path.split('/')))]));
  const damaged=new Map();
  for(const p of ['master.json','resumes/runner-fixture.json']){
    const file=path.join(main.dataDir,...p.split('/'));
    const bytes=Buffer.from('{synthetic damaged '+p,'utf8');fs.writeFileSync(file,bytes);damaged.set(p,bytes);
  }
  const originalsUnchanged=()=>{for(const [p,bytes] of damaged)assert(fs.readFileSync(path.join(main.dataDir,...p.split('/'))).equals(bytes),'damaged source changed '+p);};
  const backupUnchanged=()=>{assert(fs.readFileSync(manifestPath).equals(manifestBytes),'backup manifest changed');for(const [p,bytes] of validOriginals)assert(fs.readFileSync(path.join(backup.folder,'data',...p.split('/'))).equals(bytes),'backup file changed '+p);};
  win.webContents.reload();
  await until('all-corrupt startup error',()=>has('无法加载本地简历'));
  await until('explicit two damaged files',()=>has('有 2 份简历文件无法读取'));
  assert(!await js('!!document.querySelector("#basic-field-name")'),'unexpected editor with no usable document');
  const entry='details[aria-label="启动异常时的备份恢复"]';
  await until('recovery-only entry exists',()=>js('!!document.querySelector('+JSON.stringify(entry)+')'));
  await capture('06-startup-backup-entry');
  assert(await js('(()=>{const d=document.querySelector('+JSON.stringify(entry)+');d.querySelector("summary").click();return d.open})()'),'recovery details not open');
  assert(!await js('[...document.querySelectorAll("button")].some(b=>b.innerText==="创建本地工作区备份")'),'unsafe creation offered in startup recovery');
  checks.errorScreenOffersExistingBackupOnly=true;
  // Cancellation leaves no selection or new copy.
  dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});
  await click('检查已有备份');await until('canceled inspection',()=>has('已取消检查备份'));
  assert(!await js('!!document.querySelector("input[aria-label=\\"确认恢复到独立新工作区\\"]")'),'canceled inspection exposed approval');
  originalsUnchanged();backupUnchanged();checks.canceledInspectionLeavesSourceUntouched=true;
  // Check actual backup and reject post-inspection modification.
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup.folder]});
  await click('检查已有备份');await until('backup checked',()=>has('备份文件清单及内容校验完成'));
  assert(await disabled('恢复到独立新工作区'),'restore allowed without approval');
  await capture('07-startup-backup-inspection');
  await namedCheck('确认恢复到独立新工作区');
  const backupMaster=path.join(backup.folder,'data','master.json');fs.appendFileSync(backupMaster,' ');
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[parent]});
  await click('恢复到独立新工作区');await until('tampered source refused',()=>has('校验失败'));
  assert(!fs.readdirSync(parent).some(n=>n.startsWith('resume-studio-restored-v1-')),'tampered backup published');
  originalsUnchanged();await until('refusal actually visible',()=>visible('[aria-label="工作区操作反馈"] [role="alert"]'));
  checks.tamperedBackupRejectedWithoutChangingDamagedSource=true;await capture('08-startup-tampered-backup-blocked');
  fs.writeFileSync(backupMaster,validOriginals.get('master.json'));
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup.folder]});
  await click('检查已有备份');await until('backup rechecked',()=>has('备份文件清单及内容校验完成'));
  assert(await disabled('恢复到独立新工作区'),'fresh restore approval not required');
  await namedCheck('确认恢复到独立新工作区');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[parent]});
  await click('恢复到独立新工作区');await until('restored copy published',()=>has('已恢复并校验独立新工作区'));
  const restoredName=fs.readdirSync(parent).find(n=>n.startsWith('resume-studio-restored-v1-'));assert(restoredName,'restored folder absent');
  const restored=path.join(parent,restoredName);
  for(const f of manifest.files){const b=fs.readFileSync(path.join(restored,'data',...f.path.split('/')));assert(b.length===f.size&&digest(b)===f.sha256,'restored bytes mismatch '+f.path);}
  originalsUnchanged();backupUnchanged();checks.actualRestoreCreatesByteVerifiedIndependentCopy=true;
  await until('restore result visible',()=>visible('[aria-label="工作区操作反馈"] [role="status"]'));await capture('09-startup-restored-copy');
  // Start the real independent application entry with explicit new approval.
  await click('检查并打开刚恢复的工作区');await until('independent copy checked',()=>has('独立工作区当前数据检查完成'));
  assert(await disabled('确认打开独立工作区'),'launch allowed without approval');
  await namedCheck('确认打开独立恢复工作区');await click('确认打开独立工作区');
  await until('production independent window ready',()=>has('独立恢复工作区已实际加载，新窗口就绪'),65000);
  childPid=Number(await js('document.querySelector("[aria-label=\\"独立工作区进程 ID\\"]")?.textContent'));
  assert(Number.isSafeInteger(childPid)&&childPid>0&&childPid!==process.pid,'invalid actual child PID');
  process.kill(childPid,0);assert(fs.existsSync(path.join(restored,'.electron-userdata')),'independent user profile absent');
  originalsUnchanged();backupUnchanged();assert(await has('无法加载本地简历'),'source error workspace unexpectedly switched');
  win.show();win.focus();await until('original window foreground',()=>win.isFocused(),5000);
  await Promise.race([js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))'),sleep(4000).then(()=>{throw Error('paint watchdog')})]);
  await until('ready feedback visible in error screen',()=>visible('[aria-label="工作区操作反馈"] [role="status"]'));
  checks.actualIndependentEditorReadyAndOriginalWindowPreserved=true;await capture('10-startup-independent-window-ready');
  const cmd='$p=Get-Process -Id '+childPid+' -ErrorAction Stop; if(!$p.CloseMainWindow()){throw "no independent main window"}; $p.WaitForExit(8000)';
  const closed=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',cmd],{encoding:'utf8',timeout:12000});
  assert(closed.includes('True'),'child did not close');childPid=null;checks.independentNativeWindowClosed=true;
  observations.backupFiles=manifest.files.length;observations.damagedFiles=damaged.size;report();
}
app.whenReady().then(run).then(()=>{clearTimeout(deadline);dialog.showOpenDialog=originalDialog;fs.rmSync(parent,{recursive:true,force:true});app.exit(0)}).catch(e=>{clearTimeout(deadline);console.error(e);report(e);if(childPid)try{process.kill(childPid)}catch{};dialog.showOpenDialog=originalDialog;app.exit(1)});
