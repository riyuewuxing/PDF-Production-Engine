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
const deadline = setTimeout(() => { console.error('application smoke deadline exceeded'); app.exit(2); }, 150000);
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
  // Real renderer IPC: editor is allowed, another window with identical preload is not.
  const { BrowserWindow, ipcMain } = require('electron');
  const rogue = new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'dist-electron','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  try {
    await rogue.loadFile(path.join(__dirname,'dist','index.html'));
    const denied=await rogue.webContents.executeJavaScript('window.resumeDesktop.resumes.list().then(()=>false,()=>true)');
    if(!denied)throw Error('untrusted window was able to list resumes');
    const aiDenied=await rogue.webContents.executeJavaScript('window.resumeDesktop.ai.getSettings().then(()=>false,()=>true)');
    if(!aiDenied)throw Error('untrusted window read AI settings');
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
  server = http.createServer((req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
    if(req.headers.authorization !== 'Bearer synthetic-test-key'){res.writeHead(401);res.end();return;}
    checks.mainProcessCredentialUsed = true;
    let raw=''; req.on('data',chunk=>raw+=String(chunk));
    req.on('end',()=>{providerCalls++; const body=JSON.parse(raw); checks.exactPreviewMatched=JSON.stringify(body.messages)===JSON.stringify(approvedMessages);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'- 学生达标率提高30%。'}}]}));});
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const settings={enabled:true,providerLabel:'Isolated mock',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'synthetic-test-key',model:'synthetic'};
  fs.writeFileSync(path.join(main.dataDir,'.ai-settings.json'), JSON.stringify(settings));
  const migrated = await js('window.resumeDesktop.ai.getSettings()');
  if (migrated.apiKey !== '' || migrated.hasApiKey !== true) throw Error('renderer credential exposure or migration failed');
  const stored = JSON.parse(fs.readFileSync(path.join(main.dataDir,'.ai-settings.json'),'utf8'));
  if (stored.apiKey !== undefined || !stored.encryptedApiKey || JSON.stringify(stored).includes('synthetic-test-key')) throw Error('plaintext credential retained');
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




  fs.writeFileSync(path.join(out,'application-evidence.json'),JSON.stringify({sourceSha:source.sourceSha,runnerSha:process.env.GITHUB_SHA,platform:process.platform,electron:process.versions.electron,checks},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(deadline);server?.close();app.exit(0);}).catch(err=>{console.error(err.message);fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({checks,error:err.message},null,2));clearTimeout(deadline);server?.close();app.exit(1);});
