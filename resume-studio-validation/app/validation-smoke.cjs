const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = process.env.RESUME_STUDIO_DATA_DIR;
const out = process.env.RESUME_STUDIO_EVIDENCE_OUT;
if (!root || !out) throw Error('isolated paths required');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const userData = path.join(root, 'userData');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.disableHardwareAcceleration();
const main = require('./dist-electron/main.cjs');
const source = require('./runner-manifest.json');
const fixture = require('./runner-fixture.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = {};
let server;
const deadline = setTimeout(() => { console.error('application smoke deadline exceeded'); app.exit(2); }, 330000);
async function until(label, fn, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(150); }
  throw Error('Timed out: ' + label);
}
async function run() {
  await main.store.saveResume('master', { ...fixture, id: 'synthetic-master', title: '合成母库' });
  await main.store.saveResume('runner-fixture', fixture);
  await main.registerAssetProtocol();
  main.registerIpcHandlers();
  const win = await main.createMainWindow();
  const js = code => win.webContents.executeJavaScript(code);
  const bodyHas = text => js('document.body.innerText.includes(' + JSON.stringify(text) + ')');
  const click = async label => {
    const found = await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim() === ' + JSON.stringify(label) + '); if(!b)return false;b.click();return true})()');
    if (!found) throw Error('Missing button: ' + label);
  };
  const capture = async name => {
    await js('document.fonts.ready.then(()=>true)');
    await sleep(300);
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) throw Error('empty screenshot ' + name);
    fs.writeFileSync(path.join(out, name + '.png'), image.toPNG());
  };
  await until('synthetic document loaded', () => js('document.querySelector("#basic-field-name")?.value === "演示候选人"'));
  win.unmaximize();
  win.setSize(1440, 920);
  await capture('01-workbench');
  checks.appLoaded = true;

  // Real renderer controls -> save -> Electron IPC -> actual output files.
  // Only synthetic names, data and paths are used.
  const clickAria19=async label=>{
    const found=await js('(()=>{const b=[...document.querySelectorAll("button[aria-label]")].find(e=>e.getAttribute("aria-label")==='+JSON.stringify(label)+');if(!b||b.disabled)return false;b.click();return true})()');
    if(!found)throw Error('export visibility control missing: '+label);
  };
  const visible19=async (expected)=>{
    const doc=await main.store.getResume('runner-fixture');
    return ['name','title'].every(key=>doc.basic.fieldOrder.some(f=>f.key===key&&f.visible===expected))&&doc.basic.name===fixture.basic.name&&doc.basic.title===fixture.basic.title;
  };
  await clickAria19('隐藏姓名');
  await clickAria19('隐藏职位');
  await until('hidden name and role persisted',()=>visible19(false),15000);
  await until('hidden-field save settled',()=>bodyHas('已保存至本地硬盘'),15000);
  await capture('95-export-hidden-controls');
  function docxXml19(zip){
    let offset=0;
    while(offset+30<=zip.length&&zip.readUInt32LE(offset)===0x04034b50){
      const method=zip.readUInt16LE(offset+8),size=zip.readUInt32LE(offset+18);
      const nameLength=zip.readUInt16LE(offset+26),extraLength=zip.readUInt16LE(offset+28);
      const start=offset+30+nameLength+extraLength;
      const name=zip.subarray(offset+30,offset+30+nameLength).toString('utf8');
      if(name==='word/document.xml'){
        const payload=zip.subarray(start,start+size);
        if(method!==0&&method!==8)throw Error('unexpected Word ZIP method');
        return (method===8?require('node:zlib').inflateRawSync(payload):payload).toString('utf8');
      }
      offset=start+size;
    }
    throw Error('Word document XML missing');
  }
  const artifacts19=path.join(out,'export-visibility');
  fs.mkdirSync(artifacts19,{recursive:true});
  for(const [label,ext,feedback,check] of [
    ['Word 可编辑 (.docx)','.docx','已导出Word 文档','wordExportVisibility'],
    ['Markdown (.md)','.md','已导出Markdown 文档','markdownExportVisibility'],
    ['单文件网页主页 (.html)','.html','已导出离线网页主页','htmlExportVisibility'],
  ]){
    const existing=new Set(fs.existsSync(main.exportsDir)?fs.readdirSync(main.exportsDir):[]);
    await clickAria19('更多导出格式');
    await click(label);
    await until('export UI success '+ext,()=>bodyHas(feedback),15000);
    const added=fs.readdirSync(main.exportsDir).filter(n=>!existing.has(n)&&n.endsWith(ext));
    if(added.length!==1)throw Error('expected exactly one new '+ext+' export: '+JSON.stringify(added));
    const name=added[0],bytes=fs.readFileSync(path.join(main.exportsDir,name));
    const content=ext==='.docx'?docxXml19(bytes):bytes.toString('utf8');
    if(ext==='.docx'&&!content.includes('<w:document'))throw Error('Word document content missing');
    for(const marker of [fixture.basic.name,fixture.basic.title,fixture.title]){
      if(name.includes(marker)||content.includes(marker))throw Error('hidden or internal marker leaked in '+ext);
    }
    if(!content.includes(fixture.basic.email)||!content.includes(fixture.projects[0].name))throw Error('visible content dropped in '+ext);
    if(!await visible19(false))throw Error('export changed persisted source visibility/data');
    fs.writeFileSync(path.join(artifacts19,name),bytes);
    checks[check]=true;
    await capture('96-export-hidden-'+ext.slice(1));
  }
  await clickAria19('显示姓名');
  await clickAria19('显示职位');
  await until('visibility restored for existing regression',()=>visible19(true),15000);
  await until('restored visibility save settled',()=>bodyHas('已保存至本地硬盘'),15000);
  checks.exportVisibilitySourceRestored=true;

  // U09: actual UI redaction mode and export, in an isolated synthetic document.
  const original21=await main.store.getResume('runner-fixture');
  const fixture21=JSON.parse(JSON.stringify(original21));
  const marker21='PRIVATE21_';
  fixture21.basic.name=marker21+'NAME';
  fixture21.basic.title=marker21+'ROLE';
  fixture21.basic.email='private21@example.invalid';
  fixture21.basic.phone='19900000000';
  fixture21.basic.birthDate=marker21+'BIRTH';
  fixture21.basic.fieldOrder=fixture21.basic.fieldOrder.map(f=>({...f,label:marker21+'LABEL_'+f.key}));
  fixture21.basic.customFields=[{id:'cf21',label:marker21+'CF_LABEL',value:marker21+'CF_VALUE',visible:true}];
  fixture21.education=fixture21.education.map(e=>({...e,school:'VISIBLE_SCHOOL_21',degree:marker21+'DEGREE',gpa:marker21+'GPA',startDate:marker21+'EDU_DATE',visible:true}));
  fixture21.projects=fixture21.projects.map(e=>({...e,name:'VISIBLE_PROJECT_21',role:marker21+'PROJECT_ROLE',date:marker21+'PROJECT_DATE',linkLabel:marker21+'LINK_LABEL',visible:true}));
  fixture21.menuSections=fixture21.menuSections.map(s=>({...s,title:marker21+s.id,enabled:true}));
  fixture21.skillContent='VISIBLE_SKILL_21 '+marker21+'SKILL';
  await main.store.saveResume('runner-fixture',fixture21);
  // Reload the editor from the deliberately modified synthetic disk document.
  await win.webContents.reload();
  await until('redaction fixture loaded',()=>js('document.querySelector("#basic-field-name")?.value === "PRIVATE21_NAME"'));
  await capture('97-redaction-before');
  await clickAria19('设置自定义脱敏敏感词');
  const termsSelector21=JSON.stringify('[aria-label="脱敏敏感词设置"] textarea');
  const checkboxSelector21=JSON.stringify('[aria-label="脱敏敏感词设置"] input[type=checkbox]');
  await until('redaction settings open',()=>js('!!document.querySelector('+termsSelector21+')'));
  await js('(()=>{const e=document.querySelector('+termsSelector21+');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,"PRIVATE21_, private21@example.invalid, 19900000000");e.dispatchEvent(new Event("input",{bubbles:true}));return true})()');
  await js('(()=>{const e=document.querySelector('+checkboxSelector21+');if(!e.checked)e.click();return true})()');
  await click('完成');
  await until('redaction mode active',()=>bodyHas('脱敏模式中'));
  await capture('98-redaction-preview');
  const artifacts21=path.join(out,'redaction-u09');
  fs.mkdirSync(artifacts21,{recursive:true});
  for(const [label,ext,feedback] of [
    ['导出 PDF','.pdf','已导出'],
    ['高清 2x PNG 长图','.png','已导出'],
    ['Word 可编辑 (.docx)','.docx','已导出Word 文档'],
    ['Markdown (.md)','.md','已导出Markdown 文档'],
    ['单文件网页主页 (.html)','.html','已导出离线网页主页'],
    ['标准 JSON Resume（仅可见内容）','.json','已导出标准 JSON Resume']
  ]){
    const existing=new Set(fs.existsSync(main.exportsDir)?fs.readdirSync(main.exportsDir):[]);
    if(ext!=='.pdf')await clickAria19('更多导出格式');
    await click(label);
    await until('redacted file created '+ext,()=>fs.readdirSync(main.exportsDir).some(n=>!existing.has(n)&&n.endsWith(ext)),20000);
    await until('redacted export completed '+ext,async()=>await bodyHas(feedback)&&await js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==="导出 PDF"&&!b.disabled)'),20000);
    const added=fs.readdirSync(main.exportsDir).filter(n=>!existing.has(n)&&n.endsWith(ext));
    if(added.length!==1)throw Error('expected one redacted '+ext);
    const name=added[0],bytes=fs.readFileSync(path.join(main.exportsDir,name));
    if(/private21_|private21@example\.invalid|19900000000/i.test(name))throw Error('sensitive filename');
    if(['.md','.html','.json','.docx'].includes(ext)){
      const content=ext==='.docx'?docxXml19(bytes):bytes.toString('utf8');
      if(/private21_|private21@example\.invalid|19900000000/i.test(content))throw Error('redaction leak in '+ext);
      if(!content.includes('VISIBLE_PROJECT_21'))throw Error('redaction removed project in '+ext);
    }
    fs.writeFileSync(path.join(artifacts21,'redacted'+ext),bytes);
    checks['redaction'+ext]=true;
  }
  const after21=await main.store.getResume('runner-fixture');
  if(after21.basic.name!==fixture21.basic.name||after21.basic.phone!==fixture21.basic.phone||after21.basic.birthDate!==fixture21.basic.birthDate)throw Error('redaction changed stored source');
  checks.redactionSourcePreserved=true;
  await click('脱敏模式中');
  await main.store.saveResume('runner-fixture',original21,{expectedRevision:JSON.stringify([after21.id,after21.updatedAt])});
  await win.webContents.reload();
  await until('original synthetic fixture restored',()=>js('document.querySelector("#basic-field-name")?.value === "演示候选人"'));
  checks.redactionFixtureRestored=true;


  // Cross-format visibility: real native print windows, file IPC and actual pixels.
  const raw20=await main.store.getResume('runner-fixture');
  const source20=JSON.stringify(raw20);
  const photo20='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAA8CAIAAACb22+3AAAAN0lEQVR4nO3NMQEAAAgDILV/59nBxwcK0KnUh3lZxWKxWCwWi8VisVgsFovFYrFYLBaLxWLx0QJA6QJ2HpCnXwAAAABJRU5ErkJggg==';
  const visible20={...raw20,title:'INTERNAL_TITLE_20',templateId:'minimal-ats',
    basic:{...raw20.basic,name:'SYNTH_NAME_20',title:'SYNTH_ROLE_20',email:'hidden20@example.invalid',phone:'19900000000',location:'SYNTH_CITY_20',employmentStatus:'SYNTH_STATUS_20',birthDate:'1991-01',
      photo:photo20,photoConfig:{...raw20.basic.photoConfig,visible:true},
      customFields:[{id:'synthetic-cf20',label:'CUSTOM_LABEL_20',value:'CUSTOM_VALUE_20',visible:true}]},
    projects:[{...raw20.projects[0],name:'VISIBLE_PROJECT_20'}]};
  const exportOut20=path.join(out,'cross-format-visibility');fs.mkdirSync(exportOut20,{recursive:true});
  const native20=require('electron').nativeImage;
  const countMagenta20=bytes=>{
    const img=native20.createFromBuffer(bytes);
    if(img.isEmpty())throw Error('invalid native PNG');
    const data=img.toBitmap();let count=0;
    for(let i=0;i+3<data.length;i+=4){if(data[i]>240&&data[i+1]<12&&data[i+2]>240)count++;}
    return count;
  };
  for(const [templateId,disabled] of [['minimal-ats',false],['minimal-ats',true],['vip-sky-notch-hero',true]]){
    const doc={...visible20,templateId,menuSections:visible20.menuSections.map(s=>s.id==='basic'?{...s,enabled:!disabled}:s)};
    const pdf=await js('window.resumeDesktop.pdf.export('+JSON.stringify({slug:'',document:doc})+')');
    const png=await js('window.resumeDesktop.pdf.exportPng('+JSON.stringify({slug:'',document:doc})+')');
    if(pdf.canceled||png.canceled||!pdf.filePath||!png.filePath)throw Error('native cross-format export missing');
    const pdfBytes=fs.readFileSync(pdf.filePath),pngBytes=fs.readFileSync(png.filePath);
    if(pdfBytes.subarray(0,5).toString()!=='%PDF-'||pngBytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('native output invalid');
    const markers=['SYNTH_NAME_20','SYNTH_ROLE_20','INTERNAL_TITLE_20'];
    for(const item of [pdf,png]){
      if(item.fileName.includes('INTERNAL_TITLE_20'))throw Error('internal title in file name');
      if(disabled&&markers.some(m=>item.fileName.includes(m)))throw Error('hidden marker in native filename');
      if(!disabled&&(!item.fileName.includes('SYNTH_NAME_20')||!item.fileName.includes('SYNTH_ROLE_20')))throw Error('visible name lost in filename');
    }
    const magenta=countMagenta20(pngBytes);
    if(disabled?magenta!==0:magenta<100)throw Error('native portrait visibility pixels mismatch: '+magenta);
    const label=templateId+'-'+(disabled?'hidden':'visible');
    fs.writeFileSync(path.join(exportOut20,label+'.pdf'),pdfBytes);
    fs.writeFileSync(path.join(exportOut20,label+'.png'),pngBytes);
    checks['nativeCrossFormat-'+label]=true;
    (checks.crossFormatMetrics??=[]).push({templateId,disabled,magenta,pdfName:pdf.fileName,pngName:png.fileName});
  }
  // Simultaneous automatic writes of different contents, same proposed name.
  const disabled20={...visible20,menuSections:visible20.menuSections.map(s=>s.id==='basic'?{...s,enabled:false}:s)};
  const a20={slug:'',document:{...disabled20,skillContent:'RACE_MARKER_A_20'}};
  const b20={slug:'',document:{...disabled20,skillContent:'RACE_MARKER_B_20'}};
  const pair20=await js('Promise.all([window.resumeDesktop.pdf.exportMarkdown('+JSON.stringify(a20)+'),window.resumeDesktop.pdf.exportMarkdown('+JSON.stringify(b20)+')])');
  if(pair20[0].filePath===pair20[1].filePath||!fs.readFileSync(pair20[0].filePath,'utf8').includes('RACE_MARKER_A_20')||!fs.readFileSync(pair20[1].filePath,'utf8').includes('RACE_MARKER_B_20'))throw Error('concurrent native markdown exports collided');
  checks.concurrentNativeExportNoOverwrite=true;
  const textPair20=await js('Promise.all([window.resumeDesktop.shell.saveTextFile({defaultFileName:"synthetic-race-20.json",extension:"json",content:"A"}),window.resumeDesktop.shell.saveTextFile({defaultFileName:"synthetic-race-20.json",extension:"json",content:"B"})])');
  if(textPair20[0].filePath===textPair20[1].filePath||fs.readFileSync(textPair20[0].filePath,'utf8')!=='A'||fs.readFileSync(textPair20[1].filePath,'utf8')!=='B')throw Error('concurrent text exports collided');
  checks.concurrentTextExportNoOverwrite=true;
  const countBefore20=fs.readdirSync(main.exportsDir).length;
  const originalDialog20=dialog.showSaveDialog;
  try{
    dialog.showSaveDialog=async()=>({canceled:true});
    const canceled=await js('window.resumeDesktop.pdf.export('+JSON.stringify({slug:'',document:disabled20,saveAs:true})+')');
    const textCanceled=await js('window.resumeDesktop.shell.saveTextFile({defaultFileName:"synthetic-cancel-20.json",extension:"json",content:"no write",saveAs:true})');
    if(!canceled.canceled||!textCanceled.canceled||fs.readdirSync(main.exportsDir).length!==countBefore20)throw Error('cancel created an export file');
  }finally{dialog.showSaveDialog=originalDialog20;}
  checks.exportCancellationReadOnly=true;
  if(JSON.stringify(await main.store.getResume('runner-fixture'))!==source20)throw Error('cross-format export changed original document');
  checks.nativeCrossFormatSourceUnchanged=true;


  // Inspect actual rendered header geometry, not screenshot existence alone.
  const headerGeometry=()=>js('(()=>{const h=document.querySelector("header[aria-label=\\"工作台顶栏\\"]");const rect=h.getBoundingClientRect();const nodes=[...h.querySelectorAll("button, select, [aria-label=\\"本地保存状态\\"]")].filter(e=>e.getClientRects().length);return {width:innerWidth,height:rect.height,overflow:nodes.filter(e=>{const r=e.getBoundingClientRect();return r.left<rect.left-1||r.right>rect.right+1||r.top<rect.top-1||r.bottom>rect.bottom+1||r.height<10;}).map(e=>e.innerText||e.getAttribute("aria-label")),saveHeight:h.querySelector("[aria-label=\\"本地保存状态\\"]").getBoundingClientRect().height,saveText:h.querySelector("[aria-label=\\"本地保存状态\\"]").innerText};})()');
  const resizeHeader=async width=>{win.setContentSize(width,860);await sleep(350);const g=await headerGeometry();if(g.overflow.length||g.saveHeight>32||!g.saveText.includes('已保存'))throw Error('header geometry failed '+JSON.stringify(g));return g;};
  win.setMinimumSize(760,650);
  const wideHeader=await resizeHeader(1440);await capture('60-header-wide');
  const mediumHeader=await resizeHeader(1080);await capture('61-header-medium');
  const narrowHeader=await resizeHeader(900);await capture('62-header-narrow');
  const headerAction=label=>js('(()=>{const e=document.querySelector("[aria-label="+JSON.stringify('+JSON.stringify(label)+')+"]");if(!e||e.disabled)return false;e.click();return true})()');
  const popupInView=selector=>js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return false;const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&r.width>100})()');
  if(!await headerAction('设置自定义脱敏敏感词'))throw Error('privacy popup unavailable');
  await until('privacy popup within narrow window',()=>popupInView('header [aria-label="脱敏敏感词设置"]'));
  const popupContentFits=selector=>js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return false;return e.scrollWidth<=e.clientWidth+1&&[...e.querySelectorAll("p,button,label")].every(n=>n.scrollWidth<=n.clientWidth+1)})()');
  if(!await popupContentFits('header [aria-label="脱敏敏感词设置"]'))throw Error('privacy popup internal text overflow');
  await capture('64-header-narrow-privacy-popup');
  await click('完成');
  if(!await headerAction('更多导出格式'))throw Error('export popup unavailable');
  await until('export popup within narrow window',()=>popupInView('header [role=menu]'));
  if(!await popupContentFits('header [role=menu]'))throw Error('export popup internal text overflow');
  await capture('65-header-narrow-export-menu');
  await headerAction('更多导出格式');
  checks.headerPopupsVisible=true;
  if(narrowHeader.width>960||wideHeader.width<narrowHeader.width||mediumHeader.width<narrowHeader.width)throw Error('requested width not exercised '+JSON.stringify([wideHeader,mediumHeader,narrowHeader]));
  checks.headerResponsive=true;
  await resizeHeader(1440);
  win.setMinimumSize(1080,720);
  // Real renderer IPC: editor is allowed, another window with identical preload is not.
  const { BrowserWindow, ipcMain } = require('electron');
  const rogue = new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'dist-electron','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  try {
    await rogue.loadFile(path.join(__dirname,'dist','index.html'));
    const denied=await rogue.webContents.executeJavaScript('window.resumeDesktop.resumes.list().then(()=>false,()=>true)');
    if(!denied)throw Error('untrusted window was able to list resumes');
    const aiDenied=await rogue.webContents.executeJavaScript('window.resumeDesktop.ai.getSettings().then(()=>false,()=>true)');
    if(!aiDenied)throw Error('untrusted window read AI settings');
    const evidenceDenied=await rogue.webContents.executeJavaScript('window.resumeDesktop.evidence.get().then(()=>false,()=>true)');
    if(!evidenceDenied)throw Error('untrusted window read evidence index');
    checks.rogueEvidenceDenied=true;
  } finally {rogue.destroy();}
  checks.rogueWindowDenied=true;
  const deniedPrint=await js('window.resumeDesktop.pdf.getPrintPayload("wrong-job").then(()=>false,()=>true)');
  if(!deniedPrint)throw Error('editor read unauthorized print job');
  checks.editorPrintPayloadDenied=true;
  const deniedShell=await js('window.resumeDesktop.shell.openPath("C:\\\\Windows\\\\System32\\\\cmd.exe").then(()=>false,()=>true)');
  if(!deniedShell)throw Error('unsafe shell path accepted');
  checks.unsafeShellDenied=true;
  await win.webContents.executeJavaScript("window.resumeDesktop.shell.saveTextFile({defaultFileName:'bad.exe',extension:'exe',content:'synthetic'}).then(()=>false,()=>true)").then(v=>{if(!v)throw new Error('unsafe text export accepted');checks.unsafeTextExportDenied=true;});
  const beforeUrl=win.webContents.getURL();
  await js('(()=>{const a=document.createElement("a");a.href="https://example.invalid/";document.body.append(a);a.click();return true})()');
  await sleep(250);
  if(win.webContents.getURL()!==beforeUrl)throw Error('navigation escape');
  checks.navigationDenied=true;
  const popupsBefore=BrowserWindow.getAllWindows().length;
  await js('(()=>{window.open("https://example.invalid/");return true})()');
  await sleep(200);
  if(BrowserWindow.getAllWindows().length!==popupsBefore)throw Error('unexpected popup');
  checks.popupDenied=true;
  const csp=await js('document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content||""');
  if(!csp.includes("object-src")||!csp.includes("connect-src"))throw Error('production CSP missing');
  checks.productionCspPresent=true;

  const originalSave = main.store.saveResume.bind(main.store);
  let failSave = true;
  main.store.saveResume = async (slug, doc, options) => {
    (checks.saveTrace ??= []).push({slug,name:doc?.basic?.name,failSave});
    if (slug === 'runner-fixture' && failSave) throw Error('受控写入失败');
    try {const saved=await originalSave(slug,doc,options);checks.saveTrace.push({saved:saved.basic.name});return saved;}
    catch(err){checks.saveTrace.push({error:err.message});throw err;}
  };
  await js('(()=>{const e=document.querySelector("#basic-field-name");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"演示候选人（修改）");e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  await until('visible save failure', () => js('[...document.querySelectorAll("[title]")].some(e=>e.title.includes("受控写入失败"))'));
  win.setMinimumSize(760,650);win.setContentSize(900,860);await sleep(350);
  const failedHeader=await headerGeometry();
  if(failedHeader.overflow.length||!failedHeader.saveText.includes('保存失败')||!failedHeader.saveText.includes('重试保存'))throw Error('narrow save error inaccessible '+JSON.stringify(failedHeader));
  await capture('63-header-narrow-save-error');
  win.setContentSize(1440,920);win.setMinimumSize(1080,720);await sleep(350);
  checks.headerNarrowSaveError=true;
  await capture('02-save-error');
  let closeDialogCount = 0;
  const originalDialog = dialog.showMessageBoxSync;
  dialog.showMessageBoxSync = () => { closeDialogCount++; return 0; };
  win.close();
  await until('failed close shows explicit decision', () => closeDialogCount > 0);
  if (win.isDestroyed()) throw Error('window closed after failed save');
  dialog.showMessageBoxSync = originalDialog;
  checks.closeBlocked = true;
  failSave = false;
  await click('重试保存');
  try { await until('edit persisted after retry', async () => (await main.store.getResume('runner-fixture')).basic.name === '演示候选人（修改）'); }
  catch(err) { checks.savedName=(await main.store.getResume('runner-fixture')).basic.name; checks.uiName=await js('document.querySelector("#basic-field-name")?.value');checks.uiHead=await js('document.body.innerText.slice(0,400)'); await capture('03-retry-failure'); throw err; }
  await until('saved state', () => bodyHas('已保存至本地硬盘'));
  await capture('03-save-recovered');
  checks.saveRecovered = true;

  let providerCalls = 0;
  let approvedMessages;
  let lastAiRequest=null;
  server = http.createServer((req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    if(req.method!=='POST'||!['/v1/chat/completions','/second/chat/completions'].includes(req.url)){res.writeHead(404);res.end();return;}
    const second=req.url.startsWith('/second/');
    if(req.headers.authorization !== 'Bearer '+(second?'synthetic-second-key':'synthetic-test-key')){res.writeHead(401);res.end();return;}
    checks.mainProcessCredentialUsed = true;
    let raw=''; req.on('data',chunk=>raw+=String(chunk));
    req.on('end',()=>{
      providerCalls++; const body=JSON.parse(raw);
      lastAiRequest={second,body};
      if(!second)checks.exactPreviewMatched=JSON.stringify(body.messages)===JSON.stringify(approvedMessages);
      let content='- 学生达标率提高30%。';
      if(second){
        const user=JSON.parse(body.messages[1].content);
        if(typeof user.draftText==='string'){
          const selected=(user.toolResults?.inspect_block_facts??[]).flatMap(row=>row.sources.filter(s=>s.scope==='record'));
          content='感谢审阅。\n'+user.draftText+'\n'+(selected.length?selected[0].facts.split('\n')[0]:'我获得了30%的提升。');
        }
        else if(typeof user.originalText==='string')content=user.originalText+'\n- 核对合成资料。';
        else if(user.mode==='workflow')content=JSON.stringify({steps:[{action:'clarify',blockKeys:['B1'],reason:'合成计划第一步：核对教育表达'},{action:'concise',blockKeys:['B2'],reason:'DISPLAY_ONLY_PLAN_REASON'}]});
        else if(user.mode==='ask')content='仅供参考：当前可见正文可以更简洁。';
        else if(user.mode==='plan')content='建议先核对经历，再精简表达，不增加事实。';
        else if(user.mode==='co-create'){
          const b=user.toolResults.list_visible_blocks[0],f=user.toolResults.inspect_block_facts[0].sources[0];
          content=JSON.stringify([{blockKey:b.blockKey,suggestedText:b.text+'\n- '+(user.goal.includes('本步骤：')?'核对分步合成内容。':'整理实验记录。'),reason:'合成改写',factIds:[f.id]},{blockKey:'basic.name',suggestedText:'非法身份修改'}]);
        }else if(Array.isArray(user.blocks)){
          const b=user.blocks[0];
          content=JSON.stringify([{blockKey:b.blockKey,suggestedText:b.text+'\n- 复核合成实验数据。',reason:'整卷合成候选',factIds:[b.sources[0].id]}]);
        }else if(user.currentSettings&&typeof user.goal==='string'){
          content=JSON.stringify({reason:'合成版式微调',changes:{baseFontSize:14,pagePadding:24,lineHeight:1.2}});
        }else content='OK';
      }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));
    });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const settings={enabled:true,providerLabel:'Isolated mock',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'synthetic-test-key',model:'synthetic'};
  fs.writeFileSync(path.join(main.dataDir,'.ai-settings.json'), JSON.stringify(settings));
  const migrated = await js('window.resumeDesktop.ai.getSettings()');
  if (migrated.apiKey !== '' || migrated.hasApiKey !== true) throw Error('renderer credential exposure or migration failed');
  const stored = JSON.parse(fs.readFileSync(path.join(main.dataDir,'.ai-settings.json'),'utf8'));
  if (stored.schemaVersion!==2 || stored.profiles[0].apiKey !== undefined || !stored.profiles[0].encryptedApiKey || JSON.stringify(stored).includes('synthetic-test-key')) throw Error('plaintext credential retained');
  checks.osCredentialMigration = true;
  await click('诊断优化');
  await click('AI 润色 Diff');
  await until('AI config loaded', () => bodyHas('已启用 · 修改'));
  await click('生成润色对比 Diff');
  await until('preview appears',()=>bodyHas('发送前确认（尚未调用模型）'));
  if(providerCalls!==0)throw Error('request sent before confirmation');
  await capture('04a-outbound-preview');
  await click('取消发送');
  await sleep(200);
  if(providerCalls!==0)throw Error('cancelled preview sent a request');
  checks.cancelledPreviewNoNetwork=true;
  await click('生成润色对比 Diff');
  await until('preview reopened',()=>bodyHas('发送前确认（尚未调用模型）'));
  approvedMessages=await js('Array.from(document.querySelectorAll("section[aria-label=\\\"AI 数据发送预览\\\"] pre")).map((e,i)=>({role:i===0?"system":"user",content:e.textContent}))');
  await click('确认发送给模型');
  await until('fact guard appears', () => bodyHas('我已核对以上事实，确认属实'));
  const blocked = await js('[...document.querySelectorAll("button")].find(b=>b.innerText.includes("采纳替换"))?.disabled === true');
  if (!blocked) throw Error('risky single polish was not blocked');
  await capture('04-ai-fact-review');
  checks.riskRequiresApproval = true;
  if(providerCalls!==1||!checks.exactPreviewMatched)throw Error('request did not match preview');
  const origSnapshot = main.store.createSnapshot.bind(main.store);
  main.store.createSnapshot = async () => { throw Error('受控快照失败'); };
  await js('(()=>{const l=[...document.querySelectorAll("label")].find(x=>x.innerText.includes("我已核对以上事实"));l?.querySelector("input")?.click();return !!l})()');
  if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText.includes("采纳替换"))?.disabled===true'))throw Error('single without PDF review was enabled');
  await click('试渲染单段提案');
  await until('single actual PDF review',()=>bodyHas('真实 PDF 前后对照（本地试渲染）'),45000);
  await js('(()=>{const e=document.querySelector("section[aria-label=\\\"真实 PDF 前后对照\\\"]");e?.scrollIntoView({block:"start"});return true})()');
  await capture('04b-single-pdf-review');
  const singleConfirm=await js('(()=>{const l=[...document.querySelectorAll("label")].find(e=>e.innerText.includes("我已检查真实 PDF 前后页面，批准当前正文候选"));const box=l?.querySelector("input");if(!box||box.disabled)return false;box.click();return true})()');
  if(!singleConfirm)throw Error('single candidate PDF blocked: '+await js('document.querySelector("section[aria-label=\\\"真实 PDF 前后对照\\\"]")?.innerText'));
  checks.singlePdfReview=true;
  await click('采纳替换（可 Ctrl+Z）');
  await until('snapshot error surfaced', () => bodyHas('受控快照失败'));
  if ((await main.store.getResume('runner-fixture')).education[0].description.includes('30%')) throw Error('failed snapshot mutated saved content');
  await capture('05-ai-snapshot-blocked');
  checks.snapshotFailureBlocked = true;
  main.store.createSnapshot = origSnapshot;
  await click('采纳替换（可 Ctrl+Z）');
  await until('approved patch persisted', async () => (await main.store.getResume('runner-fixture')).education[0].description.includes('30%'));
  checks.approvedPatchApplied = true;
  if(await bodyHas('受控快照失败')) throw Error('recovered snapshot error remains visible');
  checks.recoveredErrorCleared=true;
  await capture('06-ai-applied');
  const saved = await main.store.getResume('runner-fixture');
  const pdf = await main.renderDocumentToPdf(saved);
  if (!pdf.subarray(0,5).equals(Buffer.from('%PDF-'))) throw Error('invalid PDF');
  fs.writeFileSync(path.join(out,'actual-export.pdf'),pdf);
  const png = await main.renderDocumentToPng(saved);
  fs.writeFileSync(path.join(out,'actual-export.png'),png);
  checks.pdfBytes=pdf.length;
  checks.pngBytes=png.length;

  // An independent writer changes the disk version while the real editor still has its old revision.
  await click('内容编辑');
  await until('editor visible',()=>js('!!document.querySelector("#basic-field-name")'));
  const externalBase=await main.store.getResume('runner-fixture');
  await originalSave('runner-fixture',{...externalBase,basic:{...externalBase.basic,name:'外部写入的新版本'}},{requireExisting:true});
  await js('(()=>{const e=document.querySelector("#basic-field-name");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"本地未保存草稿");e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  await until('revision conflict shown',()=>bodyHas('简历已被其他窗口或进程修改'));
  if((await main.store.getResume('runner-fixture')).basic.name!=='外部写入的新版本')throw Error('stale editor overwrote disk');
  checks.staleEditorRejected=true;
  await capture('07-revision-conflict');
  const originalSaveDialog=dialog.showSaveDialog;
  const draftPath=path.join(out,'synthetic-recovery-draft.json');
  dialog.showSaveDialog=async()=>({canceled:false,filePath:draftPath});
  await click('另存未保存草稿');
  await until('draft saved without changing original',()=>fs.existsSync(draftPath));
  const draft=JSON.parse(fs.readFileSync(draftPath,'utf8'));
  if(draft.basic.name!=='本地未保存草稿')throw Error('backup contains wrong draft');
  dialog.showSaveDialog=originalSaveDialog;
  checks.unsavedDraftBackedUp=true;
  await js('(()=>{window.confirm=()=>false;return true})()');
  await click('重载磁盘版本');
  if(await js('document.querySelector("#basic-field-name").value')!=='本地未保存草稿')throw Error('cancelled reload discarded draft');
  checks.cancelledReloadPreservedDraft=true;
  await js('(()=>{window.confirm=()=>true;return true})()');
  await click('重载磁盘版本');
  await until('latest disk version opened',()=>js('document.querySelector("#basic-field-name")?.value==="外部写入的新版本"'));
  if(await bodyHas('简历已被其他窗口或进程修改'))throw Error('stale conflict banner after reload');
  checks.diskReloadRecovered=true;
  await capture('08-conflict-recovered');
  // Real UI: archive a synthetic version while retaining the master and recover through recycle bin.
  const beforeTrash=await main.store.getResume('runner-fixture');
  const originalRevision=JSON.stringify([beforeTrash.id,beforeTrash.updatedAt]);
  await click('版本母库');
  await until('versions pane',()=>bodyHas('版本与母库管理'));
  await js('(()=>{window.confirm=()=>true;return true})()');
  const deleted=await js('(()=>{const b=[...document.querySelectorAll("button[aria-label]")].find(e=>e.getAttribute("aria-label").startsWith("删除"));if(!b)return false;b.click();return true})()');
  if(!deleted)throw Error('missing archive action');
  await until('archived to trash',async()=>{try{await main.store.getResume('runner-fixture');return false;}catch{return (await main.store.listTrash()).items.length===1;}});
  await until('version transition settled',()=>js('document.querySelector(".studio-shell")?.getAttribute("aria-busy")==="false"'));
  const opened=await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.includes("本地版本回收站"));if(!b)return false;b.click();return true})()');
  if(!opened)throw Error('missing recycle bin');
  await until('archive visible',()=>bodyHas('恢复原版本'));
  await capture('09-recycle-bin');
  checks.recycleBinVisible=true;
  await click('恢复原版本');
  await until('archived original restored',async()=>{try{return (await main.store.getResume('runner-fixture')).id===beforeTrash.id&&(await main.store.listTrash()).items.length===0;}catch{return false;}});
  const recovered=await main.store.getResume('runner-fixture');
  if(JSON.stringify([recovered.id,recovered.updatedAt])===originalRevision)throw Error('restore reused stale revision');
  if(recovered.basic.name!==beforeTrash.basic.name)throw Error('restore lost content');
  checks.recycleBinRestored=true;
  await until('restored version listed',()=>bodyHas('runner-fixture.json'));
  await capture('10-recycle-restored');
  // Real process interruption, explicit owner check and UI recovery.
  const {spawn}=require('node:child_process');
  const child=spawn('node',['--import','tsx',path.join(__dirname,'src/server/lockCrashWorker.ts'),main.dataDir],{cwd:__dirname,stdio:['ignore','pipe','pipe']});
  const code=await new Promise((resolve,reject)=>{
    let stderr='';child.stderr.on('data',c=>stderr+=String(c));
    const timer=setTimeout(()=>{child.kill();reject(Error('lock worker watchdog expired'))},12000);
    child.once('error',err=>{clearTimeout(timer);reject(err)});
    child.once('close',code=>{clearTimeout(timer);if(code!==7)reject(Error('lock worker failed: '+stderr.slice(0,300)));else resolve(code)});
  });
  if(code!==7)throw Error('crash fixture did not exit');
  await click('检查写入锁');
  await until('lock owner confirmed exited',()=>bodyHas('可安全归档的遗留锁'));
  await js('(()=>{document.querySelector("[aria-label=\\\"本地写入锁检查\\\"]")?.scrollIntoView({block:"center"});return true})()');
  await capture('11-dead-lock-inspected');
  await click('确认恢复遗留锁');
  await until('old lock archived',()=>bodyHas('当前没有写入锁'));
  if(fs.existsSync(path.join(main.dataDir,'.resume-write-lock')))throw Error('old lock remained');
  if(fs.readdirSync(path.join(main.dataDir,'.lock-recovery-history')).length!==1)throw Error('recovery evidence missing');
  checks.crashedLockRecovered=true;
  await capture('12-dead-lock-recovered');

  // Real career UI: multiple inputs, external update, retained draft, explicit backup and reload.
  await click('求职面试');
  await until('ledger loaded',()=>bodyHas('已读取本地台账'));
  const setInput=async(selector,value)=>js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return false;const proto=e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  if(!await setInput('input[placeholder="单位/学校名称（必填）"]','虚构招聘单位'))throw Error('career input missing');
  const selected=await js('(()=>{const e=document.querySelector("select[aria-label=\\\"关联本地简历版本\\\"]");return {value:e?.value,label:e?.selectedOptions[0]?.textContent}})()');
  if(selected.value!=='master'||!selected.label.includes('关联母库'))throw Error('master version selector does not reflect actual target');
  checks.masterLinkSelectorCorrect=true;
  await click('记一笔');
  await until('application created',async()=>(await main.store.getApplications()).applications.some(a=>a.company==='虚构招聘单位'));
  await until('career row visible',()=>bodyHas('虚构招聘单位'));
  const before=await main.store.getApplications();
  await main.store.saveApplications({...before,applications:before.applications.map(a=>({...a,notes:'外部已保存备注'}))},before.revision);
  const notes='textarea[placeholder="记录笔试真题、试讲课题或面试复盘..."]';
  if(!await setInput(notes,'本地未保存台账草稿'))throw Error('notes input missing');
  await until('career conflict visible',()=>bodyHas('投递台账已被其他操作更新'));
  if((await main.store.getApplications()).applications[0].notes!=='外部已保存备注')throw Error('stale ledger overwritten');
  checks.careerConflictRejected=true;
  await capture('13-ledger-conflict');
  const saveDialog=dialog.showSaveDialog;
  const careerDraftPath=path.join(out,'synthetic-ledger-draft.json');
  dialog.showSaveDialog=async()=>({canceled:false,filePath:careerDraftPath});
  await click('另存台账草稿');
  await until('ledger draft file',()=>fs.existsSync(careerDraftPath));
  if(JSON.parse(fs.readFileSync(careerDraftPath,'utf8')).applications[0].notes!=='本地未保存台账草稿')throw Error('wrong career draft');
  dialog.showSaveDialog=saveDialog;
  checks.careerDraftBackedUp=true;
  // Navigate away and back: draft must survive panel unmount.
  await click('版本母库');await click('求职面试');
  await until('ledger draft survives unmount',()=>js('document.querySelector('+JSON.stringify(notes)+')?.value==="本地未保存台账草稿"'));
  checks.careerDraftSurvivedUnmount=true;
  await click('重载磁盘台账');
  await until('latest ledger read',()=>js('document.querySelector('+JSON.stringify(notes)+')?.value==="外部已保存备注"'));
  checks.careerReloadRecovered=true;
  await capture('14-ledger-reloaded');
  // A full quick-log action through the actual renderer, including the frozen PDF.
  await click('导出 PDF');
  await until('PDF export ready',()=>bodyHas('记入投递'));
  const quickOpened=await js('(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.innerText.includes("记入投递")&&!x.innerText.includes("确认"));if(!b)return false;b.click();return true})()');
  if(!quickOpened)throw Error('quick log button missing');
  await until('quick log dialog',()=>js('!!document.querySelector("[role=dialog][aria-label=\\\"记入投递并锁定永久快照\\\"]")'));
  const companySelector='[role="dialog"] input[placeholder="如：示例第一中学"]';
  if(!await setInput(companySelector,'虚构快照招聘单位'))throw Error('quick log company input missing');
  await click('确认记入并锁定快照');
  await until('quick log persisted',async()=>(await main.store.getApplications()).applications.some(a=>a.company==='虚构快照招聘单位'&&a.snapshotId));
  const entry=(await main.store.getApplications()).applications.find(a=>a.company==='虚构快照招聘单位');
  const archived=await main.store.getApplicationSnapshot(entry.snapshotId);
  if(archived.meta.applicationId!==entry.id||archived.document.id!=='synthetic-master')throw Error('quick log frozen snapshot mismatch');
  await until('quick log modal closed',()=>js('!document.querySelector("[role=dialog][aria-label=\\\"记入投递并锁定永久快照\\\"]")'));
  checks.quickLogArchived=true;
  await capture('15-quick-log-archived');
  // Multi-profile center: independent encrypted credentials and stale revision protection.
  await click('诊断优化');await click('AI 润色 Diff');
  await until('active profile loaded',()=>bodyHas('已启用 · 修改'));
  const firstProfile=await js('window.resumeDesktop.ai.getSettings()');
  await click('已启用 · 修改');
  await until('catalog controls visible',()=>bodyHas('新建模型档案'));
  await click('新建模型档案');
  await until('new disabled profile',()=>js('document.querySelector("input[aria-label=\\\"模型档案名称\\\"]")?.value==="新模型档案"'));
  const setValue=async(selector,value)=>{if(!await setInput(selector,value))throw Error('missing input '+selector)};
  await setValue('input[aria-label="模型档案名称"]','第二合成模型');
  await setValue('input[placeholder="OpenAI 兼容 Base URL"]','http://127.0.0.1:'+server.address().port+'/second');
  await setValue('input[type=password]','synthetic-second-key');
  await setValue('input[placeholder="模型名（如 deepseek-chat）"]','second-model');
  await js('(()=>{const label=[...document.querySelectorAll("label")].find(e=>e.innerText.includes("启用 AI 原地润色接口"));const b=label?.querySelector("input");if(b&&!b.checked)b.click();return !!b})()');
  await click('保存本地配置');
  await until('profile saved',()=>bodyHas('配置已保存；密钥由系统加密保护'));
  const catalog=await js('window.resumeDesktop.ai.listProfiles()');
  if(catalog.profiles.length!==2||catalog.profiles.some(p=>p.apiKey!==''||!p.hasApiKey)||catalog.activeProfileId===firstProfile.profileId||JSON.stringify(catalog).includes('synthetic-second-key'))throw Error('profile isolation failed');
  const secondProfile=catalog.profiles.find(p=>p.profileId===catalog.activeProfileId);
  const encrypted=JSON.parse(fs.readFileSync(path.join(main.dataDir,'.ai-settings.json'),'utf8'));
  if(encrypted.profiles.length!==2||encrypted.profiles.some(p=>!p.encryptedApiKey||p.apiKey!==undefined)||JSON.stringify(encrypted).includes('synthetic-second-key'))throw Error('profile credentials not encrypted');
  checks.multiProfileEncrypted=true;
  await capture('16-ai-model-center');
  const beforeProbe=providerCalls;
  await click('测试模型连接');
  await until('synthetic connectivity probe',()=>bodyHas('连接成功 · 合成探针返回 OK'));
  if(providerCalls!==beforeProbe+1||!lastAiRequest.second||lastAiRequest.body.max_tokens!==64||JSON.parse(lastAiRequest.body.messages[1].content).task!=='connection-probe'||JSON.stringify(lastAiRequest.body.messages).includes('演示候选人'))throw Error('connection probe was not synthetic');
  checks.syntheticConnectionProbe=true;
  await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==="测试模型连接");b?.scrollIntoView({block:"center"});return true})()');
  await capture('16b-ai-connectivity');
  const beforeStale=providerCalls;
  const refused=await js('window.resumeDesktop.ai.requestCompletion('+JSON.stringify({requestId:'53ad1c68-6b20-4b94-a267-601d633fcf3c',profile:{profileId:secondProfile.profileId,revision:'old-revision',baseUrl:secondProfile.baseUrl,model:secondProfile.model},systemPrompt:'synthetic',userPrompt:'synthetic'})+').then(()=>false,()=>true)');
  if(!refused||providerCalls!==beforeStale)throw Error('stale model request reached provider');
  checks.staleModelRequestRejected=true;
  await click('收起设置');
  // Read-only ask and plan; co-create through local patch approval and snapshot.
  await click('AI 自由任务');
  await setValue('textarea[aria-label="AI 自由任务目标"]','检查合成教育经历');
  await click('预览 AI 自由任务');
  await until('assistant preview',()=>bodyHas('自由任务发送前确认'));
  if(providerCalls!==beforeStale)throw Error('assistant sent before approval');
  await capture('17-ai-assistant-preview');
  await click('确认发送自由任务');
  await until('assistant answer',()=>bodyHas('当前可见正文可以更简洁'));
  const baseline=await main.store.getResume('master');
  if(lastAiRequest.body.model!=='second-model'||!lastAiRequest.second)throw Error('assistant route incorrect');
  await click('制定计划');
  await click('预览 AI 自由任务');
  await click('确认发送自由任务');
  await until('assistant plan',()=>bodyHas('建议先核对经历'));
  if(JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(baseline))throw Error('read-only mode modified resume');
  checks.assistantReadOnly=true;
  await capture('18-ai-assistant-plan');
  await click('协作改写');
  await click('预览 AI 自由任务');await click('确认发送自由任务');
  await until('assistant proposal',()=>bodyHas('合成改写'));
  const applyDisabled=await js('[...document.querySelectorAll("button")].find(b=>b.innerText.includes("应用已核对提案"))?.disabled===true');
  if(!applyDisabled)throw Error('assistant applies without approval');
  if(JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(baseline))throw Error('assistant modified before approval');
  await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.includes("应用已核对提案"));b?.scrollIntoView({block:"center"});return true})()');
  await capture('19-ai-assistant-proposal');
  await js('(()=>{const l=[...document.querySelectorAll("label")].find(e=>e.innerText.includes("已核对本条原文"));l?.querySelector("input")?.click();return !!l})()');
  if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText.includes("应用已核对提案"))?.disabled===true'))throw Error('text application was not gated by PDF preview');
  const beforeTextRender=providerCalls;
  await click('试渲染已选正文提案');
  await until('text native PDF comparison',()=>bodyHas('真实 PDF 前后对照（本地试渲染）'),45000);
  if(providerCalls!==beforeTextRender||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(baseline))throw Error('text PDF review modified document or called provider');
  await js('(()=>{const e=document.querySelector("section[aria-label=\\\"真实 PDF 前后对照\\\"]");e?.scrollIntoView({block:"start"});return true})()');
  await capture('19b-text-pdf-comparison');
  if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText.includes("应用已核对提案"))?.disabled===true'))throw Error('text application was not gated by PDF confirmation');
  const textConfirm=await js('(()=>{const l=[...document.querySelectorAll("label")].find(e=>e.innerText.includes("已检查正文修改后的真实 PDF 页面"));const box=l?.querySelector("input");if(!box||box.disabled)return false;box.click();return true})()');
  if(!textConfirm)throw Error('text native comparison is blocked: '+await js('document.querySelector("section[aria-label=\\\"真实 PDF 前后对照\\\"]")?.innerText'));
  checks.textPdfReview=true;
  await click('应用已核对提案（1）');
  await until('assistant applied',async()=>(await main.store.getResume('master')).education[0].description.includes('整理实验记录'));
  const patched=await main.store.getResume('master');
  if(patched.basic.name!==baseline.basic.name||patched.education[0].school!==baseline.education[0].school)throw Error('assistant changed protected field');
  checks.assistantPatchApproved=true;
  await capture('20-ai-assistant-applied');
  // Independent fact bank: actual UI add and explicit per-request scope, then concurrent revoke.
  await click('问答');
  await js('(()=>{const e=[...document.querySelectorAll("summary")].find(e=>e.textContent.includes("本地事实资料库"));if(!e)return false;e.click();return true})()');
  await click('加载 / 刷新事实库');
  await until('fact bank loaded',()=>bodyHas('当前简历没有记录'));
  const beforeFacts=await main.store.getResume('master');
  const callsBeforeFacts=providerCalls;
  const selectTarget=await js('(()=>{const e=document.querySelector("select[aria-label=\\"事实关联段落\\"]");if(!e)return false;const o=[...e.options].find(o=>o.value.startsWith("edu:"));if(!o)return false;e.value=o.value;e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  if(!selectTarget)throw Error('fact target select unavailable');
  await setValue('textarea[aria-label="事实陈述"]','整理 12 份合成实验记录');
  await setValue('input[aria-label="数值（可选）"]','12');
  await setValue('input[aria-label="单位（可选）"]','份');
  await setValue('input[aria-label="时间范围（可选）"]','2025.01-2025.06');
  await setValue('input[aria-label="本地证据位置 / 来源说明"]','SYNTHETIC_LOCAL_EVIDENCE_ONLY');
  const checkLabel=label=>js('(()=>{const l=[...document.querySelectorAll("label")].find(e=>e.innerText.includes('+JSON.stringify(label)+'));const b=l?.querySelector("input[type=checkbox]");if(!b||b.disabled)return false;if(!b.checked)b.click();return true})()');
  if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="确认保存事实")?.disabled===true'))throw Error('fact saved without user approval');
  if(!await checkLabel('允许今后逐次选择此外发事实')||!await checkLabel('我已核对该陈述'))throw Error('fact approval inputs missing');
  await click('确认保存事实');
  await until('fact record saved',()=>bodyHas('事实已保存到独立本地资料库'));
  const bank=await js('window.resumeDesktop.facts.get()');
  if(bank.records.length!==1||bank.records[0].verifiedStatus!=='user-confirmed'||bank.records[0].sensitivity!=='shareable'||!fs.existsSync(path.join(main.dataDir,'.fact-bank-v1.json')))throw Error('fact bank persistence failure');
  if(JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(beforeFacts)||providerCalls!==callsBeforeFacts)throw Error('fact save mutated resume or contacted provider');
  checks.factBankPersisted=true;
  await js('(()=>{const e=[...document.querySelectorAll("summary")].find(e=>e.textContent.includes("本地事实资料库"));e?.scrollIntoView({block:"start"});return true})()');
  await capture('30-fact-bank-saved');
  await click('预览 AI 自由任务');
  await until('default fact preview',()=>bodyHas('自由任务发送前确认'));
  const getFactPreview=()=>js('Array.from(document.querySelectorAll("section[aria-label=\\"自由任务发送预览\\"] pre")).map(e=>e.textContent).join("\\n")');
  if((await getFactPreview()).includes('整理 12 份合成实验记录'))throw Error('fact leaked by default');
  checks.factBankDefaultPrivate=true;
  await click('取消预览');
  if(!await checkLabel('加入本次 AI 任务'))throw Error('explicit fact selection unavailable');
  await click('预览 AI 自由任务');
  await until('selected fact preview',()=>bodyHas('自由任务发送前确认'));
  const factPreview=await getFactPreview();
  if(!factPreview.includes('整理 12 份合成实验记录')||!factPreview.includes('record-1')||factPreview.includes('SYNTHETIC_LOCAL_EVIDENCE_ONLY')||factPreview.includes(bank.records[0].id)||factPreview.includes(bank.records[0].docId))throw Error('fact preview privacy/identity mismatch');
  await js('(()=>{const e=document.querySelector("section[aria-label=\\"自由任务发送预览\\"]");e?.scrollIntoView({block:"start"});return true})()');
  await capture('31-fact-outbound-preview');
  await click('确认发送自由任务');
  await until('selected fact answer',()=>bodyHas('当前可见正文可以更简洁'));
  if(providerCalls!==callsBeforeFacts+1||!JSON.stringify(lastAiRequest.body.messages).includes('record-1')||JSON.stringify(lastAiRequest.body.messages).includes('SYNTHETIC_LOCAL_EVIDENCE_ONLY'))throw Error('fact request not scoped');
  checks.factSelectedPrivacy=true;
  const actualFactPayload=lastAiRequest.body.messages[1].content;
  if(JSON.stringify(lastAiRequest.body).includes('factBinding')||JSON.stringify(lastAiRequest.body).includes(bank.records[0].id))throw Error('internal fact binding leaked');
  const binding={slug:'master',docId:bank.records[0].docId,bankRevision:bank.revision,ids:[bank.records[0].id],selectedKeys:[bank.records[0].blockKey]};
  const direct={requestId:'c0752ca1-26df-4e63-ab03-23f1c966ac53',profile:{profileId:secondProfile.profileId,revision:secondProfile.revision,baseUrl:secondProfile.baseUrl,model:secondProfile.model},systemPrompt:'synthetic',userPrompt:actualFactPayload};
  const unbound=await js('window.resumeDesktop.ai.requestCompletion('+JSON.stringify(direct)+').then(()=>false,e=>String(e.message).includes("缺少本地授权绑定"))');
  const altered={...direct,requestId:'c0752ca2-26df-4e63-ab03-23f1c966ac53',factBinding:binding,userPrompt:actualFactPayload.replace('整理 12 份合成实验记录','虚构成果')};
  const mismatched=await js('window.resumeDesktop.ai.requestCompletion('+JSON.stringify(altered)+').then(()=>false,e=>String(e.message).includes("事实外发清单"))');
  if(!unbound||!mismatched||providerCalls!==callsBeforeFacts+1)throw Error('main process accepted unbound or altered facts');
  checks.factExactPayloadGate=true;

  await click('预览 AI 自由任务');
  await until('fact revocation preview',()=>bodyHas('自由任务发送前确认'));
  await js('window.resumeDesktop.facts.revoke('+JSON.stringify({id:bank.records[0].id,bankRevision:bank.revision,confirmation:'REVOKE_FACT'})+')');
  await click('确认发送自由任务');
  await until('stale fact rejected',()=>bodyHas('本地事实库已变化'));
  if(providerCalls!==callsBeforeFacts+1)throw Error('revoked fact reached provider');
  checks.factRevocationBlocksOldPreview=true;
  const staleBinding={slug:'master',docId:bank.records[0].docId,bankRevision:bank.revision,ids:[bank.records[0].id],selectedKeys:[bank.records[0].blockKey]};
  const staleSend={requestId:'a6262ca1-26df-4e63-ab03-23f1c966ac53',profile:{profileId:secondProfile.profileId,revision:secondProfile.revision,baseUrl:secondProfile.baseUrl,model:secondProfile.model},systemPrompt:'synthetic',userPrompt:'{}',factBinding:staleBinding};
  const denied=await js('window.resumeDesktop.ai.requestCompletion('+JSON.stringify(staleSend)+').then(()=>false,e=>String(e.message).includes("事实库已被其他操作更新"))');
  if(!denied||providerCalls!==callsBeforeFacts+1)throw Error('main-process stale fact gate failed');
  checks.factMainProcessGate=true;

  await capture('32-fact-stale-rejected');
  await click('加载 / 刷新事实库');
  await until('revoked fact visible',()=>bodyHas('已撤销'));
  await capture('33-fact-revoked');
  await setValue('textarea[aria-label="事实陈述"]','核对 5 份合成练习材料');
  await setValue('input[aria-label="本地证据位置 / 来源说明"]','SYNTHETIC_SOURCE_SECOND');
  if(!await checkLabel('我已核对该陈述'))throw Error('second fact confirmation unavailable');
  await click('确认保存事实');
  await until('second local-only fact saved',()=>bodyHas('事实已保存到独立本地资料库'));
  const beforeCorrection=await js('window.resumeDesktop.facts.get()');
  const old=beforeCorrection.records.find(r=>r.verifiedStatus==='user-confirmed');
  if(!old||old.sensitivity!=='local-only'||beforeCorrection.records.length!==2)throw Error('local-only default failed');
  await click('更正事实');
  await setValue('textarea[aria-label="事实陈述"]','核对 6 份合成练习材料');
  if(!await checkLabel('我已核对该陈述'))throw Error('correction confirmation unavailable');
  await click('确认更正事实');
  await until('fact corrected',()=>bodyHas('事实已更正，原记录保留且不再可引用'));
  const afterCorrection=await js('window.resumeDesktop.facts.get()');
  const corrected=afterCorrection.records.find(r=>r.supersedesId===old.id);
  if(afterCorrection.records.length!==3||afterCorrection.records.find(r=>r.id===old.id)?.verifiedStatus!=='revoked'||!corrected||corrected.sensitivity!=='local-only'||corrected.assertion!=='核对 6 份合成练习材料')throw Error('fact correction not atomic or historical record lost');
  if(JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(beforeFacts)||providerCalls!==callsBeforeFacts+1)throw Error('fact correction modified resume or contacted provider');
  checks.factCorrectionHistory=true;
  const factList=()=>js('document.querySelector("[aria-label=\\"本地事实记录列表\\"]")?.innerText||""');
  const firstFact=await js('document.querySelector("[aria-label=\\"本地事实记录列表\\"] article")?.innerText||""');
  if(!firstFact.includes('核对 6 份合成练习材料')||!firstFact.includes('修订自：核对 5 份合成练习材料')||!firstFact.includes('教育经历'))throw Error('active fact origin or order missing');
  await setValue('input[aria-label="搜索本地事实"]','SYNTHETIC_SOURCE_SECOND');
  if(!(await factList()).includes('核对 6 份合成练习材料')||(await factList()).includes('整理 12 份合成实验记录'))throw Error('local fact search failed');
  await setValue('input[aria-label="搜索本地事实"]','');
  checks.factSearchAndOrigin=true;

  await js('(()=>{const e=[...document.querySelectorAll("summary")].find(e=>e.textContent.includes("本地事实资料库"));e?.scrollIntoView({block:"start"});return true})()');
  await capture('34-fact-corrected');

  await js('(()=>{const e=[...document.querySelectorAll("summary")].find(e=>e.textContent.includes("本地事实资料库"));if(e?.parentElement?.open)e.click();return true})()');

  await click('AI 版式优化');
  await setValue('textarea[aria-label="AI 版式目标"]','在不删减正文的情况下适度紧凑');
  const beforeLayout=await main.store.getResume('master');
  const beforeLayoutCalls=providerCalls;
  await click('预览版式请求');
  await until('layout request preview',()=>bodyHas('版式发送前确认'));
  if(providerCalls!==beforeLayoutCalls)throw Error('layout sent before confirmation');
  await capture('24-layout-outbound');
  await click('确认发送版式请求');
  await until('layout candidate',()=>bodyHas('版式候选（尚未应用）'));
  if(!lastAiRequest.second||JSON.stringify(lastAiRequest.body.messages).includes('演示候选人')||JSON.stringify(lastAiRequest.body.messages).includes('demo@example.invalid')||JSON.stringify(lastAiRequest.body.messages).includes('整理实验记录'))throw Error('layout sent candidate data');
  if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="应用已核对版式")?.disabled===true'))throw Error('layout not gated before render');
  await capture('25-layout-proposal');
  await click('本地试渲染版式对照');
  await until('layout native PDF comparison',()=>bodyHas('真实 PDF 前后对照（本地试渲染）'),45000);
  if(providerCalls!==beforeLayoutCalls+1||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(beforeLayout))throw Error('layout preview mutated disk or called model again');
  const images=await js('Array.from(document.querySelectorAll("section[aria-label=\\\"真实 PDF 前后对照\\\"] img")).map(e=>({complete:e.complete,width:e.naturalWidth,src:e.src.slice(0,22)}))');
  if(images.length!==2||images.some(e=>e.width<400||!e.complete||!e.src.startsWith("data:image/png")))throw Error('missing actual PDF page images '+JSON.stringify(images));
  await js('(()=>{const e=document.querySelector("section[aria-label=\\\"真实 PDF 前后对照\\\"]");e?.scrollIntoView({block:"start"});return true})()');
  await capture('26-layout-pdf-comparison');
  await click('展开全屏 PDF 对照');
  await until('full screen side by side',()=>js('document.querySelector("[role=dialog][aria-label=\\\"全屏 PDF 对照\\\"]")?.querySelectorAll("img").length===2'));
  await capture('26b-layout-fullscreen');
  await click('关闭全屏对照');
  if(await js('!!document.querySelector("[role=dialog][aria-label=\\\"全屏 PDF 对照\\\"]")'))throw Error('fullscreen did not close');
  checks.fullscreenPdfReview=true;
  if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="应用已核对版式")?.disabled===true'))throw Error('layout not gated before PDF approval');
  const layoutConfirm=await js('(()=>{const l=[...document.querySelectorAll("label")].find(e=>e.innerText.includes("我已检查真实 PDF 前后页面"));const box=l?.querySelector("input");if(!box||box.disabled)return false;box.click();return true})()');
  if(!layoutConfirm)throw Error('layout native comparison blocked: '+await js('document.querySelector("section[aria-label=\\\"真实 PDF 前后对照\\\"]")?.innerText'));
  await click('应用已核对版式');
  await until('layout applied',async()=>(await main.store.getResume('master')).globalSettings.baseFontSize===14);
  const afterLayout=await main.store.getResume('master');
  const omitStyle=d=>{const {globalSettings,updatedAt,...rest}=d;return rest};
  if(JSON.stringify(omitStyle(afterLayout))!==JSON.stringify(omitStyle(beforeLayout))||afterLayout.globalSettings.pagePadding!==24)throw Error('layout altered content');
  checks.layoutPrivacy=true;checks.layoutNativePdfReview=true;checks.layoutApproved=true;
  await capture('27-layout-applied');
  // The original full-JD entry uses the same native PDF gate; changing selected proposals invalidates approval.
  await click('整卷 JD 改写');
  await setValue('textarea[placeholder^="请在此或"]','示例岗位需要实验记录和科学教育');
  await click('生成整卷 JD 定向提案');
  await until('tailor preview',()=>bodyHas('发送前确认（尚未调用模型）'));
  await click('确认发送给模型');
  await until('tailor candidate',()=>bodyHas('整卷合成候选'));
  const beforeTailor=await main.store.getResume('master');
  await click('已核对后全选无机器预警项');
  const isTailorDisabled=()=>js('[...document.querySelectorAll("button")].find(b=>b.innerText.includes("应用已勾选的"))?.disabled===true');
  if(!await isTailorDisabled())throw Error('whole apply not gated');
  await click('试渲染整卷提案');
  await until('tailor native PDF comparison',()=>bodyHas('真实 PDF 前后对照（本地试渲染）'),45000);
  const approveWhole=()=>js('(()=>{const l=[...document.querySelectorAll("label")].find(e=>e.innerText.includes("我已检查真实 PDF 前后页面，批准当前正文候选"));const box=l?.querySelector("input");if(!box||box.disabled)return false;box.click();return true})()');
  if(!await approveWhole())throw Error('whole PDF blocked');
  await click('清空');
  if(!await isTailorDisabled())throw Error('clearing selection did not revoke approval');
  await click('已核对后全选无机器预警项');
  if(!await isTailorDisabled())throw Error('old review revived after selection change');
  checks.wholeReviewInvalidated=true;
  await click('试渲染整卷提案');
  await until('tailor rerender',()=>bodyHas('真实 PDF 前后对照（本地试渲染）'),45000);
  if(JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(beforeTailor))throw Error('whole preview modified disk');
  await js('(()=>{const e=document.querySelector("section[aria-label=\\\"真实 PDF 前后对照\\\"]");e?.scrollIntoView({block:"start"});return true})()');
  await capture('28-whole-pdf-review');
  if(!await approveWhole())throw Error('whole rerender blocked');
  await click('应用已勾选的 1 条修改');
  await until('whole applied',async()=>(await main.store.getResume('master')).education[0].description.includes('复核合成实验数据'));
  checks.wholePdfReview=true;
  await capture('29-whole-applied');
  // Same persisted fact, distinct explicit authorizations per text workflow.
  const unifiedBefore=await main.store.getResume('master');
  let unifiedBank=await js('window.resumeDesktop.facts.get()');
  const newFact={slug:'master',docRevision:JSON.stringify([unifiedBefore.id,unifiedBefore.updatedAt]),blockKey:'edu:'+unifiedBefore.education[0].id,bankRevision:unifiedBank.revision,fact:{kind:'achievement',assertion:'核对 12 份合成资料',value:'12',unit:'份',timeframe:'2025',evidenceRef:'UNIFIED_LOCAL_ONLY_SOURCE',sensitivity:'shareable'},confirmation:'CONFIRM_SELF_REPORTED_FACT'};
  unifiedBank=await js('window.resumeDesktop.facts.add('+JSON.stringify(newFact)+')');
  const unified=unifiedBank.records.find(r=>r.assertion===newFact.fact.assertion);
  const loadFacts=async()=>{
    await js('(()=>{const e=[...document.querySelectorAll("summary")].find(e=>e.textContent.includes("本地事实资料库"));if(e&&!e.parentElement.open)e.click();return !!e})()');
    await click('加载 / 刷新事实库');
    await until('shared fact bank loaded',async()=>await bodyHas('已读取本地事实资料库。')&&await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="加载 / 刷新事实库")?.disabled===false'));
  };
  const chooseUnified=()=>js('(()=>{const b=[...document.querySelectorAll("input[type=checkbox]")].find(e=>e.getAttribute("aria-label")==="选择事实 核对 12 份合成资料");if(!b||b.disabled)return false;if(!b.checked)b.click();return true})()');
  const textPreview=()=>js('Array.from(document.querySelectorAll("section[aria-label=\\"AI 数据发送预览\\"] pre")).map(e=>e.textContent)');
  const beforeUnifiedCalls=providerCalls;
  await click('单段精修');
  await loadFacts();
  await click('生成润色对比 Diff');await until('single default preview',()=>bodyHas('发送前确认（尚未调用模型）'));
  if(JSON.stringify(await textPreview()).includes(newFact.fact.assertion))throw Error('single default leaked fact');
  await click('取消发送');
  if(!await chooseUnified())throw Error('single fact choice missing');
  await click('生成润色对比 Diff');await until('single scoped preview',()=>bodyHas('本次明确外发 1 条本人确认事实'));
  const singleMessages=await textPreview();
  if(!JSON.stringify(singleMessages).includes(newFact.fact.assertion)||JSON.stringify(singleMessages).includes(newFact.fact.evidenceRef))throw Error('single fact preview privacy mismatch');
  await js('(()=>{const e=document.querySelector("section[aria-label=\\"AI 数据发送预览\\"]");e?.scrollIntoView({block:"start"});return true})()');
  await capture('35-single-fact-preview');
  await click('确认发送给模型');
  await until('single scoped result',()=>bodyHas('原文 vs 建议 Diff 审阅'));
  if(providerCalls!==beforeUnifiedCalls+1||JSON.stringify(lastAiRequest.body.messages.map(m=>m.content))!==JSON.stringify(singleMessages)||JSON.stringify(lastAiRequest.body).includes(unified.id)||JSON.stringify(lastAiRequest.body).includes('factBinding'))throw Error('single exact outbound scope failed');
  if(!await checkLabel('我已核对以上事实，确认属实'))throw Error('single fact approval unavailable');
  await click('试渲染单段提案');
  await until('single scoped PDF',()=>bodyHas('真实 PDF 前后对照（本地试渲染）'),45000);
  if(!await approveWhole())throw Error('single fact PDF approval failed');
  await js('(()=>{const e=document.querySelector("section[aria-label=\\"真实 PDF 前后对照\\"]");e?.scrollIntoView({block:"start"});return true})()');
  await capture('36-single-fact-review');
  await js('window.resumeDesktop.facts.revoke('+JSON.stringify({id:unified.id,bankRevision:unifiedBank.revision,confirmation:'REVOKE_FACT'})+')');
  await click('采纳替换（可 Ctrl+Z）');
  await until('single fact apply blocked',()=>bodyHas('本地事实库已变化'));
  if(JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(unifiedBefore))throw Error('revoked single evidence modified resume');
  checks.singleFactScoped=true;checks.singleFactRevokedAfterPdf=true;
  if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText.includes("采纳替换"))?.disabled===true'))throw Error('revoked single PDF approval still active');
  await capture('37-single-fact-revoked');
  unifiedBank=await js('window.resumeDesktop.facts.get()');
  const tailorFact={...newFact,bankRevision:unifiedBank.revision,fact:{...newFact.fact,assertion:'核对 13 份合成资料'}};
  unifiedBank=await js('window.resumeDesktop.facts.add('+JSON.stringify(tailorFact)+')');
  const tailorRecord=unifiedBank.records.find(r=>r.assertion===tailorFact.fact.assertion);
  await click('整卷 JD 改写');await loadFacts();
  await click('生成整卷 JD 定向提案');await until('whole default preview',()=>bodyHas('发送前确认（尚未调用模型）'));
  if(JSON.stringify(await textPreview()).includes(tailorFact.fact.assertion))throw Error('whole default leaked fact');
  await click('取消发送');
  const chooseTailor=await js('(()=>{const b=[...document.querySelectorAll("input[type=checkbox]")].find(e=>e.getAttribute("aria-label")==="选择事实 核对 13 份合成资料");if(!b||b.disabled)return false;b.click();return true})()');
  if(!chooseTailor)throw Error('whole fact selection unavailable');
  await click('生成整卷 JD 定向提案');await until('whole scoped preview',()=>bodyHas('本次明确外发 1 条本人确认事实'));
  const wholeMessages=await textPreview();
  if(!JSON.stringify(wholeMessages).includes(tailorFact.fact.assertion)||JSON.stringify(wholeMessages).includes(tailorFact.fact.evidenceRef))throw Error('whole fact preview privacy mismatch');
  await js('(()=>{const e=document.querySelector("section[aria-label=\\"AI 数据发送预览\\"]");e?.scrollIntoView({block:"start"});return true})()');
  await capture('38-whole-fact-preview');
  await click('确认发送给模型');
  await until('whole fact proposal',()=>bodyHas('整卷合成候选'));
  if(providerCalls!==beforeUnifiedCalls+2||JSON.stringify(lastAiRequest.body.messages.map(m=>m.content))!==JSON.stringify(wholeMessages)||JSON.stringify(lastAiRequest.body).includes(tailorRecord.id)||JSON.stringify(lastAiRequest.body).includes('factBinding'))throw Error('whole exact outbound scope failed');
  const wholeFacts=JSON.parse(lastAiRequest.body.messages[1].content).blocks.flatMap(b=>b.sources.filter(s=>s.scope==='record').map(s=>({block:b.blockKey,id:s.id})));
  if(wholeFacts.length!==1||wholeFacts[0].block!=='B1'||wholeFacts[0].id!=='record-1')throw Error('whole fact scope drift');
  await js('(()=>{const l=[...document.querySelectorAll("div.rounded-xl.border.p-3")].find(e=>e.innerText.includes("整卷合成候选"));const b=l?.querySelector("input[type=checkbox]");if(b&&!b.checked)b.click();return !!b})()');
  await click('试渲染整卷提案');await until('whole scoped PDF',()=>bodyHas('真实 PDF 前后对照（本地试渲染）'),45000);
  if(!await approveWhole())throw Error('whole scoped PDF approval missing');
  await js('window.resumeDesktop.facts.revoke('+JSON.stringify({id:tailorRecord.id,bankRevision:unifiedBank.revision,confirmation:'REVOKE_FACT'})+')');
  await click('应用已勾选的 1 条修改');await until('whole fact apply blocked',()=>bodyHas('本地事实库已变化'));
  if(JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(unifiedBefore))throw Error('revoked whole evidence modified resume');
  checks.wholeFactScoped=true;checks.wholeFactRevokedAfterPdf=true;
  if(!await isTailorDisabled())throw Error('revoked whole PDF approval still active');
  await capture('39-whole-fact-revoked');
  // Real two-step workflow: plan, explicit per-step preview/approval, save verification, skip.
  const workflowBefore=await main.store.getResume('master'),workflowCalls=providerCalls;
  await click('AI 自由任务');await click('分步工作');
  await setValue('textarea[aria-label="AI 自由任务目标"]','逐步检查并改善合成简历');
  await click('全选可见段落');
  await click('预览 AI 自由任务');await until('workflow plan preview',()=>bodyHas('自由任务发送前确认'));
  if(providerCalls!==workflowCalls)throw Error('workflow plan auto-sent');
  await click('确认发送自由任务');
  await until('structured workflow',()=>bodyHas('受控分步工作 · 0/2 步已处理'));
  if(providerCalls!==workflowCalls+1||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(workflowBefore))throw Error('workflow plan changed resume or auto-ran next step');
  const scrollWorkflow=()=>js('(()=>{const e=document.querySelector("section[aria-label=\\"受控分步工作\\"]");e?.scrollIntoView({block:"start"});return !!e})()');
  await scrollWorkflow();await capture('40-workflow-plan');
  await click('准备第 1 步');
  await until('first workflow step ready',()=>bodyHas('当前步骤'));
  if(providerCalls!==workflowCalls+1)throw Error('step preparation auto-sent');
  await click('预览 AI 自由任务');await until('workflow step preview',()=>bodyHas('自由任务发送前确认'));
  const workflowPreview=await getFactPreview();
  if(!workflowPreview.includes('本步骤：')||workflowPreview.includes('DISPLAY_ONLY_PLAN_REASON')||workflowPreview.includes('record-1'))throw Error('workflow copied unapproved evidence or plan instructions');
  await click('确认发送自由任务');await until('workflow step proposal',()=>bodyHas('核对分步合成内容'));
  const actualStep=JSON.parse(lastAiRequest.body.messages[1].content);
  if(actualStep.toolResults.list_visible_blocks.length!==1||!actualStep.toolResults.list_visible_blocks[0].label.includes('教育经历'))throw Error('workflow widened target');
  if(!await checkLabel('已核对本条原文'))throw Error('workflow proposal approval unavailable');
  await click('试渲染已选正文提案');await until('workflow native PDF',()=>bodyHas('真实 PDF 前后对照（本地试渲染）'),45000);
  if(!await checkLabel('已检查正文修改后的真实 PDF 页面'))throw Error('workflow PDF approval unavailable');
  await js('(()=>{const e=document.querySelector("section[aria-label=\\"真实 PDF 前后对照\\"]");e?.scrollIntoView({block:"start"});return true})()');
  await capture('41-workflow-step-pdf');
  await click('应用已核对提案（1）');
  await until('workflow first step saved',async()=>(await main.store.getResume('master')).education[0].description.includes('核对分步合成内容'));
  await until('workflow one step handled',()=>bodyHas('受控分步工作 · 1/2 步已处理'));
  const workflowAfter=await main.store.getResume('master');
  if(workflowAfter.experience[0].description!==workflowBefore.experience[0].description||providerCalls!==workflowCalls+2)throw Error('workflow changed unrelated block or auto-ran');
  await click('准备第 2 步');
  await until('second step active',()=>js('document.querySelector("section[aria-label=\\"受控分步工作\\"]")?.innerText.includes("当前步骤")'));
  if(providerCalls!==workflowCalls+2)throw Error('second step auto-sent');
  await click('预览 AI 自由任务');await until('second step preview',()=>bodyHas('自由任务发送前确认'));
  const secondPreview=await getFactPreview();
  if(secondPreview.includes('DISPLAY_ONLY_PLAN_REASON')||secondPreview.includes('record-1'))throw Error('second step copied plan text or evidence');
  await click('确认发送自由任务');await until('second step proposal',()=>bodyHas('合成改写'));
  const secondStepPayload=JSON.parse(lastAiRequest.body.messages[1].content);
  if(secondStepPayload.toolResults.list_visible_blocks.length!==1||!secondStepPayload.toolResults.list_visible_blocks[0].label.includes('工作经历'))throw Error('second step widened target');
  if(!await checkLabel('已核对本条原文'))throw Error('second step proposal approval missing');
  await click('试渲染已选正文提案');await until('second step native PDF',()=>bodyHas('真实 PDF 前后对照（本地试渲染）'),45000);
  if(!await checkLabel('已检查正文修改后的真实 PDF 页面'))throw Error('second step PDF approval missing');
  await click('应用已核对提案（1）');
  await until('workflow second step saved',async()=>(await main.store.getResume('master')).experience[0].description.includes('核对分步合成内容'));
  await until('workflow both steps handled',()=>bodyHas('受控分步工作 · 2/2 步已处理'));
  const workflowFinal=await main.store.getResume('master');
  if(workflowFinal.education[0].description!==workflowAfter.education[0].description||providerCalls!==workflowCalls+3)throw Error('second step changed first step or auto-ran');
  await click('核对保存并结束分步任务');
  await until('workflow disk verified',()=>bodyHas('已核对磁盘保存'));
  if(providerCalls!==workflowCalls+3||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(workflowFinal))throw Error('completion performed an unauthorized action');
  checks.workflowExplicitSteps=true;checks.workflowDiskVerified=true;checks.workflowTwoAppliedSteps=true;
  await scrollWorkflow();await capture('42-workflow-completed');
  await click('关闭分步记录');
  // A separate plan confirms the user can skip without sending or editing.
  const skipBaseline=await main.store.getResume('master'),skipCalls=providerCalls;
  await click('分步工作');await click('全选可见段落');
  await click('预览 AI 自由任务');await click('确认发送自由任务');
  await until('skip plan ready',()=>bodyHas('受控分步工作 · 0/2 步已处理'));
  await click('准备第 1 步');await until('skip step ready',()=>bodyHas('当前步骤'));
  await click('跳过当前步骤');await until('skip outcome',()=>bodyHas('受控分步工作 · 1/2 步已处理'));
  if(providerCalls!==skipCalls+1||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(skipBaseline))throw Error('skip sent data or edited resume');
  checks.workflowSkipNoNetwork=true;
  await scrollWorkflow();await capture('43-workflow-skipped');
  await click('结束本次分步工作');



  // Actual career text UI with exact preview and reversible local placeholders.
  await click('求职面试');await click('自荐信 / 话术');
  await until('career AI visible',()=>bodyHas('预览文案精修请求'));
  const callsBeforeCareer=providerCalls;
  await click('预览文案精修请求');
  await until('career preview',()=>bodyHas('文案发送前确认'));
  if(providerCalls!==callsBeforeCareer)throw Error('career request sent before preview approval');
  const careerMessages=await js('Array.from(document.querySelectorAll("section[aria-label=\\\"文案 AI 数据发送预览\\\"] pre")).map((e,i)=>({role:i===0?"system":"user",content:e.textContent}))');
  if(JSON.stringify(careerMessages).includes('演示候选人')||JSON.stringify(careerMessages).includes('demo@example.invalid'))throw Error('identity leaked into career preview');
  await capture('21-career-ai-preview');
  await click('确认发送文案给模型');
  await until('career proposed',()=>bodyHas('候选文案（本地还原）'));
  if(!lastAiRequest.second||JSON.stringify(lastAiRequest.body.messages)!==JSON.stringify(careerMessages))throw Error('career exact preview or route mismatch');
  if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="采纳文案草稿")?.disabled===true'))throw Error('career apply not gated');
  await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.includes("采纳文案草稿"));b?.scrollIntoView({block:"center"});return true})()');
  await capture('22-career-ai-review');
  await js('(()=>{const l=[...document.querySelectorAll("label")].find(e=>e.innerText.includes("我已核对候选文案"));l?.querySelector("input")?.click();return !!l})()');
  await click('采纳文案草稿');
  await until('career proposal adopted',()=>js('[...document.querySelectorAll("textarea")].some(e=>e.value.includes("感谢审阅。")&&e.value.includes("演示候选人"))'));
  checks.careerSharedGateway=true;checks.careerLocalIdentityRestored=true;
  await capture('23-career-ai-applied');
  const careerBefore=await main.store.getResume('master'),careerFactCalls=providerCalls;
  let careerBank=await js('window.resumeDesktop.facts.get()');
  const careerFactInput={slug:'master',docRevision:JSON.stringify([careerBefore.id,careerBefore.updatedAt]),blockKey:'edu:'+careerBefore.education[0].id,bankRevision:careerBank.revision,fact:{kind:'achievement',assertion:'核对 18 份合成面试资料',value:'18',unit:'份',timeframe:'2025',evidenceRef:'CAREER_LOCAL_ONLY_REF',sensitivity:'shareable'},confirmation:'CONFIRM_SELF_REPORTED_FACT'};
  careerBank=await js('window.resumeDesktop.facts.add('+JSON.stringify(careerFactInput)+')');
  const careerRecord=careerBank.records.find(r=>r.assertion===careerFactInput.fact.assertion);
  await js('(()=>{const s=[...document.querySelectorAll("summary")].find(e=>e.innerText.includes("本地事实资料库 · 文案选择"));if(s&&!s.parentElement.open)s.click();return !!s})()');
  await click('加载 / 刷新文案事实');
  await until('career fact loaded',()=>js('[...document.querySelectorAll("input")].some(e=>e.getAttribute("aria-label")==="文案选择事实 核对 18 份合成面试资料"&&!e.disabled)'));
  await click('预览文案精修请求');await until('career default private preview',()=>bodyHas('文案发送前确认'));
  const getCareerPreview=()=>js('Array.from(document.querySelectorAll("section[aria-label=\\"文案 AI 数据发送预览\\"] pre")).map((e,i)=>({role:i===0?"system":"user",content:e.textContent}))');
  if(JSON.stringify(await getCareerPreview()).includes(careerFactInput.fact.assertion))throw Error('career default leaked record');
  await click('取消文案发送');
  if(!await checkLabel(careerFactInput.fact.assertion))throw Error('career fact selection missing');
  await click('预览文案精修请求');await until('career scoped preview',()=>bodyHas('本次外发 1 条本人确认事实'));
  const careerScoped=await getCareerPreview(),cp=JSON.stringify(careerScoped);
  if(!cp.includes(careerFactInput.fact.assertion)||!cp.includes('record-1')||cp.includes(careerFactInput.fact.evidenceRef)||cp.includes(careerRecord.id)||cp.includes(careerRecord.docId))throw Error('career selected fact privacy mismatch');
  await js('(()=>{document.querySelector("section[aria-label=\\"文案 AI 数据发送预览\\"]")?.scrollIntoView({block:"start"});return true})()');
  await capture('45-career-fact-preview');
  await click('确认发送文案给模型');await until('career scoped proposal',()=>bodyHas('候选文案（本地还原）'));
  if(providerCalls!==careerFactCalls+1||JSON.stringify(lastAiRequest.body.messages)!==cp||JSON.stringify(lastAiRequest.body).includes('factBinding'))throw Error('career fact preview differs from request');
  if(!await checkLabel('我已核对候选文案'))throw Error('career fact approval missing');
  const oldDrafts=await js('[...document.querySelectorAll("textarea")].map(e=>e.value)');
  await js('window.resumeDesktop.facts.revoke('+JSON.stringify({id:careerRecord.id,bankRevision:careerBank.revision,confirmation:'REVOKE_FACT'})+')');
  await click('采纳文案草稿');await until('career stale approval blocked',()=>bodyHas('本地事实库已变化'));
  if(JSON.stringify(await js('[...document.querySelectorAll("textarea")].map(e=>e.value)'))!==JSON.stringify(oldDrafts)||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(careerBefore)||providerCalls!==careerFactCalls+1)throw Error('stale career approval modified a draft or resume');
  checks.careerFactScope=true;checks.careerFactRevokedApproval=true;
  await js('(()=>{const e=[...document.querySelectorAll("[role=alert]")].find(e=>e.innerText.includes("本地事实库已变化"));e?.scrollIntoView({block:"center"});return !!e})()');
  await capture('46-career-fact-revoked');
  // Verify the other two career output modes use independent approval and actual selected evidence.
  careerBank=await js('window.resumeDesktop.facts.get()');
  const extraCareerInput={...careerFactInput,bankRevision:careerBank.revision,fact:{...careerFactInput.fact,assertion:'整理 19 份合成岗位材料',value:'19'}};
  careerBank=await js('window.resumeDesktop.facts.add('+JSON.stringify(extraCareerInput)+')');
  const extraCareer=careerBank.records.find(r=>r.assertion===extraCareerInput.fact.assertion);
  const extraCalls=providerCalls;
  const switchCareerKind=kind=>js('(()=>{const e=document.querySelector("select[aria-label=\\"文案精修对象\\"]");e.value='+JSON.stringify(kind)+';e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  for(const [kind,label,shot] of [['email','投递邮件正文','50-career-email-facts'],['boss','招聘平台开场白','51-career-boss-facts']]){
    await switchCareerKind(kind);
    await js('(()=>{const s=[...document.querySelectorAll("summary")].find(e=>e.innerText.includes("本地事实资料库 · 文案选择"));if(s&&!s.parentElement.open)s.click();return !!s})()');
    await click('加载 / 刷新文案事实');
    await until('other career fact ready',()=>js('[...document.querySelectorAll("input")].some(e=>e.getAttribute("aria-label")==="文案选择事实 整理 19 份合成岗位材料"&&!e.disabled)'));
    await click('预览文案精修请求');await until('other career default preview',()=>bodyHas('文案发送前确认'));
    if(JSON.stringify(await getCareerPreview()).includes(extraCareerInput.fact.assertion))throw Error('career mode retained prior fact selection');
    await click('取消文案发送');
    if(!await checkLabel(extraCareerInput.fact.assertion))throw Error('career mode fact choice unavailable');
    await click('预览文案精修请求');await until('other career scoped preview',()=>bodyHas('本次外发 1 条本人确认事实'));
    const messages=await getCareerPreview(),payload=JSON.parse(messages[1].content);
    if(payload.kind!==label||!messages[1].content.includes(extraCareerInput.fact.assertion)||JSON.stringify(messages).includes(extraCareer.id)||JSON.stringify(messages).includes(extraCareer.evidenceRef))throw Error('career mode scope mismatch');
    await click('确认发送文案给模型');await until('other career scoped candidate',()=>bodyHas('候选文案（本地还原）'));
    if(JSON.stringify(lastAiRequest.body.messages)!==JSON.stringify(messages)||!await checkLabel('我已核对候选文案'))throw Error('career mode exact approval failed');
    await js('(()=>{document.querySelector("section[aria-label=\\"文案 AI 审核\\"]")?.scrollIntoView({block:"start"});return true})()');
    await capture(shot);
    const draftsBefore=await js('[...document.querySelectorAll("textarea")].map(e=>e.value)');
    await click('采纳文案草稿');
    await until('other career applied',async()=>{const current=await js('[...document.querySelectorAll("textarea")].map(e=>e.value)');return current.filter((s,i)=>s!==draftsBefore[i]).length===1&&current.some((s,i)=>s!==draftsBefore[i]&&s.includes(extraCareerInput.fact.assertion));});
    if(JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(careerBefore))throw Error('career mode mutated resume');
  }
  if(providerCalls!==extraCalls+2)throw Error('unexpected other career provider calls');
  checks.careerEmailAndBossFactScope=true;
  await js('window.resumeDesktop.facts.revoke('+JSON.stringify({id:extraCareer.id,bankRevision:careerBank.revision,confirmation:'REVOKE_FACT'})+')');
  // Create a synthetic cloned version through the real editor, then explicitly link a root fact.
  const linkBase=await main.store.getResume('master'),linkCalls=providerCalls;
  let linkBank=await js('window.resumeDesktop.facts.get()');
  const rootInput={slug:'master',docRevision:JSON.stringify([linkBase.id,linkBase.updatedAt]),blockKey:'edu:'+linkBase.education[0].id,bankRevision:linkBank.revision,fact:{kind:'achievement',assertion:'核对 24 份跨版本合成记录',value:'24',unit:'份',timeframe:'2025',evidenceRef:'LINK_LOCAL_ONLY_REF',sensitivity:'shareable'},confirmation:'CONFIRM_SELF_REPORTED_FACT'};
  linkBank=await js('window.resumeDesktop.facts.add('+JSON.stringify(rootInput)+')');
  const linkRoot=linkBank.records.find(r=>r.assertion===rootInput.fact.assertion);
  // Root fact evidence: actual renderer controls and trusted main-process native picker IPC.
  const evidenceCalls=providerCalls;
  await click('诊断优化');await click('AI 润色 Diff');await click('AI 自由任务');
  const refreshEvidenceFacts=async()=>{
    await js('(()=>{const e=[...document.querySelectorAll("summary")].find(e=>e.innerText.includes("本地事实资料库"));if(e&&!e.parentElement.open)e.click();return !!e})()');
    await click('加载 / 刷新事实库');
    await until('evidence fact bank ready',async()=>await bodyHas('已读取本地事实资料库。')&&await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="加载 / 刷新事实库")?.disabled===false'));
  };
  const openEvidence=linked=>js('(()=>{const a=[...document.querySelectorAll("article")].find(e=>e.innerText.includes("核对 24 份跨版本合成记录")&&e.innerText.includes("跨版本关联来源")==='+JSON.stringify(linked)+'&&[...e.querySelectorAll("button")].some(b=>b.innerText==="证据附件索引"));const b=[...a?.querySelectorAll("button")||[]].find(b=>b.innerText==="证据附件索引");if(!b||b.disabled)return false;b.click();return true})()');
  const scrollEvidence=()=>js('(()=>{document.querySelector("section[aria-label=\\"本地证据附件索引\\"]")?.scrollIntoView({block:"start"});return true})()');
  await refreshEvidenceFacts();
  if(!await openEvidence(false))throw Error('root evidence action missing');
  await click('加载 / 刷新附件索引');await until('empty evidence index',()=>bodyHas('已读取本地证据索引。'));
  if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="选择文件并关联证据")?.disabled===true'))throw Error('attachment consent not required');
  const evidenceSource=path.join(root,'synthetic-evidence-only.txt');
  const evidenceBytes=Buffer.from('SYNTHETIC_ATTACHMENT_PRIVATE_BYTES\n合成来源资料\n','utf8');
  fs.writeFileSync(evidenceSource,evidenceBytes);
  const evidenceNote='SYNTHETIC_ATTACHMENT_LOCAL_NOTE';
  await setValue('textarea[aria-label="附件来源说明"]',evidenceNote);
  if(!await checkLabel('我确认将选择的附件复制到本地'))throw Error('attachment consent missing');
  await scrollEvidence();await capture('53-evidence-consent');
  const nativeOpen=dialog.showOpenDialog;let pickerCalls=0;
  try{
    dialog.showOpenDialog=async(_owner,options)=>{pickerCalls++;if(options.properties.join(',')!=='openFile')throw Error('unexpected native picker options');return {canceled:true,filePaths:[]};};
    await click('选择文件并关联证据');await until('picker canceled',()=>bodyHas('已取消文件选择，未保存附件。'));
    if((await js('window.resumeDesktop.evidence.get()')).entries.length)throw Error('canceled picker modified index');
    const injected={slug:'master',docRevision:JSON.stringify([linkBase.id,linkBase.updatedAt]),factId:linkRoot.id,bankRevision:linkBank.revision,indexRevision:'empty-v1',note:evidenceNote,confirmation:'CONFIRM_LOCAL_EVIDENCE_COPY',selectedPath:evidenceSource};
    if(!await js('window.resumeDesktop.evidence.attach('+JSON.stringify(injected)+').then(()=>false,()=>true)')||pickerCalls!==1)throw Error('renderer supplied file path reached picker');
    dialog.showOpenDialog=async(_owner,options)=>{pickerCalls++;if(options.properties.join(',')!=='openFile')throw Error('unexpected native picker options');return {canceled:false,filePaths:[evidenceSource]};};
    await click('选择文件并关联证据');await until('evidence copied',()=>bodyHas('附件已复制到独立本地证据目录'));
  }finally{dialog.showOpenDialog=nativeOpen;}
  const attachedIndex=await js('window.resumeDesktop.evidence.get()'),attachedEvidence=attachedIndex.entries[0];
  const managedEvidence=path.join(main.dataDir,'.evidence-files-v1',attachedEvidence.id+'.txt');
  if(pickerCalls!==2||attachedIndex.entries.length!==1||attachedEvidence.factId!==linkRoot.id||attachedEvidence.note!==evidenceNote||!fs.readFileSync(managedEvidence).equals(evidenceBytes)||!fs.readFileSync(evidenceSource).equals(evidenceBytes)||JSON.stringify(attachedIndex).includes(evidenceSource)||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(linkBase)||JSON.stringify(await js('window.resumeDesktop.facts.get()'))!==JSON.stringify(linkBank))throw Error('evidence copy persistence or isolation failed');
  await click('校验副本 SHA-256');await until('evidence intact',()=>bodyHas('字节校验一致'));
  await click('核对本地附件目录');await until('clean evidence directory',()=>bodyHas('普通文件 1 个')&&bodyHas('未索引文件 0'));
  const vault=path.dirname(managedEvidence),orphan=path.join(vault,'synthetic-orphan.txt');
  fs.writeFileSync(orphan,'SYNTHETIC_ORPHAN_ONLY');
  await click('核对本地附件目录');await until('orphan detected',()=>bodyHas('未索引文件 1')&&bodyHas('系统未自动更改任何附件'));
  if(fs.readFileSync(orphan,'utf8')!=='SYNTHETIC_ORPHAN_ONLY')throw Error('directory audit modified orphan');
  await scrollEvidence();await capture('58-evidence-vault-audit');
  const originalOpenPath=require('electron').shell.openPath;let openedVault='';
  try{
    require('electron').shell.openPath=async p=>{openedVault=p;return '';};
    await click('打开本地证据目录');await until('vault directory opened',()=>openedVault===vault);
  }finally{require('electron').shell.openPath=originalOpenPath;}
  fs.unlinkSync(orphan);
  await until('previous evidence action settled',()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText==="核对本地附件目录"&&!b.disabled)'));
  await click('核对本地附件目录');await until('directory audit clean after explicit test cleanup',()=>bodyHas('未索引文件 0'));
  checks.evidenceVaultAuditNoMutation=true;checks.evidenceVaultOpenScoped=true;
  // The index disappearing must never authorize a new index over retained copies.
  const indexPath=path.join(main.dataDir,'.evidence-index-v1.json'),savedIndexPath=path.join(root,'synthetic-index-backup.json');
  fs.renameSync(indexPath,savedIndexPath);
  try{
    await click('加载 / 刷新附件索引');
    await until('lost index read',()=>bodyHas('有效关联 0')&&bodyHas('本地索引 0/200'));
    await click('核对本地附件目录');
    await until('lost index guarded',()=>bodyHas('证据索引缺失但目录仍有文件'));
    if(!await checkLabel('我确认将选择的附件复制到本地'))throw Error('evidence confirmation missing in lost-index test');
    if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="选择文件并关联证据")?.disabled===true'))throw Error('lost index did not disable import');
    const raw={slug:'master',docRevision:JSON.stringify([linkBase.id,linkBase.updatedAt]),factId:linkRoot.id,bankRevision:linkBank.revision,indexRevision:'empty-v1',note:'synthetic',confirmation:'CONFIRM_LOCAL_EVIDENCE_COPY'};
    let reopenedPicker=false;const originalPicker=dialog.showOpenDialog;
    try{dialog.showOpenDialog=async()=>{reopenedPicker=true;return {canceled:true,filePaths:[]};};
      const rejected=await js('window.resumeDesktop.evidence.attach('+JSON.stringify(raw)+').then(()=>false,e=>String(e).includes("禁止自动重建索引"))');
      if(!rejected||reopenedPicker||fs.existsSync(indexPath)||!fs.readFileSync(managedEvidence).equals(evidenceBytes))throw Error('lost index fail-closed gate failed');
    }finally{dialog.showOpenDialog=originalPicker;}
    await scrollEvidence();await capture('59-evidence-index-missing');
  }finally{fs.renameSync(savedIndexPath,indexPath);}
  await click('加载 / 刷新附件索引');await until('index manually restored',()=>bodyHas('有效关联 1')&&bodyHas('synthetic-evidence-only.txt'));
  await click('校验副本 SHA-256');await until('restored index valid',()=>bodyHas('字节校验一致'));
  checks.evidenceLostIndexFailClosed=true;

  await scrollEvidence();await capture('54-evidence-intact');
  fs.writeFileSync(managedEvidence,Buffer.alloc(evidenceBytes.length,65));
  await click('校验副本 SHA-256');await until('evidence changed',()=>bodyHas('本地副本已变化'));
  await click('在文件夹定位副本');await until('unsafe reveal denied',()=>bodyHas('副本缺失、已变化或不可读'));
  await scrollEvidence();await capture('55-evidence-tampered');
  fs.writeFileSync(managedEvidence,evidenceBytes);
  await click('校验副本 SHA-256');await until('evidence restored',()=>bodyHas('字节校验一致'));
  const nativeReveal=require('electron').shell.showItemInFolder;let revealed='';
  try{
    require('electron').shell.showItemInFolder=file=>{revealed=file;};
    await click('在文件夹定位副本');await until('evidence reveal requested',()=>revealed===managedEvidence);
  }finally{require('electron').shell.showItemInFolder=nativeReveal;}
  if(providerCalls!==evidenceCalls)throw Error('local attachment management contacted provider');
  checks.evidenceNativePickerConsent=true;checks.evidenceExactLocalCopy=true;checks.evidenceTamperDetected=true;checks.evidenceVerifiedReveal=true;
  await click('关闭附件索引');

  await click('版本母库');await click('基于当前版本');
  await setValue('input[placeholder="输入新岗位名称，如：物理教研员"]','合成关联测试版本');
  await click('创建');
  let linkSlug='';
  await until('clone opened',async()=>{
    const list=await main.store.listResumes(),summary=list.resumes.find(s=>s.title==='合成关联测试版本');
    if(!summary)return false;
    linkSlug=summary.slug;return await js('document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")?.value')===linkSlug;
  });
  const targetBefore=await main.store.getResume(linkSlug);
  if(targetBefore.id===linkBase.id||targetBefore.education[0].id!==linkBase.education[0].id)throw Error('clone identity unexpected');
  await click('诊断优化');await click('AI 润色 Diff');await click('AI 自由任务');
  await setValue('textarea[aria-label="AI 自由任务目标"]','检查跨版本事实');
  const loadLinkBank=async()=>{
    await js('(()=>{const e=[...document.querySelectorAll("summary")].find(e=>e.innerText.includes("本地事实资料库"));if(e&&!e.parentElement.open)e.click();return !!e})()');
    await click('加载 / 刷新事实库');
    await until('linked fact bank ready',async()=>await bodyHas('已读取本地事实资料库。')&&await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="加载 / 刷新事实库")?.disabled===false'));
  };
  await loadLinkBank();
  if(!await checkLabel('显示其他版本及孤立记录'))throw Error('other version records not exposed');
  await until('link root listed',()=>bodyHas(rootInput.fact.assertion));
  const chooseLink=()=>js('(()=>{const a=[...document.querySelectorAll("article")].find(e=>e.innerText.includes("核对 24 份跨版本合成记录")&&[...e.querySelectorAll("button")].some(b=>b.innerText==="关联到当前同源段落"));const b=[...a?.querySelectorAll("button")||[]].find(b=>b.innerText==="关联到当前同源段落");if(!b||b.disabled)return false;b.click();return true})()');
  if(!await chooseLink())throw Error('explicit link action unavailable');
  await until('link confirmation visible',()=>bodyHas('跨版本关联（不修改简历正文）'));
  const defaultLocal=await js('(()=>{const s=document.querySelector("section[aria-label=\\"跨版本事实关联确认\\"]");const boxes=[...s.querySelectorAll("input[type=checkbox]")];return boxes.every(b=>!b.checked)&&[...s.querySelectorAll("button")].find(b=>b.innerText==="确认跨版本关联")?.disabled===true})()');
  if(!defaultLocal)throw Error('link defaults to share or lacks confirmation');
  await js('(()=>{document.querySelector("section[aria-label=\\"跨版本事实关联确认\\"]")?.scrollIntoView({block:"start"});return true})()');
  await capture('47-fact-link-consent');
  if(!await checkLabel('我已核对原事实与当前段落'))throw Error('link confirmation missing');
  await click('确认跨版本关联');await until('local link saved',()=>bodyHas('已关联到当前版本'));
  linkBank=await js('window.resumeDesktop.facts.get()');
  const localLink=linkBank.records.find(r=>r.linkedFrom?.recordId===linkRoot.id&&r.docId===targetBefore.id&&r.verifiedStatus==='user-confirmed');
  if(!localLink||localLink.sensitivity!=='local-only'||JSON.stringify(await main.store.getResume(linkSlug))!==JSON.stringify(targetBefore))throw Error('local-only link failed or changed resume');
  await js('window.resumeDesktop.facts.revoke('+JSON.stringify({id:localLink.id,bankRevision:linkBank.revision,confirmation:'REVOKE_FACT'})+')');
  await loadLinkBank();
  if(!await chooseLink())throw Error('re-link after target revocation unavailable');
  if(!await checkLabel('允许今后逐次选择该关联事实外发')||!await checkLabel('我已核对原事实与当前段落'))throw Error('explicit share link consent unavailable');
  await click('确认跨版本关联');await until('share link saved',()=>bodyHas('已关联到当前版本'));
  linkBank=await js('window.resumeDesktop.facts.get()');
  const shareLink=linkBank.records.find(r=>r.linkedFrom?.recordId===linkRoot.id&&r.docId===targetBefore.id&&r.verifiedStatus==='user-confirmed');
  if(!shareLink||shareLink.sensitivity!=='shareable'||linkBank.records.find(r=>r.id===linkRoot.id)?.verifiedStatus!=='user-confirmed')throw Error('share link missing or target revoke affected root');
  await js('(()=>{const a=[...document.querySelectorAll("article")].find(e=>e.innerText.includes("跨版本关联来源")&&e.innerText.includes("核对 24 份跨版本合成记录")&&!e.innerText.includes("已撤销"));a?.scrollIntoView({block:"center"});return !!a})()');
  await capture('48-fact-link-saved');
  // Linked facts view the root evidence, without allowing another version to alter the root attachment.
  if(!await openEvidence(true))throw Error('linked evidence view missing');
  await click('加载 / 刷新附件索引');await until('linked source attachment',()=>bodyHas('synthetic-evidence-only.txt'));
  if(!await js('(()=>{const s=document.querySelector("section[aria-label=\\"本地证据附件索引\\"]");return s.innerText.includes("只读查看原始事实")&&![...s.querySelectorAll("button")].some(b=>/选择文件并关联证据|解除附件关联|删除本地附件副本/.test(b.innerText))})()'))throw Error('linked version allowed source attachment mutations');
  await scrollEvidence();await capture('56-evidence-linked-readonly');
  await click('关闭附件索引');
  checks.evidenceLinkedReadonly=true;

  const selectLinked=await js('(()=>{const a=[...document.querySelectorAll("article")].find(e=>e.innerText.includes("跨版本关联来源")&&e.innerText.includes("核对 24 份跨版本合成记录")&&!e.innerText.includes("已撤销"));const b=a?.querySelector("input[type=checkbox]");if(!b||b.disabled)return false;b.click();return true})()');
  if(!selectLinked)throw Error('linked selection unavailable');
  await click('预览 AI 自由任务');await until('linked fact preview',()=>bodyHas('自由任务发送前确认'));
  const linkedPreview=await getFactPreview();
  if(!linkedPreview.includes(rootInput.fact.assertion)||!linkedPreview.includes('record-1')||linkedPreview.includes(rootInput.fact.evidenceRef)||linkedPreview.includes(linkRoot.id)||linkedPreview.includes(shareLink.id)||linkedPreview.includes(linkSlug))throw Error('linked fact privacy mismatch');
  // A valid linked request reaches the same gated provider; origin mutation alone must then block reuse.
  await click('确认发送自由任务');await until('valid linked model answer',()=>bodyHas('当前可见正文可以更简洁'));
  if(providerCalls!==linkCalls+1||!JSON.stringify(lastAiRequest.body.messages).includes(rootInput.fact.assertion)||JSON.stringify(lastAiRequest.body).includes(shareLink.id)||JSON.stringify(lastAiRequest.body).includes(linkRoot.id)||JSON.stringify(lastAiRequest.body).includes('factBinding'))throw Error('valid linked transport mismatch');
  const sentLinkedEvidence=JSON.stringify(lastAiRequest.body);
  for(const privateValue of [attachedEvidence.id,attachedEvidence.sha256,attachedEvidence.originalName,evidenceNote,'SYNTHETIC_ATTACHMENT_PRIVATE_BYTES',evidenceSource,managedEvidence])if(sentLinkedEvidence.includes(privateValue))throw Error('attachment metadata or bytes leaked to model');
  checks.evidenceNeverOutbound=true;
  await click('预览 AI 自由任务');await until('origin-change preview',()=>bodyHas('自由任务发送前确认'));
  const originBefore=await main.store.getResume('master');
  await main.store.saveResume('master',{...originBefore,education:originBefore.education.map((e,i)=>i===0?{...e,school:'SYNTHETIC_CHANGED_ORIGIN'}:e)});
  await click('确认发送自由任务');await until('origin changed blocked',()=>bodyHas('跨版本来源主体或隐私范围已变化'));
  if(providerCalls!==linkCalls+1||(await js('window.resumeDesktop.facts.get()')).revision!==linkBank.revision)throw Error('changed origin reached provider or bank unexpectedly changed');
  await js('(()=>{const e=[...document.querySelectorAll("[role=alert]")].find(e=>e.innerText.includes("跨版本来源主体"));e?.scrollIntoView({block:"center"});return !!e})()');
  await capture('52-fact-link-origin-changed');
  const originAfter=await main.store.getResume('master');
  await main.store.saveResume('master',{...originAfter,education:originBefore.education});
  await click('预览 AI 自由任务');await until('linked revoke preview',()=>bodyHas('自由任务发送前确认'));
  checks.factLinkValidTransport=true;checks.factLinkOriginMutationBlocked=true;
  await js('window.resumeDesktop.facts.revoke('+JSON.stringify({id:linkRoot.id,bankRevision:linkBank.revision,confirmation:'REVOKE_FACT'})+')');
  await click('确认发送自由任务');await until('linked stale authorization',()=>bodyHas('本地事实库已变化'));
  const family=await js('window.resumeDesktop.facts.get()');
  if(family.records.filter(r=>r.id===linkRoot.id||r.linkedFrom?.recordId===linkRoot.id).some(r=>r.verifiedStatus!=='revoked')||providerCalls!==linkCalls+1||JSON.stringify(await main.store.getResume(linkSlug))!==JSON.stringify(targetBefore))throw Error('root revoke failed to invalidate linked preview');
  checks.factLinkDefaultLocal=true;checks.factLinkExplicitShare=true;checks.factLinkCascadeNoNetwork=true;
  await loadLinkBank();
  await js('(()=>{const a=[...document.querySelectorAll("article")].find(e=>e.innerText.includes("跨版本关联来源")&&e.innerText.includes("核对 24 份跨版本合成记录")&&e.innerText.includes("已撤销"));a?.scrollIntoView({block:"center"});return !!a})()');
  await capture('49-fact-link-revoked');
  await js('(()=>{const e=document.querySelector("select[aria-label=\\"快速切换简历版本\\"]");e.value="master";e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  await until('master restored after link',()=>js('document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")?.value==="master"'));
  await click('诊断优化');await click('AI 润色 Diff');await click('AI 自由任务');
  await refreshEvidenceFacts();
  if(!await openEvidence(false))throw Error('historical root evidence view missing');
  await click('加载 / 刷新附件索引');await until('historic evidence loaded',()=>bodyHas('synthetic-evidence-only.txt'));
  if(await js('[...document.querySelectorAll("button")].some(b=>b.innerText==="选择文件并关联证据")'))throw Error('revoked root could add evidence');
  await click('解除附件关联');await until('evidence detached',()=>bodyHas('已解除附件关联，副本与历史索引仍保留。'));
  if(!fs.existsSync(managedEvidence))throw Error('detach removed managed file');
  await click('删除本地附件副本');await until('evidence purged',()=>bodyHas('已删除工作台副本，保留历史索引。'));
  const finalEvidenceIndex=await js('window.resumeDesktop.evidence.get()');
  if(finalEvidenceIndex.entries[0].status!=='purged'||fs.existsSync(managedEvidence)||!fs.readFileSync(evidenceSource).equals(evidenceBytes))throw Error('purge failed to preserve original and historical metadata');
  await scrollEvidence();await capture('57-evidence-purged');
  await click('关闭附件索引');
  checks.evidenceDetachedAndPurgedOriginalSafe=true;
  // Local requirement review: exact source, no auto eligibility, explicit local-only fact and stale review invalidation.
  const reviewDoc=await main.store.getResume('master'),reviewCalls=providerCalls;
  let reviewBank=await js('window.resumeDesktop.facts.get()');
  const reviewFactInput={slug:'master',docRevision:JSON.stringify([reviewDoc.id,reviewDoc.updatedAt]),blockKey:'edu:'+reviewDoc.education[0].id,bankRevision:reviewBank.revision,fact:{kind:'credential',assertion:'本人核对合成教师资格证',value:'',unit:'',timeframe:'2025',evidenceRef:'SYNTHETIC_JOB_LOCAL_ONLY',sensitivity:'local-only'},confirmation:'CONFIRM_SELF_REPORTED_FACT'};
  reviewBank=await js('window.resumeDesktop.facts.add('+JSON.stringify(reviewFactInput)+')');
  const reviewFact=reviewBank.records.find(r=>r.assertion===reviewFactInput.fact.assertion);
  await click('JD 雷达');
  const jobSource='  合成招聘公告\n须持高中物理教师资格证；硕士优先。\n不要求班主任经验；必须硕士且经验优先\n报名截止2026-12-01。\n  ';
  // Exercise the user's actual PDF export + quick-log path, including significant pasted whitespace.
  await setValue('textarea[placeholder^="例如：招聘高中物理教师"]',jobSource);
  await click('导出 PDF');
  await until('job PDF export ready',()=>bodyHas('记入投递'));
  if(!await js('(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.innerText.includes("记入投递")&&!x.innerText.includes("确认"));if(!b)return false;b.click();return true})()'))throw Error('job quick log button missing');
  await until('job quick log dialog',()=>js('!!document.querySelector("[role=dialog][aria-label=\\"记入投递并锁定永久快照\\"]")'));
  if(!await setInput(companySelector,'合成岗位核对招聘单位'))throw Error('job quick log company missing');
  if(!await js('document.querySelector(\'[role="dialog"] textarea\')?.value==='+JSON.stringify(jobSource)))throw Error('quick log did not retain exact JD before save');
  await capture('74-job-review-quick-log');
  await click('确认记入并锁定快照');
  await until('job quick log persisted',async()=>(await main.store.getApplications()).applications.some(a=>a.company==='合成岗位核对招聘单位'&&a.snapshotId));
  await until('job quick log modal closed',()=>js('!document.querySelector("[role=dialog][aria-label=\\"记入投递并锁定永久快照\\"]")'));
  const reviewApplication={entry:(await main.store.getApplications()).applications.find(a=>a.company==='合成岗位核对招聘单位')};
  if(reviewApplication.entry.jdText!==jobSource||!reviewApplication.entry.exportedFilePath||!fs.existsSync(reviewApplication.entry.exportedFilePath))throw Error('quick log altered exact JD or failed actual PDF export');
  checks.jobReviewQuickLogExactSource=true;
  const waitJobButton=label=>until('enabled job button '+label,()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(label)+'&&!b.disabled)'));
  await waitJobButton('刷新本地核对档案');await click('刷新本地核对档案');await until('job history refreshed',()=>bodyHas('已读取本地核对档案'));
  await setValue('textarea[placeholder^="例如：招聘高中物理教师"]',jobSource);
  await click('分析岗位原文');await until('six source clauses',()=>bodyHas('候选 6 条'));
  await click('加载 / 刷新岗位事实依据');await until('current job evidence loaded',async()=>await bodyHas('已加载本地有效原始事实')&&await js('[...document.querySelectorAll("button")].some(b=>b.innerText==="记录本条人工核对"&&!b.disabled)'));
  const jobSelect=(name,val)=>js('(()=>{const e=document.querySelector("select[aria-label="+JSON.stringify('+JSON.stringify(name)+')+"]");if(!e||e.disabled)return false;e.value='+JSON.stringify(val)+';e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  const jobQuote=()=>js('document.querySelector("[aria-label=\\"岗位条款原文\\"]")?.innerText');
  const clauseId=(quote)=>{const start=jobSource.indexOf(quote);return start+':'+(start+quote.length);};
  if(!await jobSelect('岗位候选条款',clauseId('须持高中物理教师资格证；')))throw Error('job clause unavailable');
  await until('exact job clause',async()=>await jobQuote()==='须持高中物理教师资格证；');
  if(!await js('document.querySelector("select[aria-label=\\"岗位条件类型\\"]")?.value==="unknown"&&document.querySelector("select[aria-label=\\"岗位核对结果\\"]")?.value==="unchecked"'))throw Error('job auto approved');
  await jobSelect('岗位条件类型','mandatory');await jobSelect('岗位核对结果','supported');
  if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="记录本条人工核对")?.disabled===true'))throw Error('job support without evidence');
  await setValue('input[aria-label="搜索岗位依据"]','SYNTHETIC_JOB_LOCAL_ONLY');
  if(!await checkLabel('本人核对合成教师资格证'))throw Error('local-only job evidence missing');
  await setValue('textarea[aria-label="岗位核对说明"]','合成示例：已本人核对，非资格结论');
  await js('(()=>{document.querySelector("[aria-label=\\"岗位原文与证据核对\\"]")?.scrollIntoView({block:"start"});return true})()');
  await capture('66-job-requirement-evidence');
  await click('记录本条人工核对');await until('job evidence explicitly recorded',()=>bodyHas('已记录 1 条')&&bodyHas('自述支持 1')&&bodyHas('已记录该条人工核对结果'));
  await jobSelect('岗位候选条款',clauseId('不要求班主任经验；'));await until('negative clause exact',async()=>await jobQuote()==='不要求班主任经验；');
  if(!await js('document.querySelector("select[aria-label=\\"岗位条件类型\\"]")?.value==="unknown"'))throw Error('negation auto marked mandatory');
  await jobSelect('岗位条件类型','not-requirement');await click('记录本条人工核对');await until('non requirement recorded',()=>bodyHas('已记录 2 条'));
  await jobSelect('岗位候选条款',clauseId('必须硕士且经验优先'));await until('compound clause exact',async()=>await jobQuote()==='必须硕士且经验优先');
  await jobSelect('岗位条件类型','unknown');await jobSelect('岗位核对结果','gap');await click('记录本条人工核对');await until('job gap recorded',()=>bodyHas('已记录 3 条')&&bodyHas('缺口 1'));
  await js('(()=>{document.querySelector("[aria-label=\\"岗位核对记录\\"]")?.scrollIntoView({block:"center"});return true})()');await capture('67-job-review-results');
  // Archive explicitly; a confirmed disk write is required before reporting success.
  await waitJobButton('保存本次核对到本地');
  if(!await jobSelect('关联岗位核对投递',reviewApplication.entry.id))throw Error('matching permanent application unavailable');
  await click('保存本次核对到本地');
  await until('job review archive disk confirmed',async()=>await bodyHas('已确认保存本地岗位核对档案')&&(await main.store.getApplications()).jobReviews?.length===1);
  const savedReview=(await main.store.getApplications()).jobReviews[0];
  if(savedReview.source!==jobSource||savedReview.docId!==reviewDoc.id||savedReview.factRevision!==reviewBank.revision||savedReview.applicationId!==reviewApplication.entry.id||savedReview.snapshotId!==reviewApplication.entry.snapshotId||savedReview.rows.length!==3||!savedReview.rows.some(row=>row.review.evidenceIds.includes('fact:'+reviewFact.id)))throw Error('saved job review binding incorrect');
  if(JSON.stringify(savedReview).includes('SYNTHETIC_JOB_LOCAL_ONLY'))throw Error('duplicated local evidence source');
  await js('(()=>{document.querySelector("[aria-label=\\\"本地岗位核对档案\\\"]")?.scrollIntoView({block:"center"});return true})()');
  await capture('69-job-review-archive-saved');
  checks.jobReviewDiskArchive=true;
  await click('求职面试');
  await until('job review shown in application ledger',()=>bodyHas('已关联 1 份历史岗位人工核对档案'));
  await js('(()=>{const x=[...document.querySelectorAll("div")].find(e=>e.innerText.startsWith("已关联 1 份历史岗位人工核对档案")&&e.classList.contains("bg-indigo-50"));x?.scrollIntoView({block:"center"});return !!x})()');
  await capture('70-job-review-linked-application');
  checks.jobReviewApplicationLink=true;
  // Reload the actual renderer, losing its in-memory career ledger and JD state.
  win.webContents.reload();
  await until('renderer reloaded',async()=>{try{return await js('!!document.querySelector("select[aria-label=\\\"快速切换简历版本\\\"]")&&!!document.querySelector("#basic-field-name")')}catch{return false}});
  await js('(()=>{const e=document.querySelector("select[aria-label=\\\"快速切换简历版本\\\"]");if(e.value!=="master"){e.value="master";e.dispatchEvent(new Event("change",{bubbles:true}))}return true})()');
  await until('master selected after reload',()=>js('document.querySelector("select[aria-label=\\\"快速切换简历版本\\\"]")?.value==="master"&&document.body.innerText.includes("合成母库")'));
  await click('诊断优化');await click('JD 雷达');
  await waitJobButton('载入档案原文');
  await click('载入档案原文');
  await until('archived exact JD restored',()=>js('document.querySelector(\'textarea[placeholder^="例如：招聘高中物理教师"]\')?.value==='+JSON.stringify(jobSource)));
  await waitJobButton('恢复档案核对');await click('恢复档案核对');
  await until('historical job review freshly restored',async()=>await bodyHas('已重新校验版本、原文与依据并恢复本地核对档案')&&await bodyHas('已记录 3 条')&&await bodyHas('自述支持 1')&&await bodyHas('缺口 1'));
  await js('(()=>{document.querySelector("[aria-label=\\\"岗位核对记录\\\"]")?.scrollIntoView({block:"center"});return true})()');
  await capture('71-job-review-restored-after-reload');
  checks.jobReviewRendererReload=true;
  reviewBank=await js('window.resumeDesktop.facts.revoke('+JSON.stringify({id:reviewFact.id,bankRevision:reviewBank.revision,confirmation:'REVOKE_FACT'})+')');
  await until('job review controls ready',()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText==="记录本条人工核对"&&!b.disabled)'));
  await click('记录本条人工核对');await until('stale job review cleared',()=>bodyHas('旧核对记录已清空')&&bodyHas('已记录 0 条'));
  await capture('68-job-review-stale');
  await waitJobButton('恢复档案核对');await click('恢复档案核对');
  await until('stale historical review rejected',async()=>await bodyHas('事实库版本已变化，历史核对档案不能恢复为当前结果')&&await js('!document.querySelector("select[aria-label=\\\"岗位候选条款\\\"]")'));
  if((await main.store.getApplications()).jobReviews[0].id!==savedReview.id)throw Error('stale history was silently deleted');
  await capture('72-job-review-archive-stale');checks.jobReviewArchiveStaleRejected=true;
  await js('(()=>{const d=document.querySelector("details[aria-label=\\"历史岗位核对内容\\"]");if(!d)return false;d.open=true;d.scrollIntoView({block:"center"});return true})()');
  await until('stale historical details still readable',()=>js('(()=>{const d=document.querySelector("details[aria-label=\\"历史岗位核对内容\\"]");return !!d?.open&&d.innerText.includes("合成示例：已本人核对，非资格结论")&&d.innerText.includes("不代表当前有效")})()'));
  await capture('73-job-review-historical-readonly');checks.jobReviewHistoricalReadable=true;
  await setValue('textarea[placeholder^="例如：招聘高中物理教师"]',jobSource+'\n合成附加条件');
  await until('job source change clears session',()=>js('!document.querySelector("select[aria-label=\\"岗位候选条款\\"]")'));
  if(providerCalls!==reviewCalls||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(reviewDoc))throw Error('job review wrote resume or contacted model');
  checks.jobRequirementSourceExact=true;checks.jobRequirementExplicitEvidence=true;checks.jobRequirementStaleCleared=true;checks.jobRequirementNoNetwork=true;





  // Real local PDF bytes, text pages with a graphic-only middle page.
  const noticeBefore=jobSource+'\n合成附加条件',noticeCalls=providerCalls;
  const noticeInput='input[aria-label="选择本地招聘公告 PDF"]';
  const sendNotice=async(name,buf)=>js('(()=>{const f=document.querySelector('+JSON.stringify(noticeInput)+');if(!f||f.disabled)return false;const dt=new DataTransfer();dt.items.add(new File([new Uint8Array('+JSON.stringify([...buf])+')],'+JSON.stringify(name)+',{type:"application/pdf"}));f.files=dt.files;f.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  if(!await js('(()=>{const f=document.querySelector('+JSON.stringify(noticeInput)+');if(!f||f.disabled)return false;const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(10*1024*1024+1)],"synthetic-oversized.pdf",{type:"application/pdf"}));f.files=dt.files;f.dispatchEvent(new Event("change",{bubbles:true}));return true})()'))throw Error('oversize notice input unavailable');
  await until('oversized PDF refused',()=>bodyHas('最多10 MB'));
  if(!await sendNotice('synthetic-invalid.pdf',Buffer.from('not a PDF')))throw Error('notice input unavailable');
  await until('invalid PDF refused',()=>bodyHas('文件没有有效 PDF 文件头'));
  const noticeJd=()=>js('document.querySelector(\'textarea[placeholder^="例如：招聘高中物理教师"]\')?.value');
  if(await noticeJd()!==noticeBefore)throw Error('invalid file changed existing JD');
  checks.jobPdfInvalidPreservesJd=true;checks.jobPdfOversizeRejected=true;
  const stream=s=>'<< /Length '+Buffer.byteLength(s)+' >>\nstream\n'+s+'\nendstream';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 7 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>',
    stream('BT /F1 22 Tf 55 760 Td (Synthetic recruitment notice) Tj 0 -40 Td (Physics degree required;) Tj ET'),
    stream('0.2 0.4 0.6 rg 55 500 480 200 re f'),
    stream('BT /F1 22 Tf 55 760 Td (Teaching certificate required;) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ];
  let noticePdf='%PDF-1.4\n',offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(noticePdf));noticePdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});
  const xref=Buffer.byteLength(noticePdf);
  noticePdf+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  const noticeBytes=Buffer.from(noticePdf),noticeHash=require('node:crypto').createHash('sha256').update(noticeBytes).digest('hex');
  // Drive the actual file picker control with Chromium's intercepted native file chooser.
  const noticePath=path.join(root,'synthetic-notice.pdf');fs.writeFileSync(noticePath,noticeBytes);
  const picker=win.webContents.debugger;
  let chooserListener,chooserTimer;
  try{
    picker.attach('1.3');await picker.sendCommand('Page.enable');await picker.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true});
    const opened=new Promise((resolve,reject)=>{
      chooserTimer=setTimeout(()=>reject(Error('PDF picker event watchdog expired')),8000);
      chooserListener=(_event,method,params)=>{if(method==='Page.fileChooserOpened'){clearTimeout(chooserTimer);resolve(params);}};
      picker.on('message',chooserListener);
    });
    const [chosen,clicked]=await Promise.all([opened,win.webContents.executeJavaScript('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==="选择本地招聘公告 PDF");if(!b||b.disabled)return false;b.click();return true})()',true)]);
    if(!clicked||!chosen.backendNodeId)throw Error('actual PDF picker button did not open file input');
    await picker.sendCommand('DOM.setFileInputFiles',{files:[noticePath],backendNodeId:chosen.backendNodeId});
  }finally{
    clearTimeout(chooserTimer);if(chooserListener)picker.removeListener('message',chooserListener);
    if(picker.isAttached()){await picker.sendCommand('Page.setInterceptFileChooserDialog',{enabled:false}).catch(()=>{});picker.detach();}
  }
  checks.jobPdfActualPicker=true;
  await until('three PDF pages extracted',async()=>await bodyHas('synthetic-notice.pdf · 共 3 页')&&await bodyHas('第 2 页无可靠文本层'));
  if(await noticeJd()!==noticeBefore)throw Error('PDF extraction replaced JD without approval');
  const namedCheck=(label)=>js('(()=>{const e=document.querySelector("input[aria-label="+JSON.stringify('+JSON.stringify(label)+')+"]");if(!e||e.disabled)return false;e.click();return true})()');
  const buttonEnabled=label=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(label)+'&&!b.disabled)');
  if(await buttonEnabled('确认导入所选公告页'))throw Error('unreviewed PDF could be imported');
  await js('document.querySelector("[aria-label=\\"招聘公告 PDF 本地导入\\"]")?.scrollIntoView({block:"start"})');
  await capture('75-job-pdf-scan-warning');
  if(!await namedCheck('导入 PDF 第 2 页'))throw Error('could not explicitly exclude graphic page');
  await until('omission warning',()=>bodyHas('其余页不参与核对'));
  await click('渲染本页 PDF 原件');
  await until('actual PDF page one rendered',()=>js('(()=>{const i=document.querySelector("img[alt=\\"公告 PDF 第 1 页实际渲染\\"]");return !!i&&i.complete&&i.naturalWidth>100})()'));
  await js('document.querySelector("img[alt=\\"公告 PDF 第 1 页实际渲染\\"]")?.scrollIntoView({block:"center"})');
  if(!await jobSelect('公告原件显示比例','200'))throw Error('PDF zoom control unavailable');
  await until('original zoom is scrollable',()=>js('(()=>{const e=document.querySelector("[aria-label=\\"公告原件滚动预览\\"]");return !!e&&e.scrollWidth>e.clientWidth&&e.scrollHeight>e.clientHeight})()'));
  await js('(()=>{const e=document.querySelector("[aria-label=\\"公告原件滚动预览\\"]");e.scrollIntoView({block:"center"});e.scrollTop=0;e.scrollLeft=0;return true})()');
  await capture('76-job-pdf-original-page');checks.jobPdfOriginalZoom=true;
  if(!await namedCheck('确认已对照 PDF 第 1 页'))throw Error('review page one unavailable');
  if(!await jobSelect('公告原件对照页','3'))throw Error('page selector unavailable');
  await click('渲染本页 PDF 原件');
  await until('actual PDF page three rendered',()=>js('(()=>{const i=document.querySelector("img[alt=\\"公告 PDF 第 3 页实际渲染\\"]");return !!i&&i.complete&&i.naturalWidth>100})()'));
  if(!await namedCheck('确认已对照 PDF 第 3 页'))throw Error('review page three unavailable');
  if(await buttonEnabled('确认导入所选公告页'))throw Error('import allowed without final approval');
  if(!await namedCheck('确认公告所选页和替换 JD'))throw Error('final PDF confirmation missing');
  await waitJobButton('确认导入所选公告页');
  await setValue('textarea[placeholder^="例如：招聘高中物理教师"]',noticeBefore+'\nAnother draft');
  await until('changed JD revokes previous replacement approval',async()=>!(await buttonEnabled('确认导入所选公告页')));
  if(!await namedCheck('确认公告所选页和替换 JD'))throw Error('new replacement approval missing');
  await waitJobButton('确认导入所选公告页');await click('确认导入所选公告页');
  checks.jobPdfReplacementApprovalBound=true;
  await until('confirmed PDF source visible',()=>bodyHas('当前来源：synthetic-notice.pdf · 第 1、3 页 / 共 3 页'));
  const confirmedPdfJd=await noticeJd();
  if(!confirmedPdfJd.includes('Physics degree required;')||!confirmedPdfJd.includes('Teaching certificate required;')||confirmedPdfJd.includes(noticeBefore))throw Error('confirmed PDF source is wrong');
  await click('分析岗位原文');await until('PDF clauses split',()=>bodyHas('候选 3 条'));
  const certQuote='Teaching certificate required;',certStart=confirmedPdfJd.indexOf(certQuote);
  if(!await jobSelect('岗位候选条款',certStart+':'+(certStart+certQuote.length)))throw Error('PDF page three clause unavailable');
  await until('actual page number retained',()=>js('document.querySelector("[aria-label=\\"公告 PDF 页码\\"]")?.innerText.includes("PDF 第 3 页")'));
  if(!await js('document.querySelector("select[aria-label=\\"岗位候选条款\\"]")?.selectedOptions[0]?.textContent.includes("PDF 第 3 页")'))throw Error('clause selector lost page provenance');
  checks.jobPdfPageSelector=true;
  await js('document.querySelector("[aria-label=\\"岗位条款原文\\"]")?.scrollIntoView({block:"center"})');
  await capture('77-job-pdf-page-provenance');
  await jobSelect('岗位核对结果','gap');await click('记录本条人工核对');await until('PDF clause reviewed',()=>bodyHas('已记录 1 条'));
  await waitJobButton('保存本次核对到本地');await click('保存本次核对到本地');
  await until('PDF review archive saved',async()=>await bodyHas('已确认保存本地岗位核对档案')&&(await main.store.getApplications()).jobReviews?.length===2);
  const pdfArchive=(await main.store.getApplications()).jobReviews.find(a=>a.pdfOrigin);
  if(!pdfArchive||pdfArchive.pdfOrigin.sha256!==noticeHash||pdfArchive.pdfOrigin.totalPages!==3||JSON.stringify(pdfArchive.pdfOrigin.pages.map(p=>p.page))!=='[1,3]'||pdfArchive.source!==confirmedPdfJd||pdfArchive.rows[0].clauseId!==certStart+':'+(certStart+certQuote.length))throw Error('PDF archive metadata or source mismatch');
  checks.jobPdfSelectedPagesExplicit=true;checks.jobPdfExactPageOrigin=true;checks.jobPdfArchivePersisted=true;
  await setValue('textarea[placeholder^="例如：招聘高中物理教师"]',confirmedPdfJd+'\nEdited');
  await until('manual edit invalidates provenance and review',()=>js('!document.querySelector("[aria-label=\\"当前公告来源\\"]")&&!document.querySelector("[aria-label=\\"公告 PDF 页码\\"]")&&!document.querySelector("select[aria-label=\\"岗位候选条款\\"]")'));
  checks.jobPdfManualEditClearsOrigin=true;
  win.webContents.reload();
  await until('PDF archive renderer reloaded',async()=>{try{return await js('!!document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")&&!!document.querySelector("#basic-field-name")')}catch{return false}});
  await js('(()=>{const e=document.querySelector("select[aria-label=\\"快速切换简历版本\\"]");if(e.value!=="master"){e.value="master";e.dispatchEvent(new Event("change",{bubbles:true}))}return true})()');
  await until('master selected for PDF archive',()=>js('document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")?.value==="master"&&document.body.innerText.includes("合成母库")'));
  await click('诊断优化');await click('JD 雷达');
  const pdfArchiveButton=label=>js('(()=>{const e=[...document.querySelectorAll("[aria-label=\\"本地岗位核对档案\\"] button")].find(b=>b.innerText.trim()==='+JSON.stringify(label)+'&&!b.disabled&&b.parentElement?.parentElement?.innerText.includes("synthetic-notice.pdf"));if(!e)return false;e.click();return true})()');
  await until('load PDF archive original',()=>pdfArchiveButton('载入档案原文'));
  await until('archive provenance restored before review',()=>bodyHas('当前来源：synthetic-notice.pdf · 第 1、3 页 / 共 3 页'));
  await until('restore PDF archive review',()=>pdfArchiveButton('恢复档案核对'));
  await until('PDF archive review restored',async()=>await bodyHas('已重新校验版本、原文与依据并恢复本地核对档案')&&await js('document.querySelector("[aria-label=\\"公告 PDF 页码\\"]")?.innerText.includes("PDF 第 3 页")'));
  await js('document.querySelector("[aria-label=\\"岗位条款原文\\"]")?.scrollIntoView({block:"center"})');
  await capture('78-job-pdf-archive-restored');
  if(await noticeJd()!==confirmedPdfJd||providerCalls!==noticeCalls||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(reviewDoc))throw Error('PDF import called provider, modified resume or lost exact JD');
  checks.jobPdfArchiveReload=true;checks.jobPdfOfflineReadOnly=true;
  // Native Chinese PDF fixture, generated by Windows Electron, not a mocked extraction.
  const chineseHtml=path.join(root,'synthetic-notice-zh.html');
  fs.writeFileSync(chineseHtml,'<!doctype html><meta charset="utf-8"><style>body{font-family:"Microsoft YaHei",SimSun,sans-serif;margin:45px;font-size:18px}h1{font-size:24px}</style><h1>合成学校招聘公告</h1><p>须持高中物理教师资格证；</p><p>硕士研究生优先。</p>','utf8');
  const nativeNoticeWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  let chineseBytes;
  try{await nativeNoticeWindow.loadFile(chineseHtml);await nativeNoticeWindow.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');chineseBytes=await nativeNoticeWindow.webContents.printToPDF({pageSize:'A4',printBackground:true});}
  finally{nativeNoticeWindow.destroy();}
  if(!await sendNotice('synthetic-notice-zh.pdf',chineseBytes))throw Error('Chinese notice input unavailable');
  await until('native Chinese PDF text extracted',()=>js('document.querySelector("[aria-label=\\"公告逐页提取文本\\"]")?.innerText.replace(/\\s/g,"").includes("须持高中物理教师资格证；")'));
  await click('渲染本页 PDF 原件');
  await until('native Chinese PDF original rendered',()=>js('(()=>{const i=document.querySelector("img[alt=\\"公告 PDF 第 1 页实际渲染\\"]");return !!i&&i.complete&&i.naturalWidth>100})()'));
  await jobSelect('公告原件显示比例','200');
  await js('document.querySelector("[aria-label=\\"公告原件滚动预览\\"]")?.scrollIntoView({block:"center"})');
  await capture('79-job-pdf-chinese-original');
  if(!await namedCheck('确认已对照 PDF 第 1 页')||!await namedCheck('确认公告所选页和替换 JD'))throw Error('Chinese notice review confirmation unavailable');
  await waitJobButton('确认导入所选公告页');await click('确认导入所选公告页');
  await until('Chinese notice source confirmed',()=>bodyHas('当前来源：synthetic-notice-zh.pdf · 第 1 页 / 共 1 页'));
  const chineseJd=await noticeJd();
  if(!chineseJd.replace(/\s/g,'').includes('硕士研究生优先。'))throw Error('Chinese source lost second requirement');
  await click('分析岗位原文');await until('Chinese notice clauses',()=>bodyHas('候选 3 条'));
  await until('Chinese PDF page origin',()=>js('document.querySelector("[aria-label=\\"公告 PDF 页码\\"]")?.innerText.includes("PDF 第 1 页")'));
  if(providerCalls!==noticeCalls||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(reviewDoc))throw Error('Chinese notice import modified resume or contacted model');
  checks.jobPdfChineseNative=true;

  // Previous evidence lifecycle test intentionally purged its attachment. Create a new active fixture using trusted IPC.
  const backupFactDoc=await main.store.getResume('master'),backupFactBank=await js('window.resumeDesktop.facts.get()');
  const backupFactInput={slug:'master',docRevision:JSON.stringify([backupFactDoc.id,backupFactDoc.updatedAt]),blockKey:'edu:'+backupFactDoc.education[0].id,bankRevision:backupFactBank.revision,fact:{kind:'credential',assertion:'合成工作区备份附件核对',value:'',unit:'',timeframe:'2025',evidenceRef:'SYNTHETIC_BACKUP_LOCAL_ONLY',sensitivity:'local-only'},confirmation:'CONFIRM_SELF_REPORTED_FACT'};
  const backupBank=await js('window.resumeDesktop.facts.add('+JSON.stringify(backupFactInput)+')');
  const backupFact=backupBank.records.find(r=>r.assertion===backupFactInput.fact.assertion);
  const backupIndex=await js('window.resumeDesktop.evidence.get()');
  const backupAttachmentPath=path.join(root,'synthetic-backup-attachment.txt'),backupAttachmentBytes=Buffer.from('SYNTHETIC_BACKUP_ATTACHMENT_BYTES\n合成备份附件','utf8');
  fs.writeFileSync(backupAttachmentPath,backupAttachmentBytes);
  const backupAttachmentPicker=dialog.showOpenDialog;
  let backupAttached;
  try{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backupAttachmentPath]});
    const request={slug:'master',docRevision:backupFactInput.docRevision,factId:backupFact.id,bankRevision:backupBank.revision,indexRevision:backupIndex.revision,note:'合成备份验收',confirmation:'CONFIRM_LOCAL_EVIDENCE_COPY'};
    await js('window.resumeDesktop.evidence.attach('+JSON.stringify(request)+')');
    backupAttached=(await js('window.resumeDesktop.evidence.get()')).entries.find(e=>e.factId===backupFact.id&&e.status==='attached');
  }finally{dialog.showOpenDialog=backupAttachmentPicker;}
  if(!backupAttached||!fs.readFileSync(path.join(main.dataDir,'.evidence-files-v1',backupAttached.id+'.txt')).equals(backupAttachmentBytes))throw Error('active backup attachment fixture unavailable');
  // Backup all persisted managed data from the real workspace, never secrets or exports.
  await click('版本母库');
  await until('backup pane mounted',()=>bodyHas('工作区备份与安全恢复'));
  const backupParent=fs.mkdtempSync(path.join(path.dirname(root),'synthetic-backup-acceptance-'));
  const originalBackupDialog=dialog.showOpenDialog;
  const currentMaster=fs.readFileSync(path.join(main.dataDir,'master.json'));
  const backupCalls=providerCalls;
  let backupFolder,restoreFolder;
  try{
    dialog.showOpenDialog=async(_owner,options)=>{if(!options.properties.includes('openDirectory'))throw Error('backup requires directory chooser');return {canceled:true,filePaths:[]};};
    await click('创建本地工作区备份');
    await until('backup canceled',()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText==="创建本地工作区备份"&&!b.disabled)'));
    if(fs.readdirSync(backupParent).length)throw Error('cancel published folder');
    checks.workspaceBackupCancel=true;
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backupParent]});
    await click('创建本地工作区备份');
    await until('backup created',()=>bodyHas('已创建并校验工作区备份。'));
    backupFolder=path.join(backupParent,fs.readdirSync(backupParent).find(n=>n.startsWith('resume-studio-backup-v1-')));
    const manifest=JSON.parse(fs.readFileSync(path.join(backupFolder,'workspace-backup-v1.json'),'utf8'));
    const requiredPaths=['master.json','applications.json','.fact-bank-v1.json','.evidence-index-v1.json','.evidence-files-v1/'+backupAttached.id+'.txt'];
    const omitted=requiredPaths.filter(p=>!manifest.files.some(f=>f.path===p));
    if(omitted.length||!manifest.files.some(f=>f.path.startsWith('.application-snapshots/')))throw Error('backup omitted managed data: '+JSON.stringify({omitted,files:manifest.files.map(f=>f.path)}));
    if(!fs.readFileSync(path.join(backupFolder,'data','.evidence-files-v1',backupAttached.id+'.txt')).equals(backupAttachmentBytes))throw Error('active attachment bytes not preserved');
    if(manifest.files.some(f=>f.path.includes('ai-settings')||f.path.includes('resume-write-lock'))||fs.existsSync(path.join(backupFolder,'data','.ai-settings.json')))throw Error('backup copied secret or lock');
    for(const row of manifest.files){const b=fs.readFileSync(path.join(backupFolder,'data',...row.path.split('/')));if(b.length!==row.size||require('node:crypto').createHash('sha256').update(b).digest('hex')!==row.sha256)throw Error('backup bytes invalid');}
    if(!fs.readFileSync(path.join(backupFolder,'data','master.json')).equals(currentMaster))throw Error('backup master differs');
    await js('document.querySelector("[aria-label=\\"工作区备份结果\\"]")?.scrollIntoView({block:"center"})');await capture('80-workspace-backup-created');
    checks.workspaceBackupExactManagedBytes=true;
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backupFolder]});
    await click('检查已有备份');await until('backup inspected',()=>bodyHas('备份文件清单及内容校验完成'));
    if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="恢复到独立新工作区")?.disabled===true'))throw Error('restore approval not required');
    await js('document.querySelector("[aria-label=\\"确认恢复到独立新工作区\\"]")?.scrollIntoView({block:"center"})');await capture('81-workspace-backup-review');
    if(!await namedCheck('确认恢复到独立新工作区'))throw Error('restore confirmation missing');
    const backupMaster=path.join(backupFolder,'data','master.json');
    fs.appendFileSync(backupMaster,' ');
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backupParent]});
    await click('恢复到独立新工作区');
    await until('tampered backup blocked',()=>bodyHas('校验失败'));
    if(fs.readdirSync(backupParent).some(n=>n.startsWith('resume-studio-restored-v1-'))||!fs.readFileSync(path.join(main.dataDir,'master.json')).equals(currentMaster))throw Error('failed restore altered current workspace');
    await js('document.querySelector("[aria-label=\\"工作区备份与安全恢复\\"] [role=alert]")?.scrollIntoView({block:"center"})');await capture('82-workspace-backup-tamper-blocked');
    checks.workspaceBackupTamperRejected=true;
    fs.writeFileSync(backupMaster,currentMaster);
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backupFolder]});
    await click('检查已有备份');await until('backup rechecked',()=>bodyHas('备份文件清单及内容校验完成'));
    if(!await namedCheck('确认恢复到独立新工作区'))throw Error('restore confirmation missing after recheck');
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backupParent]});
    await click('恢复到独立新工作区');await until('new workspace restored',()=>bodyHas('已恢复并校验独立新工作区'));
    restoreFolder=path.join(backupParent,fs.readdirSync(backupParent).find(n=>n.startsWith('resume-studio-restored-v1-')));
    for(const row of manifest.files){const b=fs.readFileSync(path.join(restoreFolder,'data',...row.path.split('/')));if(b.length!==row.size||require('node:crypto').createHash('sha256').update(b).digest('hex')!==row.sha256)throw Error('restored bytes invalid');}
    if(!fs.readFileSync(path.join(main.dataDir,'master.json')).equals(currentMaster)||providerCalls!==backupCalls)throw Error('backup modified master or contacted provider');
    await js('document.querySelector("[aria-label=\\"工作区备份结果\\"]")?.scrollIntoView({block:"center"})');await capture('83-workspace-restored-copy');
    checks.workspaceRestoreIndependent=true;
    // Independent fresh Electron process: read restored data through the real renderer IPC.
    await new Promise((resolve,reject)=>{
      const proc=require('node:child_process').spawn(process.execPath,[path.join(__dirname,'validation-restored.cjs')],{cwd:__dirname,env:{...process.env,RESUME_STUDIO_DATA_DIR:restoreFolder},stdio:['ignore','pipe','pipe']});
      let logs='',expired=false;
      const collect=b=>{logs=(logs+b.toString()).slice(-8000);};proc.stdout.on('data',collect);proc.stderr.on('data',collect);
      const watchdog=setTimeout(()=>{expired=true;proc.kill();},25000);
      proc.once('error',e=>{clearTimeout(watchdog);reject(e);});
      proc.once('close',code=>{clearTimeout(watchdog);if(expired||code!==0)reject(Error('restored workspace cold process failed: '+code+' '+logs));else resolve();});
    });
    const cold=JSON.parse(fs.readFileSync(path.join(out,'workspace-restored-cold.json'),'utf8'));
    if(!cold.master||!cold.ledger||!cold.facts||!cold.evidence||cold.jobReviews<2||cold.pdfArchives<1||!cold.restoredIdentity)throw Error('restored workspace failed independent readback');
    checks.workspaceRestoredColdProcess=true;
    const feedbackVisible=selector=>js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return false;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0||r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1)return false;for(let p=e.parentElement;p;p=p.parentElement){const css=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(css.overflowY)&&(r.top<b.top-1||r.bottom>b.bottom+1))return false;}const center=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!center&&(center===e||e.contains(center));})()');
    const feedbackAlert='[aria-label="工作区操作反馈"] [role="alert"]',feedbackStatus='[aria-label="工作区操作反馈"] [role="status"]';
    await until('manual fallback collapsed',()=>js('document.querySelector("[aria-label=\\"工作区备份结果\\"] details")?.open===false'));
    checks.workspaceManualFallbackCollapsed=true;
    // Short and narrow actual content viewport. No test-side scroll after confirming launch.
    win.setContentSize(1080,650);await sleep(350);
    // Use the production desktop IPC and the real independent application entry, not the cold harness.
    const badLaunch=await js('window.resumeDesktop.workspaceBackup.launch("invalid","OPEN_INDEPENDENT_WORKSPACE").then(()=>false,()=>true)');
    if(!badLaunch)throw Error('unprepared launch accepted');
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backupFolder]});
    await click('检查并打开已有恢复工作区');await until('backup folder is not runnable',()=>bodyHas('请选择已恢复的独立工作区'));
    checks.workspaceLaunchRejectBackup=true;
    await click('检查并打开刚恢复的工作区');await until('launch inspected',()=>bodyHas('独立工作区当前数据检查完成'));
    if(!await js('[...document.querySelectorAll("button")].find(b=>b.innerText==="确认打开独立工作区")?.disabled===true'))throw Error('workspace launch confirmation missing');
    await js('document.querySelector("[aria-label=\\"独立工作区打开确认\\"]")?.scrollIntoView({block:"center"})');
    await capture('85-workspace-launch-review');
    const restoredMaster=path.join(restoreFolder,'data','master.json');
    fs.appendFileSync(restoredMaster,' ');
    if(!await namedCheck('确认打开独立恢复工作区'))throw Error('missing launch checkbox');
    await click('确认打开独立工作区');await until('stale launch refused',()=>bodyHas('恢复工作区数据已变化'));
    await until('refusal actually visible without test scroll',()=>feedbackVisible(feedbackAlert));
    await capture('86-workspace-launch-stale');checks.workspaceLaunchRefusalVisible=true;
    checks.workspaceLaunchStaleRejected=true;
    const staleToken=await js('window.resumeDesktop.workspaceBackup.prepareLaunch("last")');
    dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});
    await js('window.resumeDesktop.workspaceBackup.inspect()');
    const superseded=await js('window.resumeDesktop.workspaceBackup.launch('+JSON.stringify(staleToken.token)+',"OPEN_INDEPENDENT_WORKSPACE").then(()=>false,e=>String(e).includes("打开前必须检查"))');
    if(!superseded)throw Error('superseded launch approval was accepted');
    checks.workspaceLaunchSupersededRefused=true;
    fs.writeFileSync(restoredMaster,currentMaster);
    await click('检查并打开刚恢复的工作区');await until('launch rechecked',()=>bodyHas('独立工作区当前数据检查完成'));
    if(!await namedCheck('确认打开独立恢复工作区'))throw Error('missing fresh launch checkbox');
    await click('确认打开独立工作区');
    await until('production child editor ready',()=>bodyHas('独立恢复工作区已实际加载，新窗口就绪'),55000);
    const pid=Number(await js('document.querySelector("[aria-label=\\"独立工作区进程 ID\\"]")?.textContent'));
    if(!Number.isSafeInteger(pid)||pid<=0||pid===process.pid)throw Error('invalid child pid');
    let childClosed=false;
    try{
      process.kill(pid,0);
      if(!fs.existsSync(path.join(restoreFolder,'.electron-userdata'))||!fs.readFileSync(path.join(main.dataDir,'master.json')).equals(currentMaster)||providerCalls!==backupCalls)throw Error('independent launch changed source or shared user profile');
      await until('success text actually visible without test scroll',()=>feedbackVisible(feedbackStatus));
      await until('launch result actually visible without test scroll',()=>feedbackVisible('[aria-label="独立工作区启动结果"]'));
      // The independently launched window may occlude the source window and leave its last composited frame stale.
      // Return to the original window as a user would, without touching its scroll position.
      win.show();win.focus();
      await until('source window foreground for final screenshot',()=>win.isFocused(),5000);
      await Promise.race([js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'),sleep(4000).then(()=>{throw Error('source window paint watchdog expired')})]);
      await until('success still visible in foreground short window',()=>feedbackVisible(feedbackStatus));
      await capture('87-workspace-launch-ready');checks.workspaceLaunchReadyVisible=true;
      win.setContentSize(1440,860);await sleep(350);
      await until('success remains visible wide',()=>feedbackVisible(feedbackStatus));await capture('88-workspace-launch-ready-wide');checks.workspaceLaunchWideVisible=true;
      checks.workspaceLaunchProductionReady=true;
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[restoreFolder]});
      const inspected=await js('window.resumeDesktop.workspaceBackup.prepareLaunch("choose")');
      if(!inspected?.token)throw Error('existing restored workspace could not be inspected');
      const refused=await js('window.resumeDesktop.workspaceBackup.launch('+JSON.stringify(inspected.token)+',"OPEN_INDEPENDENT_WORKSPACE").then(()=>false,e=>String(e).includes("已有运行实例"))');
      if(!refused)throw Error('duplicate restored workspace launch not rejected');
      checks.workspaceLaunchDuplicateRefused=true;
      // Close the actual child through its native window rather than using an in-process mock.
      const cp=require('node:child_process');
      const cmd='$p=Get-Process -Id '+pid+' -ErrorAction Stop; if(!$p.CloseMainWindow()){throw "no independent main window"}; $p.WaitForExit(8000)';
      const closed=cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',cmd],{encoding:'utf8',timeout:12000});
      if(!closed.includes('True'))throw Error('independent window did not close');
      childClosed=true;checks.workspaceLaunchNativeWindow=true;
    }finally{if(!childClosed){try{process.kill(pid);}catch{}}}
    // The backup remains untouched even after editing the restored copy.
    const edit=JSON.parse(fs.readFileSync(restoredMaster,'utf8'));edit.title='独立恢复副本的编辑';fs.writeFileSync(restoredMaster,JSON.stringify(edit,null,2));
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[restoreFolder]});
    await click('检查并打开已有恢复工作区');await until('edited workspace reinspection',()=>bodyHas('独立工作区当前数据检查完成'));
    if(!fs.readFileSync(path.join(main.dataDir,'master.json')).equals(currentMaster)||!fs.readFileSync(path.join(backupFolder,'data','master.json')).equals(currentMaster))throw Error('restored edit changed original or backup');
    checks.workspaceLaunchEditedCopyAccepted=true;

  }finally{dialog.showOpenDialog=originalBackupDialog;fs.rmSync(backupParent,{recursive:true,force:true});}

  // At the very end, mutate only the isolated synthetic disk to simulate another process.
  await click('诊断优化');await click('AI 润色 Diff');await click('AI 自由任务');await click('分步工作');
  await setValue('textarea[aria-label="AI 自由任务目标"]','测试磁盘版本变化');
  await click('全选可见段落');await click('预览 AI 自由任务');await click('确认发送自由任务');
  await until('stale workflow plan ready',()=>bodyHas('受控分步工作 · 0/2 步已处理'));
  const staleWorkflowCalls=providerCalls;
  const oldDisk=await main.store.getResume('master');
  const changedDisk=await main.store.saveResume('master',{...oldDisk,skillContent:oldDisk.skillContent+'\nSYNTHETIC_EXTERNAL_EDIT'});
  await click('准备第 1 步');
  await until('stale workflow refused',()=>bodyHas('磁盘简历与已批准的步骤结果不一致'));
  if(providerCalls!==staleWorkflowCalls||JSON.stringify(await main.store.getResume('master'))!==JSON.stringify(changedDisk))throw Error('stale workflow contacted provider or overwrote disk');
  checks.workflowStaleDiskBlocked=true;
  await js('(()=>{const e=[...document.querySelectorAll("[role=alert]")].find(e=>e.innerText.includes("磁盘简历"));e?.scrollIntoView({block:"center"});return !!e})()');
  await capture('44-workflow-stale-disk');






  fs.writeFileSync(path.join(out,'application-evidence.json'),JSON.stringify({sourceSha:source.sourceSha,runnerSha:process.env.GITHUB_SHA,platform:process.platform,electron:process.versions.electron,checks},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(deadline);server?.close();app.exit(0);}).catch(err=>{console.error(err.message);fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({checks,error:err.message},null,2));clearTimeout(deadline);server?.close();app.exit(1);});
