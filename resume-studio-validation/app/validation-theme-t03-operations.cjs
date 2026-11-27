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

  const masterBefore=JSON.stringify(await main.store.getResume('master'));
  function stable(d){const {id,title,createdAt,updatedAt,...rest}=d;return rest;}
  async function currentSlug(){return js('document.querySelector(\'select[aria-label="快速切换简历版本"]\').value');}
  async function saved(slug,predicate){
    await until('expected disk content '+slug,async()=>{const d=await main.store.getResume(slug);return d&&predicate(d)});
    await until('saved UI',()=>js('document.querySelector(\'[aria-label="本地保存状态"]\').innerText.includes("已保存至本地硬盘")'));
  }
  async function fill(selector,value){
    assert.ok(await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e||e.disabled)return false;e.scrollIntoView({block:"center"});e.focus();e.select();return document.activeElement===e})()'));
    await win.webContents.insertText(value);
    await until('native text entered '+value,()=>js('document.querySelector('+JSON.stringify(selector)+').value==='+JSON.stringify(value)));
  }
  await selectTheme('dark');
  await nav('版本母库');
  await until('version create controls',()=>js('!!document.querySelector(\'input[placeholder^="输入新岗位名称"]\')'));
  await clickText('从母库派生');
  const input='input[placeholder^="输入新岗位名称"]';
  const cloneTitle='T03 合成派生岗位';
  await fill(input,cloneTitle);
  await capture('dark-create-draft');
  const beforeTheme=await js('(()=>{const e=document.querySelector(\'input[placeholder^="输入新岗位名称"]\');window.__cloneDraft=e;return {value:e.value,focus:document.activeElement===e}})()');
  await selectTheme('warm');
  assert.ok(await js('window.__cloneDraft===document.querySelector(\'input[placeholder^="输入新岗位名称"]\')'));
  assert.deepEqual(await js('(()=>{const e=document.querySelector(\'input[placeholder^="输入新岗位名称"]\');return {value:e.value,focus:document.activeElement===e}})()'),beforeTheme);
  await capture('warm-create-draft-preserved');
  await clickText('创建');
  await until('new version selected',async()=>{const slug=await currentSlug();return slug!=='runner-fixture'&&slug!=='master'&&!!slug});
  const cloneSlug=await currentSlug();await saved(cloneSlug,d=>d.title===cloneTitle);
  const cloneDoc=await main.store.getResume(cloneSlug);
  assert.deepEqual(stable(cloneDoc),stable(JSON.parse(masterBefore)),'clone diverged from master');
  assert.equal(sha(fs.readFileSync(disk)),originalDisk);assert.equal(JSON.stringify(await main.store.getResume('master')),masterBefore);
  checks.cloneFromMaster=true;
  await nav('版本母库');
  await until('clone version visible',()=>js('document.body.innerText.includes("T03 合成派生岗位")'));
  await clickText('重命名');
  await fill('input[aria-label="版本标题"]','T03 合成重命名岗位');
  await selectTheme('light');await capture('light-rename-draft');
  await clickByAria('确认重命名');await saved(cloneSlug,d=>d.title==='T03 合成重命名岗位');
  checks.rename=true;
  const snapsBefore=await main.store.listSnapshots(cloneSlug);
  await clickText('手动创建快照');
  await until('actual manual snapshot',async()=>(await main.store.listSnapshots(cloneSlug)).length===snapsBefore.length+1);
  const newSnaps=await main.store.listSnapshots(cloneSlug);
  await until('snapshot UI acknowledged',()=>js('document.body.innerText.includes("已创建本地时间机器快照")'));
  const snap=newSnaps.find(s=>!snapsBefore.some(o=>o.id===s.id));assert.ok(snap);
  const snapDoc=await main.store.getSnapshotForComparison(cloneSlug,snap.id);
  const beforeTemplate=await main.store.getResume(cloneSlug);assert.deepEqual(stable(snapDoc.document),stable(beforeTemplate));
  await capture('light-manual-snapshot');
  checks.snapshot=true;
  await selectTheme('dark');await nav('模板库(');await search('vip-cyber-dark');
  await until('actual dark template card',()=>js('document.querySelectorAll(".group h3").length===1&&!!document.querySelector('+JSON.stringify(thumbSelector)+')'));
  await clickText('大图放大对比',false,'.group');await until('actual lightbox',()=>js('!!document.querySelector('+JSON.stringify(modalSelector)+')'));
  const color=await js('Array.from(document.querySelectorAll(\'[role="dialog"] button[aria-label^="试色 "]\')).find(e=>!e.className.includes("ring-2"))?.getAttribute("aria-label")');
  assert.ok(color);await clickByAria(color);await capture('dark-template-trial-before-apply');
  await clickText('应用此模板并开始编辑',false,modalSelector);
  await saved(cloneSlug,d=>d.templateId==='vip-cyber-dark'&&d.globalSettings.themeColor===color.slice(3));
  const applied=await main.store.getResume(cloneSlug);assert.equal(applied.templateId,'vip-cyber-dark');
  await until('editor after apply',()=>js('!!document.querySelector(".a4-sheet")&&!!document.querySelector("#basic-field-name")'));
  await capture('dark-template-applied');
  await selectTheme('warm');await capture('warm-document-dark-template');
  await clickByAria('撤销');
  await saved(cloneSlug,d=>d.templateId===beforeTemplate.templateId&&d.globalSettings.themeColor===beforeTemplate.globalSettings.themeColor);
  assert.deepEqual(stable(await main.store.getResume(cloneSlug)),stable(beforeTemplate));
  await capture('warm-template-undone');
  checks.templateApplyUndo=true;
  await nav('版本母库');await until('clone versions page',()=>js('document.body.innerText.includes("T03 合成重命名岗位")'));
  await clickText('对比版本 / 历史快照');await until('compare dialog',()=>js('!!document.querySelector('+JSON.stringify(versionModal)+')'));
  const opt=await js('Array.from(document.querySelector(\'select[aria-label="对照来源"]\').options).find(e=>e.value.startsWith("snapshot:"))?.value');
  assert.ok(opt,'actual snapshot target not in comparison');
  await js('(()=>{const e=document.querySelector(\'select[aria-label="对照来源"]\');e.value='+JSON.stringify(opt)+';e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  await clickText('读取并对比',false,versionModal);
  await until('actual snapshot comparison',()=>js('!!document.querySelector(\'[aria-label="差异统计"]\')'));
  await capture('warm-snapshot-comparison');await clickByAria('关闭版本对照');
  // Switch original through actual top-bar selector, ensuring isolated clone never affects original.
  await js('(()=>{const e=document.querySelector(\'select[aria-label="快速切换简历版本"]\');e.value="runner-fixture";e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  await until('original version active',async()=>await currentSlug()==='runner-fixture');
  assert.equal(sha(fs.readFileSync(disk)),originalDisk);
  assert.equal(JSON.stringify(await main.store.getResume('master')),masterBefore);
  assert.equal((await main.store.getResume(cloneSlug)).title,'T03 合成重命名岗位');
  await capture('warm-original-restored');
  checks.sourceFilesUntouched=true;
  results.operations={cloneSlug,sourceHash:originalDisk,masterHash:sha(masterBefore),cloneId:cloneDoc.id,snapshotId:snap.id,templateApplied:applied.templateId,trialColor:color,originalTemplate:beforeTemplate.templateId,finalTemplate:(await main.store.getResume(cloneSlug)).templateId};
  fs.writeFileSync(path.join(out,'result-operations.json'),JSON.stringify({checks,results,runnerSha:process.env.GITHUB_SHA},null,2));
  console.log(JSON.stringify({checks,results},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0);}).catch(err=>{console.error(err.stack||err.message);fs.writeFileSync(path.join(out,'failure-operations.json'),JSON.stringify({checks,results,error:err.stack||err.message},null,2));clearTimeout(timer);app.exit(1);});
