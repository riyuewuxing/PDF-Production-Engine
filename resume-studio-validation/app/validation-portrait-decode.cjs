const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-decode-'))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},files={};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(v,m)=>{if(!v)throw Error(m)};
const watchdog=setTimeout(()=>{console.error('portrait decode watchdog');app.exit(2)},155000);
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150)}throw Error('timeout '+label)}
function report(error){fs.writeFileSync(path.join(out,'decode-evidence.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,phase:process.env.PORTRAIT_EXPECT,checks,files,...(error?{error:String(error)}:{})},null,2))}
async function run(){
 const fixed=process.env.PORTRAIT_EXPECT==='fixed';
 const rgba=Buffer.alloc(80*120*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=255;rgba[i+2]=255;rgba[i+3]=255}
 const image=nativeImage.createFromBitmap(rgba,{width:80,height:120});
 const png=image.toPNG(),jpg=image.toJPEG(95);
 const broken=Buffer.from('Synthetic non-image bytes for corrupt portrait regression only.','utf8');
 const items=[['good-png','png',png],['good-jpg','jpg',jpg],['corrupt-png','png',broken],['corrupt-jpg','jpg',broken],['empty-png','png',Buffer.alloc(0)]];
 const docs={};
 async function saveItem([label,ext,bytes]){
   const filename=label+'.'+ext;
   fs.mkdirSync(path.join(main.dataDir,'assets'),{recursive:true});
   fs.writeFileSync(path.join(main.dataDir,'assets',filename),bytes);
   docs[label]=await main.store.saveResume(label,{...fixture,id:'synthetic-decode-'+label,title:'Synthetic decode '+label,templateId:'left-right',menuSections:fixture.menuSections.map(s=>s.id==='basic'?{...s,enabled:true}:s),basic:{...fixture.basic,name:'Synthetic Decode Candidate',photo:'/api/assets/'+filename,photoConfig:{visible:true}}});
   files[filename]={inputHash:crypto.createHash('sha256').update(bytes).digest('hex'),inputBytes:bytes.length,nativeEmpty:nativeImage.createFromBuffer(bytes).isEmpty()};
 }
 for(const item of items)await saveItem(item);
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
 const js=code=>win.webContents.executeJavaScript(code);
 await until('editor',()=>js('!!document.querySelector("#basic-field-name")'));
 if(fixed){
   const webp=await js("(()=>{const c=document.createElement('canvas');c.width=80;c.height=120;const x=c.getContext('2d');x.fillStyle='#ff00ff';x.fillRect(0,0,80,120);return c.toDataURL('image/webp',1)})()");
   assert(webp.startsWith('data:image/webp;base64,'),'Chromium did not create WebP');
   const additional=[['good-webp','webp',Buffer.from(webp.split(',')[1],'base64')],['corrupt-webp','webp',broken]];
   for(const item of additional){items.push(item);await saveItem(item);}
 }
 for(const [label] of items){
   for(const [ext,method] of [['pdf','export'],['png','exportPng'],['docx','exportDocx'],['html','exportHtml']]){
     const options={slug:'',document:docs[label],saveAs:false,skipSave:true,fileNameSuffix:label+'-'+ext};
     const result=await js('window.resumeDesktop.pdf['+JSON.stringify(method)+']('+JSON.stringify(options)+')');
     assert(result&&!result.canceled&&typeof result.filePath==='string','export unavailable '+label+' '+ext);
     const bytes=fs.readFileSync(result.filePath);assert(bytes.length>100,'empty export');
     const name=label+'-out.'+ext;fs.writeFileSync(path.join(out,name),bytes);
     const warning=result.contentWarning??null;files[name]={warning,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
     assert(label.startsWith('good-')?!warning:(fixed?!!warning:!warning),'unexpected warning '+name+': '+warning);
   }
 }
 checks.actualExportCount=items.length*4;
 if(fixed)assert(checks.actualExportCount===28,'incomplete candidate matrix');
 for(const [label,ext,bytes] of items)assert(fs.readFileSync(path.join(main.dataDir,'assets',label+'.'+ext)).equals(bytes),'asset changed '+label);
 checks.allInputsPreserved=true;
 if(fixed){
   const bad=docs['corrupt-png'];
   const hidden={...bad,basic:{...bad.basic,photoConfig:{...bad.basic.photoConfig,visible:false}}};
   for(const [label,method,doc] of [['hidden','export',hidden],['markdown','exportMarkdown',bad]]){
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
 await until('corrupt version selected',async()=>await selected()==='corrupt-png');
 const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
 const button=t=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled)');
 await until('corrupt portrait editor ready',()=>js('!!document.querySelector("#basic-field-name")'));
 assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==="导出 PDF");if(!b||b.disabled)return false;b.click();return true})()'),'export button unavailable');
 await until('actual receipt',async()=>await button('导出 PDF')&&await button('打开文件'));
 const quick=await button('记入投递并锁定快照');
 const warned=await has('头像')&&await has('导出成品可能缺少照片');
 files.ui={quick, warned};
 assert(fixed?!quick&&warned:quick&&!warned,'unexpected actual receipt');
 checks.actualReceiptMatchesPhase=true;
 if(fixed){
   const original=await main.store.getResume('corrupt-png');
   assert(original.basic.photo==='/api/assets/corrupt-png.png','stored source portrait changed');
   const history=await main.store.listSnapshots('corrupt-png');
   assert(history.length===1,'history not retained');
   checks.originalPortraitAndHistoryPreserved=true;
 }
 const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,'corrupt-portrait-receipt.png'),shot.toPNG());
 report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
