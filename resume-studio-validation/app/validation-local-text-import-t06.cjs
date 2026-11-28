const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out)throw Error('isolated paths required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
const userData=path.join(root,'userData');fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData);app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),manifest=require('./runner-manifest.json');
const checks={};const matrix=require('./validation-theme-t06-dialog-matrix.cjs');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>{console.error('local import desktop watchdog expired');app.exit(2);},150000);
async function until(label,fn,limit=15000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('timed out: '+label);}
async function makePdf(target,html){
  const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  try{await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html><body style="font:18px Arial">'+html+'</body></html>'));
  const b=await w.webContents.printToPDF({pageSize:'A4',printBackground:true});fs.writeFileSync(target,b);}
  finally{if(!w.isDestroyed())w.destroy();}
}
async function run(){
  const relative=path.relative(path.resolve(root),path.resolve(main.store.resumesDir));if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('store escaped isolated root');
  await main.store.saveResume('master',{...fixture,id:'synthetic-import-master',title:'合成母库'});
  await main.store.saveResume('runner-fixture',fixture);
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
  const active=()=>js(()=>document.querySelector('select[aria-label="快速切换简历版本"]')?.value||'');
  const click=async label=>{if(!await js(label=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===label);if(!b||b.disabled)return false;b.click();return true;},label))throw Error('button missing: '+label);};
  const modal=()=>js(()=>!!document.querySelector('[role="dialog"][aria-label*="简历解析导入确认"]'));
  const field=async(label,value)=>{if(!await js((label,value)=>{const l=[...document.querySelectorAll('[role="dialog"] label')].find(e=>e.querySelector('span')?.textContent.trim()===label);const input=l?.querySelector('input,textarea');if(!input)return false;const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));return true;},label,value))throw Error('field missing: '+label);};
  const getField=label=>js(label=>{const l=[...document.querySelectorAll('[role="dialog"] label')].find(e=>e.querySelector('span')?.textContent.trim()===label);return l?.querySelector('input,textarea')?.value??null;},label);
  const choose=async keep=>{if(!await js(keep=>{const r=[...document.querySelectorAll('[role="dialog"] input[name="import-unclassified"]')][keep?0:1];if(!r)return false;r.click();return true;},keep))throw Error('unclassified choice missing');};
  const capture=async name=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(300);const shot=await win.webContents.capturePage();if(shot.isEmpty())throw Error('empty capture');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG());};
  const count=()=>fs.readdirSync(main.store.resumesDir).filter(n=>n.endsWith('.json')).length;
  const original=fs.readFileSync(path.join(main.store.resumesDir,'runner-fixture.json'));
  const initial=count();
  const selectFile=async(label,inputPath)=>{
    const picker=win.webContents.debugger;let listener,timer;
    try{
      picker.attach('1.3');await picker.sendCommand('Page.enable');await picker.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true});
      const opened=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('actual picker watchdog expired')),8000);listener=(_event,method,params)=>{if(method==='Page.fileChooserOpened'){clearTimeout(timer);resolve(params);}};picker.on('message',listener);});
      const clickCode='('+((label)=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===label);if(!b||b.disabled)return false;b.click();return true;}).toString()+')('+JSON.stringify(label)+')';
      const [chosen,clicked]=await Promise.all([opened,win.webContents.executeJavaScript(clickCode,true)]);
      if(!clicked||!chosen.backendNodeId)throw Error('actual file picker did not open');
      await picker.sendCommand('DOM.setFileInputFiles',{files:[inputPath],backendNodeId:chosen.backendNodeId});
    }finally{clearTimeout(timer);if(listener)picker.removeListener('message',listener);if(picker.isAttached()){await picker.sendCommand('Page.setInterceptFileChooserDialog',{enabled:false}).catch(()=>{});picker.detach();}}
  };
  await until('initial editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
  await click('版本母库');
  const md=path.join(root,'synthetic-candidate.md');
  const mdText=['# Demo Candidate','> Target Role: Teacher | Email: demo@example.invalid | Phone: 13800000000','## Education','### Alpha Academy','Course A','### Beta Academy','Course B','## Publications','UNCLASSIFIED_PUBLICATION_36','## Honors & Awards','Synthetic Honor'].join('\n');
  fs.writeFileSync(md,mdText);
  await selectFile('从 TXT / Markdown 导入',md);
  await until('Markdown preview',modal);
  if(count()!==initial||await getField('姓名')!=='Demo Candidate'||await getField('邮箱')!=='demo@example.invalid'||await getField('意向岗位')!=='Teacher'||await getField('状态（可留空）')!=='')throw Error('candidate fields or pre-confirm disk state wrong');
  checks.previewNoWrite=true;
  if(!await js(()=>[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.innerText.trim()==='创建为新简历版本')?.disabled===true))throw Error('unclassified decision was not required');
  await capture('01-markdown-preview-decision-required');checks.decisionRequired=true;
  await field('邮箱','corrected@example.invalid');await field('所在地','Synthetic City');await field('出生日期','2000-01');await field('荣誉奖项（逐行）','Corrected Honor');
  await until('edited candidate',async()=>await getField('邮箱')==='corrected@example.invalid'&&await getField('荣誉奖项（逐行）')==='Corrected Honor');
  await choose(true);
  await until('opt-in selected',()=>js(()=>document.querySelector('[role="dialog"] input[name="import-unclassified"]')?.checked===true));
  await js(()=>document.querySelector('[role="dialog"] input[name="import-unclassified"]')?.scrollIntoView({block:'center'}));
  await capture('02-markdown-unclassified-explicit-retention');
  const previous=await active();
  if(!await js(()=>{const b=[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.innerText.trim()==='创建为新简历版本');if(!b||b.disabled)return false;b.click();b.click();return true;}))throw Error('create missing');
  await until('new version selected',async()=>{const slug=await active();if(!slug||slug===previous)return false;try{return (await main.store.getResume(slug)).basic.name==='Demo Candidate';}catch{return false;}});
  const slug=await active(),doc=await main.store.getResume(slug);
  if(count()!==initial+1||doc.basic.email!=='corrected@example.invalid'||doc.basic.location!=='Synthetic City'||doc.basic.birthDate!=='2000-01'||doc.basic.employmentStatus!==''||doc.education.map(e=>e.school).join('|')!=='Alpha Academy|Beta Academy'||doc.customData['custom-honors']?.[0]?.title!=='Corrected Honor')throw Error('created resume not equal reviewed fields');
  if(doc.menuSections.find(s=>s.id==='custom-import-unclassified')?.enabled!==false||!doc.customData['custom-import-unclassified']?.[0]?.description.includes('UNCLASSIFIED_PUBLICATION_36')||doc.education.some(e=>e.description.includes('UNCLASSIFIED_PUBLICATION_36')))throw Error('unclassified source leaked or missing');
  if(fs.readFileSync(md,'utf8')!==mdText||!fs.readFileSync(path.join(main.store.resumesDir,'runner-fixture.json')).equals(original))throw Error('source bytes changed');
  checks.reviewedFieldsDisk=true;checks.groupingAndUnclassifiedDisk=true;checks.doubleConfirmOneVersion=true;checks.originalBytesUnchanged=true;
  await click('内容编辑');
  await until('rendered imported version',()=>js(()=>{const t=[...document.querySelectorAll('.a4-sheet')].map(e=>e.innerText).join('\n');return t.includes('Alpha Academy')&&t.includes('Beta Academy')&&!t.includes('UNCLASSIFIED_PUBLICATION_36');}));
  await capture('03-created-markdown-resume');checks.unclassifiedHiddenInPreview=true;
  await click('版本母库');
  const txt=path.join(root,'synthetic-cancel.txt');fs.writeFileSync(txt,'Unclassified note\nSecond line');
  await selectFile('从 TXT / Markdown 导入',txt);
  await until('TXT preview',modal);
  await matrix(win,out,'resume-import-dialog','txt-import');checks.themeTxtDraft=true;
  if(await getField('自我评价')!==''||await getField('姓名')!=='')throw Error('unstructured text invented identity or self-evaluation');
  await click('取消');await until('dialog dismissed',async()=>!await modal());
  if(count()!==initial+1)throw Error('cancel created a version');checks.txtCancelNoWrite=true;
  const invalid=path.join(root,'invalid-utf8.txt');fs.writeFileSync(invalid,Buffer.from([255,254,0]));
  await selectFile('从 TXT / Markdown 导入',invalid);
  await until('UTF-8 error',()=>js(()=>document.body.innerText.includes('不是有效 UTF-8')));
  if(await modal()||count()!==initial+1)throw Error('invalid text produced version');checks.invalidTextNoWrite=true;
  const pdf=path.join(root,'synthetic-source.pdf');
  await makePdf(pdf,'<h1>Demo Candidate</h1><p>Email: pdf@example.invalid</p><h2>Education</h2><p>PDF Academy</p><h2>Awards</h2><p>PDF Honor</p>');
  const originalPdf=fs.readFileSync(pdf);
  await selectFile('从旧 PDF 导入',pdf);await until('PDF review',modal,35000);
  if(await getField('邮箱')!=='pdf@example.invalid'||await getField('状态（可留空）')!==''||await getField('荣誉奖项（逐行）')!=='PDF Honor')throw Error('native PDF candidate wrong');
  await matrix(win,out,'resume-import-dialog','pdf-before-approval');checks.themePdfBeforeApproval=true;
  await choose(false);await capture('04-pdf-preview-reviewed');
  await click('创建为新简历版本');
  await until('PDF import selected',async()=>{const s=await active();if(s===slug)return false;try{return (await main.store.getResume(s)).basic.email==='pdf@example.invalid';}catch{return false;}});
  const pdfDoc=await main.store.getResume(await active());
  if(count()!==initial+2||pdfDoc.basic.employmentStatus!==''||pdfDoc.customData['custom-import-unclassified']||!fs.readFileSync(pdf).equals(originalPdf))throw Error('PDF import disk or explicit discard incorrect');
  checks.pdfReviewedDiscardDisk=true;
  const scan=path.join(root,'synthetic-graphic.pdf');await makePdf(scan,'<div style="width:300px;height:300px;background:black"></div>');
  await selectFile('从旧 PDF 导入',scan);
  await until('graphic-only refusal',()=>js(()=>document.body.innerText.includes('PDF 无可提取文本')),35000);
  if(await modal()||count()!==initial+2)throw Error('graphic-only file created resume');await capture('05-scan-refusal');checks.scanNoWrite=true;
  const large=path.join(root,'synthetic-oversized.txt');fs.writeFileSync(large,Buffer.alloc(1024*1024+1,65));
  await selectFile('从 TXT / Markdown 导入',large);await until('oversize rejection',()=>js(()=>document.body.innerText.includes('超过 1 MiB 上限')));
  if(await modal()||count()!==initial+2)throw Error('oversized input created resume');checks.oversizedNoWrite=true;
  fs.writeFileSync(path.join(out,'import-desktop-evidence.json'),JSON.stringify({sourceSha:manifest.sourceSha,runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks},null,2));
  fs.writeFileSync(path.join(out,'synthetic-markdown-imported.json'),JSON.stringify(doc,null,2));fs.writeFileSync(path.join(out,'synthetic-pdf-imported.json'),JSON.stringify(pdfDoc,null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(deadline);app.exit(0);}).catch(e=>{clearTimeout(deadline);console.error(e);fs.writeFileSync(path.join(out,'import-desktop-failure.json'),JSON.stringify({checks,error:String(e)},null,2));app.exit(1);});
