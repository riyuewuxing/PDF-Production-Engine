const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;if(!root||!out||!path.basename(root).startsWith('synthetic-preview-'))throw Error('isolated preview fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const report={runnerSha:process.env.GITHUB_SHA,checks:{},gallery:{},spread:{}};const write=()=>fs.writeFileSync(path.join(out,'preview-chrome.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='preview chrome watchdog';write();app.exit(2)},160000);
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),audit=require('./validation-theme-t05-contrast.cjs');const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
async function run(){
 const slug='runner-fixture',long='overflow-fixture';
 const original=await main.store.saveResume(slug,{...fixture,id:'synthetic-gallery-9',title:'Synthetic gallery'});
 await main.store.saveResume(long,{...fixture,id:'synthetic-overflow-9',title:'Synthetic overflow',experience:Array.from({length:18},(_,i)=>({...fixture.experience[0],id:'exp-'+i,company:'合成项目 '+i,description:Array.from({length:14},(_,j)=>'- 合成实验记录 '+i+'-'+j+'，用于验证连续分页内容与外部提示，未经任何事实声明。').join('\n')}))});
 const file=s=>main.store.resolveResumePath(s).filePath,hashes=()=>[sha(fs.readFileSync(file(slug))),sha(fs.readFileSync(file(long)))],before=hashes(),ledger=await main.store.getApplications();
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,1000);win.focus();
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const themes=['classic','dark','light','warm'];
 const click=async(label,scope='body')=>{await until('button '+label,()=>js((label,scope)=>[...document.querySelectorAll(scope+' button')].some(e=>(e.innerText.trim()===label||e.getAttribute('aria-label')===label)&&!e.disabled&&e.getClientRects().length),label,scope));assert(await js((label,scope)=>{const b=[...document.querySelectorAll(scope+' button')].find(e=>(e.innerText.trim()===label||e.getAttribute('aria-label')===label)&&!e.disabled&&e.getClientRects().length);if(!b)return false;b.scrollIntoView({block:'nearest'});b.click();return true},label,scope));};
 const set=async(sel,value)=>assert(await js((sel,value)=>{const e=document.querySelector(sel);if(!e||e.disabled)return false;const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return true},sel,value));
 const theme=async id=>{await set('select[aria-label="切换工作台主题"]',id);await until('theme',()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));await sleep(350);};
 const shot=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(250);const s=await win.webContents.capturePage();assert(!s.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),s.toPNG())};
 const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode,modifiers});await sleep(35);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(100)};
 const noWrite=async()=>{assert.deepEqual(hashes(),before);assert.deepEqual(await main.store.getApplications(),ledger);};
 const card='[data-studio-gallery-card="vip-cyber-dark"]',action=card+' [data-studio-region="gallery-card-actions"]',fav=card+' [data-studio-gallery-favorite="true"]';
 await until('editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 await click('模板库(51)').catch(async()=>{assert(await js(()=>{const e=[...document.querySelectorAll('nav button')].find(b=>b.innerText.includes('模板库'));if(!e)return false;e.click();return true}));});
 await until('gallery',()=>js(()=>!!document.querySelector('input[aria-label="搜索模板"]')));
 // Target card by exact id; search by the displayed name from its metadata rather than relying on card order.
 const name=await js(sel=>document.querySelector(sel)?.querySelector('h3')?.innerText,card);assert(name,'target card absent');
 await set('input[aria-label="搜索模板"]',name);await until('card mounted',()=>js(sel=>!!document.querySelector(sel+' [data-studio-paper="thumbnail"]'),card));
 const paper=async(label)=>{
  await js(()=>{document.querySelector('input[aria-label="搜索模板"]').focus();return true});win.webContents.sendInputEvent({type:'mouseMove',x:2,y:2});await sleep(400);
  const r=await js(sel=>{const p=document.querySelector(sel+' [data-studio-paper="thumbnail"]'),b=p.getBoundingClientRect(),c=p.parentElement.getBoundingClientRect(),x=Math.max(Math.ceil(b.left)+3,0),y=Math.max(Math.ceil(b.top)+38,0),right=Math.min(Math.floor(b.right)-3,Math.floor(c.right)-3,innerWidth-2),bottom=Math.min(Math.floor(b.bottom)-3,Math.floor(c.bottom)-3,innerHeight-2);
   const round=v=>Math.round(v*1000)/1000;
   const nodes=[p,...p.querySelectorAll('*')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,cls:e.className,style:e.getAttribute('style'),rect:[round(r.left-b.left),round(r.top-b.top),round(r.width),round(r.height)],fg:s.color,bg:s.backgroundColor,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,line:s.lineHeight,spacing:s.letterSpacing,scheme:s.colorScheme,border:s.border,transform:s.transform,filter:s.filter,opacity:s.opacity}});
   return {x,y,width:right-x,height:bottom-y,markers:p.querySelectorAll('[data-studio-control],[data-studio-surface],[class*="studio-ui-"]').length,overlayOpacity:getComputedStyle(document.querySelector(sel+' [data-studio-region="gallery-card-actions"]')).opacity,nodes}
  },card);assert(r.width>100&&r.height>100&&r.markers===0&&Number(r.overlayOpacity)===0,'invalid clean paper crop');
  const {markers,nodes,overlayOpacity,...rect}=r;
  const image=await win.webContents.capturePage(rect);assert(!image.isEmpty());fs.writeFileSync(path.join(out,label+'-paper.png'),image.toPNG());
  // Preserve original crop; the independent paper interior excludes the top 8px near the composited overlay band.
  const interior=await win.webContents.capturePage({...rect,y:rect.y+8,height:rect.height-8});assert(!interior.isEmpty());fs.writeFileSync(path.join(out,label+'-paper-interior.png'),interior.toPNG());
  return {raw:{pixels:sha(image.toBitmap()),size:image.getSize(),rect},interior:{pixels:sha(interior.toBitmap()),size:interior.getSize()},domHash:sha(JSON.stringify(nodes)),nodes:nodes.length};
 };
 for(const id of themes){await theme(id);await js(sel=>{document.querySelector(sel).scrollIntoView({block:'center'});return true},card);await sleep(200);
  const clean=await paper(id);if(id!=='classic'){assert.deepEqual(clean.interior,report.gallery.classic.paper.interior,'theme changed interior thumbnail pixels');assert.equal(clean.domHash,report.gallery.classic.paper.domHash,'theme changed thumbnail node geometry/style');}
  const point=await js(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(100,r.height/2))}},card);
  win.webContents.sendInputEvent({type:'mouseMove',...point});await until('hover action visible',()=>js(sel=>Number(getComputedStyle(document.querySelector(sel)).opacity)>.99,action));
  const contrast=await audit(win,action,'gallery-'+id);if(id!=='classic')assert.equal(contrast.failures.length,0,JSON.stringify(contrast.failures.slice(0,5)));await shot('gallery-hover-'+id);
  const beforeFav=await js(sel=>document.querySelector(sel).getAttribute('aria-pressed'),fav);assert.equal(beforeFav,'false');
  await js(sel=>{document.querySelector(sel).focus();return true},fav);await key('Space');await until('favorited',()=>js(sel=>document.querySelector(sel).getAttribute('aria-pressed')==='true',fav));
  assert(await js(()=>JSON.parse(localStorage.getItem('resume-studio:favorite-templates')).includes('vip-cyber-dark')));await shot('gallery-favorite-'+id);await key('Space');await until('favorite removed',()=>js(sel=>document.querySelector(sel).getAttribute('aria-pressed')==='false',fav));
  await js(sel=>{document.querySelector(sel+' button:last-child').focus();return true},action);await key('Enter');await until('lightbox',()=>js(()=>!!document.querySelector('[role="dialog"][aria-label^="模板大图对比"]')));await shot('gallery-lightbox-'+id);await key('Escape');await until('lightbox close',()=>js(()=>!document.querySelector('[role="dialog"][aria-label^="模板大图对比"]')));await noWrite();
  report.gallery[id]={paper:clean,contrast,favoriteToggle:true,inspectAndEscape:true,noWrite:true};write();
 }
 report.checks.galleryFourThemes=true;
 // Explicitly apply one template; all other fields except recommended color are unchanged.
 await click('一键应用',action);await until('applied template',async()=> (await main.store.getResume(slug)).templateId==='vip-cyber-dark',20000);
 const applied=await main.store.getResume(slug);assert.deepEqual({...applied,templateId:original.templateId,globalSettings:original.globalSettings,updatedAt:original.updatedAt},original);assert.deepEqual({...applied.globalSettings,themeColor:original.globalSettings.themeColor},original.globalSettings);assert.equal(hashes()[1],before[1]);report.checks.explicitApplyOnlyTemplateAndColor=true;
 await set('select[aria-label="快速切换简历版本"]',long);await until('long doc',()=>js(s=>document.querySelector('select[aria-label="快速切换简历版本"]')?.value===s&&document.querySelector('.studio-shell')?.getAttribute('aria-busy')==='false',long));await until('three plus pages',()=>js(()=>Number(document.querySelector('[aria-label="预估页数"]')?.textContent.match(/\d+/)?.[0])>2));
 await click('双页总览');const warning='[data-studio-region="preview-spread-warning"]';await until('warning',()=>js(sel=>!!document.querySelector(sel),warning));
 for(const id of themes){await theme(id);const state=await js(sel=>{const w=document.querySelector(sel);w.scrollIntoView({block:'nearest'});const s=getComputedStyle(w);const sheets=[...document.querySelectorAll('.a4-sheet')].map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,markers:e.querySelectorAll('[data-studio-surface],[data-studio-control],[class*="studio-ui-"]').length,style:e.getAttribute('style'),fg:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor,inner:e.innerText}});return {text:w.innerText,theme:w.dataset.studioTheme,fg:s.color,bg:s.backgroundColor,sheets}},warning);
  assert(state.sheets.length===2&&state.sheets.every(s=>s.markers===0));assert.equal(state.theme,id);if(id!=='classic')assert.deepEqual(state.sheets,report.spread.classic.sheets,'theme modified spread paper');
  const contrast=await audit(win,warning,'spread-'+id);if(id!=='classic')assert.equal(contrast.failures.length,0,JSON.stringify(contrast.failures.slice(0,5)));await shot('spread-warning-'+id);
  assert.equal(hashes()[1],before[1]);assert.deepEqual(await main.store.getApplications(),ledger);report.spread[id]={...state,contrast};write();
 }
 report.checks.overflowWarningFourThemes=true;report.checks.paperAndLedgerPreserved=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();app.exit(1)});
