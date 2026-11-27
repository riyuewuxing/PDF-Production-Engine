const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(process.platform!=='win32'||!root||!out||!path.basename(root).startsWith('synthetic-locked-export-'))throw Error('isolated Windows fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},observations={};const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const watchdog=setTimeout(()=>{console.error('locked export watchdog');app.exit(2)},155000);
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(150)}throw Error('timeout '+label)}
function report(error){fs.writeFileSync(path.join(out,'locked-export-evidence.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,checks,observations,...(error?{error:String(error)}:{})},null,2))}
async function run(){
 const doc=await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-locked-export',title:'Synthetic Locked Resume',basic:{...fixture.basic,name:'Synthetic Locked Candidate',photo:''}});
 const source=main.store.resolveResumePath('runner-fixture').filePath,sourceBefore=fs.readFileSync(source);
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
 const js=code=>win.webContents.executeJavaScript(code);
 await until('actual editor',()=>js('document.querySelector("#basic-field-name")?.value==="Synthetic Locked Candidate"'));
 fs.mkdirSync(main.exportsDir,{recursive:true});
 const target=path.join(main.exportsDir,'locked-original.pdf'),ready=path.join(root,'lock-ready.txt'),release=path.join(root,'lock-release.txt');
 const original=await main.renderDocumentToPdf({...doc,basic:{...doc.basic,name:'Synthetic Locked Original'}});
 fs.writeFileSync(target,original);
 const lockCode="$ErrorActionPreference='Stop'; $f=[IO.File]::Open($env:QA_LOCK_TARGET,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None); try { [IO.File]::WriteAllText($env:QA_LOCK_READY,'ready'); $deadline=[DateTime]::UtcNow.AddSeconds(75); while(!(Test-Path -LiteralPath $env:QA_LOCK_RELEASE) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100} } finally {$f.Dispose()}";
 const locker=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',lockCode],{windowsHide:true,env:{...process.env,QA_LOCK_TARGET:target,QA_LOCK_READY:ready,QA_LOCK_RELEASE:release},stdio:['ignore','pipe','pipe']});
 let lockError='';locker.stderr.on('data',b=>{lockError+=b.toString()});
 const exit=new Promise((resolve,reject)=>{locker.once('error',reject);locker.once('exit',code=>resolve(code))});
 const occupants=new Map();
 const originalDialog=dialog.showSaveDialog;
 const outputs=[];
 try {
   await until('real Windows lock ready',()=>fs.existsSync(ready),12000);
   let lockCodeObserved='';
   try{fs.writeFileSync(target,Buffer.from('SYNTHETIC_PROBE_SHOULD_BE_BLOCKED'));}
   catch(e){lockCodeObserved=e.code||String(e)}
   assert(lockCodeObserved,'Windows exclusive sharing lock not enforced');
   observations.actualLockError=lockCodeObserved;checks.realWindowsSharingLock=true;
   // Occupy each timestamp fallback candidate across the short controlled
   // experiment. The real writer must choose independent exclusive suffixes.
   const base=Date.now();
   for(let i=-3;i<=65;i++){
     const t=new Date(base+i*1000);const stamp=[t.getHours(),t.getMinutes(),t.getSeconds()].map(v=>String(v).padStart(2,'0')).join('');
     const file=path.join(main.exportsDir,'locked-original-'+stamp+'.pdf'),bytes=Buffer.from('SYNTHETIC_OCCUPIED_'+stamp);
     fs.writeFileSync(file,bytes,{flag:'wx'});occupants.set(file,bytes);
   }
   let chooserCalls=0;
   dialog.showSaveDialog=async()=>{chooserCalls++;return {canceled:false,filePath:target}};
   const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
   const button=t=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled)');
   assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==="另存为...");if(!b||b.disabled)return false;b.click();return true})()'),'Save As control unavailable');
   await until('actual Save As receipt',async()=>await button('导出 PDF')&&await has('已导出矢量 A4 PDF')&&await button('打开文件'),30000);
   const newFiles=()=>fs.readdirSync(main.exportsDir).map(n=>path.join(main.exportsDir,n)).filter(f=>f!==target&&!occupants.has(f)&&f.endsWith('.pdf'));
   const saved=newFiles();assert(saved.length===1,'expected one fallback file after UI Save As');
   assert(await has(saved[0]),'actual fallback path not shown');
   outputs.push([saved[0],'locked-resume.pdf']);
   checks.actualSaveAsReceiptShowsFallback=true;
   const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty fallback screenshot');fs.writeFileSync(path.join(out,'locked-saveas-receipt.png'),shot.toPNG());
   const payload={title:'Synthetic Locked Letter',company:'Synthetic Company',role:'Role',candidateName:'Synthetic Candidate',contactLine:'',themeColor:'#167883',fontFamily:'sans',bodyText:'SYNTHETIC_LOCKED_ALPHA'};
   const first=JSON.stringify({payload,saveAs:true}),second=JSON.stringify({payload:{...payload,bodyText:'SYNTHETIC_LOCKED_BETA'},saveAs:true});
   const pair=await js('Promise.all([window.resumeDesktop.pdf.exportCoverLetter('+first+'),window.resumeDesktop.pdf.exportCoverLetter('+second+')])');
   assert(pair[0].filePath&&pair[1].filePath&&pair[0].filePath!==pair[1].filePath,'locked fallback collision');
   outputs.push([pair[0].filePath,'locked-alpha.pdf'],[pair[1].filePath,'locked-beta.pdf']);
   assert(newFiles().length===3&&new Set(outputs.map(x=>x[0])).size===3,'not three independent fallback outputs');
   assert(chooserCalls===3,'unexpected simulated dialog count');
   for(const [file,bytes] of occupants)assert(fs.readFileSync(file).equals(bytes),'preexisting timestamp fallback was overwritten');
   assert(outputs.every(([file])=>/locked-original-\d{6}-\d+\.pdf$/i.test(path.basename(file))),'occupied candidate not bypassed');
   checks.concurrentCoverLetterFallbackPathsUnique=true;checks.allTimestampOccupantsPreserved=true;
   observations.outputs=outputs.map(([file,name])=>{const b=fs.readFileSync(file);assert(b.subarray(0,4).toString()==='%PDF','invalid fallback PDF');fs.writeFileSync(path.join(out,name),b);return {name,actualBasename:path.basename(file),sha256:hash(b),size:b.length}});
   observations.occupiedFallbackCount=occupants.size;
 } finally {
   dialog.showSaveDialog=originalDialog;
   fs.writeFileSync(release,'release');
   let timer;const code=await Promise.race([exit,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),10000)})]).finally(()=>clearTimeout(timer));
   if(code===null){locker.kill();throw Error('fixture lock process did not exit')}
   if(code!==0)throw Error('fixture lock process failed '+code+' '+lockError);
   observations.lockProcessExitCode=code;
 }
 assert(fs.readFileSync(target).equals(original),'locked original changed');
 assert(fs.readFileSync(source).equals(sourceBefore),'stored resume changed');
 assert((await main.store.listSnapshots('runner-fixture')).length===1,'UI Save As history missing');
 fs.writeFileSync(path.join(out,'locked-original.pdf'),original);
 observations.originalSha256=hash(original);checks.lockedOriginalAndSourcePreserved=true;checks.historyPreserved=true;report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
