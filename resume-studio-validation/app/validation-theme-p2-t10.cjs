const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = process.env.RESUME_STUDIO_DATA_DIR;
const out = process.env.RESUME_STUDIO_EVIDENCE_OUT;
const phase = process.env.STUDIO_THEME_PHASE || 'candidate';
const group = process.env.STUDIO_THEME_GROUP || 'new';
const audit = require('./validation-theme-t05-contrast.cjs');
if (!root || !out || !['candidate','baseline'].includes(phase)) throw Error('isolated paths/phase required');
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
const timer = setTimeout(() => { fs.writeFileSync(path.join(out,'timeout-'+phase+'.json'),JSON.stringify({checks,results},null,2)); app.exit(2); }, 410000);
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

  const themes=phase==='baseline'?['classic']:group==='pilot'?['classic','dark','light','warm']:['classic','graphite','obsidian','ocean','porcelain'];
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
      const expect={dark:['rgb(11, 17, 32)','rgb(15, 23, 42)','dark'],light:['rgb(248, 250, 252)','rgb(248, 250, 252)','light'],warm:['rgb(244, 238, 225)','rgb(255, 253, 248)','light'],graphite:['rgb(24, 24, 27)','rgb(32, 32, 36)','dark'],obsidian:['rgb(17, 16, 15)','rgb(25, 23, 20)','dark'],ocean:['rgb(13, 36, 54)','rgb(16, 43, 64)','dark'],porcelain:['rgb(230, 237, 244)','rgb(246, 249, 252)','light']}[id];
      assert.equal(s.bg,expect[0]);assert.equal(s.inputBg,expect[1]);assert.equal(s.inputScheme,expect[2]);
    }
    return s;
  }
  async function region(id,name){
    if(!isCandidate)return null;
    const s=await js('(()=>{const e=document.querySelector(\'[data-studio-region="'+name+'"]\');if(!e)throw Error("region missing");const c=getComputedStyle(e);return {id:e.dataset.studioTheme,bg:c.backgroundColor,fg:c.color,width:e.clientWidth,scrollWidth:e.scrollWidth}})()');
    assert.equal(s.id,id);assert.ok(s.scrollWidth<=s.width+2,'region horizontal overflow '+name);
    if(id!=='classic')assert.equal(s.bg,{dark:'rgb(17, 24, 39)',light:'rgb(255, 255, 255)',warm:'rgb(251, 247, 238)',graphite:'rgb(35, 35, 38)',obsidian:'rgb(28, 25, 23)',ocean:'rgb(23, 53, 75)',porcelain:'rgb(246, 249, 252)'}[id]);
    return s;
  }
  await nav('模板库(');
  await until('gallery ready',()=>js('!!document.querySelector(\'input[aria-label="搜索模板"]\')'));
  await search('never-match-synthetic-t03');
  await until('empty gallery',()=>js('document.body.innerText.includes("未找到匹配")'));
  await capture('gallery-empty');
  await search('minimal-ats');
  await until('one rendered thumbnail',()=>js('document.querySelectorAll(".group h3").length===1&&!!document.querySelector('+JSON.stringify(thumbSelector)+')'));
  // Favorite only affects isolated UI preferences, not the resume.
  const fav=await js('document.querySelector(\'.group button[aria-label^="收藏 "]\')?.getAttribute("aria-label")');
  assert.ok(fav);await clickByAria(fav);
  await until('favorite added',()=>js('!!document.querySelector(\'.group button[aria-label^="取消收藏 "]\')'));
  await clickText('★ 我的收藏',true);
  await until('favorite retained in filter',()=>js('document.querySelectorAll(".group h3").length===1'));
  await clickByAria(fav.replace(/^收藏 /,'取消收藏 '));
  await until('favorite empty',()=>js('document.body.innerText.includes("暂无收藏模板")'));
  await clickText('全部模板',true);
  await until('filtered thumbnail rendered',()=>js('!!document.querySelector('+JSON.stringify(thumbSelector)+')'));
  assert.equal(sha(fs.readFileSync(disk)),originalDisk);
  checks.favoriteAndSearch=true;
  results.gallery={};
  for(const template of ['minimal-ats','vip-cyber-dark']){
    await search(template);
    await until('one actual template '+template,()=>js('document.querySelectorAll(".group h3").length===1&&!!document.querySelector('+JSON.stringify(thumbSelector)+')'));
    results.gallery[template]={};
    for(const id of themes){
      await selectTheme(id);
      await js('(()=>{document.querySelector(\'input[aria-label="搜索模板"]\').focus();return true})()');
      win.webContents.sendInputEvent({type:'mouseMove',x:10,y:100});
      await sleep(400);
      const surface=await galleryAppearance(id);
      const thumb=await proof('thumb',template+'-'+id+'-thumb');
      await capture(template+'-'+id+'-gallery');
      await clickText('大图放大对比',false,'.group');
      await until('lightbox',()=>js('!!document.querySelector('+JSON.stringify(modalSelector+' .a4-sheet')+')'));
      const modal=await proof('modal',template+'-'+id+'-lightbox');
      await capture(template+'-'+id+'-lightbox');
      const swatches=await js('Array.from(document.querySelectorAll(\'[role="dialog"] button[aria-label^="试色 "]\')).map(e=>({label:e.getAttribute("aria-label"),bg:getComputedStyle(e).backgroundColor,style:e.getAttribute("style")}))');
      assert.ok(swatches.length>=6);
      if(id!=='classic'){
        const b=results.gallery[template].classic;
        assert.equal(thumb.styleHash,b.thumb.styleHash,'thumbnail computed paper changed');
        assert.equal(thumb.cropHash,b.thumb.cropHash,'thumbnail pixels changed');
        assert.equal(modal.styleHash,b.modal.styleHash,'lightbox computed paper changed');
        assert.equal(modal.cropHash,b.modal.cropHash,'lightbox pixels changed');
        assert.deepEqual(swatches,b.swatches,'document swatches changed');
      }
      results.gallery[template][id]={surface,thumb,modal,swatches};
      await clickByAria('关闭大图对比');await until('lightbox closed',()=>js('!document.querySelector('+JSON.stringify(modalSelector)+')'));
      assert.equal(sha(fs.readFileSync(disk)),originalDisk,'gallery theme affected resume file');
    }
  }
  checks.galleryPaper=true;
  // Local trial swatch and sample mode never apply to stored document without explicit apply.
  await clickText('示例数据');
  await until('demo visible',()=>js('!!document.querySelector('+JSON.stringify(thumbSelector)+')'));
  await capture('gallery-sample-mode');
  await clickText('用我的简历预览');
  await clickText('大图放大对比',false,'.group');
  await until('lightbox trial',()=>js('!!document.querySelector('+JSON.stringify(modalSelector)+')'));
  const trial=await js('Array.from(document.querySelectorAll(\'[role="dialog"] button[aria-label^="试色 "]\')).find(e=>!e.className.includes("ring-2"))?.getAttribute("aria-label")');
  assert.ok(trial);await clickByAria(trial);
  await until('swatch trial selected',()=>js('Array.from(document.querySelectorAll(\'[role="dialog"] button[aria-label^="试色 "]\')).some(e=>e.getAttribute("aria-label")==='+JSON.stringify(trial)+'&&e.className.includes("ring-2"))'));
  await capture('gallery-trial-color');
  await clickByAria('关闭大图对比');
  assert.equal(sha(fs.readFileSync(disk)),originalDisk,'trial or sample mode wrote resume');
  checks.trialCancel=true;
  await nav('版本母库');
  await until('versions ready',()=>js('document.body.innerText.includes("版本与母库管理")'));
  await clickCss('[aria-label="本地版本回收站"] button');
  await until('trash empty',()=>js('document.body.innerText.includes("回收站为空")'));
  await clickText('检查写入锁');
  await until('lock inspected',()=>js('!!document.querySelector(\'[aria-label="本地写入锁检查"] [role="status"]\')'));
  const lockText=await js('document.querySelector(\'[aria-label="本地写入锁检查"] [role="status"]\').innerText');
  results.versions={};
  for(const id of themes){
    await selectTheme(id);
    const body=await region(id,'versions-body');
    const head=await region(id,'versions-header');
    assert.equal(await js('document.querySelector(\'[aria-label="本地写入锁检查"] [role="status"]\').innerText'),lockText);
    await capture('versions-'+id);
    await clickText('对比版本 / 历史快照');
    await until('read-only compare dialog',()=>js('!!document.querySelector('+JSON.stringify(versionModal)+')'));
    await clickText('读取并对比',false,versionModal);
    await until('read-only comparison computed',()=>js('!!document.querySelector(\'[aria-label="差异统计"]\')'));
    const stats=await js('document.querySelector(\'[aria-label="差异统计"]\').innerText');
    if(id!=='classic')assert.equal(stats,results.versions.classic.stats);
    await capture('versions-compare-'+id);
    await clickByAria('关闭版本对照');
    assert.equal(sha(fs.readFileSync(disk)),originalDisk,'read-only compare altered resume');
    results.versions[id]={body,head,lockText,stats};
  }
  checks.versionReadOnly=true;
  await clickText('隐私脱敏');
  await until('privacy comparison blocked',()=>js('Array.from(document.querySelectorAll("button")).some(b=>b.innerText.trim()==="对比版本 / 历史快照"&&b.disabled)'));
  await capture('versions-privacy-blocked');await clickText('脱敏模式中');
  checks.privacyComparisonGate=true;
  await nav('诊断优化');
  await until('HR computed score',()=>js('!!document.querySelector(\'[aria-label="HR体检综合分"]\')'));
  results.hr={};
  const hr=await js('document.querySelector(\'[aria-label="HR体检综合分"]\').innerText');
  for(const id of themes){
    await selectTheme(id);
    assert.equal(await js('document.querySelector(\'[aria-label="HR体检综合分"]\').innerText'),hr);
    results.hr[id]={score:hr,body:await region(id,'diagnose-body'),head:await region(id,'diagnose-header')};
    await capture('hr-'+id);
  }
  await clickText('真 ATS 机读');
  await clickText('运行真 ATS 逆向体检');
  await until('real ATS score',()=>js('!!document.querySelector(\'[aria-label="ATS 机读得分"]\')'),40000);
  await clickText('查看原始 ATS 机读纯文本流',true);
  await until('raw parsed text',()=>js('Array.from(document.querySelectorAll("pre")).some(e=>e.innerText.includes("演示候选人"))'));
  const ats=await js('({score:document.querySelector(\'[aria-label="ATS 机读得分"]\').innerText,text:Array.from(document.querySelectorAll("pre")).map(e=>e.innerText)})');
  assert.ok(ats.text.some(t=>t.includes('演示候选人')));
  results.ats={};
  for(const id of themes){
    await selectTheme(id);
    const s=await js('({score:document.querySelector(\'[aria-label="ATS 机读得分"]\').innerText,text:Array.from(document.querySelectorAll("pre")).map(e=>e.innerText)})');assert.deepEqual(s,ats);
    results.ats[id]={score:s.score,textHash:sha(JSON.stringify(s.text)),body:await region(id,'diagnose-body')};
    await capture('ats-'+id);
  }
  checks.offlineHrAts=true;
  // Unconverted AI/JD areas remain separate; no AI request or keys used.
  await clickText('JD 雷达');
  assert.equal(await js('!!document.querySelector(\'[data-studio-region="diagnose-body"]\')'),false);
  await capture('diagnose-jd-boundary');
  await clickText('AI 润色 Diff');
  assert.equal(await js('!!document.querySelector(\'[data-studio-region="diagnose-body"]\')'),false);
  await capture('diagnose-ai-boundary');
  checks.approvalBoundary=true;
  await nav('内容编辑');
  await until('editor back',()=>js('document.querySelector("#basic-field-name")?.value==="演示候选人"'));
  results.exports={};
  for(const id of themes){
    await selectTheme(id);
    const sheet=await captureSheet('export-'+id);
    const exp=await exportNative('export-'+id);
    if(id!=='classic'){assert.equal(sheet.styleHash,results.exports.classic.sheet.styleHash);assert.equal(sheet.cropHash,results.exports.classic.sheet.cropHash);assert.equal(exp.pngPixels,results.exports.classic.export.pngPixels);}
    results.exports[id]={sheet,export:exp};
  }
  assert.equal(sha(fs.readFileSync(disk)),originalDisk,'theme or read-only operation changed resume bytes');
  checks.exportIsolation=true;
  // Per-scene coverage: actual rendered shell, editor, style and career.
  // Keep paper out of the measured selectors and retain raw failures.
  if (isCandidate) {
    results.coverage={};
    for(const id of themes){
      await nav('内容编辑');await selectTheme(id);
      await until('editor source identity',()=>js('document.querySelector("#basic-field-name")?.value==="演示候选人"'));
      const rows={};
      const inspect=async(name,selector)=>{
        const state=await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("coverage region missing");const s=getComputedStyle(e);return {theme:e.dataset.studioTheme,bg:s.backgroundColor,fg:s.color,width:e.clientWidth,scrollWidth:e.scrollWidth}})()');
        assert.equal(state.theme,id,'wrong actual scoped theme '+name);
        assert.ok(state.scrollWidth<=state.width+2,'horizontal overflow '+name+' '+id);
        rows[name]={state,contrast:await audit(win,selector,name+'-'+id)};
      };
      await inspect('header','[data-studio-surface="header"]');
      await inspect('nav','[data-studio-surface="nav"]');
      await inspect('editor','aside[data-studio-surface="panel"]');
      await capture('editor-'+id);
      await nav('样式底色');await inspect('style','aside[data-studio-surface="panel"]');await capture('style-'+id);
      await nav('求职面试');await until('career ready',()=>js('!!document.querySelector(\'[data-studio-region="career-main"]\')'));
      await inspect('career','[data-studio-region="career-main"]');await capture('career-'+id);
      results.coverage[id]=rows;
      fs.writeFileSync(path.join(out,'coverage-'+group+'.json'),JSON.stringify(results.coverage,null,2));
      assert.equal(sha(fs.readFileSync(disk)),originalDisk,'theme/scene switch changed resume bytes');
    }
    const failed=Object.entries(results.coverage).flatMap(([id,rows])=>id==='classic'?[]:Object.entries(rows).flatMap(([name,row])=>row.contrast.failures.map(f=>({id,name,...f}))));
    // Record the entire matrix before enforcing the gate, so failure evidence is useful.
    checks.renderedTextContrast=failed.length===0;
    fs.writeFileSync(path.join(out,'contrast-failures-'+group+'.json'),JSON.stringify(failed,null,2));
    await nav('内容编辑');
  }
  // Minimum window: actual panel content is still reachable, not just the default desktop.
  win.setSize(1080,720);await sleep(350);
  await selectTheme(themes[themes.length-1]);
  await nav('模板库(');await search('vip-cyber-dark');await until('minimum template preview',()=>js('!!document.querySelector('+JSON.stringify(thumbSelector)+')'));
  await galleryAppearance(themes[themes.length-1]);await capture('minimum-gallery');
  await nav('版本母库');await until('minimum versions',()=>js('document.body.innerText.includes("版本与母库管理")'));await region(themes[themes.length-1],'versions-body');await capture('minimum-versions');
  await nav('诊断优化');await until('minimum HR',()=>js('!!document.querySelector(\'[aria-label="HR体检综合分"]\')'));await region(themes[themes.length-1],'diagnose-body');await capture('minimum-hr');
  checks.minimumWindow=true;
  if(isCandidate)assert.equal(checks.renderedTextContrast,true,'rendered text contrast failures; see raw matrix');
  fs.writeFileSync(path.join(out,'result-'+phase+'.json'),JSON.stringify({phase,runnerSha:process.env.GITHUB_SHA||null,checks,results,diskHash:originalDisk},null,2));
  console.log(JSON.stringify({phase,checks,results},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0);}).catch(err=>{console.error(err.stack||err.message);fs.writeFileSync(path.join(out,'failure-'+phase+'.json'),JSON.stringify({phase,checks,results,error:err.stack||err.message},null,2));clearTimeout(timer);app.exit(1);});
