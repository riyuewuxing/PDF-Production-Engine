const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const out=process.env.RESUME_STUDIO_BROWSER_EVIDENCE,url=process.env.RESUME_STUDIO_BROWSER_URL,root=process.env.RESUME_STUDIO_BROWSER_ROOT,snap=process.env.RESUME_STUDIO_BROWSER_SNAPSHOT,appId=process.env.RESUME_STUDIO_BROWSER_APP_ID,revision=process.env.RESUME_STUDIO_BROWSER_LEDGER_REVISION;
if(!out||!root||!snap||!appId||!revision||!/^http:\/\/127\.0\.0\.1:\d+$/.test(url||''))throw Error('isolated local server required');
const userData=path.join(root,'browser-user-data');fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData);app.disableHardwareAcceleration();
const checks={},sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m);};
const watchdog=setTimeout(()=>{console.error('browser application review watchdog');app.exit(2);},115000);
async function until(label,fn,limit=25000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('timed out '+label);}
async function run(){
  const win=new BrowserWindow({width:1440,height:920,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  await win.loadURL(url);
  const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
  const click=async label=>assert(await js(label=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()===label);if(!b||b.disabled)return false;b.click();return true;},label),'missing button '+label);
  const select=async(label,value)=>assert(await js((label,value)=>{const el=document.querySelector('select[aria-label="'+label+'"]');if(!el||![...el.options].some(o=>o.value===value))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));return true;},label,value),'missing select '+value);
  const active=()=>js(()=>document.querySelector('select[aria-label="快速切换简历版本"]')?.value||'');
  const dialog=()=>js(()=>document.querySelector('[role="dialog"][aria-label="永久投递快照只读复盘"]')?.textContent??'');
  const has=async t=>(await dialog()).includes(t);
  const capture=async name=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(250);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG());};
  await until('browser editor',()=>js(()=>!!document.querySelector('#basic-field-name')));
  assert(await js(()=>typeof window.resumeDesktop==='undefined'&&typeof window.require==='undefined'),'preload or Node unexpectedly present');
  checks.noDesktopBridge=true;
  if(await active()!=='runner-fixture'){await select('快速切换简历版本','runner-fixture');await until('active baseline',async()=>await active()==='runner-fixture'&&await js(()=>document.querySelector('#basic-field-name')?.value==='合成候选甲'));}
  await click('求职面试');
  await until('browser ledger review loaded',()=>js(()=>!!document.querySelector('button[aria-label="只读复盘 浏览器合成学校"]:not([disabled])')));
  assert(await js(()=>{const b=document.querySelector('button[aria-label="只读复盘 浏览器合成学校"]');b?.click();return !!b}),'browser review button missing');
  await until('browser application review dialog',()=>has('选择来源后点击'));
  assert(await has('关联版本不在当前可用列表'),'deleted original warning missing');
  await click('读取并对比');await until('browser sealed memory comparison',()=>has('browser-current@example.invalid'));
  assert((await dialog()).includes('browser-sealed@example.invalid')&&!(await dialog()).includes('HIDDEN_PHONE_')&&await active()==='runner-fixture','browser archive direction or mask wrong');
  checks.actualBrowserSealedToMemory=true;await capture('01-browser-sealed-to-memory');
  await select('对照来源','disk:target-compare');await click('读取并对比');await until('browser target compare',()=>has('browser-other@example.invalid'));
  assert((await dialog()).includes('浏览器封存原稿')&&await active()==='runner-fixture','browser disk compare switched version');
  checks.actualBrowserDiskCompare=true;await capture('02-browser-sealed-to-disk');
  const header=await js(async({id,appId,revision})=>{
   const query=new URLSearchParams({applicationId:appId,snapshotId:id,ledgerRevision:revision});
   const r=await fetch('/api/application-snapshot-review?'+query,{cache:'no-store'});
   const legacy=await fetch('/api/application-snapshots/'+encodeURIComponent(id),{cache:'no-store'});
   const wrong=await fetch('/api/application-snapshot-review?'+query+'&snapshotId='+id,{cache:'no-store'});
   const stale=await fetch('/api/application-snapshot-review?'+new URLSearchParams({applicationId:appId,snapshotId:id,ledgerRevision:'0'.repeat(64)}),{cache:'no-store'});
   return {status:r.status,cache:r.headers.get('cache-control'),corp:r.headers.get('cross-origin-resource-policy'),sameId:(await r.json()).meta?.id===id,legacyStatus:legacy.status,legacyCache:legacy.headers.get('cache-control'),legacyId:(await legacy.json()).meta?.id===id,duplicate:wrong.status,stale:stale.status};
  },{id:snap,appId,revision});
  assert(header.status===200&&header.cache==='no-store'&&header.corp==='same-origin'&&header.sameId&&header.legacyStatus===200&&header.legacyCache==='no-store'&&header.legacyId&&header.duplicate===400&&header.stale===409,'actual browser endpoint or legacy guard mismatch');
  checks.browserLinkedAndLegacyPrivacyHeaders=true;checks.browserRejectsStaleAndDuplicateQuery=true;
  await click('关闭对照');await click('隐私脱敏');await until('privacy gate',()=>js(()=>document.querySelector('button[aria-label="只读复盘 浏览器合成学校"]')?.disabled===true));
  checks.browserRedactionGate=true;await capture('03-browser-redaction-gate');
  fs.writeFileSync(path.join(out,'application-review-browser-ui.json'),JSON.stringify({checks,header,runnerSha:process.env.GITHUB_SHA},null,2));
}
app.whenReady().then(run).then(()=>{clearTimeout(watchdog);app.exit(0);}).catch(error=>{clearTimeout(watchdog);console.error(error);fs.writeFileSync(path.join(out,'application-review-browser-failure.json'),JSON.stringify({checks,error:String(error)},null,2));app.exit(1);});
