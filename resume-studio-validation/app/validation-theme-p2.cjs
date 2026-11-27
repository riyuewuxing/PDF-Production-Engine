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
      const clipEl=sheet.closest('.print-workspace.overflow-auto');if(!clipEl)throw Error('missing scroll viewport');const cr=clipEl.getBoundingClientRect();
      const num=v=>Math.round(v*1000)/1000;
      const children=[sheet,...sheet.querySelectorAll('*')].map(el=>{
        const r=el.getBoundingClientRect(),s=getComputedStyle(el);
        return {tag:el.tagName,cls:el.getAttribute('class'),style:el.getAttribute('style'),
          rect:[num(r.x-base.x),num(r.y-base.y),num(r.width),num(r.height)],
          color:s.color,bg:s.backgroundColor,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,
          line:s.lineHeight,spacing:s.letterSpacing,border:s.border,transform:s.transform,scheme:s.colorScheme};
      });
      return {text:sheet.innerText,children,width:num(base.width),height:num(base.height),
        x:base.x,y:base.y,viewport:[innerWidth,innerHeight],clip:{left:cr.left,top:cr.top,right:cr.right,bottom:cr.bottom}};
    })()`);
  }
  const compareSheet = state => sha(JSON.stringify({text:state.text,children:state.children,width:state.width,height:state.height}));
  async function captureSheet(name) {
    const s=await sheetState();
    const x=Math.max(Math.ceil(s.x)+2,Math.ceil(s.clip.left)+1,0),y=Math.max(Math.ceil(s.y)+2,Math.ceil(s.clip.top)+1,0);
    const right=Math.min(Math.floor(s.x+s.width)-2,Math.floor(s.clip.right)-1,s.viewport[0]-2);
    const bottom=Math.min(Math.floor(s.y+s.height)-2,Math.floor(s.clip.bottom)-1,s.viewport[1]-2);
    assert.ok(right-x>100&&bottom-y>100,'visible A4 too small');
    const image=await win.webContents.capturePage({x,y,width:right-x,height:bottom-y});
    assert.ok(!image.isEmpty(),'empty A4 crop');
    fs.writeFileSync(path.join(out,name+'-a4.png'),image.toPNG());
    return {styleHash:compareSheet(s),cropHash:sha(image.toBitmap()),cropSize:image.getSize(),sheet:[s.width,s.height],viewport:s.viewport,clip:s.clip,cropRect:{x,y,right,bottom}};
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
  async function inspectSurfaces(id) {
    const s=await js(`(()=>{
      const panel=document.querySelector('[data-studio-surface="panel"]');
      const toolbar=document.querySelector('[data-studio-surface="preview"]');
      const stage=document.querySelector('[data-studio-preview-backing]');
      const input=document.querySelector('#basic-field-name');
      const sheet=document.querySelector('.a4-sheet');
      if(!panel||!toolbar||!stage||!sheet) throw Error('missing explicit surface');
      const bg=e=>getComputedStyle(e).backgroundColor;
      const fg=e=>getComputedStyle(e).color;
      const swatches=[...panel.querySelectorAll('button[aria-label^="主题色 "],button[aria-label^="纸张底色 "]')].map(e=>({
        label:e.getAttribute('aria-label'),style:e.getAttribute('style'),
        swatch:e.querySelector('span[style]')?.getAttribute('style')||null,
        color:bg(e.querySelector('span[style]')||e)
      }));
      const controls=[...panel.querySelectorAll('[data-studio-control]')];
      return {panel:bg(panel),panelText:fg(panel),toolbar:bg(toolbar),stage:bg(stage),backing:stage.dataset.studioPreviewBacking,
        field:input?{bg:bg(input),fg:fg(input),scheme:getComputedStyle(input).colorScheme,value:input.value}:null,
        swatches,controls:controls.length,
        sheetMarkers:sheet.querySelectorAll('[data-studio-control],[class*="studio-ui-"],[data-studio-surface]').length,
        sheetScheme:getComputedStyle(sheet).colorScheme,
        panelWidth:panel.clientWidth,scrollWidth:panel.scrollWidth};
    })()`);
    assert.equal(s.sheetMarkers,0,'theme marker inside paper');assert.equal(s.sheetScheme,'light');assert.ok(s.controls>10);
    assert.ok(s.scrollWidth<=s.panelWidth+2,'panel horizontal overflow');
    if(id!=='classic'){
      const expected={dark:['rgb(17, 24, 39)','rgb(24, 34, 52)','rgb(11, 15, 23)','rgb(15, 23, 42)','dark'],
        light:['rgb(255, 255, 255)','rgb(255, 255, 255)','rgb(226, 232, 240)','rgb(248, 250, 252)','light'],
        warm:['rgb(251, 247, 238)','rgb(244, 238, 225)','rgb(230, 223, 208)','rgb(255, 253, 248)','light']}[id];
      assert.equal(s.panel,expected[0]);assert.equal(s.toolbar,expected[1]);
      if(s.backing==='follow')assert.equal(s.stage,expected[2]);
      if(s.field){assert.equal(s.field.bg,expected[3]);assert.equal(s.field.scheme,expected[4]);}
    }
    if(s.field)assert.equal(s.field.value,'演示候选人');
    return s;
  }
  async function switchNav(label) {
    const ok=await js(`(()=>{const e=[...document.querySelectorAll('[data-studio-surface="nav"] button')].find(e=>e.innerText.trim()===`+JSON.stringify(label)+`);if(!e||e.disabled)return false;e.click();return true})()`);
    assert.ok(ok,'missing nav '+label);await sleep(250);
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
    await js('(()=>{window.__themeProbeInput=document.querySelector("#basic-field-name");return !!window.__themeProbeInput})()');
    for (const id of ['classic','dark','light','warm']) {
      if (id!=='classic') await selectTheme(id);
      assert.ok(await js('window.__themeProbeInput===document.querySelector("#basic-field-name")'),'editor remounted');
      const c=await inspectChrome(id);
      const expected={classic:['rgb(17, 22, 31)','rgb(13, 17, 24)'],dark:['rgb(11, 17, 32)','rgb(8, 13, 26)'],light:['rgb(255, 255, 255)','rgb(248, 250, 252)'],warm:['rgb(244, 238, 225)','rgb(239, 232, 216)']}[id];
      assert.equal(c.header,expected[0]);assert.equal(c.nav,expected[1]);
      await capture('candidate-'+id);
      const sheet=await captureSheet('candidate-'+id);
      const exp=await exportNative('candidate-'+id);
      results[id]={chrome:c,sheet,export:exp,surfaces:await inspectSurfaces(id)};
      if(id!=='classic'){
        assert.equal(sheet.styleHash,results.classic.sheet.styleHash,'A4 computed layout/style changed for '+id);
        assert.equal(sheet.cropHash,results.classic.sheet.cropHash,'visible A4 pixels changed for '+id);
        assert.equal(exp.pngPixels,results.classic.export.pngPixels,'actual exported PNG changed for '+id);
        assert.deepEqual(exp.pngSize,results.classic.export.pngSize);
      }
      assert.equal(sha(fs.readFileSync(disk)),originalDisk,'theme/export altered document bytes');
      checks['theme-'+id]=true;
    }
    // Explicit editor fold/unfold (UI-only) and style panel swatch invariance.
    await selectTheme('dark');
    const fold=await js(`(()=>{const b=[...document.querySelectorAll('[data-studio-surface="panel"] button[aria-expanded]')].find(e=>e.getAttribute('aria-label')?.startsWith('折叠')&&e.closest('.rounded-lg')?.querySelector('#basic-field-name'));if(!b)return null;return b.getAttribute('aria-label')})()`);
    assert.ok(fold,'missing actual basic section fold control');
    await clickByAria(fold);
    await until('basic field collapsed',()=>js('!document.querySelector("#basic-field-name")'));
    await capture('editor-dark-collapsed');
    await clickByAria(fold.replace(/^折叠/,'展开'));
    await until('basic field expanded',()=>js('document.querySelector("#basic-field-name")?.value==="演示候选人"'));
    await capture('editor-dark-expanded');
    checks.editorFold=true;
    await switchNav('样式底色');
    await until('style controls visible',()=>js(`!!document.querySelector('input[aria-label="自定义主题色"]')`));
    results.style={};
    for(const id of ['classic','dark','light','warm']){
      await selectTheme(id);
      const surface=await inspectSurfaces(id);
      assert.ok(surface.swatches.length>=10,'actual swatch controls missing');
      const sheet=await captureSheet('style-'+id);
      assert.equal(sheet.styleHash,results.classic.sheet.styleHash,'style tab changed paper layout');
      assert.equal(sheet.cropHash,results.classic.sheet.cropHash,'style tab changed visible paper pixels');
      results.style[id]={surface,sheet};
      if(id!=='classic') assert.deepEqual(surface.swatches,results.style.classic.surface.swatches,'actual swatch colors changed');
      await capture('style-'+id);
    }
    checks.stylePanelSwatches=true;
    await switchNav('内容编辑');
    await until('editor visible again',()=>js('document.querySelector("#basic-field-name")?.value==="演示候选人"'));
    assert.equal(sha(fs.readFileSync(disk)),originalDisk,'navigation/theme/fold changed document');
    // Stage override follows the user until reset, without altering A4 or the document.
    await selectTheme('warm');
    const beforeBacking=await captureSheet('backing-before');
    await clickByAria('切换暗色画布');
    await until('dark override',()=>js('document.querySelector("[data-studio-preview-backing]").dataset.studioPreviewBacking==="dark"'));
    await sleep(250);
    const override=await inspectSurfaces('warm');assert.equal(override.stage,'rgb(24, 29, 39)');
    await capture('warm-dark-backing');
    await selectTheme('light');const retained=await inspectSurfaces('light');assert.equal(retained.backing,'dark');assert.equal(retained.stage,'rgb(24, 29, 39)');
    await capture('light-retained-dark-backing');
    await clickByAria('画布底衬跟随工作台');
    await until('backing follows again',()=>js('document.querySelector("[data-studio-preview-backing]").dataset.studioPreviewBacking==="follow"'));
    await sleep(250);
    const follow=await inspectSurfaces('light');assert.equal(follow.stage,'rgb(226, 232, 240)');
    const afterBacking=await captureSheet('backing-after');
    assert.equal(afterBacking.styleHash,beforeBacking.styleHash,'backing override changed paper');
    assert.equal(afterBacking.cropHash,beforeBacking.cropHash,'backing override changed paper pixels');
    assert.equal(sha(fs.readFileSync(disk)),originalDisk,'backing override changed document');
    results.backing={override,retained,follow,before:beforeBacking,after:afterBacking};
    checks.backingOverride=true;
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

    // Exercise the supported minimum native window size and actual keyboard events.
    win.setSize(1080,720); await sleep(450);
    const narrow=await js('({width:innerWidth,height:innerHeight})');
    assert.ok(narrow.width<=1080&&narrow.height<=720,'minimum window resize did not take effect');
    results.narrow={viewport:narrow,themes:{}};
    for(const id of ['classic','dark','light','warm']){
      await selectTheme(id);
      const c=await inspectChrome(id);
      const layout=await js(`(()=>{
        const h=document.querySelector('[data-studio-surface="header"]');
        const box=h.getBoundingClientRect();
        return [...h.querySelectorAll('button,select')].filter(e=>e.getClientRects().length>0).map(e=>{
          const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.innerText||e.title,
            visible:r.width>0&&r.height>0&&r.left>=box.left-1&&r.right<=box.right+1&&r.top>=box.top-1&&r.bottom<=box.bottom+1};
        });
      })()`);
      assert.ok(layout.length>5&&layout.every(e=>e.visible),'header control clipped at minimum size '+id+': '+JSON.stringify(layout.filter(e=>!e.visible)));
      results.narrow.themes[id]={chrome:c,controls:layout.length,sheet:await captureSheet('minimum-'+id),surfaces:await inspectSurfaces(id)};
      await capture('minimum-'+id);
    }
    const focus=await js(`(()=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');e.focus();return document.activeElement===e})()`);
    assert.ok(focus,'theme selector keyboard focus unavailable');
    await capture('minimum-keyboard-focus');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Home'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Home'});
    await until('keyboard native select Home classic',()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==="classic"'),6000);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'End'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'End'});
    await until('keyboard native select End warm',()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==="warm"'),6000);
    checks.minimumKeyboardSelect=true;
    await clickByAria('更多导出格式');
    await until('minimum export menu open',()=>js('!!document.querySelector("[role=menu]")'));
    const menu=await js(`(()=>{const r=document.querySelector('[role=menu]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
    results.narrow.menu=menu;
    assert.ok(menu.left>=0&&menu.right<=menu.width+1&&menu.top>=0&&menu.bottom<=menu.height+1,'minimum menu outside viewport');
    await capture('minimum-export-menu');await clickByAria('更多导出格式');
    await clickByAria('设置自定义脱敏敏感词');
    await until('minimum privacy popover open',()=>js('!!document.querySelector(\'[aria-label="脱敏敏感词设置"]\')'));
    const pop=await js(`(()=>{const r=document.querySelector('[aria-label="脱敏敏感词设置"]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
    results.narrow.privacy=pop;
    assert.ok(pop.left>=0&&pop.right<=pop.width+1&&pop.top>=0&&pop.bottom<=pop.height+1,'minimum privacy popover outside viewport');
    await capture('minimum-privacy-popover');await clickByAria('设置自定义脱敏敏感词');
    assert.equal(sha(fs.readFileSync(disk)),originalDisk,'minimum controls changed document');
    checks.minimumViewport=true;
  }
  fs.writeFileSync(path.join(out,'result-'+phase+'.json'),JSON.stringify({phase,runnerSha:process.env.GITHUB_SHA||null,checks,results,diskHash:originalDisk},null,2));
  console.log(JSON.stringify({phase,checks,results},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0);}).catch(err=>{console.error(err.stack||err.message);fs.writeFileSync(path.join(out,'failure-'+phase+'.json'),JSON.stringify({phase,checks,results,error:err.stack||err.message},null,2));clearTimeout(timer);app.exit(1);});
