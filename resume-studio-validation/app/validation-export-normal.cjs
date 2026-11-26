const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-export-normal-'))throw Error('isolated synthetic fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const checks={},observations={};
const assert=(v,m)=>{if(!v)throw Error(m)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=b=>createHash('sha256').update(b).digest('hex');
const watchdog=setTimeout(()=>{console.error('export scenario deadline');app.exit(2)},105000);
function report(error){fs.writeFileSync(path.join(out,'export-scenario.json'),JSON.stringify({privateBaseSha:'8ac7fed56c619faf3b4bf521329db99eb01f6dad',runnerSha:process.env.GITHUB_SHA,checks,observations,...(error?{error:String(error)}:{})},null,2))}
async function until(label,fn){const end=Date.now()+23000;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(150)}throw Error('timeout '+label)}
async function run(){
  const doc=await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-export-receipt',title:'Synthetic Receipt',basic:{...fixture.basic,name:'Synthetic Receipt Candidate'}});
  const source=main.store.resolveResumePath('runner-fixture').filePath,bytes=fs.readFileSync(source),revision=JSON.stringify([doc.id,doc.updatedAt]);
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=code=>win.webContents.executeJavaScript(code);
  const has=text=>js('document.body.innerText.includes('+JSON.stringify(text)+')');
  const button=text=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(text)+'&&!b.disabled)');
  const click=async text=>assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(text)+');if(!b||b.disabled)return false;b.click();return true})()'),'button unavailable '+text);
  const capture=async name=>{await js('document.fonts.ready.then(()=>true)');await sleep(300);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
  const copy=(file,name)=>{const b=fs.readFileSync(file);assert(b.subarray(0,4).toString()==='%PDF','invalid PDF');fs.writeFileSync(path.join(out,name),b);return{basename:path.basename(file),sha256:hash(b),size:b.length}};
  await until('editor loaded',()=>js('document.querySelector("#basic-field-name")?.value==="Synthetic Receipt Candidate"'));
  await click('导出 PDF');await until('ordinary export',async()=>await button('导出 PDF')&&await has('已导出矢量 A4 PDF')&&await button('记入投递并锁定快照'));
  const names=fs.readdirSync(main.exportsDir).filter(n=>n.endsWith('.pdf'));assert(names.length===1,'expected one PDF');
  observations.normal=copy(path.join(main.exportsDir,names[0]),'ordinary.pdf');
  assert((await main.store.listSnapshots('runner-fixture')).length===1&&fs.readFileSync(source).equals(bytes),'normal export altered source or missing history');
  checks.normalReceiptAndHistory=true;await capture('01-normal-receipt');
  // Reversible ordinary recycle-bin operation on the synthetic fixture models
  // another app instance archiving a document while its editor remains open.
  const removed=await main.store.deleteResume('runner-fixture',revision);
  const archive=path.join(main.store.trashDir,removed.trashId+'.json');
  assert(fs.readFileSync(archive).equals(bytes),'archive bytes differ');
  await click('导出 PDF');await until('separate written-artifact warning',async()=>await button('导出 PDF')&&await has('自动历史快照未确认完成'));
  assert(await button('打开文件')&&!await button('记入投递并锁定快照'),'warning lacks file action or exposes quick-log');
  const newNames=fs.readdirSync(main.exportsDir).filter(n=>n.endsWith('.pdf')&&!names.includes(n));assert(newNames.length===1,'expected one additional PDF');
  observations.archivedSource=copy(path.join(main.exportsDir,newNames[0]),'archived-source.pdf');
  assert(await has(path.join(main.exportsDir,newNames[0])),'actual output path not shown');
  assert(fs.readFileSync(archive).equals(bytes)&&(await main.store.listSnapshots('runner-fixture')).length===1,'archived source or history changed');
  checks.completedExportWithArchivedSourceKeepsFileAndWarning=true;await capture('02-artifact-with-history-warning');
  const restored=await main.store.restoreTrash(removed.trashId,revision);
  assert(restored.document.id===doc.id&&restored.document.basic.name===doc.basic.name,'synthetic restoration failed');
  checks.archivedOriginalCanBeRestored=true;
  // Normal concurrent cover-letter requests have the same default filename
  // but intentionally different content. Both must be independently retained.
  const payload={title:'Synthetic Cover Letter',company:'Synthetic Company',role:'Role',candidateName:'Synthetic Candidate',contactLine:'',themeColor:'#167883',fontFamily:'sans',bodyText:'SYNTHETIC_LETTER_ALPHA'};
  const first=JSON.stringify({payload}),second=JSON.stringify({payload:{...payload,bodyText:'SYNTHETIC_LETTER_BETA'}});
  const pair=await js('Promise.all([window.resumeDesktop.pdf.exportCoverLetter('+first+'),window.resumeDesktop.pdf.exportCoverLetter('+second+')])');
  assert(pair[0].filePath&&pair[1].filePath&&pair[0].filePath!==pair[1].filePath,'cover letter paths are not unique');
  observations.letters=[copy(pair[0].filePath,'letter-alpha.pdf'),copy(pair[1].filePath,'letter-beta.pdf')];
  assert(observations.letters[0].sha256!==observations.letters[1].sha256,'cover letters have identical bytes');
  checks.concurrentNormalCoverLettersRetainTwoFiles=true;report();
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0)}).catch(e=>{clearTimeout(watchdog);console.error(e);report(e);app.exit(1)});
