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
  const originalSave = main.store.saveResume.bind(main.store);
  let failSave = true;
  main.store.saveResume = async (slug, doc) => {
    if (slug === 'runner-fixture' && failSave) throw Error('受控写入失败');
    return originalSave(slug, doc);
  };
  await js('(()=>{const e=document.querySelector("#basic-field-name");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"演示候选人（修改）");e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  await until('visible save failure', () => bodyHas('受控写入失败'));
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
  await until('edit persisted after retry', async () => (await main.store.getResume('runner-fixture')).basic.name === '演示候选人（修改）');
  await until('saved state', () => bodyHas('已保存至本地硬盘'));
  await capture('03-save-recovered');
  checks.saveRecovered = true;

  server = http.createServer((req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
    req.resume();
    req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'- 学生达标率提高30%。'}}]}));});
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const settings={enabled:true,providerLabel:'Isolated mock',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'',model:'synthetic'};
  await js('window.resumeDesktop.ai.saveSettings('+JSON.stringify(settings)+')');
  await click('诊断优化');
  await click('AI 润色 Diff');
  await until('AI config loaded', () => bodyHas('已启用 · 修改'));
  await click('生成润色对比 Diff');
  await until('fact guard appears', () => bodyHas('我已核对以上事实，确认属实'));
  const blocked = await js('[...document.querySelectorAll("button")].find(b=>b.innerText.includes("采纳替换"))?.disabled === true');
  if (!blocked) throw Error('risky single polish was not blocked');
  await capture('04-ai-fact-review');
  checks.riskRequiresApproval = true;
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
  await capture('06-ai-applied');
  const saved = await main.store.getResume('runner-fixture');
  const pdf = await main.renderDocumentToPdf(saved);
  if (!pdf.subarray(0,5).equals(Buffer.from('%PDF-'))) throw Error('invalid PDF');
  fs.writeFileSync(path.join(out,'actual-export.pdf'),pdf);
  const png = await main.renderDocumentToPng(saved);
  fs.writeFileSync(path.join(out,'actual-export.png'),png);
  checks.pdfBytes=pdf.length;
  checks.pngBytes=png.length;
  fs.writeFileSync(path.join(out,'application-evidence.json'),JSON.stringify({sourceSha:source.sourceSha,runnerSha:process.env.GITHUB_SHA,platform:process.platform,electron:process.versions.electron,checks},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(deadline);server?.close();app.exit(0);}).catch(err=>{console.error(err.message);fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({checks,error:err.message},null,2));clearTimeout(deadline);server?.close();app.exit(1);});
