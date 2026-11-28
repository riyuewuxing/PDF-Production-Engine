const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('resume-studio-restored-v1-synthetic-t07-'))throw Error('isolated restored fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'.electron-userdata'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),audit=require('./validation-theme-t05-contrast.cjs');
const report={runnerSha:process.env.GITHUB_SHA,checks:{},matrix:{}};
const write=()=>fs.writeFileSync(path.join(out,'recovery-errors.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='application watchdog';write();process.exit(2)},100000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
async function run(){
 assert.equal(path.resolve(main.dataDir),path.join(path.resolve(root),'data'));
 await main.store.saveResume('master',{...fixture,id:'synthetic-t07-restored-master',title:'合成母库'});
 await main.store.saveResume('runner-fixture',fixture);
 const disk=main.store.resolveResumePath('runner-fixture').filePath,original=fs.readFileSync(disk);
 const restoreSave=main.store.saveResume.bind(main.store);
 // A filesystem obstacle makes the real checkpoint API fail; no renderer state is forged.
 const blocked=path.join(root,'.resume-studio-drafts-v1');assert(!fs.existsSync(blocked));fs.writeFileSync(blocked,'synthetic checkpoint path obstacle');
 main.store.saveResume=async()=>{throw Error('T07受控正式保存拒绝')};
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const sel=r=>'[data-studio-region="'+r+'"]';
 await until('restored editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 await until('actual context identity',()=>js(s=>!!document.querySelector(s),sel('restored-workspace')));
 const context=await js(()=>window.resumeDesktop.workspaceBackup.context());assert(context.restored&&path.resolve(context.folder)===path.resolve(root));report.checks.contextRestoredExact=true;
 const draft='T07恢复检查点故障草稿';
 await js(v=>{const e=document.querySelector('#basic-field-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));return true},draft);
 await until('actual checkpoint error',()=>js(s=>document.querySelector(s)?.innerText.includes('自动恢复草稿写入失败'),sel('recovery-error')));
 await until('actual save refused',()=>js(s=>document.querySelector(s)?.innerText.includes('T07受控正式保存拒绝'),sel('save-error')));
 for(const id of ['classic','dark','light','warm']){
   await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true},id);
   for(const r of ['restored-workspace','recovery-error','save-error']){
    await until(r+' '+id,()=>js((s,id)=>document.querySelector(s)?.dataset.studioTheme===id,sel(r),id));
    const state=await js(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return {status:e.dataset.studioStatus,bg:c.backgroundColor,text:e.innerText,fg:c.color}},sel(r));
    const colors=state.status==='error'?{dark:'rgb(59, 29, 37)',light:'rgb(254, 226, 226)',warm:'rgb(254, 226, 226)'}:{dark:'rgb(66, 44, 21)',light:'rgb(254, 243, 199)',warm:'rgb(254, 243, 199)'};
    if(id!=='classic')assert.equal(state.bg,colors[id]);const contrast=await audit(win,sel(r),r+'-'+id);report.matrix[r+'-'+id]={state,contrast};write();if(id!=='classic')assert.equal(contrast.failures.length,0);
   }
   await js(()=>document.fonts.ready.then(()=>true));await sleep(200);const shot=await win.webContents.capturePage();assert(!shot.isEmpty());fs.writeFileSync(path.join(out,'restored-error-'+id+'.png'),shot.toPNG());
   assert.equal(await js(()=>document.querySelector('#basic-field-name').value),draft);assert(fs.readFileSync(disk).equals(original));assert.equal(fs.readFileSync(blocked,'utf8'),'synthetic checkpoint path obstacle');
 }
 report.checks.themePreservedBothFailuresAndMemory=true;
 fs.unlinkSync(blocked);main.store.saveResume=restoreSave;
 await js(()=>{window.confirm=()=>true;return true});
 await js(s=>{const b=[...document.querySelector(s).querySelectorAll('button')].find(e=>e.innerText.trim()==='重载磁盘版本');b.click();return true},sel('save-error'));
 await until('reload original',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'));
 assert(fs.readFileSync(disk).equals(original));report.checks.explicitReloadOriginalUnchanged=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();process.exit(1)});
