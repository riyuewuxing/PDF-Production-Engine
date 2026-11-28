// Native supplementary paper isolation: two additional fixtures, plus cold restart.
// No production source changes, no real documents or credentials.
const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
const group=process.env.STUDIO_THEME_GROUP,phase=process.env.STUDIO_MATRIX_PHASE||'main';
const groups={classic:['classic'],light:['light'],dark:['dark'],highContrast:['highContrast']};
const skinRows=[['inherit','inherit'],['solid','square'],['outline','round'],['soft','pill'],['flat','ghost'],['raised','floating'],['gradient','fine-outline']];
if(!root||!out||!path.basename(root).startsWith('synthetic-theme-t11-export-')||!groups[group]||!['main','restart'].includes(phase))throw Error('isolated fixture/group required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={runnerSha:process.env.GITHUB_SHA,group,phase,checks:{},measurements:[],cases:{}};
const write=()=>fs.writeFileSync(path.join(out,'matrix-'+phase+'.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='application watchdog';write();app.exit(2)},360000);
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(120)}throw Error('Timed out: '+label)}
const nearSlug=n=>'near-'+String(n).padStart(2,'0');
const nearName=n=>'分页合成 '+String(n).padStart(2,'0');
async function run(){
 if(phase==='main'){
  await main.store.saveResume('master',{...fixture,id:'synthetic-master',title:'合成母库'});
  await main.store.saveResume('runner-fixture',fixture);
  await main.store.saveResume('dark-fixture',{...fixture,id:'synthetic-dark',title:'深色合成样本',templateId:'vip-cyber-dark',basic:{...fixture.basic,name:'深色合成样本'}});
  for(let n=0;n<=64;n++){
   const description=Array.from({length:n},(_,i)=>'- 分页临界合成记录 '+String(i+1).padStart(2,'0')+'，仅用于布局测量。').join('\n');
   await main.store.saveResume(nearSlug(n),{...fixture,id:'synthetic-near-'+n,title:nearName(n),basic:{...fixture.basic,name:nearName(n)},experience:[{...fixture.experience[0],description}]});
  }
 }
 const storeHashes=()=>Object.fromEntries(fs.readdirSync(main.store.resumesDir).filter(n=>n.endsWith('.json')).sort().map(n=>[n,sha(fs.readFileSync(path.join(main.store.resumesDir,n)))]));
 const original=storeHashes();
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.focus();
 const js=code=>win.webContents.executeJavaScript(code);
 const selector='select[aria-label="快速切换简历版本"]',key='resume-studio-ui-theme-v1';
 await until('native editor and versions ready',()=>js('!!document.querySelector("#basic-field-name")&&!!document.querySelector('+JSON.stringify(selector)+')'));
 if(win.isMaximized()){win.unmaximize();await sleep(250)}win.setContentSize(1440,900);await sleep(300);assert.deepEqual(win.getContentSize(),[1440,900]);
 const stateFile=path.join(root,'t13-export-restart.json');
 const readPref=()=>js('JSON.parse(localStorage.getItem('+JSON.stringify(key)+')||"null")');
 const shot=async(name,rect)=>{const image=await win.webContents.capturePage(rect);assert(!image.isEmpty(),'empty '+name);fs.writeFileSync(path.join(out,name+'.png'),image.toPNG());return {pixels:sha(image.toBitmap()),size:image.getSize()}};
 async function switchTheme(id){
  assert(await js('(()=>{const e=document.querySelector("select[aria-label=\\\"切换工作台主题\\\"]");if(!e||e.disabled||![...e.options].some(o=>o.value==='+JSON.stringify(id)+'))return false;e.value='+JSON.stringify(id)+';e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'));
  await until('theme applied '+id,()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==='+JSON.stringify(id)));
  await until('theme persisted '+id,async()=>{const v=await readPref();return v?.schemaVersion===1&&v.activePreset===id});
  await js('document.fonts.ready.then(()=>true)');await sleep(250);
 }
 async function switchVersion(slug,name){
  assert(await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e||e.disabled||![...e.options].some(o=>o.value==='+JSON.stringify(slug)+'))return false;if(e.value!=='+JSON.stringify(slug)+'){e.value='+JSON.stringify(slug)+';e.dispatchEvent(new Event("change",{bubbles:true}));}return true})()'),'version missing '+slug);
  await until('selected version '+slug,()=>js('document.querySelector('+JSON.stringify(selector)+')?.value==='+JSON.stringify(slug)+'&&document.querySelector("#basic-field-name")?.value==='+JSON.stringify(name)+'&&document.querySelector(".studio-shell")?.getAttribute("aria-busy")==="false"'));
  await until('saved version '+slug,()=>js('document.querySelector("[aria-label=\\\"本地保存状态\\\"]")?.innerText.includes("已保存至本地硬盘")'));
  await js('document.fonts.ready.then(()=>true)');await sleep(300);
 }
 const skinKey='resume-studio-ui-component-skins-v1';
 const readSkin=()=>js('JSON.parse(localStorage.getItem('+JSON.stringify(skinKey)+')||"null")');
 const chooseSkin=async(b,i)=>{
  const prior=await readSkin();if((prior?.skins?.button??'inherit')===b&&(prior?.skins?.icon??'inherit')===i)return;
  const click=async(label,scope='body')=>{assert(await js('('+((label,scope)=>{const x=[...document.querySelectorAll(scope+' button')].find(x=>x.innerText.trim()===label&&x.getClientRects().length&&!x.disabled);if(!x)return false;x.click();return true;}).toString()+')('+JSON.stringify(label)+','+JSON.stringify(scope)+')'),'missing '+label)};
  const sel='dialog[aria-label="组件外观工坊"]';await click('组件外观');await until('workshop open',()=>js('document.querySelector('+JSON.stringify(sel)+')?.matches(":modal")'));
  for(const [label,v] of [['普通按钮皮肤',b],['图标按钮皮肤',i]]){
   assert(await js('('+((s,l,v)=>{const e=document.querySelector(s+' select[aria-label='+JSON.stringify(l)+']');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('change',{bubbles:true}));return true;}).toString()+')('+JSON.stringify(sel)+','+JSON.stringify(label)+','+JSON.stringify(v)+')'));
   await until('draft '+label,()=>js('document.querySelector('+JSON.stringify(sel+' select[aria-label='+JSON.stringify(label)+']')+')?.value==='+JSON.stringify(v)));
  }
  await click('应用组件外观',sel);await until('workshop closed',()=>js('!document.querySelector('+JSON.stringify(sel)+')'));assert.deepEqual(await readSkin(),{schemaVersion:1,skins:{button:b,icon:i}});await sleep(200);
 };
 if(phase==='restart'){
  const expected=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.deepEqual(original,expected.hashes,'files changed across restart');
  await until('saved theme on fresh Electron process',()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==='+JSON.stringify(expected.theme)));
  assert.deepEqual(await readPref(),{schemaVersion:1,activePreset:expected.theme});assert.deepEqual(await readSkin(),{schemaVersion:1,skins:{button:'gradient',icon:'fine-outline'}});
  await switchVersion('dark-fixture','深色合成样本');
  await shot('restart-'+expected.theme);
  assert.deepEqual(storeHashes(),original);
  report.checks.nativeRestartPreference=true;report.checks.sourceBytesUnchanged=true;report.theme=expected.theme;write();return;
 }
 await switchTheme('classic');
 const measure=async n=>{
  await switchVersion(nearSlug(n),nearName(n));
  const text=await js('Array.from(document.querySelectorAll("span")).map(e=>e.innerText).find(t=>/^(超出单页 \\+|单页内 \\(余 )\\d+px/.test(t))');
  assert(typeof text==='string','missing measured page boundary');
  const m=text.match(/\d+/);assert(m,'unreadable boundary '+text);
  const delta=text.startsWith('超出')?Number(m[0]):-Number(m[0]);
  report.measurements.push({n,delta,text});write();return delta;
 };
 let lo=0,hi=64;
 const first=await measure(lo),last=await measure(hi);assert(first<=0&&last>0,'fixture search does not bracket real page boundary');
 while(hi-lo>1){const mid=Math.floor((lo+hi)/2),d=await measure(mid);if(d>0)hi=mid;else lo=mid}
 const left=await measure(lo),right=await measure(hi);
 const nearest=Math.abs(left)<=Math.abs(right)?{n:lo,delta:left}:{n:hi,delta:right};
 assert(Math.abs(nearest.delta)<=40,'no actual near-boundary fixture '+JSON.stringify(nearest));report.nearest=nearest;
 report.checks.actualNearBoundary=true;write();
 const sheetState=()=>js('('+function(){
  const sheet=document.querySelector('.a4-sheet');if(!sheet)throw Error('missing A4');
  const base=sheet.getBoundingClientRect(),clip=sheet.closest('.print-workspace.overflow-auto');if(!clip)throw Error('missing scroll viewport');
  const cr=clip.getBoundingClientRect(),round=n=>Math.round(n*1000)/1000;
  const children=[sheet,...sheet.querySelectorAll('*')].map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {tag:el.tagName,cls:el.getAttribute('class'),style:el.getAttribute('style'),rect:[round(r.x-base.x),round(r.y-base.y),round(r.width),round(r.height)],color:s.color,bg:s.backgroundColor,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,line:s.lineHeight,spacing:s.letterSpacing,border:s.border,transform:s.transform,scheme:s.colorScheme}});
  const x=Math.max(Math.ceil(base.x)+2,Math.ceil(cr.left)+1,0),y=Math.max(Math.ceil(base.y)+2,Math.ceil(cr.top)+1,0),right=Math.min(Math.floor(base.right)-2,Math.floor(cr.right)-1,innerWidth-2),bottom=Math.min(Math.floor(base.bottom)-2,Math.floor(cr.bottom)-1,innerHeight-2);
  const boundary=Array.from(document.querySelectorAll('span')).map(e=>e.innerText).find(t=>/^(超出单页 \+|单页内 \(余 )\d+px/.test(t));
  return {signature:{text:sheet.innerText,children,width:round(base.width),height:round(base.height)},rect:{x,y,width:right-x,height:bottom-y},boundary,pages:document.querySelector('[aria-label="预估页数"]')?.innerText};
 }.toString()+')()');
 const nativeExport=async(doc,label)=>{
  const pdf=await js('window.resumeDesktop.pdf.export('+JSON.stringify({slug:'',document:doc})+')');
  const png=await js('window.resumeDesktop.pdf.exportPng('+JSON.stringify({slug:'',document:doc})+')');
  assert(!pdf.canceled&&pdf.filePath&&!png.canceled&&png.filePath,'native export missing');
  const pb=fs.readFileSync(pdf.filePath),ib=fs.readFileSync(png.filePath);
  assert.equal(pb.subarray(0,5).toString(),'%PDF-');assert.equal(ib.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const im=nativeImage.createFromBuffer(ib);assert(!im.isEmpty());fs.writeFileSync(path.join(out,label+'-export.pdf'),pb);fs.writeFileSync(path.join(out,label+'-export.png'),ib);
  return {pdfSha:sha(pb),pdfBytes:pb.length,pngSha:sha(ib),pngPixels:sha(im.toBitmap()),pngSize:im.getSize()};
 };
 for(const [label,slug,name] of [['near',nearSlug(nearest.n),nearName(nearest.n)],['dark','dark-fixture','深色合成样本']]){
  await switchVersion(slug,name);const doc=await main.store.getResume(slug);assert(doc);
  report.cases[label]={slug,documentHash:sha(fs.readFileSync(path.join(main.store.resumesDir,slug+'.json'))),rows:{}};
  const id=group;await switchTheme(id);
  for(const [b,i] of skinRows){
   await chooseSkin(b,i);const s=await sheetState();assert(s.rect.width>100&&s.rect.height>100,'A4 crop too small');
   const key=label+'-'+b+'-'+i;
   const row={domHash:sha(JSON.stringify(s.signature)),crop:await shot(key+'-a4',s.rect),rect:s.rect,boundary:s.boundary,pages:s.pages,export:await nativeExport(doc,key)};
   await shot(key+'-screen');report.cases[label].rows[b+'-'+i]=row;write();
   if(b!=='inherit'){const baseline=report.cases[label].rows['inherit-inherit'];assert.equal(row.domHash,baseline.domHash,'paper DOM '+key);if(JSON.stringify(row.crop.size)===JSON.stringify(baseline.crop.size))assert.equal(row.crop.pixels,baseline.crop.pixels,'same-size paper crop '+key);else row.cropComparison='different visible clip; compare document DOM and native output';assert.equal(row.export.pngPixels,baseline.export.pngPixels,'native PNG '+key);assert.equal(row.boundary,baseline.boundary,'page boundary '+key);assert.equal(row.pages,baseline.pages,'page count '+key)}
   assert.deepEqual(storeHashes(),original,'theme or export modified source file');
  }
 }
 report.checks.twoAdditionalFixturesAllThemeRows=true;report.checks.paperDomAndNativePngExact=true;report.checks.sourceBytesUnchanged=true;
 const lastTheme=group;assert.deepEqual(await readPref(),{schemaVersion:1,activePreset:lastTheme});
 fs.writeFileSync(stateFile,JSON.stringify({theme:lastTheme,hashes:original}));report.checks.restartFixturePersisted=true;write();await sleep(400);
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=e.stack||String(e);write();console.error(report.error);app.exit(1)});
