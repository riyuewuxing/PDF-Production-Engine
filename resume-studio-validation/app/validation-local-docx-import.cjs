const {app}=require('electron');
const {Document,HeadingLevel,Packer,Paragraph,Table,TableRow,TableCell,TextRun,ExternalHyperlink,Header,Footer}=require('docx');
const {deflateRawSync}=require('node:zlib');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out)throw Error('isolated paths required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
const userData=path.join(root,'userData');fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData);app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),manifest=require('./runner-manifest.json');
const checks={};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>{console.error('local import desktop watchdog expired');app.exit(2);},210000);
async function until(label,fn,limit=15000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('timed out: '+label);}
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',CT='http://schemas.openxmlformats.org/package/2006/content-types',REL='http://schemas.openxmlformats.org/package/2006/relationships',OFFICE='http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const body=x=>'<w:document xmlns:w="'+W+'"><w:body>'+x+'</w:body></w:document>';
const p=x=>'<w:p><w:r><w:t>'+x+'</w:t></w:r></w:p>';
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function zip(items){const local=[],central=[];let off=0;for(const {name,xml,flags=0,declared,checksum} of items){const n=Buffer.from(name),raw=Buffer.from(xml),data=deflateRawSync(raw),size=declared??raw.length,hash=checksum??crc(raw),l=Buffer.alloc(30),c=Buffer.alloc(46);
l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(flags,6);l.writeUInt16LE(8,8);l.writeUInt32LE(hash,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(size,22);l.writeUInt16LE(n.length,26);
c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(flags,8);c.writeUInt16LE(8,10);c.writeUInt32LE(hash,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(size,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(off,42);const b=Buffer.concat([l,n,data]);local.push(b);central.push(Buffer.concat([c,n]));off+=b.length;}
const cd=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(items.length,8);e.writeUInt16LE(items.length,10);e.writeUInt32LE(cd.length,12);e.writeUInt32LE(off,16);return Buffer.concat([...local,cd,e]);}
function fixtureZip(doc,extra=[],relsTarget='word/document.xml',mainExtra={}){
return zip([{name:'[Content_Types].xml',xml:'<Types xmlns="'+CT+'"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'},{name:'_rels/.rels',xml:'<Relationships xmlns="'+REL+'"><Relationship Id="rId1" Type="'+OFFICE+'" Target="'+relsTarget+'"/></Relationships>'},{name:'word/document.xml',xml:doc,...mainExtra},...extra]);}
async function makeNativeDocx(target){
 const native=new Document({sections:[{headers:{default:new Header({children:[new Paragraph('HEADER_PRIVATE_MARKER_37')]})},footers:{default:new Footer({children:[new Paragraph('FOOTER_PRIVATE_MARKER_37')]})},children:[
 new Paragraph('Name: Demo Candidate'),new Paragraph('Email: docx@example.invalid'),new Paragraph('Target Role: Teacher'),
 new Paragraph({text:'Education',heading:HeadingLevel.HEADING_1}),new Paragraph({text:'Alpha Academy',heading:HeadingLevel.HEADING_2}),new Paragraph('Course A'),new Paragraph({text:'Beta Academy',heading:HeadingLevel.HEADING_2}),new Paragraph('Course B'),
 new Paragraph({text:'Publications',heading:HeadingLevel.HEADING_1}),new Paragraph('UNCLASSIFIED_DOCX_37'),
 new Paragraph({text:'Skills',heading:HeadingLevel.HEADING_1}),new Table({rows:[new TableRow({children:[new TableCell({children:[new Paragraph('Table Cell A')]}),new TableCell({children:[new Paragraph('Table Cell B')]})]})]}),
 new Paragraph({children:[new ExternalHyperlink({link:'https://example.invalid/DO_NOT_FETCH_DOCX_37',children:[new TextRun('Visible link label')]})]}),
 new Paragraph({text:'Honors & Awards',heading:HeadingLevel.HEADING_1}),new Paragraph('Synthetic Honor')]}]});
 fs.writeFileSync(target,await Packer.toBuffer(native));
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
  const docx=path.join(root,'synthetic-candidate.docx');
  await makeNativeDocx(docx);const before=fs.readFileSync(docx);
  let externalAttempts=0;
  win.webContents.session.webRequest.onBeforeRequest({urls:['https://example.invalid/*']},(_details,cb)=>{externalAttempts++;cb({cancel:true});});
  const review=()=>js(()=>document.querySelector('[role="dialog"][aria-label="DOCX 简历解析导入确认"] input[type="checkbox"]')?.checked===true);
  const acknowledge=async()=>{if(!await js(()=>{const c=document.querySelector('[role="dialog"][aria-label="DOCX 简历解析导入确认"] input[type="checkbox"]');if(!c)return false;c.click();return true;}))throw Error('DOCX review acknowledgement missing');};
  const confirmDisabled=()=>js(()=>[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.innerText.trim()==='创建为新简历版本')?.disabled===true);
  await selectFile('从 DOCX 导入',docx);await until('DOCX preview',modal,25000);
  if(count()!==initial||await getField('姓名')!=='Demo Candidate'||await getField('邮箱')!=='docx@example.invalid'||await getField('意向岗位')!=='Teacher'||await getField('状态（可留空）')!=='')throw Error('candidate fields or preview disk state wrong');
  if(!await confirmDisabled()||await review())throw Error('DOCX acknowledgement not required');
  if(!await js(()=>document.querySelector('[role="dialog"]')?.innerText.includes('不是视觉脱敏')))throw Error('DOCX visual privacy limitation absent');
  checks.visualPrivacyLimitDisclosed=true;
  const raw=await js(()=>document.querySelector('[role="dialog"] pre')?.textContent??'');
  if(!raw.includes('Table Cell A\nTable Cell B')||!raw.includes('Visible link label')||/HEADER_PRIVATE_MARKER_37|FOOTER_PRIVATE_MARKER_37|DO_NOT_FETCH_DOCX_37/.test(raw))throw Error('DOCX extracted body mismatch');
  checks.previewNoWriteAndBodyBoundary=true;await capture('01-docx-review-required');
  await click('定位待确认');
  if(!await js(()=>{const e=document.querySelector('[data-import-review-scope]'),s=document.querySelector('[data-import-review-scroll]');return !!e&&!!s&&e.getBoundingClientRect().top>=s.getBoundingClientRect().top-3&&e.getBoundingClientRect().top<s.getBoundingClientRect().bottom;}))throw Error('pending scope navigation failed');
  await field('邮箱','corrected@example.invalid');await field('所在地','Synthetic City');await field('荣誉奖项（逐行）','Corrected Honor');
  await choose(true);if(!await confirmDisabled())throw Error('unclassified choice bypassed DOCX acknowledgement');
  await acknowledge();await until('review acknowledged',review);
  if(await confirmDisabled())throw Error('reviewed candidate still disabled');
  await js(()=>document.querySelector('[role="dialog"] input[name="import-unclassified"]')?.scrollIntoView({block:'center'}));
  if(!await js(()=>{const e=document.querySelector('[data-import-review-source]'),s=document.querySelector('[data-import-review-scroll]'),p=e?.querySelector('pre');if(!e||!s||!p)return false;const r=p.getBoundingClientRect(),b=s.getBoundingClientRect();return getComputedStyle(e).position==='sticky'&&Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)>100&&p.textContent.includes('Alpha Academy');}))throw Error('source comparison no longer visible during lower-field review');
  checks.stickySourceAtLowerFields=true;await capture('02-docx-retention-choice');checks.twoIndependentDecisions=true;
  // Test the actual renderer at a narrower emulated viewport. No user-device claim.
  const debug=win.webContents.debugger;
  try{
    debug.attach('1.3');await debug.sendCommand('Emulation.setDeviceMetricsOverride',{width:650,height:800,deviceScaleFactor:1,mobile:false});
    await until('narrow viewport',()=>js(()=>innerWidth===650));
    await click('定位原文');
    if(!await js(()=>{const e=document.querySelector('[data-import-review-source]'),s=document.querySelector('[data-import-review-scroll]');if(!e||!s)return false;const r=e.getBoundingClientRect(),b=s.getBoundingClientRect();return getComputedStyle(e).position!=='sticky'&&Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)>80;}))throw Error('narrow source jump failed');
    await capture('02b-narrow-source-jump');
    await click('定位字段');
    if(!await js(()=>{const e=[...document.querySelectorAll('[role="dialog"] label')].find(x=>x.querySelector('span')?.textContent==='姓名')?.querySelector('input'),s=document.querySelector('[data-import-review-scroll]');if(!e||!s)return false;const r=e.getBoundingClientRect(),b=s.getBoundingClientRect();return r.top>=b.top-3&&r.bottom<=b.bottom+3;}))throw Error('narrow field jump failed');
    await capture('02c-narrow-fields-jump');
    if(count()!==initial||await getField('邮箱')!=='corrected@example.invalid'||!await review())throw Error('navigation mutated reviewed state');
    checks.narrowSourceAndFieldsNavigation=true;
  }finally{if(debug.isAttached()){await debug.sendCommand('Emulation.clearDeviceMetricsOverride').catch(()=>{});debug.detach();}}
  await until('desktop viewport restored',()=>js(()=>innerWidth>=768));
  const prev=await active();
  if(!await js(()=>{const b=[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.innerText.trim()==='创建为新简历版本');if(!b||b.disabled)return false;b.click();b.click();return true;}))throw Error('create missing');
  await until('new DOCX version',async()=>{const slug=await active();if(!slug||slug===prev)return false;try{return(await main.store.getResume(slug)).basic.name==='Demo Candidate';}catch{return false;}});
  const slug=await active(),doc=await main.store.getResume(slug);
  if(count()!==initial+1||doc.basic.email!=='corrected@example.invalid'||doc.basic.location!=='Synthetic City'||doc.basic.employmentStatus!==''||doc.education.map(e=>e.school).join('|')!=='Alpha Academy|Beta Academy'||doc.customData['custom-honors']?.[0]?.title!=='Corrected Honor')throw Error('created document differs from reviewed fields');
  if(doc.menuSections.find(s=>s.id==='custom-import-unclassified')?.enabled!==false||!doc.customData['custom-import-unclassified']?.[0]?.description.includes('UNCLASSIFIED_DOCX_37')||doc.education.some(e=>e.description.includes('UNCLASSIFIED_DOCX_37')))throw Error('unclassified source boundary');
  if(!fs.readFileSync(docx).equals(before)||!fs.readFileSync(path.join(main.store.resumesDir,'runner-fixture.json')).equals(original))throw Error('source changed');
  checks.reviewedFieldsDiskAndDoubleConfirm=true;checks.sourceUnchangedAndHiddenRetention=true;
  await click('内容编辑');await until('visible result',()=>js(()=>{const t=[...document.querySelectorAll('.a4-sheet')].map(e=>e.innerText).join('\n');return t.includes('Alpha Academy')&&t.includes('Beta Academy')&&!t.includes('UNCLASSIFIED_DOCX_37');}));await capture('03-docx-created');
  const importedFile=path.join(main.store.resumesDir,slug+'.json'),saved=fs.readFileSync(importedFile);
  for(const [ext,method] of [['pdf','export'],['html','exportHtml'],['md','exportMarkdown'],['docx','exportDocx']]){
    const result=await js((method,options)=>window.resumeDesktop.pdf[method](options),method,{slug:'',document:doc,saveAs:false,skipSave:true,fileNameSuffix:'synthetic-docx-audit-'+ext});
    if(result?.canceled||!result?.filePath)throw Error('actual export unavailable '+ext);
    const bytes=fs.readFileSync(result.filePath);if(bytes.length<100)throw Error('empty export '+ext);fs.writeFileSync(path.join(out,'actual-docx-import-export.'+ext),bytes);
  }
  if(!fs.readFileSync(importedFile).equals(saved))throw Error('export changed imported document');
  checks.fourActualExportsAndSourcePreserved=true;
  await click('版本母库');
  const roundTrip=path.join(out,'actual-docx-import-export.docx');
  await selectFile('从 DOCX 导入',roundTrip);await until('actual application DOCX reimport',modal);
  const edu=await js(()=>[...document.querySelectorAll('[role="dialog"] label')].find(e=>e.querySelector('span')?.textContent.startsWith('教育经历'))?.querySelector('textarea')?.value??'');
  if(!edu.includes('### Alpha Academy')||!edu.includes('### Beta Academy'))throw Error('app-produced DOCX semantic outline not preserved: '+edu.slice(0,400));
  if(await getField('邮箱')!=='corrected@example.invalid')throw Error('round-trip email mismatch');
  await capture('04-docx-export-reimport');await click('取消');await until('cancelled',async()=>!await modal());
  if(count()!==initial+1)throw Error('cancel created document');checks.actualExportReimportAndCancel=true;
  const cases=[
    ['hidden',fixtureZip(body('<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDEN</w:t></w:r></w:p>')),'隐藏文字'],
    ['tracked',fixtureZip(body('<w:p><w:del><w:r><w:delText>OLD</w:delText></w:r></w:del></w:p>')),'修订'],
    ['traversal',fixtureZip(body(p('Test')),[{name:'../escape.xml',xml:'x'}]),'路径'],
    ['macro',fixtureZip(body(p('Test')),[{name:'word/vbaProject.bin',xml:'synthetic'}]),'宏'],
    ['external',fixtureZip(body(p('Test')),[],'https://example.invalid/DO_NOT_FETCH_DOCX_37'),'外部'],
    ['DTD',fixtureZip('<!DOCTYPE x [<!ENTITY leak SYSTEM "https://example.invalid/DO_NOT_FETCH_DOCX_37">]>'+body(p('Test'))),'DTD'],
    ['false-size',fixtureZip(body(p('Test')),[],'word/document.xml',{declared:1}),'解压'],
    ['badcrc',fixtureZip(body(p('Test')),[],'word/document.xml',{checksum:1}),'CRC'],
    ['empty',fixtureZip(body('<w:p><w:r><w:drawing/></w:r></w:p>')),'没有可提取'],
    ['large',Buffer.alloc(20*1024*1024+1,65),'20 MiB'],
    ['badzip',Buffer.from('not an OOXML ZIP'),'ZIP']
  ];
  for(const [name,bytes,reason] of cases){
    const file=path.join(root,'synthetic-'+name+'.docx');fs.writeFileSync(file,bytes);
    await selectFile('从 DOCX 导入',file);await until('refusal '+name,()=>js(t=>document.body.innerText.includes(t),reason),25000);
    if(await modal()||count()!==initial+1||!fs.readFileSync(file).equals(bytes))throw Error('rejected file changed data '+name);
    checks['refused_'+name]=true;
    if(['hidden','false-size','DTD'].includes(name))await capture('05-refusal-'+name);
  }
  if(externalAttempts)throw Error('unexpected external request attempt');
  checks.externalRequestAttemptsZero=true;checks.originalBytesStillUnchanged=fs.readFileSync(docx).equals(before)&&fs.readFileSync(path.join(main.store.resumesDir,'runner-fixture.json')).equals(original);
  if(!checks.originalBytesStillUnchanged)throw Error('original source changed');
  fs.writeFileSync(path.join(out,'synthetic-native-docx.docx'),before);
  fs.writeFileSync(path.join(out,'synthetic-imported.json'),JSON.stringify(doc,null,2));

  fs.writeFileSync(path.join(out,'docx-desktop-evidence.json'),JSON.stringify({sourceSha:manifest.sourceSha,runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(deadline);app.exit(0);}).catch(e=>{clearTimeout(deadline);console.error(e);fs.writeFileSync(path.join(out,'docx-desktop-failure.json'),JSON.stringify({checks,error:String(e)},null,2));app.exit(1);});
