const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const out=process.env.RESUME_STUDIO_BROWSER_EVIDENCE,url=process.env.RESUME_STUDIO_BROWSER_URL,root=process.env.RESUME_STUDIO_BROWSER_ROOT,snap=process.env.RESUME_STUDIO_BROWSER_SNAPSHOT;
if(!out||!root||!snap||!/^http:\/\/127\.0\.0\.1:\d+$/.test(url||''))throw Error('isolated local server required');
const userData=path.join(root,'browser-user-data');fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData);app.disableHardwareAcceleration();
const checks={},sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m);};
const watchdog=setTimeout(()=>{console.error('browser comparison watchdog');app.exit(2);},115000);
async function until(label,fn,limit=25000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('timed out '+label);}
async function run(){
  const win=new BrowserWindow({width:1440,height:920,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  await win.loadURL(url);
  const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
  const click=async label=>assert(await js(label=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()===label);if(!b||b.disabled)return false;b.click();return true;},label),'missing button '+label);
  const select=async(label,value)=>assert(await js((label,value)=>{const el=document.querySelector('select[aria-label="'+label+'"]');if(!el||![...el.options].some(o=>o.value===value))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));return true;},label,value),'missing select '+value);
  const active=()=>js(()=>document.querySelector('select[aria-label="快速切换简历版本"]')?.value||'');
  const dialog=()=>js(()=>document.querySelector('[role="dialog"][aria-label="只读版本差异对照"]')?.textContent??'');
  const has=async t=>(await dialog()).includes(t);
  const capture=async name=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(250);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG());};
  await until('browser editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
  assert(await js(()=>typeof window.resumeDesktop==='undefined'&&typeof window.require==='undefined'),'preload or Node unexpectedly present');
  checks.noDesktopBridge=true;
  if(await active()!=='runner-fixture'){await select('快速切换简历版本','runner-fixture');await until('active baseline',async()=>await active()==='runner-fixture'&&await js(()=>document.querySelector('#basic-field-name')?.value==='合成候选甲'));}
  await click('版本母库');await click('对比版本 / 历史快照');await until('browser comparison dialog',()=>has('选择来源后点击'));
  await select('对照来源','disk:target-compare');await click('读取并对比');await until('browser disk comparison',()=>has('browser-target@example.invalid'));
  assert((await dialog()).includes('browser-current@example.invalid')&&!(await dialog()).includes('HIDDEN_PHONE_B'),'browser content/masking mismatch');
  checks.actualBrowserDiskCompare=true;await capture('01-browser-disk-comparison');
  await select('对照来源','snapshot:'+snap);await click('读取并对比');await until('browser historical compare',()=>has('browser-history@example.invalid'));
  assert((await dialog()).includes('快照创建时间')&&await active()==='runner-fixture','browser snapshot switched version');
  checks.actualBrowserHistoricalCompare=true;await capture('02-browser-history-comparison');
  const header=await js(async id=>{const response=await fetch('/api/resumes/runner-fixture/snapshot-preview/'+encodeURIComponent(id),{cache:'no-store'});return {status:response.status,cache:response.headers.get('cache-control'),corp:response.headers.get('cross-origin-resource-policy'),sameId:(await response.json()).document?.id==='synthetic-compare-doc'};},snap);
  assert(header.status===200&&header.cache==='no-store'&&header.corp==='same-origin'&&header.sameId,'actual browser cache/origin response mismatch');
  checks.browserNoStoreAndLocalOrigin=true;
  await click('关闭对照');await click('隐私脱敏');await until('privacy gate',()=>js(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='对比版本 / 历史快照'&&b.disabled)));
  checks.browserRedactionGate=true;await capture('03-browser-redaction-gate');
  fs.writeFileSync(path.join(out,'browser-comparison-ui.json'),JSON.stringify({checks,header,runnerSha:process.env.GITHUB_SHA},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0);}).catch(error=>{clearTimeout(watchdog);console.error(error);fs.writeFileSync(path.join(out,'browser-comparison-failure.json'),JSON.stringify({checks,error:String(error)},null,2));app.exit(1);});
