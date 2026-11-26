const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('resume-studio-restored-v1-'))throw Error('isolated restored root required');
const userData=path.join(root,'.electron-userdata');fs.mkdirSync(userData,{recursive:true});
app.setPath('userData',userData);app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs');
const deadline=setTimeout(()=>{console.error('restored cold process watchdog');app.exit(2);},20000);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(label,fn){const stop=Date.now()+12000;while(Date.now()<stop){if(await fn())return;await wait(150);}throw Error('timeout '+label);}
async function run(){
  if(path.resolve(main.dataDir)!==path.join(path.resolve(root),'data'))throw Error('wrong restored workspace');
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=code=>win.webContents.executeJavaScript(code);
  await until('restored editor',()=>js('!!document.querySelector("#basic-field-name")&&!!document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")'));
  await js('(()=>{const e=document.querySelector("select[aria-label=\\"快速切换简历版本\\"]");if(e.value!=="master"){e.value="master";e.dispatchEvent(new Event("change",{bubbles:true}))}return true})()');
  const master=await main.store.getResume('master');
  await until('restored master in actual editor',()=>js('document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")?.value==="master"&&document.querySelector("#basic-field-name")?.value==='+JSON.stringify(master.basic.name)));
  const values=await js('Promise.all([window.resumeDesktop.resumes.get("master"),window.resumeDesktop.applications.get(),window.resumeDesktop.facts.get(),window.resumeDesktop.evidence.get()])');
  const ledger=JSON.parse(fs.readFileSync(path.join(main.dataDir,'applications.json'),'utf8'));
  const facts=JSON.parse(fs.readFileSync(path.join(main.dataDir,'.fact-bank-v1.json'),'utf8'));
  const evidence=JSON.parse(fs.readFileSync(path.join(main.dataDir,'.evidence-index-v1.json'),'utf8'));
  const result={master:JSON.stringify(values[0])===JSON.stringify(master),ledger:JSON.stringify(values[1].jobReviews)===JSON.stringify(ledger.jobReviews)&&JSON.stringify(values[1].applications)===JSON.stringify(ledger.applications),facts:JSON.stringify(values[2])===JSON.stringify(facts),evidence:JSON.stringify(values[3])===JSON.stringify(evidence),jobReviews:ledger.jobReviews.length,pdfArchives:ledger.jobReviews.filter(x=>x.pdfOrigin).length};
  if(!result.master||!result.ledger||!result.facts||!result.evidence)throw Error('restored IPC values differ from persisted data: '+JSON.stringify(result));
  await js('document.fonts.ready.then(()=>true)');await wait(250);
  const image=await win.webContents.capturePage();if(image.isEmpty())throw Error('empty restored screenshot');
  fs.writeFileSync(path.join(out,'84-workspace-restored-cold-editor.png'),image.toPNG());
  fs.writeFileSync(path.join(out,'workspace-restored-cold.json'),JSON.stringify(result,null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(deadline);app.exit(0);}).catch(e=>{console.error(e.message);clearTimeout(deadline);app.exit(1);});
