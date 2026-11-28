const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-t07-save-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),audit=require('./validation-theme-t05-contrast.cjs');
const report={runnerSha:process.env.GITHUB_SHA,checks:{},matrix:{}};
const write=()=>fs.writeFileSync(path.join(out,'save-load-native.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='application watchdog';write();process.exit(2)},115000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
async function run(){
 await main.store.saveResume('master',{...fixture,id:'synthetic-t07-master',title:'合成母库'});
 await main.store.saveResume('runner-fixture',fixture);
 await main.store.saveResume('zz-other',{...fixture,id:'synthetic-t07-other',title:'第二合成版本',basic:{...fixture.basic,name:'第二合成候选人'}});
 const disk=main.store.resolveResumePath('runner-fixture').filePath,original=fs.readFileSync(disk),before=await main.store.getResume('runner-fixture');
 const listResumes=main.store.listResumes.bind(main.store),getResume=main.store.getResume.bind(main.store),saveResume=main.store.saveResume.bind(main.store);
 let listGate=null,getGate=null,saveFail=false;
 // Delay only real reads at the IPC storage boundary to make transient real states inspectable.
 main.store.listResumes=async(...args)=>{if(listGate)await listGate;return listResumes(...args)};
 main.store.getResume=async(slug,...args)=>{if(getGate&&slug==='zz-other')await getGate;return getResume(slug,...args)};
 main.store.saveResume=async(...args)=>{if(saveFail)throw Error('T07受控正式简历写入失败');return saveResume(...args)};
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);win.focus();
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const cap=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(150);const shot=await win.webContents.capturePage();assert(!shot.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),shot.toPNG())};
 const select=async(label,value)=>assert(await js((label,value)=>{const e=document.querySelector('select[aria-label="'+label+'"]');if(!e||e.disabled)return false;e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));return true},label,value));
 const click=async(label,scope='body')=>assert(await js((label,scope)=>{const b=[...document.querySelector(scope)?.querySelectorAll('button')||[]].find(e=>e.innerText.trim()===label&&!e.disabled);if(!b)return false;b.click();return true},label,scope),'button missing '+label);
 const sel=r=>'[data-studio-region="'+r+'"]';
 const verify=async(r,id)=>{
   await until(r+' '+id,()=>js((s,id)=>document.querySelector(s)?.dataset.studioTheme===id,sel(r),id));
   const x=await js(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return {bg:c.backgroundColor,fg:c.color,text:e.innerText,theme:e.dataset.studioTheme,status:e.dataset.studioStatus||null}},sel(r));
   const bg=x.status==='error'?{dark:'rgb(59, 29, 37)',light:'rgb(254, 226, 226)',warm:'rgb(254, 226, 226)'}:{dark:'rgb(17, 24, 39)',light:'rgb(255, 255, 255)',warm:'rgb(251, 247, 238)'};
   if(id!=='classic')assert.equal(x.bg,bg[id]);
   const contrast=await audit(win,sel(r),r+'-'+id);report.matrix[r+'-'+id]={state:x,contrast};write();
   if(id!=='classic')assert.equal(contrast.failures.length,0,JSON.stringify(contrast.failures.slice(0,4)));
   await cap(r+'-'+id);
 };
 const themes=['classic','dark','light','warm'];
 const ready=()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人');
 await until('initial editor',ready);
 for(const id of themes){
   await select('切换工作台主题',id);await until('theme saved',()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));
   let release;listGate=new Promise(r=>release=r);
   try{win.webContents.reload();await verify('startup-loading',id);}finally{listGate=null;release();}
   await until('editor returns',ready);assert(fs.readFileSync(disk).equals(original),'theme reload wrote source');
   // Actual user-selected version change, with one controlled delayed getResume IPC.
   let releaseGet;getGate=new Promise(r=>releaseGet=r);
   try{
     await select('快速切换简历版本','zz-other');await verify('busy-overlay',id);
     assert(await js(()=>document.querySelector('.studio-shell').inert===true),'transition not inert');
   }finally{getGate=null;releaseGet();}
   await until('other editor',()=>js(()=>document.querySelector('#basic-field-name')?.value==='第二合成候选人'));
   await select('快速切换简历版本','runner-fixture');await until('original editor',ready);
 }
 report.checks.loadingAndVersionGateFourThemes=true;
 saveFail=true;
 const draft='T07 未保存合成草稿';
 await js(v=>{const e=document.querySelector('#basic-field-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));return true},draft);
 await until('actual save failure',()=>js(()=>document.body.innerText.includes('T07受控正式简历写入失败')));
 const dirs=path.join(root,'.resume-studio-drafts-v1');
 const records=()=>fs.existsSync(dirs)?fs.readdirSync(dirs).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(dirs,n),'utf8'))):[];
 await until('durable checkpoint',()=>records().some(x=>x.input.kind==='resume'&&x.input.data.basic.name===draft));
 const originalDrafts=JSON.stringify(records());
 for(const id of themes){
   await select('切换工作台主题',id);await verify('save-error',id);
   assert.equal(await js(()=>document.querySelector('#basic-field-name').value),draft);assert(fs.readFileSync(disk).equals(original));assert.equal(JSON.stringify(records()),originalDrafts);
 }
 report.checks.saveErrorThemeRetainsMemoryDiskAndCheckpoint=true;
 const backup=path.join(root,'explicit-draft.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:backup});
 await click('另存未保存草稿',sel('save-error'));await until('draft saved',()=>fs.existsSync(backup));assert.equal(JSON.parse(fs.readFileSync(backup,'utf8')).basic.name,draft);assert(fs.readFileSync(disk).equals(original));report.checks.explicitDraftExport=true;
 await js(()=>{window.confirm=()=>false;return true});await click('重载磁盘版本',sel('save-error'));await sleep(250);assert.equal(await js(()=>document.querySelector('#basic-field-name').value),draft);assert.equal(JSON.stringify(records()),originalDrafts);report.checks.cancelReloadPreservesDraft=true;
 saveFail=false;await js(()=>{window.confirm=()=>true;return true});await click('重载磁盘版本',sel('save-error'));await until('confirmed reload',ready);
 await until('checkpoint cleared after confirmation',()=>!records().some(x=>x.input.kind==='resume'));
 assert(fs.readFileSync(disk).equals(original));assert.deepEqual(await getResume('runner-fixture'),before);report.checks.confirmedReloadNoOriginalWrite=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();process.exit(1)});
