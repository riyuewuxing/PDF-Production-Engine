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
const results = {};
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
  if (phase==='baseline') {
    await capture('baseline-classic');
    results.classic={sheet:await captureSheet('baseline-classic'),export:await exportNative('baseline-classic')};
    assert.equal(sha(fs.readFileSync(disk)),originalDisk,'baseline exports changed stored document');
    checks.realOldBaseline=true;
  } else if (phase==='restart') {
    await until('persisted warm theme on cold app process',()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==="warm"'));
    results.restart={chrome:await inspectChrome('warm'),sheet:await captureSheet('restart-warm')};
    await capture('restart-warm');
    assert.equal(sha(fs.readFileSync(disk)),originalDisk);
    checks.coldProcessPersistence=true;
  } else {
    await until('default classic',()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==="classic"'));
    await js('window.__themeProbeInput=document.querySelector("#basic-field-name")');
    for (const id of ['classic','dark','light','warm']) {
      if (id!=='classic') await selectTheme(id);
      assert.ok(await js('window.__themeProbeInput===document.querySelector("#basic-field-name")'),'editor remounted');
      const c=await inspectChrome(id);
      const expected={classic:['rgb(17, 22, 31)','rgb(13, 17, 24)'],dark:['rgb(11, 17, 32)','rgb(8, 13, 26)'],light:['rgb(255, 255, 255)','rgb(248, 250, 252)'],warm:['rgb(244, 238, 225)','rgb(239, 232, 216)']}[id];
      assert.equal(c.header,expected[0]);assert.equal(c.nav,expected[1]);
      await capture('candidate-'+id);
      const sheet=await captureSheet('candidate-'+id);
      const exp=await exportNative('candidate-'+id);
      results[id]={chrome:c,sheet,export:exp};
      if(id!=='classic'){
        assert.equal(sheet.styleHash,results.classic.sheet.styleHash,'A4 computed layout/style changed for '+id);
        assert.equal(exp.pngPixels,results.classic.export.pngPixels,'actual exported PNG changed for '+id);
        assert.deepEqual(exp.pngSize,results.classic.export.pngSize);
      }
      assert.equal(sha(fs.readFileSync(disk)),originalDisk,'theme/export altered document bytes');
      checks['theme-'+id]=true;
    }
    // Actual renderer control, keyboard command path, and menu/permission boundaries.
    await selectTheme('light');
    await clickByAria('更多导出格式');
    await until('export menu open',()=>js('!!document.querySelector("[role=menu]")'));
    await capture('light-export-menu');
    await clickByAria('更多导出格式');
    await clickByAria('设置自定义脱敏敏感词');
    await until('privacy popover',()=>js('!!document.querySelector("[aria-label=\\\"脱敏敏感词设置\\\"]")'));
    await capture('light-privacy-popover');
    await clickByAria('设置自定义脱敏敏感词');
    await clickByAria('打开命令面板');
    await until('command palette',()=>js('!!document.querySelector("[aria-label=\\\"搜索命令、模板与版本\\\"]")'));
    await js(`(()=>{
      const e=document.querySelector('[aria-label="搜索命令、模板与版本"]');
      e.focus();const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(e,'工作台主题 warm');e.dispatchEvent(new Event('input',{bubbles:true}));return true;
    })()`);
    await until('theme command result',()=>js('document.body.innerText.includes("工作台外观预览：温润羊皮")'));
    await capture('theme-command-palette');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    await until('theme command executes',()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==="warm"&&!document.querySelector("[aria-label=\\\"全局命令面板\\\"]")'));
    checks.commandKeyboard=true;
    assert.equal(sha(fs.readFileSync(disk)),originalDisk,'command changed document bytes');
    await win.webContents.reload();
    await ready();
    await until('reload persisted warm',()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==="warm"'));
    checks.rendererReload=true;
    // Simulate future-version state via isolated renderer storage only.
    const future=JSON.stringify({schemaVersion:99,activePreset:'dark'});
    await js('localStorage.setItem('+JSON.stringify(key)+','+JSON.stringify(future)+')');
    await win.webContents.reload();await ready();
    await until('future fallback notice',()=>js('document.body.innerText.includes("原配置已保留")'));
    await selectTheme('dark');
    assert.equal(await js('localStorage.getItem('+JSON.stringify(key)+')'),future);
    await capture('future-preference-preserved');
    checks.futurePreferencePreserved=true;
    // Restore only the synthetic test preference for a separate actual cold-process test.
    await js('localStorage.setItem('+JSON.stringify(key)+','+JSON.stringify(JSON.stringify({schemaVersion:1,activePreset:'warm'}))+')');
    await win.webContents.reload();await ready();
    await until('warm ready for cold restart',()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==="warm"'));
    assert.equal(sha(fs.readFileSync(disk)),originalDisk);
    checks.diskUnchanged=true;
    // Real user-facing PDF export through the existing button/handler, not just direct IPC.
    const before=new Set(fs.readdirSync(main.exportsDir));
    const clicked=await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==="导出 PDF");if(!b||b.disabled)return false;b.click();return true})()');
    assert.ok(clicked);
    await until('real UI export file',()=>fs.readdirSync(main.exportsDir).some(n=>!before.has(n)&&n.endsWith('.pdf')));
    await until('real UI export success',()=>js('document.body.innerText.includes("已导出")&&[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==="导出 PDF"&&!b.disabled)'));
    await capture('warm-ui-export-complete');
    assert.equal(sha(fs.readFileSync(disk)),originalDisk,'UI export altered document');
    checks.realUiPdfExport=true;
  }
  fs.writeFileSync(path.join(out,'result-'+phase+'.json'),JSON.stringify({phase,runnerSha:process.env.GITHUB_SHA||null,checks,results,diskHash:originalDisk},null,2));
  console.log(JSON.stringify({phase,checks,results},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0);}).catch(err=>{console.error(err.stack||err.message);fs.writeFileSync(path.join(out,'failure-'+phase+'.json'),JSON.stringify({phase,checks,results,error:err.stack||err.message},null,2));clearTimeout(timer);app.exit(1);});
