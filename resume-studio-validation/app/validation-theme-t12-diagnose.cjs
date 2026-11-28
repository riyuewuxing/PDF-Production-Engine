// P2 actual diagnosis subregions: offline synthetic data, no approved AI send or document mutation.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,group=process.env.STUDIO_THEME_GROUP;
const groups={pilot:['classic','dark','light','warm'],batch1:['classic','graphite','obsidian','ocean','porcelain'],batch2:['classic','aurora','forest','lavender','highContrast'],batch3:['classic','nordic','blueprint','terracotta','ink']};
if(!root||!out||!path.basename(root).startsWith('synthetic-t12-diagnose-')||!groups[group])throw Error('isolated synthetic fixture/group required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),audit=require('./validation-theme-t05-contrast.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={runnerSha:process.env.GITHUB_SHA,group,checks:{},networkAttempts:[],rows:{}};
const write=()=>fs.writeFileSync(path.join(out,'diagnose-native.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='diagnose native watchdog';write();app.exit(2)},260000);
async function until(label,fn,limit=20000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timed out: '+label);}
async function makePdf(target,html){
 const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 try{await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html><body style="font:18px Arial">'+html+'</body></html>'));const b=await w.webContents.printToPDF({pageSize:'A4',printBackground:true});fs.writeFileSync(target,b);}
 finally{if(!w.isDestroyed())w.destroy()}
}
async function run(){
 await main.store.saveResume('master',{...fixture,id:'synthetic-diagnose-master',title:'合成母库'});await main.store.saveResume('runner-fixture',fixture);
 const disk=path.join(main.store.resumesDir,'runner-fixture.json'),before=sha(fs.readFileSync(disk)),doc=await main.store.getResume('runner-fixture');
 const sourceHashes=()=>Object.fromEntries(fs.readdirSync(main.store.resumesDir).filter(n=>n.endsWith('.json')).sort().map(n=>[n,sha(fs.readFileSync(path.join(main.store.resumesDir,n)))]));
 const hashes=sourceHashes(),snapshotBefore=JSON.stringify(await main.store.listSnapshots('runner-fixture'));
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.focus();
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>{report.networkAttempts.push(d.url);cb({cancel:true})});
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const click=async label=>{assert(await js(label=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===label);if(!b||b.disabled)return false;b.click();return true;},label),'button missing '+label);await sleep(180)};
 const has=t=>js(t=>document.body.innerText.includes(t),t);
 const field=async(sel,value)=>{assert(await js((sel,value)=>{const e=document.querySelector(sel);if(!e||e.disabled)return false;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return true},sel,value),'field missing '+sel);await until('field '+sel,()=>js((s,v)=>document.querySelector(s)?.value===v,sel,value))};
 const val=sel=>js(s=>document.querySelector(s)?.value,sel);
 const enabled=label=>js(l=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()===l&&!b.disabled),label);
 const theme=async id=>{await field('select[aria-label="切换工作台主题"]',id);await until('theme '+id,()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));await sleep(200)};
 const noWrite=async()=>{assert.deepEqual(sourceHashes(),hashes,'source document mutated');assert.equal(sha(fs.readFileSync(disk)),before);assert.equal(JSON.stringify(await main.store.listSnapshots('runner-fixture')),snapshotBefore);assert.deepEqual(report.networkAttempts,[],'external request attempted')};
 const capture=async(label,sel,scroll)=>{
  if(scroll)await js(s=>document.querySelector(s)?.scrollIntoView({block:'center',behavior:'instant'}),scroll);
  await js(()=>document.fonts.ready.then(()=>true));await sleep(200);
  const scope=await js(s=>{const e=document.querySelector(s);if(!e)return null;return{theme:e.dataset.studioTheme,bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color,width:e.clientWidth,scrollWidth:e.scrollWidth}},sel);
  assert(scope,'missing actual region '+sel);const image=await win.webContents.capturePage();assert(!image.isEmpty());fs.writeFileSync(path.join(out,label+'.png'),image.toPNG());
  return {scope,contrast:await audit(win,sel,label),capture:image.getSize()};
 };
 await until('ready editor',()=>js(()=>document.querySelector('#basic-field-name')?.value==='演示候选人'));if(win.isMaximized()){win.unmaximize();await sleep(250)}win.setContentSize(1440,900);await sleep(300);
 await click('诊断优化');await click('AI 润色 Diff');const ai='[data-studio-region="diagnose-ai"]';await until('actual AI region',()=>js(s=>!!document.querySelector(s),ai));
 await until('config open button',()=>enabled('去配置'));await click('去配置');const model='input[aria-label="模型名"]';
 await until('model form',()=>js(s=>!!document.querySelector(s),model));
 await field(model,'synthetic-model-ui-t12');assert.equal(await js(()=>document.querySelector('input[type="password"]')?.value),'');
 assert.equal(await enabled('测试模型连接'),false,'AI unexpectedly enabled');
 const bankSummary=await js(()=>[...document.querySelectorAll('summary')].find(e=>e.innerText.includes('本地事实资料库'))?.innerText);
 assert(bankSummary,'missing local facts summary');
 assert(await js(()=>{const e=[...document.querySelectorAll('summary')].find(e=>e.innerText.includes('本地事实资料库'));if(!e)return false;e.click();return true}));
 await click('加载 / 刷新事实库');await until('fact draft ready',()=>js(()=>!!document.querySelector('[aria-label="事实关联段落"]')));
 const target='select[aria-label="事实关联段落"]',assertion='textarea[aria-label="事实陈述"]',evidence='input[aria-label="本地证据位置 / 来源说明"]';
 const firstTarget=await js(s=>[...document.querySelector(s).options].find(o=>o.value)?.value,target);assert(firstTarget,'no target');
 await field(target,firstTarget);await field(assertion,'合成事实草稿，仅供主题验收');await field(evidence,'合成本地来源，不保存');
 assert.equal(await enabled('确认保存事实'),false,'unconfirmed fact may be saved');
 for(const id of groups[group]){
  await theme(id);assert.equal(await val(model),'synthetic-model-ui-t12');assert.equal(await val(assertion),'合成事实草稿，仅供主题验收');assert.equal(await val(evidence),'合成本地来源，不保存');assert.equal(await val(target),firstTarget);assert.equal(await enabled('确认保存事实'),false);assert.equal(await enabled('测试模型连接'),false);
  const config=await capture('ai-config-'+id,ai,model),fact=await capture('fact-gate-'+id,ai,assertion);
  for(const row of [config,fact])assert.equal(row.scope.theme,id);
  report.rows[id]={config,fact};await noWrite();write();
 }
 report.checks.aiDraftAndDisabledConnectionPreserved=true;report.checks.unconfirmedFactDraftPreserved=true;
 // Render a real synthetic local PDF using the application's existing native browser infrastructure.
 await click('JD 雷达');const jd='[data-studio-region="diagnose-jd"]',jdInput=jd+' textarea[data-native-undo="true"]';
 await until('JD region',()=>js(s=>!!document.querySelector(s),jd));const draft='SYNTHETIC JD DRAFT: teaching, no actual employer.';
 await field(jdInput,draft);
 const pdf=path.join(root,'synthetic-notice.pdf');await makePdf(pdf,'<h1>SYNTHETIC NOTICE</h1><p>Teaching qualification required.</p><p>Master degree preferred.</p><p>No actual employer or personal data.</p>');
 const pb=fs.readFileSync(pdf);assert(pb.subarray(0,5).toString()==='%PDF-');fs.copyFileSync(pdf,path.join(out,'synthetic-notice.pdf'));
 const picker=win.webContents.debugger;let listener,pickerTimer;
 try{
  picker.attach('1.3');await picker.sendCommand('Page.enable');await picker.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true});
  const opened=new Promise((resolve,reject)=>{pickerTimer=setTimeout(()=>reject(Error('actual file picker watchdog')),8000);listener=(_e,m,p)=>{if(m==='Page.fileChooserOpened'){clearTimeout(pickerTimer);resolve(p)}};picker.on('message',listener)});
  const clickCode='('+((label)=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===label);if(!b||b.disabled)return false;b.click();return true}).toString()+')('+JSON.stringify('选择本地招聘公告 PDF')+')';
  const [chosen,clicked]=await Promise.all([opened,win.webContents.executeJavaScript(clickCode,true)]);assert(clicked&&chosen.backendNodeId,'real picker did not open');await picker.sendCommand('DOM.setFileInputFiles',{files:[pdf],backendNodeId:chosen.backendNodeId});
 }finally{clearTimeout(pickerTimer);if(listener)picker.removeListener('message',listener);if(picker.isAttached()){await picker.sendCommand('Page.setInterceptFileChooserDialog',{enabled:false}).catch(()=>{});picker.detach()}}
 const notice='[aria-label="招聘公告 PDF 本地导入"]',text='[aria-label="公告逐页提取文本"]',image='[aria-label="公告原件滚动预览"] img',review='input[aria-label="确认已对照 PDF 第 1 页"]',risk='input[aria-label="确认公告所选页和替换 JD"]';
 await until('PDF extraction',()=>js(s=>document.querySelector(s)?.innerText.includes('SYNTHETIC NOTICE'),text),35000);
 assert.equal(await enabled('确认导入所选公告页'),false);await click('渲染本页 PDF 原件');
 await until('actual rendered original',()=>js(s=>{const e=document.querySelector(s);return e?.complete&&e.naturalWidth>100},image),35000);
 const initial=await js((s,t)=>{const e=document.querySelector(s);return {src:e.src,width:e.naturalWidth,height:e.naturalHeight,text:document.querySelector(t).innerText}},image,text);
 const actualImage=Buffer.from(initial.src.split(',')[1],'base64');assert(actualImage.length>1000);fs.writeFileSync(path.join(out,'notice-original-render.png'),actualImage);const originalImageHash=sha(actualImage);report.originalNotice={pdfSha:sha(pb),imageSha:originalImageHash,width:initial.width,height:initial.height,text:initial.text};
 const checked=s=>js(s=>document.querySelector(s)?.checked,s);
 const toggle=async s=>{assert(await js(s=>{const e=document.querySelector(s);if(!e||e.disabled)return false;e.click();return true},s));await sleep(120)};
 for(const id of groups[group]){
  await theme(id);assert.equal(await val(jdInput),draft);assert.equal(await checked(review),false);assert.equal(await checked(risk),false);assert.equal(await enabled('确认导入所选公告页'),false);
  const current=await js((s,t)=>{const e=document.querySelector(s);return {src:e.src,width:e.naturalWidth,height:e.naturalHeight,text:document.querySelector(t).innerText}},image,text);assert.deepEqual(current,initial,'theme modified original document render or text');
  const row=await capture('notice-original-'+id,jd,image);
  assert.equal(row.scope.theme,id);report.rows[id].notice=row;report.rows[id].noticeImageSha=sha(Buffer.from(current.src.split(',')[1],'base64'));
  await noWrite();write();
 }
 await toggle(risk);assert.equal(await checked(risk),true);assert.equal(await enabled('确认导入所选公告页'),false,'risk alone bypassed page review');
 await toggle(review);assert.equal(await checked(review),true);assert.equal(await checked(risk),false,'review change did not invalidate confirmation');
 await toggle(risk);assert.equal(await enabled('确认导入所选公告页'),true,'explicit two-part gate not reachable');
 await capture('notice-confirm-ready-'+groups[group].at(-1),jd,risk);
 await click('放弃公告导入');await until('cancel clears preview',()=>js(s=>!document.querySelector(s),image));
 assert.equal(await val(jdInput),draft,'cancel changed JD');assert.equal(sha(fs.readFileSync(pdf)),sha(pb),'source PDF changed');await noWrite();
 report.checks.noticeOriginalAndDraftPreservedAllThemes=true;report.checks.explicitReviewAndRiskGateThenCancel=true;report.checks.noDocumentSnapshotOrNetworkWrite=true;
 report.contrastFailures=Object.entries(report.rows).flatMap(([id,row])=>id==='classic'?[]:['config','fact','notice'].flatMap(scene=>row[scene].contrast.failures.map(f=>({id,scene,...f}))));
 report.checks.nonclassicDiagnosticContrast=report.contrastFailures.length===0;write();
 if(report.contrastFailures.length)throw Error('nonclassic diagnostic text contrast failures: '+report.contrastFailures.length+'; preserve report');
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=e.stack||String(e);write();console.error(report.error);app.exit(1)});
