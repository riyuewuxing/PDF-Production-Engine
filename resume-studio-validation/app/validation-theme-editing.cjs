const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = process.env.RESUME_STUDIO_DATA_DIR;
const out = process.env.RESUME_STUDIO_EVIDENCE_OUT;
const phase = process.env.STUDIO_THEME_PHASE || 'candidate';
if (!root || !out || !['candidate','baseline','restart'].includes(phase)) throw Error('isolated paths/phase required');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const userData = path.join(root, 'userData');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.disableHardwareAcceleration();
const main = require('./dist-electron/main.cjs');
const fixture = require('./runner-fixture.json');
const checks = {};
let results = {};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timer = setTimeout(() => { fs.writeFileSync(path.join(out,'timeout-'+phase+'.json'),JSON.stringify({checks,results},null,2)); app.exit(2); }, 200000);
async function until(label, fn, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(120); }
  throw Error('Timed out: ' + label);
}
async function run() {
  if (phase !== 'restart') {
    await main.store.saveResume('master', { ...fixture, id: 'synthetic-master', title: '合成母库' });
    await main.store.saveResume('runner-fixture', fixture);
  }
  await main.registerAssetProtocol();
  main.registerIpcHandlers();
  const win = await main.createMainWindow();
  const js = code => win.webContents.executeJavaScript(code);
  const key = 'resume-studio-ui-theme-v1';
  const disk = path.join(main.store.resumesDir,'runner-fixture.json');
  assert.ok(!path.relative(root,disk).startsWith('..')&&!path.isAbsolute(path.relative(root,disk)),'fixture path escaped isolated workspace');
  async function ready() {
    await until('synthetic document loaded', () => js('document.querySelector("#basic-field-name")?.value === "演示候选人"'));
    await until('saved state', () => js('document.querySelector("[aria-label=\\\"本地保存状态\\\"]")?.innerText.includes("已保存至本地硬盘")'));
    await js('document.fonts.ready.then(()=>true)');
    await sleep(250);
  }
  await ready();
  win.unmaximize();
  win.setSize(1440,920);
  win.focus();
  await sleep(450);
  const originalDisk = sha(fs.readFileSync(disk));
  const doc = await main.store.getResume('runner-fixture');
  assert.ok(doc);
  async function capture(name) {
    await js('document.fonts.ready.then(()=>true)');
    await sleep(250);
    const image = await win.webContents.capturePage();
    assert.ok(!image.isEmpty(),'empty screenshot '+name);
    fs.writeFileSync(path.join(out,name+'.png'),image.toPNG());
  }
  async function sheetState() {
    return js(`(()=>{
      const sheet=document.querySelector('.a4-sheet');if(!sheet)throw Error('missing A4');
      const base=sheet.getBoundingClientRect();
      const num=v=>Math.round(v*1000)/1000;
      const children=[sheet,...sheet.querySelectorAll('*')].map(el=>{
        const r=el.getBoundingClientRect(),s=getComputedStyle(el);
        return {tag:el.tagName,cls:el.getAttribute('class'),style:el.getAttribute('style'),
          rect:[num(r.x-base.x),num(r.y-base.y),num(r.width),num(r.height)],
          color:s.color,bg:s.backgroundColor,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,
          line:s.lineHeight,spacing:s.letterSpacing,border:s.border,transform:s.transform,scheme:s.colorScheme};
      });
      return {text:sheet.innerText,children,width:num(base.width),height:num(base.height),
        x:base.x,y:base.y,viewport:[innerWidth,innerHeight]};
    })()`);
  }
  const compareSheet = state => sha(JSON.stringify({text:state.text,children:state.children,width:state.width,height:state.height}));
  async function captureSheet(name) {
    const s=await sheetState();
    const x=Math.ceil(s.x)+2,y=Math.ceil(s.y)+2;
    const right=Math.min(Math.floor(s.x+s.width)-2,s.viewport[0]-2);
    const bottom=Math.min(Math.floor(s.y+s.height)-2,s.viewport[1]-2);
    assert.ok(right-x>100&&bottom-y>100,'visible A4 too small');
    const image=await win.webContents.capturePage({x,y,width:right-x,height:bottom-y});
    assert.ok(!image.isEmpty(),'empty A4 crop');
    fs.writeFileSync(path.join(out,name+'-a4.png'),image.toPNG());
    return {styleHash:compareSheet(s),cropHash:sha(image.toBitmap()),cropSize:image.getSize(),sheet:[s.width,s.height],viewport:s.viewport};
  }
  async function exportNative(label) {
    const pdf=await js('window.resumeDesktop.pdf.export('+JSON.stringify({slug:'',document:doc})+')');
    const png=await js('window.resumeDesktop.pdf.exportPng('+JSON.stringify({slug:'',document:doc})+')');
    assert.ok(!pdf.canceled&&pdf.filePath&&!png.canceled&&png.filePath,'native export missing');
    const pb=fs.readFileSync(pdf.filePath),ib=fs.readFileSync(png.filePath);
    assert.equal(pb.subarray(0,5).toString(),'%PDF-');
    assert.equal(ib.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const image=nativeImage.createFromBuffer(ib);assert.ok(!image.isEmpty());
    fs.writeFileSync(path.join(out,label+'-export.pdf'),pb);
    fs.writeFileSync(path.join(out,label+'-export.png'),ib);
    return {pdfSha:sha(pb),pdfBytes:pb.length,pngSha:sha(ib),pngPixels:sha(image.toBitmap()),pngSize:image.getSize()};
  }
  async function clickByAria(label) {
    const ok=await js('(()=>{const el=[...document.querySelectorAll("button[aria-label]")].find(e=>e.getAttribute("aria-label")==='+JSON.stringify(label)+');if(!el||el.disabled)return false;el.click();return true})()');
    assert.ok(ok,'missing UI action '+label);
  }
  async function selectTheme(id) {
    const ok=await js('(()=>{const e=document.querySelector("select[aria-label=\\\"切换工作台主题\\\"]");if(!e||e.disabled)return false;e.value='+JSON.stringify(id)+';e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
    assert.ok(ok,'missing actual theme selector');
    await until('theme applied '+id,()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==='+JSON.stringify(id)));
    await sleep(220);
  }
  async function inspectChrome(id) {
    const s=await js(`(()=>{
      const h=document.querySelector('[data-studio-surface="header"]'),n=document.querySelector('[data-studio-surface="nav"]');
      if(!h||!n)throw Error('missing marked surfaces');
      const sel=n.querySelector('[aria-current="page"]');
      const p=h.querySelector('select[aria-label="切换工作台主题"]');
      return {id:h.dataset.studioTheme,navId:n.dataset.studioTheme,header:getComputedStyle(h).backgroundColor,
        nav:getComputedStyle(n).backgroundColor,headerText:getComputedStyle(h).color,
        navSelected:getComputedStyle(sel).color,navSelectedBg:getComputedStyle(sel).backgroundColor,
        value:p.value,scheme:getComputedStyle(p).colorScheme,
        sheetScheme:getComputedStyle(document.querySelector('.a4-sheet')).colorScheme,
        headerHeight:h.getBoundingClientRect().height,headerScrollWidth:h.scrollWidth,headerWidth:h.clientWidth};
    })()`);
    assert.equal(s.id,id);assert.equal(s.navId,id);assert.equal(s.value,id);assert.equal(s.sheetScheme,'light');
    assert.ok(s.headerScrollWidth<=s.headerWidth+2,'header horizontal overflow');
    return s;
  }
  const stableDoc = d => { const {updatedAt,...rest}=d;return JSON.stringify(rest); };
  const originalStable=stableDoc(doc);
  const current=()=>main.store.getResume('runner-fixture');
  async function saved(label,predicate){
    await until(label+' disk state',async()=>predicate(await current()));
    await until(label+' saved status',()=>js(`document.querySelector('[aria-label="本地保存状态"]')?.innerText.includes("已保存至本地硬盘")`));
  }
  function keyStroke(keyCode,modifiers=[]){
    win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
    win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
  }
  async function fieldState(){
    return js(`(()=>{
      const e=document.querySelector('#basic-field-name');
      const undo=document.querySelector('button[aria-label="撤销"]'),redo=document.querySelector('button[aria-label="重做"]');
      return {value:e.value,focus:document.activeElement===e,selection:[e.selectionStart,e.selectionEnd],
        undo:{disabled:undo.disabled,title:undo.title},redo:{disabled:redo.disabled,title:redo.title},
        paper:document.querySelector('.a4-sheet').innerText};
    })()`);
  }
  await selectTheme('dark');
  assert.ok(await js(`(()=>{const e=document.querySelector('#basic-field-name');window.__editIdentity=e;e.focus();e.select();return document.activeElement===e})()`));
  await win.webContents.insertText('合成修改候选人');
  await saved('native keyboard edit',d=>d.basic.name==='合成修改候选人');
  let edited=await fieldState();assert.equal(edited.value,'合成修改候选人');assert.ok(edited.paper.includes('合成修改候选人'));assert.equal(edited.undo.disabled,false);
  await capture('dark-edited');
  await js(`(()=>{const e=document.querySelector('#basic-field-name');e.focus();e.setSelectionRange(1,3);return true})()`);
  const beforeTheme=await fieldState();const editedHash=sha(fs.readFileSync(disk));
  await selectTheme('warm');
  const afterTheme=await fieldState();
  assert.ok(await js('window.__editIdentity===document.querySelector("#basic-field-name")'));
  assert.deepEqual(afterTheme,beforeTheme,'theme change lost editor selection, focus, history or content');
  assert.equal(sha(fs.readFileSync(disk)),editedHash,'theme wrote edited document');
  await capture('warm-preserved-selection');
  checks.nativeTextEditAndThemePreserve=true;
  keyStroke('Z',['control']);
  await saved('actual Ctrl+Z',d=>d.basic.name===doc.basic.name);
  let undone=await fieldState();assert.equal(undone.value,doc.basic.name);assert.ok(undone.paper.includes(doc.basic.name));assert.equal(undone.redo.disabled,false);
  await capture('warm-undo');
  await selectTheme('light');
  keyStroke('Y',['control']);
  await saved('actual Ctrl+Y',d=>d.basic.name==='合成修改候选人');
  await capture('light-redo');
  keyStroke('Z',['control']);
  await saved('restore original name',d=>d.basic.name===doc.basic.name);
  assert.equal(stableDoc(await current()),originalStable,'undo did not restore entire document');
  checks.nativeUndoRedo=true;
  // Native range-keyboard change exercises the real preview/document setting path.
  await selectTheme('dark');
  const range=await js(`(()=>{const e=document.querySelector('input[aria-label="基础字号"]');e.focus();window.__rangeIdentity=e;return {value:Number(e.value),step:Number(e.step),focus:document.activeElement===e}})()`);
  assert.ok(range.focus);assert.equal(range.value,doc.globalSettings.baseFontSize);
  keyStroke('Right');
  const desired=range.value+range.step;
  await saved('native range keyboard',d=>d.globalSettings.baseFontSize===desired);
  await capture('dark-font-increased');
  const rangeHash=sha(fs.readFileSync(disk));
  await selectTheme('warm');
  assert.ok(await js('window.__rangeIdentity===document.querySelector(\'input[aria-label="基础字号"]\')'));
  assert.equal(sha(fs.readFileSync(disk)),rangeHash);
  assert.equal(await js('Number(document.querySelector(\'input[aria-label="基础字号"]\').value)'),desired);
  keyStroke('Z',['control']);
  await saved('restore font size',d=>d.globalSettings.baseFontSize===range.value);
  assert.equal(stableDoc(await current()),originalStable,'font undo changed another setting');
  checks.nativeRangeAndUndo=true;
  // Privacy mode uses its actual buttons and masked document, not fake labels.
  const stableHash=sha(fs.readFileSync(disk));
  const toggle=await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='隐私脱敏');if(!b||b.disabled)return false;b.click();return true})()`);
  assert.ok(toggle);
  await until('real privacy preview',()=>js(`document.body.innerText.includes('当前处于隐私脱敏预览与导出模式')&&!document.querySelector('.a4-sheet').innerText.includes('演示候选人')&&!document.querySelector('.a4-sheet').innerText.includes('demo@example.invalid')`));
  for(const id of ['warm','dark','light']){
    await selectTheme(id);assert.ok(await js(`!document.querySelector('.a4-sheet').innerText.includes('演示候选人')&&!document.querySelector('.a4-sheet').innerText.includes('demo@example.invalid')`));
    await capture(id+'-actual-redacted');
    assert.equal(sha(fs.readFileSync(disk)),stableHash,'privacy/theme changed original document');
  }
  const exit=await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='退出脱敏模式');if(!b||b.disabled)return false;b.click();return true})()`);
  assert.ok(exit);
  await until('privacy exit restores visible document',()=>js(`document.querySelector('.a4-sheet').innerText.includes('演示候选人')`));
  assert.equal(sha(fs.readFileSync(disk)),stableHash);
  await selectTheme('warm');
  await capture('warm-restored');
  checks.actualPrivacyMode=true;
  results={beforeTheme,afterTheme,edited,undone,range,desired,restoredDocumentHash:sha(stableDoc(await current()))};
  fs.writeFileSync(path.join(out,'result-editing.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA||null,checks,results},null,2));
  console.log(JSON.stringify({checks,results},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0);}).catch(err=>{console.error(err.stack||err.message);fs.writeFileSync(path.join(out,'failure-editing.json'),JSON.stringify({checks,results,error:err.stack||err.message},null,2));clearTimeout(timer);app.exit(1);});
