const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out)throw Error('isolated paths required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
const userData=path.join(root,'userData');fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData);app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json'),manifest=require('./runner-manifest.json');
const checks={};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>{console.error('import visibility watchdog expired');app.exit(2);},90000);
async function until(label,fn,limit=15000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await sleep(150);}throw Error('timed out: '+label);}
async function run(){
  await main.store.saveResume('master',{...fixture,id:'synthetic-import-master',title:'合成母库'});
  await main.store.saveResume('runner-fixture',fixture);
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  const js=code=>win.webContents.executeJavaScript(code);
  const active=()=>js('document.querySelector("select[aria-label=\\"快速切换简历版本\\"]")?.value||""');
  const click=async label=>{const ok=await js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(label)+');if(!b||b.disabled)return false;b.click();return true})()');if(!ok)throw Error('button missing: '+label);};
  const clickAria=async label=>{const ok=await js('(()=>{const b=[...document.querySelectorAll("button[aria-label]")].find(e=>e.getAttribute("aria-label")==='+JSON.stringify(label)+');if(!b||b.disabled)return false;b.click();return true})()');if(!ok)throw Error('aria button missing: '+label);};
  const capture=async name=>{await js('document.fonts.ready.then(()=>true)');await sleep(350);const shot=await win.webContents.capturePage();if(shot.isEmpty())throw Error('empty capture');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG());};
  const preview=()=>js('[...document.querySelectorAll(".a4-sheet")].map(e=>e.innerHTML).join("\\n")');
  await until('initial editor',()=>js('!!document.querySelector("#basic-field-name")'));
  for(const missing of [false,true]){
    const label=missing?'missing':'disabled';
    const name='IMPORT_NAME_20_'+label,role='IMPORT_HIDDEN_ROLE_20_'+label,email='import-'+label+'@example.invalid',skill='IMPORT_SKILL_20_'+label;
    const original=await main.store.getResume('runner-fixture');
    const input={...original,id:'import-20-'+label,title:'synthetic-import-'+label+'-20',templateId:'minimal-ats',
      basic:{...original.basic,name,title:role,email,fieldOrder:original.basic.fieldOrder.map(f=>f.key==='title'?{...f,visible:false}:f)},
      menuSections:original.menuSections.map(s=>s.id==='basic'?{...s,enabled:false}:s).filter(s=>!missing||s.id!=='basic'),skillContent:skill};
    const inputPath=path.join(root,'synthetic-import-'+label+'.json');fs.writeFileSync(inputPath,JSON.stringify(input));
    const bytes=fs.readFileSync(inputPath);
    const previous=await active();
    await click('版本母库');await until('JSON import control visible',()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==="导入 JSON"&&!b.disabled)'));
    const picker=win.webContents.debugger;let listener,timer;
    try{
      picker.attach('1.3');await picker.sendCommand('Page.enable');await picker.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true});
      const opened=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('JSON picker watchdog expired')),8000);listener=(_event,method,params)=>{if(method==='Page.fileChooserOpened'){clearTimeout(timer);resolve(params);}};picker.on('message',listener);});
      const [chosen,clicked]=await Promise.all([opened,win.webContents.executeJavaScript('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==="导入 JSON");if(!b||b.disabled)return false;b.click();return true})()',true)]);
      if(!clicked||!chosen.backendNodeId)throw Error('actual JSON picker did not open file input');
      await picker.sendCommand('DOM.setFileInputFiles',{files:[inputPath],backendNodeId:chosen.backendNodeId});
    }finally{clearTimeout(timer);if(listener)picker.removeListener('message',listener);if(picker.isAttached()){await picker.sendCommand('Page.setInterceptFileChooserDialog',{enabled:false}).catch(()=>{});picker.detach();}}
    await until('imported version selected',async()=>{const slug=await active();if(!slug||slug===previous)return false;try{return (await main.store.getResume(slug)).basic.name===name;}catch{return false;}});
    const slug=await active();const imported=await main.store.getResume(slug);
    if(imported.menuSections.some(s=>s.id==='basic'&&s.enabled)||imported.basic.title!==role||imported.basic.email!==email)throw Error('import changed hidden original fields');
    await click('内容编辑');
    await until('hidden preview loaded',async()=>{const p=await preview();return p.includes(skill)&&!p.includes(name)&&!p.includes(role)&&!p.includes(email);});
    await capture('import-'+label+'-hidden');
    checks['import-'+label+'-hidden']=true;
    if(missing)await click('恢复基本信息模块');else await clickAria('显示模块基本信息');
    await until('restored data persisted',async()=>{const doc=await main.store.getResume(slug);return doc.menuSections.some(s=>s.id==='basic'&&s.enabled);});
    await until('visible name restored but individual role stays hidden',async()=>{const p=await preview();return p.includes(skill)&&p.includes(name)&&p.includes(email)&&!p.includes(role);});
    const restored=await main.store.getResume(slug);
    if(JSON.stringify(restored.basic)!==JSON.stringify(imported.basic)||!fs.readFileSync(inputPath).equals(bytes))throw Error('restoration changed stored fields or external import file');
    await capture('import-'+label+'-restored');
    checks['import-'+label+'-explicitRestore']=true;
  }
  fs.writeFileSync(path.join(out,'import-visibility-evidence.json'),JSON.stringify({sourceSha:manifest.sourceSha,runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(deadline);app.exit(0);}).catch(e=>{clearTimeout(deadline);console.error(e);fs.writeFileSync(path.join(out,'import-visibility-failure.json'),JSON.stringify({checks,error:String(e)},null,2));app.exit(1);});
