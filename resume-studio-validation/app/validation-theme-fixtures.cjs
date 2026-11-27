const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = process.env.RESUME_STUDIO_DATA_DIR;
const out = process.env.RESUME_STUDIO_EVIDENCE_OUT;
const phase = process.env.STUDIO_THEME_PHASE || 'candidate';
const kind = process.env.STUDIO_FIXTURE_KIND;
if (!root || !out || !['candidate','baseline'].includes(phase) || !['near','natural','manual','dark'].includes(kind)) throw Error('isolated paths/phase/fixture required');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const userData = path.join(root, 'userData');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.disableHardwareAcceleration();
const main = require('./dist-electron/main.cjs');
const seed = require('./runner-fixture.json');
let nearCount = 32;
const nearText = n => seed.selfEvaluationContent+'\n'+Array.from({length:n},(_,i)=>'- 合成分页边界检查条目 '+String(i+1).padStart(2,'0')+'：记录、核对与复核实验结果。').join('\n');
const fixture = {...seed,
  ...(kind==='near'?{selfEvaluationContent:nearText(nearCount)}:{}),
  ...(kind==='natural'?{experience:Array.from({length:12},(_,i)=>({...seed.experience[0],id:'exp-synthetic-'+i,company:'合成机构 '+(i+1),description:Array.from({length:4},(_,k)=>'- 合成经历 '+(i+1)+'-'+(k+1)+'：组织实验演示，记录结果并进行复核。').join('\n')}))}:{}),
  ...(kind==='manual'?{menuSections:seed.menuSections.map(x=>x.id==='projects'?{...x,pageBreakBefore:true}:x)}:{}),
  ...(kind==='dark'?{templateId:'vip-cyber-dark'}:{}),
};
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
  async function nearMeasure() {
    return js(`(()=>{
      const paper=document.querySelector('.a4-sheet');
      const last=paper?.querySelector('[data-section-id="selfEvaluation"]');
      const first=paper?.querySelector('[data-section-id="basic"]');
      if(!paper||!last||!first)throw Error('missing near fixture content');
      const r=paper.getBoundingClientRect();
      const scale=r.width/paper.offsetWidth;
      const padding=parseFloat(getComputedStyle(first.parentElement).paddingBottom)||0;
      const contentEnd=(last.getBoundingClientRect().bottom-r.top)/scale+padding;
      return {scale,padding,contentEnd,spare:297*96/25.4-contentEnd};
    })()`);
  }
  if(kind==='near'){
    const attempts=[];
    for(let i=0;i<7;i++){
      const m=await nearMeasure();attempts.push({count:nearCount,...m});
      if(m.spare>=0&&m.spare<=32) break;
      const delta=Math.round((m.spare-12)/16);
      const next=Math.max(1,Math.min(100,nearCount+(delta|| (m.spare>32?1:-1))));
      assert.notEqual(next,nearCount,'near fixture calibration stuck');
      nearCount=next;
      const current=await main.store.getResume('runner-fixture');
      await main.store.saveResume('runner-fixture',{...current,selfEvaluationContent:nearText(nearCount)},{requireExisting:true});
      const loaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
      win.webContents.reload();await loaded;await ready();
    }
    const finalMeasure=await nearMeasure();
    results.calibration={attempts,count:nearCount,...finalMeasure};
    assert.ok(finalMeasure.spare>=0&&finalMeasure.spare<=32,'near fixture not physically near page boundary');
  }
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
  async function spreadProof(){
    return js(`(()=>{
      return [...document.querySelectorAll('.a4-sheet')].map(sheet=>{
        const base=sheet.getBoundingClientRect();
        const round=x=>Math.round(x*1000)/1000;
        return {text:sheet.innerText,rect:[round(base.width),round(base.height)],
          children:[sheet,...sheet.querySelectorAll('*')].map(e=>{
            const r=e.getBoundingClientRect(),c=getComputedStyle(e);
            return {cls:e.getAttribute('class'),style:e.getAttribute('style'),r:[round(r.x-base.x),round(r.y-base.y),round(r.width),round(r.height)],
              fg:c.color,bg:c.backgroundColor,font:c.fontFamily,size:c.fontSize,line:c.lineHeight,weight:c.fontWeight,spacing:c.letterSpacing,scheme:c.colorScheme,transform:c.transform};
          }),
          markers:sheet.querySelectorAll('[data-studio-control],[class*="studio-ui-"],[data-studio-surface]').length};
      });
    })()`);
  }
  const {updatedAt,...stableDoc}=doc;
  fs.writeFileSync(path.join(out,'fixture-doc.json'),JSON.stringify(stableDoc,null,2));
  results.fixture={kind,stableHash:sha(JSON.stringify(stableDoc)),template:doc.templateId,experienceCount:doc.experience.length};
  for(const id of phase==='baseline'?['classic']:['classic','warm']){
    if(phase==='candidate'&&id!=='classic')await selectTheme(id);
    await js(`(()=>{const v=document.querySelector('.print-workspace.overflow-auto');v.scrollTop=0;v.scrollLeft=0;return true})()`);await sleep(250);
    await capture(id+'-scroll');
    const sheet=await captureSheet(id+'-scroll');
    const exp=await exportNative(id);
    const preStatus=await js(`document.querySelector('[aria-label="预估页数"]')?.parentElement?.innerText`);
    await clickByAria('双页并排总览');
    await until('spread selected',()=>js(`!!document.querySelector('button[aria-label="切回单列滚动"]')`));
    await sleep(350);
    await js(`(()=>{const v=document.querySelector('.print-workspace.overflow-auto');v.scrollTop=0;v.scrollLeft=0;return true})()`);await sleep(250);
    const spread=await spreadProof();
    assert.ok(spread.length>=1);
    assert.ok(spread.every(x=>x.markers===0),'studio marker inside spread paper');
    await capture(id+'-spread');
    const postStatus=await js(`document.querySelector('[aria-label="预估页数"]')?.parentElement?.innerText`);
    if(phase==='candidate'&&(kind==='manual'||kind==='natural'))assert.ok(spread.length>=2,'missing second preview page');
    const second=await js(`(()=>{const page=document.querySelectorAll('.a4-sheet')[1];if(!page)return null;page.scrollIntoView({block:'start',inline:'nearest'});return true;})()`);assert.ok(second,'second page absent');await sleep(300);
    const visible=await js(`(()=>{const page=document.querySelectorAll('.a4-sheet')[1];const r=page.getBoundingClientRect();const c=page.closest('.print-workspace.overflow-auto').getBoundingClientRect();return {height:Math.min(r.bottom,c.bottom)-Math.max(r.top,c.top),width:Math.min(r.right,c.right)-Math.max(r.left,c.left)};})()`);assert.ok(visible.height>200&&visible.width>200,'second page not visible');await capture(id+'-second-page-visible');
    const spreadHash=sha(JSON.stringify(spread));
    await clickByAria('切回单列滚动');
    await until('scroll selected',()=>js(`!!document.querySelector('button[aria-label="双页并排总览"]')`));
    await sleep(350);
    results[id]={sheet,export:exp,spreadHash,spreadPageCount:spread.length,secondPageVisible:visible,preStatus,postStatus};
    if(id!=='classic'){
      assert.equal(sheet.styleHash,results.classic.sheet.styleHash,'paper computed layout changed');
      assert.equal(exp.pngPixels,results.classic.export.pngPixels,'native PNG changed');
      assert.equal(spreadHash,results.classic.spreadHash,'spread paper changed');
    }
    assert.equal(sha(fs.readFileSync(disk)),originalDisk,'theme or spread altered stored resume');
    checks[id]=true;
  }
  fs.writeFileSync(path.join(out,'result-'+phase+'.json'),JSON.stringify({phase,kind,runnerSha:process.env.GITHUB_SHA||null,checks,results,diskHash:originalDisk},null,2));
  console.log(JSON.stringify({phase,kind,checks,results},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0);}).catch(err=>{console.error(err.stack||err.message);fs.writeFileSync(path.join(out,'failure-'+phase+'.json'),JSON.stringify({phase,kind,checks,results,error:err.stack||err.message},null,2));clearTimeout(timer);app.exit(1);});
