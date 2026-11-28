const {app,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,phase=process.env.STUDIO_THEME_PHASE;
if(!root||!out||!path.basename(root).startsWith('synthetic-crop-')||!['baseline','candidate'].includes(phase))throw Error('isolated crop fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const report={runnerSha:process.env.GITHUB_SHA,phase,checks:{},rows:{}};
const write=()=>fs.writeFileSync(path.join(out,'crop.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='crop watchdog';write();app.exit(2)},260000);
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),audit=require('./validation-theme-t05-contrast.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function until(label,fn,ms=18000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
const configs=[{preset:'一寸 3:4',frame:'无额外边框',sw:'透明',color:'',zoom:.8,w:240,h:320,outH:480,radius:'sm',aspect:'3:4',width:88,height:116},{preset:'方照 1:1',frame:'白环投影',sw:'证件蓝',color:'#2563eb',zoom:1.35,w:260,h:260,outH:360,radius:'md',aspect:'1:1',width:96,height:96},{preset:'圆形头像',frame:'精装相框',sw:'证件红',color:'#dc2626',zoom:1.75,w:260,h:260,outH:360,radius:'full',aspect:'1:1',width:96,height:96}];
const frames=['none','white-ring','card-border'];
async function run(){
 const themes=phase==='baseline'?['classic']:['classic','aurora','forest','lavender','highContrast'];
 const rgba=Buffer.alloc(137*193*4);
 for(let y=0;y<193;y++)for(let x=0;x<137;x++){const i=(y*137+x)*4;rgba[i]=(x*3+y)%256;rgba[i+1]=(y*5+x)%256;rgba[i+2]=(x*7+y*2)%256;rgba[i+3]=x<21||y<17?0:255;if(!rgba[i+3])rgba.fill(0,i,i+3);}
 const original=nativeImage.createFromBitmap(rgba,{width:137,height:193}).toPNG(),dataUrl='data:image/png;base64,'+original.toString('base64');
 const assets=path.join(main.dataDir,'assets');fs.mkdirSync(assets,{recursive:true});const originalPath=path.join(assets,'synthetic-crop-source.png');fs.writeFileSync(originalPath,original);
 fs.writeFileSync(path.join(out,'source.png'),original);report.sourceSha256=sha(original);
 for(const id of themes)for(let i=0;i<configs.length;i++){const slug='crop-'+id+'-'+i;await main.store.saveResume(slug,{...fixture,id:'synthetic-'+slug,title:'Synthetic crop',basic:{...fixture.basic,name:'Synthetic Crop Candidate',photo:'/api/assets/synthetic-crop-source.png',photoConfig:{visible:true,aspectRatio:'3:4',borderRadius:'sm',bgBackdrop:'',frameStyle:'none',width:88,height:116}}});}
 const ledger=await main.store.getApplications();
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,1000);win.focus();
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const dlg='[role="dialog"][aria-label="证件照裁剪与底色工作台"]',panel=dlg+' > div';
 const click=async (label,scope='body')=>{await until('button '+label,()=>js((label,scope)=>[...document.querySelectorAll(scope+' button')].some(e=>(e.innerText.trim()===label||e.getAttribute('aria-label')===label||e.title===label)&&!e.disabled&&e.getClientRects().length),label,scope));assert(await js((label,scope)=>{const e=[...document.querySelectorAll(scope+' button')].find(e=>(e.innerText.trim()===label||e.getAttribute('aria-label')===label||e.title===label)&&!e.disabled&&e.getClientRects().length);if(!e)return false;e.scrollIntoView({block:'nearest'});e.click();return true},label,scope));};
 const set=async(sel,value)=>assert(await js((sel,value)=>{const e=document.querySelector(sel);if(!e||e.disabled)return false;const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return true},sel,value));
 const shot=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(300);const image=await win.webContents.capturePage();assert(!image.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),image.toPNG());};
 const theme=async id=>{await set('select[aria-label="切换工作台主题"]',id);await until('theme '+id,()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));await sleep(300);};
 const canvas=()=>js(sel=>{const c=document.querySelector(sel+' canvas');return c?{url:c.toDataURL('image/png'),width:c.width,height:c.height,clientWidth:c.clientWidth,clientHeight:c.clientHeight,stage:getComputedStyle(c.parentElement).backgroundColor,bg:getComputedStyle(c).backgroundColor,filter:getComputedStyle(c).filter,opacity:getComputedStyle(c).opacity}:null},dlg);
 const expected=async(c,dx,dy,output=false)=>js(async (src,c,dx,dy,output)=>{const img=new Image();img.src=src;await img.decode();const a=document.createElement('canvas');a.width=output?360:c.w;a.height=output?c.outH:c.h;const x=a.getContext('2d');if(c.color){x.fillStyle=c.color;x.fillRect(0,0,a.width,a.height)}const scale=Math.max(a.width/img.naturalWidth,a.height/img.naturalHeight)*c.zoom,dw=img.naturalWidth*scale,dh=img.naturalHeight*scale;x.drawImage(img,(a.width-dw)/2+dx*(output?a.width/c.w:1),(a.height-dh)/2+dy*(output?a.height/c.h:1),dw,dh);return a.toDataURL('image/png')},dataUrl,c,dx,dy,output);
 const exportFiles=async (doc,label)=>{const results={};for(const [kind,method] of [['png','exportPng'],['pdf','export']]){const ret=await js((method,doc)=>window.resumeDesktop.pdf[method]({slug:'',document:doc,saveAs:false,skipSave:true}),method,doc);assert(ret&&!ret.canceled&&ret.filePath&&!ret.contentWarning,'native export failed '+kind);const bytes=fs.readFileSync(ret.filePath);fs.writeFileSync(path.join(out,label+'-paper.'+kind),bytes);results[kind]={sha256:sha(bytes),size:bytes.length};if(kind==='png'){const image=nativeImage.createFromBuffer(bytes);assert(!image.isEmpty());results[kind].pixels=sha(image.toBitmap());results[kind].dimensions=image.getSize();}}return results;};
 await until('editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 for(const id of themes)for(let i=0;i<configs.length;i++){
  const c=configs[i],label=id+'-'+i,slug='crop-'+label,docPath=main.store.resolveResumePath(slug).filePath;
  await set('select[aria-label="快速切换简历版本"]',slug);await until('version '+slug,()=>js(slug=>document.querySelector('select[aria-label="快速切换简历版本"]')?.value===slug&&document.querySelector('.studio-shell')?.getAttribute('aria-busy')==='false',slug));
  await theme(id);await until('photo visible',()=>js(()=>document.querySelector('img[alt="证件照预览"]')?.naturalWidth>0));
  const old=await main.store.getResume(slug),before=sha(fs.readFileSync(docPath)),files=fs.readdirSync(assets).sort();
  await click('裁剪/换底');await until('crop',()=>js(sel=>!!document.querySelector(sel+' canvas'),dlg));await sleep(400);
  await click(c.preset,dlg);await click(c.frame,dlg);await click(c.sw,dlg);
  await set(dlg+' input[type="range"]',String(c.zoom));await sleep(350);
  assert.equal(await js(sel=>Number(document.querySelector(sel+' input[type="range"]').value),dlg),c.zoom);
  const a=await canvas();assert.equal(a.width,c.w);assert.equal(a.height,c.h);assert.equal(a.clientWidth,c.w,'unexpected resized canvas at desktop');assert.equal(a.clientHeight,c.h);
  // Real Electron pointer input at the canvas center; CSS pixel movement matches backing at 100%.
  const r=await js(sel=>{const el=document.querySelector(sel+' canvas');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}},dlg);
  win.webContents.sendInputEvent({type:'mouseDown',x:r.x,y:r.y,button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseMove',x:r.x+13,y:r.y-9,button:'left',modifiers:['leftButtonDown']});
  win.webContents.sendInputEvent({type:'mouseUp',x:r.x+13,y:r.y-9,button:'left',clickCount:1});
  const previewExpected=await expected(c,13,-9);await until('exact dragged canvas '+label,async()=> (await canvas())?.url===previewExpected);
  const preview=await canvas();assert.equal(preview.filter,'none');assert.equal(preview.opacity,'1');
  assert.equal(sha(fs.readFileSync(docPath)),before);assert.deepEqual(fs.readdirSync(assets).sort(),files);
  let contrast=await audit(win,panel,label);if(id!=='classic')assert.equal(contrast.failures.length,0,JSON.stringify(contrast.failures.slice(0,8)));
  await shot(label+'-dialog');fs.writeFileSync(path.join(out,label+'-canvas.png'),Buffer.from(preview.url.split(',')[1],'base64'));
  if(phase==='candidate'){
   for(const next of themes){await theme(next);assert.deepEqual(await canvas(),preview,'theme changed canvas geometry/pixels '+next);assert.equal(sha(fs.readFileSync(docPath)),before);assert.deepEqual(fs.readdirSync(assets).sort(),files);}
   await theme(id);
  }
  const outputExpected=await expected(c,13,-9,true);
  await click('保存并应用证件照',dlg);await until('modal closed',()=>js(sel=>!document.querySelector(sel),dlg));
  await until('photo saved '+label,async()=> (await main.store.getResume(slug)).basic.photo!==old.basic.photo,25000);
  const saved=await main.store.getResume(slug),photo=saved.basic.photo,asset=path.join(assets,path.basename(photo)),bytes=fs.readFileSync(asset);
  assert.deepEqual(bytes,Buffer.from(outputExpected.split(',')[1],'base64'),'actual output differs from independently calculated crop');
  const config=saved.basic.photoConfig;assert.equal(config.aspectRatio,c.aspect);assert.equal(config.borderRadius,c.radius);assert.equal(config.bgBackdrop,c.color);assert.equal(config.frameStyle,frames[i]);assert.equal(config.width,c.width);assert.equal(config.height,c.height);
  assert.deepEqual({...saved,updatedAt:old.updatedAt,basic:old.basic},old,'non-photo fields changed');
  assert.equal(sha(fs.readFileSync(originalPath)),report.sourceSha256);assert.deepEqual(await main.store.getApplications(),ledger);
  fs.writeFileSync(path.join(out,label+'-saved.png'),bytes);const exports=await exportFiles(saved,label);
  const row={previewSha:sha(Buffer.from(preview.url.split(',')[1],'base64')),previewSize:[preview.width,preview.height],stage:preview.stage,outputSha:sha(bytes),outputSize:nativeImage.createFromBuffer(bytes).getSize(),config,contrast,exports};
  if(id!=='classic'){const ref=report.rows['classic-'+i];assert.equal(row.previewSha,ref.previewSha);assert.equal(row.outputSha,ref.outputSha);assert.equal(row.exports.png.pixels,ref.exports.png.pixels);}
  report.rows[label]=row;write();
 }
 report.checks.validCropAndOutputExact=true;report.checks.sourceAndLedgerUnchanged=true;report.checks.themeMatrixNoWrite=true;report.checks.nativePaperExports=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();app.exit(1)});
