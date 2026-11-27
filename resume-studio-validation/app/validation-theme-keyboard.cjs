const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = process.env.RESUME_STUDIO_DATA_DIR;
const out = process.env.RESUME_STUDIO_EVIDENCE_OUT;
const phase = process.env.STUDIO_THEME_PHASE || 'candidate';
if (!root || !out || !['candidate','baseline'].includes(phase)) throw Error('isolated paths/phase required');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const userData = path.join(root, 'userData');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor','1.25');
const main = require('./dist-electron/main.cjs');
const fixture = require('./runner-fixture.json');
const checks = {};
const results = {};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timer = setTimeout(() => { fs.writeFileSync(path.join(out,'timeout-'+phase+'.json'),JSON.stringify({checks,results},null,2)); app.exit(2); }, 260000);
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

  const themes=phase==='baseline'?['classic']:['classic','dark','light','warm'];
  const isCandidate=phase==='candidate';
  async function clickText(label, starts=false, scope='body'){
    const ok=await js('(()=>{const s=document.querySelector('+JSON.stringify(scope)+');const e=[...(s?.querySelectorAll("button")||[])].find(e=>'+(starts?'e.innerText.trim().startsWith(':'e.innerText.trim()===')+JSON.stringify(label)+(starts?')':'')+');if(!e||e.disabled)return false;e.click();return true})()');
    assert.ok(ok,'button unavailable '+label+' in '+scope);await sleep(220);
  }
  async function clickCss(sel){
    const ok=await js('(()=>{const e=document.querySelector('+JSON.stringify(sel)+');if(!e||e.disabled)return false;e.click();return true})()');assert.ok(ok,'control missing '+sel);
  }
  async function nav(label){
    await clickText(label,true,'[aria-label="主导航"]');
  }
  async function search(value){
    await until('gallery search control',()=>js('!!document.querySelector(\'input[aria-label="搜索模板"]\')'));
    await js('(()=>{const e=document.querySelector(\'input[aria-label="搜索模板"]\');e.focus();e.select();return true})()');
    if(value)await win.webContents.insertText(value);
    else {win.webContents.sendInputEvent({type:'keyDown',keyCode:'Backspace'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Backspace'});}
    await until('native search value',()=>js('document.querySelector(\'input[aria-label="搜索模板"]\').value==='+JSON.stringify(value)));
    await sleep(250);
  }
  const thumbSelector='.group .pointer-events-none.origin-top-left.select-none';
  const modalSelector='[role="dialog"][aria-label^="模板大图对比"]';
  const versionModal='[role="dialog"][aria-label="只读版本差异对照"]';
  async function proof(mode,name){
    await js('document.fonts.ready.then(()=>true)');await sleep(300);
    const state=await js('('+function(mode,thumbSelector,modalSelector){
      const root=mode==='thumb'?document.querySelector(thumbSelector):document.querySelector(modalSelector+' .a4-sheet');
      if(!root)throw Error('paper root missing '+mode);
      const clip=mode==='thumb'?root.parentElement:root.closest('.overflow-auto');
      const b=root.getBoundingClientRect(),cr=clip.getBoundingClientRect();
      const round=x=>Math.round(x*1000)/1000;
      const children=[root,...root.querySelectorAll('*')].map(e=>{
        const r=e.getBoundingClientRect(),s=getComputedStyle(e);
        return {tag:e.tagName,cls:e.getAttribute('class'),style:e.getAttribute('style'),
          rect:[round(r.x-b.x),round(r.y-b.y),round(r.width),round(r.height)],
          fg:s.color,bg:s.backgroundColor,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,line:s.lineHeight,
          spacing:s.letterSpacing,scheme:s.colorScheme,border:s.border,transform:s.transform,filter:s.filter,opacity:s.opacity};
      });
      // Thumbnail overlays (favorite/active badge) occupy the top band; clip to the unobstructed document interior.
      const x=Math.max(Math.ceil(b.left)+3,Math.ceil(cr.left)+3,0);
      const y=Math.max(Math.ceil(b.top)+(mode==='thumb'?38:3),Math.ceil(cr.top)+3,0);
      const right=Math.min(Math.floor(b.right)-3,Math.floor(cr.right)-3,innerWidth-2);
      const bottom=Math.min(Math.floor(b.bottom)-3,Math.floor(cr.bottom)-3,innerHeight-2);
      return {text:root.innerText,children,rect:[round(b.width),round(b.height)],crop:{x,y,width:right-x,height:bottom-y},
        markers:root.querySelectorAll('[data-studio-control],[class*="studio-ui-"],[data-studio-surface]').length,
        inherited:{fg:getComputedStyle(root).color,scheme:getComputedStyle(root).colorScheme}};
    }.toString()+')('+[mode,thumbSelector,modalSelector].map(x=>JSON.stringify(x)).join(',')+')');
    assert.equal(state.markers,0,'theme markers inside document renderer');
    assert.ok(state.crop.width>100&&state.crop.height>100,'paper crop too small');
    const img=await win.webContents.capturePage(state.crop);assert.ok(!img.isEmpty());fs.writeFileSync(path.join(out,name+'-paper.png'),img.toPNG());
    const {text,children,rect,inherited}=state;return {styleHash:sha(JSON.stringify({text,children,rect,inherited})),cropHash:sha(img.toBitmap()),size:img.getSize(),rect,inherited,markers:state.markers};
  }

  async function galleryAppearance(id){
    const s=await js('('+function(){
      const input=document.querySelector('input[aria-label="搜索模板"]');
      const g=document.querySelector('[data-studio-surface="gallery"]')||input.closest('.flex.min-w-0.flex-1.flex-col');
      const card=g.querySelector('.group');
      const color=e=>getComputedStyle(e).backgroundColor,fg=e=>getComputedStyle(e).color;
      return {bg:color(g),inputBg:color(input),inputFg:fg(input),inputScheme:getComputedStyle(input).colorScheme,
        cardCount:g.querySelectorAll('.group').length,cardBg:card?color(card):null,rootFg:fg(g),width:g.clientWidth,scrollWidth:g.scrollWidth};
    }.toString()+')()');
    assert.ok(s.scrollWidth<=s.width+2,'gallery horizontal overflow');
    if(isCandidate&&id!=='classic'){
      const expect={dark:['rgb(11, 17, 32)','rgb(15, 23, 42)','dark'],light:['rgb(248, 250, 252)','rgb(248, 250, 252)','light'],warm:['rgb(244, 238, 225)','rgb(255, 253, 248)','light']}[id];
      assert.equal(s.bg,expect[0]);assert.equal(s.inputBg,expect[1]);assert.equal(s.inputScheme,expect[2]);
    }
    return s;
  }
  async function region(id,name){
    if(!isCandidate)return null;
    const s=await js('(()=>{const e=document.querySelector(\'[data-studio-region="'+name+'"]\');if(!e)throw Error("region missing");const c=getComputedStyle(e);return {id:e.dataset.studioTheme,bg:c.backgroundColor,fg:c.color,width:e.clientWidth,scrollWidth:e.scrollWidth}})()');
    assert.equal(s.id,id);assert.ok(s.scrollWidth<=s.width+2,'region horizontal overflow '+name);
    if(id!=='classic')assert.equal(s.bg,{dark:'rgb(17, 24, 39)',light:'rgb(255, 255, 255)',warm:'rgb(251, 247, 238)'}[id]);
    return s;
  }

  const dpi=await js('devicePixelRatio');assert.ok(Math.abs(dpi-1.25)<0.01,'actual renderer DPI factor mismatch '+dpi);
  await selectTheme('warm');await nav('模板库(');await search('vip-cyber-dark');
  await until('keyboard card mounted',()=>js('!!document.querySelector('+JSON.stringify(thumbSelector)+')'));
  win.webContents.focus();
  await js(`(()=>{window.__nativeKeyTrace=[];for(const type of ['keydown','keypress','keyup','click','focusin'])document.addEventListener(type,e=>{const el=e.target;window.__nativeKeyTrace.push({type,key:e.key??null,code:e.code??null,trusted:e.isTrusted,text:el?.innerText?.trim()?.slice(0,80),label:el?.getAttribute?.('aria-label')??null});},true);return true;})()`);
  async function press(keyCode,modifiers=[]){win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});await sleep(45);if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode,modifiers});await sleep(45);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(120);}
  async function focused(){return js('(()=>{const e=document.activeElement;return {label:e.getAttribute("aria-label"),text:e.innerText?.trim(),inDialog:!!e.closest("[role=dialog]"),outline:getComputedStyle(e).outlineStyle}})()');}
  assert.ok(await js('(()=>{const e=document.querySelector(\'.group button[aria-label^="收藏 "]\');e.focus();return document.activeElement===e})()'));
  await capture('dpi125-favorite-focused');await press('Tab');await until('native Tab reaches apply',async()=> (await focused()).text==='一键应用');
  await capture('dpi125-apply-focused');await press('Tab');await until('native Tab reaches inspect',async()=> (await focused()).text==='大图放大对比');
  await capture('dpi125-inspect-focused');
  results.beforeEnter=await focused();results.documentHasFocus=await js('document.hasFocus()');
  await press('Enter');await sleep(300);
  results.enterOpened=await js('!!document.querySelector('+JSON.stringify(modalSelector)+')');
  results.traceAfterEnter=await js('window.__nativeKeyTrace');
  await capture('dpi125-enter-result');
  if(!results.enterOpened){
    // Preserve the native failure separately; Space is a distinct native path, not a substitute for Enter.
    await press('Space');await sleep(300);results.spaceAfterEnterFailure=await js('!!document.querySelector('+JSON.stringify(modalSelector)+')');
    results.traceAfterSpace=await js('window.__nativeKeyTrace');
    await capture('dpi125-space-result');
    if(!results.spaceAfterEnterFailure){await clickText('大图放大对比',false,'.group');results.domClickOpened=await js('!!document.querySelector('+JSON.stringify(modalSelector)+')');}
  }
  const initial=await focused();await capture('dpi125-dialog-after-open');
  await press('Tab');const afterTab=await focused();await capture('dpi125-dialog-after-tab');
  await press('Tab',['shift']);const afterShiftTab=await focused();
  await press('Escape');const escapeClosed=await js('!document.querySelector('+JSON.stringify(modalSelector)+')');
  const focusAfterEscape=await focused();
  if(!escapeClosed)await clickByAria('关闭大图对比');
  const report={dpi,initial,afterTab,afterShiftTab,escapeClosed,focusAfterEscape};
  results.keyboard=report;
  checks.nativeTabAndEnter=results.enterOpened&&results.traceAfterEnter.some(e=>e.type==='click'&&e.trusted&&e.text==='大图放大对比');
  checks.initialFocusInside=initial.inDialog;
  checks.tabInside=afterTab.inDialog;
  checks.shiftTabInside=afterShiftTab.inDialog;
  checks.escapeClosed=escapeClosed;
  checks.focusRestored=focusAfterEscape.text==='大图放大对比';
  if(escapeClosed&&checks.focusRestored){await press('Space');checks.nativeSpace=await js('!!document.querySelector('+JSON.stringify(modalSelector)+')');if(checks.nativeSpace){if(isCandidate){await press('K',['control']);checks.modalBlocksPalette=await js('!!document.querySelector('+JSON.stringify(modalSelector)+')&&!document.querySelector(\'[role="dialog"][aria-label="全局命令面板"]\')');checks.focusRetainedAfterShortcut=(await focused()).inDialog;await capture('dpi125-modal-shortcut-isolation');}await press('Escape');}}
  if(isCandidate){await press('K',['control']);checks.paletteAvailableAfterClose=await js('!!document.querySelector(\'[role="dialog"][aria-label="全局命令面板"]\')');await capture('dpi125-palette-after-close');await press('Escape');}
  results.trace=await js('window.__nativeKeyTrace');
  await capture('dpi125-closed');
  if(isCandidate)for(const name of ['nativeTabAndEnter','initialFocusInside','tabInside','shiftTabInside','escapeClosed','focusRestored','nativeSpace','modalBlocksPalette','focusRetainedAfterShortcut','paletteAvailableAfterClose'])assert.equal(checks[name],true,'keyboard gate '+name);
  assert.equal(sha(fs.readFileSync(disk)),originalDisk);
  win.setSize(1080,720);await sleep(350);await capture('dpi125-minimum-gallery');
  fs.writeFileSync(path.join(out,'result-'+phase+'.json'),JSON.stringify({phase,checks,results,runnerSha:process.env.GITHUB_SHA},null,2));
  console.log(JSON.stringify({phase,checks,results},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0);}).catch(err=>{console.error(err.stack||err.message);fs.writeFileSync(path.join(out,'failure-'+phase+'.json'),JSON.stringify({phase,checks,results,error:err.stack||err.message},null,2));clearTimeout(timer);app.exit(1);});
