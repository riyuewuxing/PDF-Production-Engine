const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-packaged-interview-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,checks:{},calls:[],mode:'win-unpacked packaged ASAR; synthetic loopback only'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,server,ws,active=null;
const pending=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'packaged-interview.json'),JSON.stringify(report,null,2));
async function until(label,f,ms=30000){const end=Date.now()+ms;while(Date.now()<end){try{if(await f())return}catch{}await sleep(150)}throw Error('timeout '+label)}
function stop(){try{ws?.close()}catch{}try{server?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='packaged fixture watchdog';write();stop();process.exit(2)},170000);
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));})}
async function js(expression){const v=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error('renderer eval failed '+expression.slice(0,100));return v.result.value;}
async function run(){
  const data=path.join(root,'data');fs.mkdirSync(path.join(data,'resumes'),{recursive:true});
  const original=JSON.stringify({...fixture,id:'synthetic-packaged-interview-master',title:'合成母库'});
  const visibleA={...fixture.projects[0],id:'a',name:'合成甲项目',description:'甲：参与整理实验记录，未独立主持'},visibleB={...fixture.projects[0],id:'b',name:'合成乙项目',description:'乙：协作清洗数据'};
  const hiddenCollision={...fixture.projects[0],id:'collision',name:'HIDDEN_COLLISION_METADATA',description:'HIDDEN_COLLISION_BODY',visible:false};
  const visibleCollision={...fixture.projects[0],id:'collision',name:'合成冲突项目',description:'可见但身份冲突'};
  const doc={...fixture,id:'synthetic-packaged-interview-version',title:'合成打包面试',basic:{...fixture.basic,name:'PACKAGED_INTERVIEW_PRIVATE',title:'科研助理'},education:fixture.education.map(e=>({...e,major:'物理学'})),projects:[visibleA,visibleB,hiddenCollision,visibleCollision]};
  const versionPath=path.join(data,'resumes','runner-fixture.json'),ledgerPath=path.join(data,'applications.json');
  fs.writeFileSync(path.join(data,'master.json'),original);fs.writeFileSync(versionPath,JSON.stringify(doc));
  fs.writeFileSync(ledgerPath,JSON.stringify({schemaVersion:1,applications:[],coverLetters:[],interviewAnswers:{'runner-fixture:q-proj-1':'旧版甲草稿'}}));
  const reserved=net.createServer();await new Promise(r=>reserved.listen(0,'127.0.0.1',r));const debugPort=reserved.address().port;await new Promise(r=>reserved.close(r));
  const exe=path.resolve('release','win-unpacked','Resume Studio.exe');assert(fs.existsSync(exe),'packaged executable absent');
  const asar=path.join(path.dirname(exe),'resources','app.asar');report.asarSha256=crypto.createHash('sha256').update(fs.readFileSync(asar)).digest('hex');
  child=spawn(exe,['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debugPort],{cwd:path.dirname(exe),env:{...process.env,RESUME_STUDIO_DATA_DIR:root},stdio:'ignore',windowsHide:false});
  let target;await until('packaged renderer CDP',async()=>{const r=await fetch('http://127.0.0.1:'+debugPort+'/json/list',{signal:AbortSignal.timeout(2000)});target=(await r.json()).find(t=>t.type==='page'&&t.url.startsWith('file:')&&t.webSocketDebuggerUrl);return !!target;},35000);
  assert(['127.0.0.1','localhost'].includes(new URL(target.webSocketDebuggerUrl).hostname),'CDP not loopback');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(!d.id)return;const p=pending.get(d.id);if(!p)return;pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);});
  const q=sel=>'document.querySelector('+JSON.stringify(sel)+')',has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const click=async name=>{await until('button '+name,()=>js('[...document.querySelectorAll("button")].some(b=>b.innerText.trim()==='+JSON.stringify(name)+'&&!b.disabled&&b.getClientRects().length)'));assert(await js('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.innerText.trim()==='+JSON.stringify(name)+'&&!b.disabled&&b.getClientRects().length);if(!b)return false;b.click();return true})()'),'button missing '+name)};
  const setValue=async(sel,value)=>assert(await js('(()=>{const e='+q(sel)+';if(!e||e.disabled)return false;const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:e.tagName==="INPUT"?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}));return true})()'),'input missing '+sel);
  const capture=async(name,sel)=>{await js(q(sel)+'?.scrollIntoView({block:"center",behavior:"instant"})');await sleep(250);const shot=await cdp('Page.captureScreenshot',{format:'png'});assert(shot.data?.length>1000,'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'))};
  const version='select[aria-label="快速切换简历版本"]',panel='[aria-label="本地面试练习"]',role='input[aria-label="面试练习目标岗位"]',history='details[aria-label="面试历史草稿"]';
  const rowFor=marker=>'Array.from(document.querySelectorAll('+JSON.stringify(panel+' article[aria-label^="面试练习题 "]')+')).find(a=>a.textContent.includes('+JSON.stringify(marker)+'))';
  const valueFor=marker=>js(rowFor(marker)+'?.querySelector("textarea")?.value');
  const setAnswer=async(marker,v)=>assert(await js('(()=>{const a='+rowFor(marker)+';const e=a?.querySelector("textarea");if(!e||e.disabled)return false;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,'+JSON.stringify(v)+');e.dispatchEvent(new Event("input",{bubbles:true}));return true})()'),'question missing '+marker);
  const ready=()=>until('practice ready',()=>js('!!'+q(panel+' article[aria-label^="面试练习题 "] textarea:not(:disabled)')));
  const enter=async()=>{await until('packaged editor',()=>js('!!'+q(version)+'&&!!document.querySelector("#basic-field-name")'));if(await js(q(version)+'?.value')!=='runner-fixture')await setValue(version,'runner-fixture');await until('version selected',()=>js('document.querySelector("#basic-field-name")?.value==="PACKAGED_INTERVIEW_PRIVATE"'));await click('求职面试');await click('面试追问');await ready();};
  await enter();
  assert(await has('当前目标：科研助理')&&await has('研究方法、可复现性')&&!await has('电磁感应'),'packaged role misclassification');
  assert(await valueFor('合成甲项目')===''&&await valueFor('合成乙项目')===''&&await valueFor('合成冲突项目')===undefined,'packaged legacy/collision draft incorrect');
  await js(q(history)+'.open=true');assert(await js(q(history)+'?.querySelector("textarea[readonly]")?.value==="旧版甲草稿"'),'packaged legacy draft lost');
  report.checks.packagedRoleAndLegacyIsolation=true;await capture('packaged-interview-legacy',history);
  const a='合成甲回答，未独立主持',b='合成乙回答，协作完成';
  const before=fs.readFileSync(versionPath),masterBefore=fs.readFileSync(path.join(data,'master.json'));
  await setAnswer('合成甲项目',a);await setAnswer('合成乙项目',b);
  await until('packaged disk drafts saved',()=>{const l=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));return Object.values(l.interviewAnswers).includes(a)&&Object.values(l.interviewAnswers).includes(b)});
  const l=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));const entries=Object.entries(l.interviewAnswers).filter(([k])=>k.startsWith('interview-practice-v2:'));
  assert(entries.length===2&&entries.every(([k,v])=>JSON.parse(k.slice('interview-practice-v2:'.length))[1]===doc.id)&&entries.some(([k,v])=>v===a&&k.includes('block:proj:a'))&&entries.some(([k,v])=>v===b&&k.includes('block:proj:b')),'packaged exact key readback failed');
  report.checks.packagedAnswerDiskIdentity=true;
  await setValue(role,'高中物理教师');await ready();assert(await has('电磁感应')&&await valueFor('合成甲项目')===''&&await valueFor('合成乙项目')==='','packaged role draft crossed scope');
  await setValue(role,'');await ready();assert(await valueFor('合成甲项目')===a&&await valueFor('合成乙项目')===b,'packaged return failed');
  report.checks.packagedRoleSwitchRestoresCorrectDraft=true;
  // The real packaged AI pane must not offer an ambiguous visible/hidden block as an editable target.
  await click('诊断优化');await click('AI 润色 Diff');await click('AI 自由任务');
  const free='[aria-label="简历 AI 自由任务"]';
  await until('packaged free task',()=>js('!!'+q(free)));
  const freeText=await js(q(free)+'?.textContent||""');
  assert(freeText.includes('合成甲项目')&&freeText.includes('合成乙项目')&&!freeText.includes('合成冲突项目')&&!freeText.includes('HIDDEN_COLLISION'),'packaged ambiguous target exposed to free task');
  report.checks.packagedAmbiguousBlockNotOffered=true;await capture('packaged-ambiguous-target-filtered',free);
  assert(fs.readFileSync(versionPath).equals(before)&&fs.readFileSync(path.join(data,'master.json')).equals(masterBefore)&&JSON.parse(fs.readFileSync(ledgerPath,'utf8')).interviewAnswers['runner-fixture:q-proj-1']==='旧版甲草稿','packaged practice changed resume or old draft');
  report.checks.packagedOriginalAndLegacyPreserved=true;report.checks.noModelRequestMade=true;write();
}
run().then(()=>{clearTimeout(watchdog);stop();process.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e?.message||'package fixture error').slice(0,500);write();stop();process.exit(1)});
