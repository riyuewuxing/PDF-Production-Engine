const {app,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-crop-safety-'))throw Error('isolated crop safety fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const report={runnerSha:process.env.GITHUB_SHA,checks:{},rows:{},zoom:{}};const write=()=>fs.writeFileSync(path.join(out,'crop-safety.json'),JSON.stringify(report,null,2));
const timer=setTimeout(()=>{report.error='crop safety watchdog';write();app.exit(2)},190000);
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),audit=require('./validation-theme-t05-contrast.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('timeout '+label)}
async function run(){
 const assets=path.join(main.dataDir,'assets');fs.mkdirSync(assets,{recursive:true});
 function sample(w,h,k){const b=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;b[i]=(x*k+y)%256;b[i+1]=(y*k+x)%256;b[i+2]=(x+y*3+k)%256;b[i+3]=x<12||y<7?0:255;if(!b[i+3])b.fill(0,i,i+3);}return nativeImage.createFromBitmap(b,{width:w,height:h}).toPNG();}
 const a=sample(137,193,3),b=sample(211,109,7),source=path.join(assets,'synthetic-source.png');fs.writeFileSync(source,a);
 const slug='runner-fixture',old=await main.store.saveResume(slug,{...fixture,id:'synthetic-crop-safety',title:'Synthetic crop safety',basic:{...fixture.basic,photo:'/api/assets/synthetic-source.png',photoConfig:{visible:true,aspectRatio:'3:4',borderRadius:'sm',bgBackdrop:'',frameStyle:'none',width:88,height:116}}});
 const docPath=main.store.resolveResumePath(slug).filePath,original=fs.readFileSync(docPath),ledger=await main.store.getApplications(),files=fs.readdirSync(assets).sort(),snapshots=await main.store.listSnapshots(slug);
 let uploads=0,held=false,fail=false,release=null,last=null;const save=main.store.saveAsset.bind(main.store);
 main.store.saveAsset=async payload=>{uploads++;last=payload;if(held)await new Promise(r=>release=r);if(fail){fail=false;throw Error('synthetic upload refusal');}return save(payload);};
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,1000);win.focus();
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const dlg='[role="dialog"][aria-label="证件照裁剪与底色工作台"]',panel=dlg+' > div';
 const button=(label,scope=dlg)=>js((label,scope)=>[...document.querySelectorAll(scope+' button')].some(e=>(e.innerText.trim()===label||e.getAttribute('aria-label')===label||e.title===label)&&!e.disabled&&e.getClientRects().length),label,scope);
 const click=async(label,scope=dlg)=>{await until('button '+label,()=>button(label,scope));assert(await js((label,scope)=>{const e=[...document.querySelectorAll(scope+' button')].find(e=>(e.innerText.trim()===label||e.getAttribute('aria-label')===label||e.title===label)&&!e.disabled&&e.getClientRects().length);if(!e)return false;e.scrollIntoView({block:'nearest'});e.click();return true},label,scope));};
 const theme=async id=>{await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true},id);await until('theme',()=>js(id=>document.querySelector('.studio-shell')?.dataset.studioTheme===id,id));await sleep(300);};
 const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode,modifiers});await sleep(35);win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(90);};
 const shot=async n=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(180);const s=await win.webContents.capturePage();assert(!s.isEmpty());fs.writeFileSync(path.join(out,n+'.png'),s.toPNG())};
 const canvas=()=>js(sel=>{const e=document.querySelector(sel+' canvas');return e?.toDataURL('image/png')},dlg);
 const ready=()=>button('保存并应用证件照');
 const readOnly=async()=>{assert(fs.readFileSync(docPath).equals(original));assert(fs.readFileSync(source).equals(a));assert.deepEqual(fs.readdirSync(assets).sort(),files);assert.deepEqual(await main.store.getApplications(),ledger);assert.deepEqual(await main.store.listSnapshots(slug),snapshots);};
 const close=()=>until('closed',()=>js(sel=>!document.querySelector(sel),dlg));
 const open=async()=>{await js(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='裁剪/换底');b.scrollIntoView({block:'center'});b.focus();return true});await press('Enter');await until('decoded crop',()=>ready());};
 const pick=async(bytes,name)=>js((sel,arr,name)=>{const el=document.querySelector(sel+' input[type="file"]');const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(arr)],name,{type:'image/png'}));el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));return true},dlg,[...bytes],name);
 const focus=()=>js(sel=>{const e=document.activeElement;return {inside:!!e.closest(sel),label:e.getAttribute('aria-label')||e.innerText.trim(),tag:e.tagName}},dlg);
 await until('editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
 await until('source image',()=>js(()=>document.querySelector('img[alt="证件照预览"]')?.naturalWidth>0));
 for(const id of ['classic','nordic','blueprint','terracotta','ink']){
  await theme(id);await open();const initial=await canvas(),first=await focus();assert(first.inside&&first.label==='关闭证件照裁剪弹窗');
  const n=await js(sel=>[...document.querySelectorAll(sel+' button:not(:disabled),'+sel+' input:not(:disabled),'+sel+' [tabindex="0"]')].filter(e=>e.tabIndex>=0&&e.getClientRects().length).length,dlg);
  const index=()=>js(sel=>[...document.querySelectorAll(sel+' button:not(:disabled),'+sel+' input:not(:disabled),'+sel+' [tabindex="0"]')].filter(e=>e.tabIndex>=0&&e.getClientRects().length).indexOf(document.activeElement),dlg);
  const f=[],rev=[];for(let i=0;i<n;i++){await press('Tab');f.push(await index());assert.equal(f[i],(i+1)%n);}for(let i=0;i<n;i++){await press('Tab',['shift']);rev.push(await index());assert.equal(rev[i],(n-1-i+n)%n);}
  await js(sel=>{document.querySelector(sel+' canvas').focus();return true},dlg);await press('Right',['shift']);assert.notEqual(await canvas(),initial,'keyboard pan no effect');await press('Left',['shift']);assert.equal(await canvas(),initial,'keyboard pan not reversible');
  const beforeWheel=await js(sel=>{const c=document.querySelector(sel+' canvas');c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),scroll:document.querySelector(sel+' > div').scrollTop,zoom:Number(document.querySelector(sel+' input[type="range"]').value)}},dlg);
  win.webContents.sendInputEvent({type:'mouseWheel',x:beforeWheel.x,y:beforeWheel.y,deltaX:0,deltaY:-120,canScroll:true});await sleep(250);
  const afterWheel=await js(sel=>({scroll:document.querySelector(sel+' > div').scrollTop,zoom:Number(document.querySelector(sel+' input[type="range"]').value)}),dlg);
  assert(afterWheel.zoom!==beforeWheel.zoom,'wheel no zoom');assert.equal(afterWheel.scroll,beforeWheel.scroll,'wheel also scrolled dialog');
  await click('重置证件照位置');assert.equal(await canvas(),initial);
  await press('K',['control']);await press('S',['control']);assert(!await js(()=>!!document.querySelector('[aria-label="全局命令面板"]')));await readOnly();
  await click('圆形头像');await click('证件红');await click('精装相框');
  await press('Escape');await close();assert.equal((await focus()).label,'裁剪/换底');
  await open();assert.equal(await canvas(),initial,'cancelled preset persisted');await click('取消');await close();assert.equal((await focus()).label,'裁剪/换底');await readOnly();
  await open();await pick(Buffer.from('broken image'),'broken.png');await until('decode error',()=>js(sel=>document.querySelector(sel+' [role="alert"]')?.textContent.includes('无法读取图片内容'),dlg));assert(!await ready());assert.notEqual(await canvas(),initial,'old source survived decode failure');
  const contrast=await audit(win,panel,'broken-'+id);if(id!=='classic')assert.equal(contrast.failures.length,0,JSON.stringify(contrast.failures.slice(0,5)));
  await shot('broken-'+id);assert.equal(uploads,0);await readOnly();
  await pick(b,'replacement.png');await until('valid replacement',()=>ready());assert.notEqual(await canvas(),initial);await shot('replacement-'+id);await press('Escape');await close();await readOnly();
  report.rows[id]={forward:f,reverse:rev,wheel:{beforeWheel,afterWheel},keyboardPan:true,cancelReset:true,brokenRejected:true,replacementDecoded:true,contrast,sourcePreserved:true};write();
 }
 report.checks.keyboardMouseCancelAndBadImage=true;
 // Narrow native renderer: all controls reachable via scroll, no horizontal overflow.
 win.setSize(980,720);
 for(const id of ['classic','nordic','blueprint','terracotta','ink']){win.webContents.setZoomFactor(1);await theme(id);for(const z of [1,1.25,1.5]){win.webContents.setZoomFactor(z);await sleep(160);await open();
  const geom=()=>js(sel=>{const f=document.querySelector(sel+' > div'),r=f.getBoundingClientRect(),e=document.activeElement,b=e.getBoundingClientRect();return {view:[innerWidth,innerHeight],rect:[r.left,r.top,r.right,r.bottom],scroll:[f.clientWidth,f.scrollWidth,f.clientHeight,f.scrollHeight],focus:e.getAttribute('aria-label')||e.innerText.trim(),visible:b.left>=r.left-1&&b.right<=r.right+1&&b.top>=r.top-1&&b.bottom<=r.bottom+1}},dlg);
  const first=await geom();await press('Tab',['shift']);const last=await geom();report.zoom[id+'-'+z]={first,last};write();assert(first.rect[0]>=0&&first.rect[1]>=0&&first.rect[2]<=first.view[0]+1&&first.rect[3]<=first.view[1]+1);assert(first.scroll[1]<=first.scroll[0]+1,'horizontal overflow');assert(first.visible&&last.visible,'focused control outside visible dialog');await shot('zoom-'+id+'-'+z);await press('Escape');await close();}}
 win.webContents.setZoomFactor(1);win.setSize(1440,1000);await readOnly();report.checks.zoomReachable=true;
 // Real IPC: refuse first upload; then hold a real save and prove one request, no cancellation or stale state.
 await open();await pick(b,'replacement.png');await until('replacement decoded',()=>ready());fail=true;await click('保存并应用证件照');await until('upload refusal',()=>js(sel=>document.querySelector(sel+' [role="alert"]')?.textContent.includes('synthetic upload refusal'),dlg));assert(await ready());assert.equal(uploads,1);await readOnly();await shot('upload-refusal');
 held=true;await click('保存并应用证件照');await until('actual upload held',()=>uploads===2&&!!release);await press('Escape');await press('Enter');await press('K',['control']);await press('S',['control']);assert(await js(sel=>!!document.querySelector(sel),dlg));assert(!await ready());assert.equal(uploads,2);await readOnly();await shot('upload-held');release();await close();
 await until('saved replacement',async()=> (await main.store.getResume(slug)).basic.photo!==old.basic.photo,25000);
 const saved=await main.store.getResume(slug),asset=path.join(assets,path.basename(saved.basic.photo)),bytes=fs.readFileSync(asset);
 assert.deepEqual(bytes,Buffer.from(last.dataUrl.split(',')[1],'base64'));assert.equal(nativeImage.createFromBuffer(bytes).getSize().width,360);assert.equal(nativeImage.createFromBuffer(bytes).getSize().height,480);assert(fs.readFileSync(source).equals(a));assert.deepEqual(await main.store.getApplications(),ledger);assert.equal(uploads,2);
 report.checks.failedUploadNoWrite=true;report.checks.heldUploadExactlyOnce=true;report.checks.actualAssetAndDocumentSaved=true;report.asset={sha256:sha(bytes),size:bytes.length,sourceSha256:sha(a),uploads};write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=String(e.stack||e);console.error(report.error);write();app.exit(1)});
