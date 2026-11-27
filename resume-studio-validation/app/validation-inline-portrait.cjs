const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-inline-'))throw Error('isolated inline fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},files={};const sleep=ms=>new Promise(r=>setTimeout(r,ms)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m)};
const watchdog=setTimeout(()=>{console.error('inline photo watchdog');app.exit(2)},165000);
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150)}throw Error('timeout '+label)}
function report(error){fs.writeFileSync(path.join(out,'inline-evidence.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,phase:process.env.PORTRAIT_EXPECT,checks,files,...(error?{error:String(error)}:{})},null,2))}
async function run(){
 const fixed=process.env.PORTRAIT_EXPECT==='fixed';
 const rgba=Buffer.alloc(80*120*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=255;rgba[i+2]=255;rgba[i+3]=255}
 const image=nativeImage.createFromBitmap(rgba,{width:80,height:120}),png=image.toPNG(),jpg=image.toJPEG(95);
 const broken=Buffer.from('Synthetic non-image bytes for inline portrait regression only.','utf8');
 const items=[['good-png','png',png],['good-jpg','jpeg',jpg],['corrupt-png','png',broken],['corrupt-jpg','jpeg',broken],['header-png','png',png.subarray(0,8)],['header-jpg','jpeg',jpg.subarray(0,4)],['empty-png','png',Buffer.alloc(0)]];
 const docs={},original={};
 async function saveItem([label,type,bytes]){
   let photo='data:image/'+type+';base64,'+bytes.toString('base64');
   if(label==='good-wrapped')photo='data:image/PNG;BASE64,'+bytes.toString('base64').match(/.{1,24}/g).join('\n');
   if(label==='managed-header-png'||label==='managed-header-jpg'){
     const ext=type==='jpeg'?'jpg':type,filename=label+'.'+ext;
     fs.mkdirSync(path.join(main.dataDir,'assets'),{recursive:true});
     fs.writeFileSync(path.join(main.dataDir,'assets',filename),bytes);
     photo='/api/assets/'+filename;
   }
   original[label]=photo;
   docs[label]=await main.store.saveResume(label,{...fixture,id:'synthetic-inline-'+label,title:'Synthetic inline '+label,templateId:'left-right',menuSections:fixture.menuSections.map(s=>s.id==='basic'?{...s,enabled:true}:s),basic:{...fixture.basic,name:'Synthetic Inline Candidate',photo,photoConfig:{visible:true}}});
   files[label]={inputHash:hash(bytes),inputBytes:bytes.length,nativeEmpty:nativeImage.createFromBuffer(bytes).isEmpty()};
 }
 for(const item of items)await saveItem(item);
 await main.registerAssetProtocol();main.registerIpcHandlers();const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
 const js=code=>win.webContents.executeJavaScript(code);
 await until('editor',()=>js('!!document.querySelector("#basic-field-name")'));
 if(fixed){
   const webp=await js("(()=>{const c=document.createElement('canvas');c.width=80;c.height=120;const x=c.getContext('2d');x.fillStyle='#ff00ff';x.fillRect(0,0,80,120);return c.toDataURL('image/webp',1)})()");
   assert(webp.startsWith('data:image/webp;base64,'),'Chromium did not create WebP');
   const bytes=Buffer.from(webp.split(',')[1],'base64');
   const extra=[['good-webp','webp',bytes],['corrupt-webp','webp',bytes.subarray(0,12)],['good-wrapped','png',png],['managed-header-png','png',png.subarray(0,8)],['managed-header-jpg','jpeg',jpg.subarray(0,4)]];
   for(const item of extra){items.push(item);await saveItem(item);}
 }
 for(const [label] of items){
   for(const [ext,method] of [['pdf','export'],['png','exportPng'],['docx','exportDocx'],['html','exportHtml']]){
     const options={slug:'',document:docs[label],saveAs:false,skipSave:true,fileNameSuffix:label+'-'+ext};
     const result=await js('window.resumeDesktop.pdf['+JSON.stringify(method)+']('+JSON.stringify(options)+')');
     assert(result&&!result.canceled&&result.filePath,'export unavailable '+label+' '+ext);
     const bytes=fs.readFileSync(result.filePath);assert(bytes.length>100,'empty export');
     const name=label+'-out.'+ext;fs.writeFileSync(path.join(out,name),bytes);
     const warning=result.contentWarning??null;files[name]={warning,sha256:hash(bytes),size:bytes.length};
     assert(label.startsWith('good-')?!warning:(fixed?!!warning:!warning),'unexpected warning '+name+': '+warning);
   }
   const loaded=await main.store.getResume(label);
   assert(loaded.basic.photo===original[label],'stored portrait changed '+label);
 }
 checks.actualExportCount=items.length*4;checks.originalPortraitsPreserved=true;
 if(fixed){
   const hidden={...docs['corrupt-png'],basic:{...docs['corrupt-png'].basic,photoConfig:{...docs['corrupt-png'].basic.photoConfig,visible:false}}};
   for(const [label,method,doc] of [['hidden','export',hidden],['markdown','exportMarkdown',docs['corrupt-png']]]){
     const result=await js('window.resumeDesktop.pdf['+JSON.stringify(method)+']('+JSON.stringify({slug:'',document:doc,saveAs:false,skipSave:true,fileNameSuffix:label})+')');
     assert(!result.canceled&&!result.contentWarning&&fs.existsSync(result.filePath),'intentional omission warned '+label);
   }
   checks.hiddenAndMarkdownDoNotWarn=true;
 }
 const selector='select[aria-label="快速切换简历版本"]';
 const selected=()=>js('document.querySelector('+JSON.stringify(selector)+')?.value');
 if(await selected()!=='corrupt-png'){
   assert(await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"corrupt-png");e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),'selector absent');
 }
 await until('corrupt inline version selected',async()=>await selected()==='corrupt-png');
 const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
 const button=t=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled)');
 await until('corrupt inline editor ready',()=>js('!!document.querySelector("#basic-field-name")'));
 assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==="导出 PDF");if(!b||b.disabled)return false;b.click();return true})()'),'export button unavailable');
 await until('actual receipt',async()=>await button('导出 PDF')&&await button('打开文件'));
 const quick=await button('记入投递并锁定快照'),warned=await has('导出成品可能缺少照片');
 files.ui={quick,warned};assert(fixed?!quick&&warned:quick&&!warned,'unexpected actual receipt');
 checks.actualReceiptMatchesPhase=true;
 const history=await main.store.listSnapshots('corrupt-png');
 assert(history.length===1,'missing automatic history');
 const snapshot=JSON.parse(fs.readFileSync(path.join(main.store.backupsDir,'corrupt-png',history[0].id+'.json'),'utf8'));
 assert(snapshot.document.basic.photo===original['corrupt-png'],'history modified inline photo');
 checks.originalHistoryPreserved=true;
 const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,'inline-portrait-receipt.png'),shot.toPNG());report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
