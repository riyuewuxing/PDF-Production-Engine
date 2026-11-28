const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-review-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),audit=require('./validation-theme-t05-contrast.cjs'),matrix=require('./validation-theme-t08-matrix.cjs');
const report={runnerSha:process.env.GITHUB_SHA,checks:{},states:{},zoom:{}};
const write=()=>fs.writeFileSync(path.join(out,'status-zoom.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='application watchdog';write();app.exit(2)},150000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
async function run(){
 await main.store.saveResume('runner-fixture',fixture);
 const states=['wishlist','applied','written','interview','offer','closed'];
 const before=await main.store.getApplications();
 await main.store.saveApplications({...before,applications:states.map((status,i)=>({id:'synthetic-status-'+i,company:'T08合成状态'+i,role:'物理教师',status,resumeSlug:'runner-fixture'}))},before.revision);
 const seeded=await main.store.getApplications(),source=main.store.resolveResumePath('runner-fixture').filePath,bytes=fs.readFileSync(source);
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);win.focus();
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const click=async t=>assert(await js(t=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()===t&&!x.disabled);if(!b)return false;b.click();return true},t),'button missing '+t);
 const set=async(sel,value)=>assert(await js((sel,value)=>{const e=document.querySelector(sel);if(!e||e.disabled)return false;const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return true},sel,value));
 const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode,modifiers});await sleep(50);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(100)};
 const capture=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(180);const s=await win.webContents.capturePage();assert(!s.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),s.toPNG())};
 await until('editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 await click('求职面试');await until('six status records',()=>js(()=>document.querySelectorAll('select[data-studio-career-status]').length===6));
 for(const id of ['classic','nordic','blueprint','terracotta','ink']){
  await set('select[aria-label="切换工作台主题"]',id);await until('theme',()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));
  await sleep(400); // allow CSS color transitions to settle before contrast sampling
  const rows=await js(()=>[...document.querySelectorAll('select[data-studio-career-status]')].map(e=>({value:e.value,marker:e.dataset.studioCareerStatus,bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color,selected:e.selectedOptions[0].textContent})));
  assert.equal(rows.length,6);assert.deepEqual(rows.map(r=>r.value).sort(),states.slice().sort());assert(rows.every(r=>r.marker===r.value&&r.selected));
  if(id!=='classic'){const bg=rows.map(r=>r.bg);assert(new Set(bg).size>=5,'semantic status backgrounds collapsed '+JSON.stringify(rows));}
  const contrast=await audit(win,'[data-studio-region="career-main"]','statuses-'+id);report.states[id]={rows,contrast};write();if(id!=='classic')assert.equal(contrast.failures.length,0,JSON.stringify(contrast.failures.slice(0,5)));
  await js(()=>document.querySelector('select[data-studio-career-status]').scrollIntoView({block:'center'}));await capture('statuses-'+id);
  assert.deepEqual(await main.store.getApplications(),seeded);assert(fs.readFileSync(source).equals(bytes));
 }
 report.checks.allSixStatusesAcrossThemes=true;
 await set('select[aria-label="T08合成状态0 状态"]','offer');await until('explicit status change',async()=>(await main.store.getApplications()).applications.find(x=>x.id==='synthetic-status-0').status==='offer');
 const updated=await main.store.getApplications();for(const a of seeded.applications){const next=updated.applications.find(x=>x.id===a.id);if(a.id==='synthetic-status-0')assert.deepEqual({...next,updatedAt:a.updatedAt},{...a,status:'offer'});else assert.deepEqual(next,a);}
 assert(fs.readFileSync(source).equals(bytes));report.checks.explicitStatusUpdateOnlyTarget=true;
 await click('内容编辑');await click('导出 PDF');await until('export ready',()=>js(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='记入投递并锁定快照'&&!b.disabled)),30000);
 const ledger=await main.store.getApplications();const sel='[data-studio-region="quick-log-dialog"]';
 win.setSize(1080,720);
 for(const id of ['classic','nordic','blueprint','terracotta','ink']){
  win.webContents.setZoomFactor(1);await set('select[aria-label="切换工作台主题"]',id);await until('theme',()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));
  for(const z of [1,1.25,1.5]){
   win.webContents.setZoomFactor(z);await sleep(150);await click('记入投递并锁定快照');await until('modal',()=>js(sel=>!!document.querySelector(sel),sel));
   const geometry=()=>js(sel=>{const f=document.querySelector(sel),r=f.getBoundingClientRect(),a=document.activeElement,b=a.getBoundingClientRect();return {viewport:[innerWidth,innerHeight],form:[r.left,r.top,r.right,r.bottom],scroll:[f.clientWidth,f.scrollWidth,f.clientHeight,f.scrollHeight],focus:a.getAttribute('aria-label')||a.getAttribute('placeholder')||a.innerText.trim(),focusVisible:b.left>=r.left-1&&b.right<=r.right+1&&b.top>=r.top-1&&b.bottom<=r.bottom+1&&b.bottom<=innerHeight+1}},sel);
   const first=await geometry();await js(sel=>{document.querySelector(sel+' button').focus();return true},sel);await press('Tab',['shift']);const last=await geometry();await capture('quick-log-zoom-'+id+'-'+z);
   report.zoom[id+'-'+z]={first,last};write();
   assert(first.form[0]>=0&&first.form[1]>=0&&first.form[2]<=first.viewport[0]+1&&first.form[3]<=first.viewport[1]+1,'form clipped');
   assert(first.scroll[1]<=first.scroll[0]+1,'form horizontal overflow');assert(first.focusVisible&&last.focusVisible,'focused field clipped');
   await press('Escape');await until('closed',()=>js(sel=>!document.querySelector(sel),sel));
  }
 }
 assert.deepEqual(await main.store.getApplications(),ledger);assert(fs.readFileSync(source).equals(bytes));report.checks.zoomNoWriteAndAllReachable=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();app.exit(1)});
