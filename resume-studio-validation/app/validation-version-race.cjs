const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-version-race-'))throw Error('isolated version race fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},files={};const sleep=ms=>new Promise(r=>setTimeout(r,ms)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m)};
const watchdog=setTimeout(()=>{console.error('version race watchdog');app.exit(2)},145000);
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(100)}throw Error('timeout '+label)}
function report(error){fs.writeFileSync(path.join(out,'version-race-evidence.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,checks,files,...(error?{error:String(error)}:{})},null,2))}
async function run(){
 const rgba=Buffer.alloc(80*120*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=255;rgba[i+2]=255;rgba[i+3]=255}
 const photo=nativeImage.createFromBitmap(rgba,{width:80,height:120}).toPNG();
 const asset=await main.store.saveAsset({filename:'synthetic-race-photo.png',dataUrl:'data:image/png;base64,'+photo.toString('base64')});
 const first=await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-race-first',title:'Synthetic First Version',templateId:'left-right',basic:{...fixture.basic,name:'Synthetic First Version Marker',photo:asset.url,photoConfig:{visible:true}}});
 const second=await main.store.saveResume('other-version',{...fixture,id:'synthetic-race-second',title:'Synthetic Second Version',templateId:'left-right',basic:{...fixture.basic,name:'Synthetic Second Version Marker',photo:''}});
 const a=main.store.resolveResumePath('runner-fixture').filePath,b=main.store.resolveResumePath('other-version').filePath,ab=fs.readFileSync(a),bb=fs.readFileSync(b);
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
 const js=code=>win.webContents.executeJavaScript(code),selector='select[aria-label="快速切换简历版本"]';
 const selected=()=>js('document.querySelector('+JSON.stringify(selector)+')?.value');
 const inputName=()=>js('document.querySelector("#basic-field-name")?.value');
 const switchTo=async slug=>{
   if(await selected()!==slug)assert(await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,'+JSON.stringify(slug)+');e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'version selector unavailable');
   await until('actual selected version '+slug,async()=>await selected()===slug&&await inputName()===(slug==='runner-fixture'?first.basic.name:second.basic.name));
 };
 const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
 const button=t=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled)');
 const click=async t=>assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(t)+');if(!b||b.disabled)return false;b.click();return true})()'),'button unavailable '+t);
 const capture=async name=>{await js('document.fonts.ready.then(()=>true)');await sleep(200);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot '+name);fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
 const paths=()=>fs.existsSync(main.exportsDir)?fs.readdirSync(main.exportsDir).filter(n=>n.endsWith('.pdf')).map(n=>path.join(main.exportsDir,n)):[];
 const copy=(file,name)=>{const data=fs.readFileSync(file);assert(data.subarray(0,4).toString()==='%PDF','invalid PDF');fs.writeFileSync(path.join(out,name),data);return{basename:path.basename(file),size:data.length,sha256:hash(data)}};
 await until('editor loaded',()=>js('!!document.querySelector("#basic-field-name")'));
 await switchTo('runner-fixture');
 await until('first managed portrait loaded',()=>js('[...document.images].some(i=>i.src.includes('+JSON.stringify(asset.filename)+')&&i.complete&&i.naturalWidth===80)'));
 const oldRead=main.store.readAsset.bind(main.store);
 let entered=false,release,timer;const gate=new Promise(r=>{release=r});
 // Delay only the next synthetic managed read after the editor image is
 // loaded; the real main IPC request and renderer remain in use.
 main.store.readAsset=async name=>{
   const data=await oldRead(name);
   if(name===asset.filename&&!entered){entered=true;await Promise.race([gate,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('controlled fixture gate timed out')),15000)})]);clearTimeout(timer);}
   return data;
 };
 try {
   await click('导出 PDF');
   await until('first export in flight',async()=>entered&&await has('导出中...'));
   assert(paths().length===0,'artifact existed before gate released');
   await switchTo('other-version');
   assert(await has('导出中...')&&!await button('记入投递并锁定快照'),'unexpected current version receipt while first pending');
   checks.realSwitchDuringPendingExport=true;
   await capture('01-switched-while-export-pending');
 } finally {release();if(timer)clearTimeout(timer);main.store.readAsset=oldRead;}
 await until('late receipt belongs to prior version',async()=>await button('导出 PDF')&&await has('文件属于此前版本，未关联当前简历')&&await button('打开文件'));
 assert(await inputName()===second.basic.name&&!await button('记入投递并锁定快照'),'old receipt associated to current document');
 const firstPaths=paths();assert(firstPaths.length===1,'expected first artifact');
 files.first=copy(firstPaths[0],'first-version.pdf');
 assert((await main.store.listSnapshots('runner-fixture')).length===1&&(await main.store.listSnapshots('other-version')).length===0,'old history attached to wrong version');
 const h=(await main.store.listSnapshots('runner-fixture'))[0];
 const stored=JSON.parse(fs.readFileSync(path.join(main.store.backupsDir,'runner-fixture',h.id+'.json'),'utf8'));
 assert(stored.document.id===first.id&&stored.document.basic.photo===asset.url,'old frozen history wrong identity');
 checks.lateReceiptAndHistoryStayWithPriorVersion=true;await capture('02-prior-version-warning');
 await click('导出 PDF');
 await until('new current version receipt',async()=>await button('导出 PDF')&&await has('已导出矢量 A4 PDF')&&await button('记入投递并锁定快照')&&!await has('文件属于此前版本'));
 const newPaths=paths().filter(x=>!firstPaths.includes(x));assert(newPaths.length===1,'expected new artifact');
 files.second=copy(newPaths[0],'second-version.pdf');
 assert((await main.store.listSnapshots('other-version')).length===1&&fs.readFileSync(a).equals(ab)&&fs.readFileSync(b).equals(bb),'current history or source changed');
 checks.newReceiptReplacesOldWarning=true;checks.bothSourcesPreserved=true;await capture('03-new-version-green-receipt');
 await switchTo('runner-fixture');
 assert(!await button('记入投递并锁定快照')&&!await button('打开文件'),'current receipt survived another switch');
 checks.switchClearsQuickLogAndFileReceipt=true;report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
