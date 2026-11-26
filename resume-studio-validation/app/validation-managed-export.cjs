const {app,nativeImage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-contained-export-'))throw Error('isolated export fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},files={};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const watchdog=setTimeout(()=>{console.error('managed export watchdog');app.exit(2)},155000);
const assert=(v,m)=>{if(!v)throw Error(m)};
const hash=b=>createHash('sha256').update(b).digest('hex');
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150)}throw Error('timeout '+label)}
const report=error=>fs.writeFileSync(path.join(out,'managed-export-evidence.json'),JSON.stringify({privateBaseSha:'78d2264811a14a6ff8522235b422ccbffcec2126',runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks,files,...(error?{error:String(error)}:{})},null,2));
async function run(){
  const pixels=Buffer.alloc(80*120*4);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=255;pixels[i+1]=0;pixels[i+2]=255;pixels[i+3]=255;}
  const photo=nativeImage.createFromBitmap(pixels,{width:80,height:120}).toPNG();
  assert(photo.length>80,'invalid marker image');
  const ordinary=await main.store.saveAsset({filename:'synthetic-managed-portrait.png',dataUrl:'data:image/png;base64,'+photo.toString('base64')});
  const outside=path.join(root,'synthetic-external-portrait.png');
  fs.writeFileSync(outside,photo);
  const linked=path.join(main.dataDir,'assets','linked-portrait.png');
  fs.linkSync(outside,linked);
  const good=await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-managed-export',title:'Synthetic managed export',templateId:'left-right',menuSections:fixture.menuSections.map(x=>x.id==='basic'?{...x,enabled:true}:x),basic:{...fixture.basic,name:'Synthetic Marker Candidate',photo:ordinary.url,photoConfig:{visible:true}}});
  const originalPath=path.join(main.dataDir,'resumes','runner-fixture.json'),before=fs.readFileSync(originalPath);
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=code=>win.webContents.executeJavaScript(code);
  await until('healthy editor',()=>js('!!document.querySelector("#basic-field-name")'));
  await until('actual managed preview photo',()=>js('[...document.images].some(i=>i.src.includes('+JSON.stringify(ordinary.filename)+')&&i.complete&&i.naturalWidth===80)'));
  checks.managedPhotoRenderedInEditor=true;
  const capture=await win.webContents.capturePage();assert(!capture.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,'01-managed-photo-preview.png'),capture.toPNG());
  const unsafe={...good,basic:{...good.basic,photo:'/api/assets/linked-portrait.png'}};
  const modes=[['pdf','export'],['png','exportPng'],['docx','exportDocx'],['html','exportHtml']];
  for(const [label,doc] of [['ordinary',good],['linked',unsafe]]){
    for(const [ext,method] of modes){
      const options={slug:'',document:doc,saveAs:false,skipSave:true,fileNameSuffix:label+'-'+ext};
      const result=await js('window.resumeDesktop.pdf['+JSON.stringify(method)+']('+JSON.stringify(options)+')');
      assert(result&&!result.canceled&&typeof result.filePath==='string','actual export unavailable '+label+' '+ext);
      const bytes=fs.readFileSync(result.filePath);assert(bytes.length>100,'export empty');
      const dest=label+'.'+ext;fs.writeFileSync(path.join(out,dest),bytes);files[dest]={size:bytes.length,sha256:hash(bytes)};
    }
  }
  assert(fs.readFileSync(originalPath).equals(before),'exports modified stored document');
  assert(fs.readFileSync(outside).equals(photo)&&fs.statSync(outside).nlink===2,'external photo changed or link replaced');
  assert(fs.readFileSync(path.join(main.dataDir,'assets',ordinary.filename)).equals(photo),'ordinary photo changed');
  checks.allEightRealExportsCreated=true;checks.originalAndBothAssetsPreserved=true;files.marker={sha256:hash(photo)};
  report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
