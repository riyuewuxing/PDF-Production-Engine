const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('Windows isolated package validation required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-packaged-job-rewrite-'));
const fixture=require('./runner-fixture.json'),report={runnerSha:process.env.GITHUB_SHA,checks:{},calls:[],mode:'win-unpacked packaged ASAR; synthetic loopback only'};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,server,ws,active=null;
const pending=new Map();let nextId=0;
const write=()=>fs.writeFileSync(path.join(out,'packaged-job-rewrite.json'),JSON.stringify(report,null,2));
async function until(label,f,ms=30000){const end=Date.now()+ms;while(Date.now()<end){try{if(await f())return}catch{}await sleep(150)}throw Error('timeout '+label)}
function stop(){try{ws?.close()}catch{}try{server?.close()}catch{}if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000})}catch{}}try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
const watchdog=setTimeout(()=>{report.error='packaged fixture watchdog';write();stop();process.exit(2)},170000);
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));})}
async function js(expression){const v=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error('renderer eval failed '+expression.slice(0,100));return v.result.value;}
async function run(){
  const data=path.join(root,'data');fs.mkdirSync(path.join(data,'resumes'),{recursive:true});
  const original=JSON.stringify({...fixture,id:'synthetic-packaged-master',title:'合成母库'});
  const body='协助组织30课时教学活动，未独立主讲。',next='协助组织30课时的教学活动；未独立主讲。';
  const source='须具备组织教学活动经历；须持高中物理教师资格证；必须具备独立主讲经验。';
  const versionPath=path.join(data,'resumes','runner-fixture.json');
  fs.writeFileSync(path.join(data,'master.json'),original);
  fs.writeFileSync(versionPath,JSON.stringify({...fixture,id:'synthetic-packaged-guided-version',title:'合成打包岗位改写',basic:{...fixture.basic,name:'PACKAGED_PRIVATE_NAME',email:'packaged-private@example.invalid'},experience:fixture.experience.map(e=>({...e,description:body})),skillContent:'PACKAGED_UNSELECTED_SKILLS'}));
  server=http.createServer((req,res)=>{
    let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{
      try{
        const b=JSON.parse(raw),u=JSON.parse(b.messages[1].content);
        assert(active&&req.method==='POST'&&req.url==='/v1/chat/completions'&&b.model==='synthetic-packaged-model'&&JSON.stringify(b.messages)===JSON.stringify(active.expected)&&!req.headers.authorization&&b.max_tokens<=1600,'unexpected actual loopback request');
        assert(!['PACKAGED_PRIVATE_NAME','packaged-private@example.invalid','PACKAGED_UNSELECTED_SKILLS','synthetic-packaged-guided-version','exp-demo','edu-demo','factBinding'].some(m=>raw.includes(m)),'unauthorized data in packaged request');
        let content;
        if(active.phase==='analysis'){
          assert(u.task==='job-evidence-v1'&&u.requirements.length===3&&u.sources.length===1,'packaged analysis scope invalid');
          content=JSON.stringify([{requirementId:'R1',assessment:'partial',citations:[{evidenceId:'E1',quote:'协助组织30课时'}],reason:'合成分析 MODEL_REASON_NEVER_FORWARD',missing:['独立范围待核实 MODEL_GAP_NEVER_FORWARD']},{requirementId:'R2',assessment:'gap',citations:[],reason:'合成分析',missing:['教师资格证']},{requirementId:'R3',assessment:'supported',citations:[{evidenceId:'E1',quote:'独立主讲'}],reason:'合成错误肯定线索',missing:[]}]);
        }else{
          assert(u.mode==='co-create'&&u.jdText===source.split('；')[0]+'；'&&u.toolResults.list_visible_blocks.length===1&&u.toolResults.list_visible_blocks[0].text===body&&!raw.includes('MODEL_REASON_NEVER_FORWARD')&&!raw.includes('MODEL_GAP_NEVER_FORWARD')&&!raw.includes('须持高中物理教师资格证'),'packaged rewrite scope expanded');
          content=JSON.stringify([{blockKey:'B1',suggestedText:next,reason:'合成表达调整',factIds:[u.toolResults.inspect_block_facts[0].sources[0].id]},{blockKey:'B2',suggestedText:'UNAUTHORIZED_OUTSIDE_SCOPE',reason:'越权目标',factIds:[]}]);
        }
        report.calls.push({phase:active.phase,model:b.model,cap:b.max_tokens,requestSha256:crypto.createHash('sha256').update(JSON.stringify(b.messages)).digest('hex')});
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'synthetic-packaged-returned',usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160},choices:[{finish_reason:'stop',message:{content}}]}));
      }catch(e){report.error=String(e.message);res.writeHead(400);res.end('fixture rejected');}
    });
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const reserved=net.createServer();await new Promise(r=>reserved.listen(0,'127.0.0.1',r));const debugPort=reserved.address().port;await new Promise(r=>reserved.close(r));
  const exe=path.resolve('release','win-unpacked','Resume Studio.exe');assert(fs.existsSync(exe),'packaged executable absent');
  const asar=path.join(path.dirname(exe),'resources','app.asar');assert(fs.existsSync(asar),'packaged ASAR absent');report.asarSha256=crypto.createHash('sha256').update(fs.readFileSync(asar)).digest('hex');
  child=spawn(exe,['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debugPort],{cwd:path.dirname(exe),env:{...process.env,RESUME_STUDIO_DATA_DIR:root},stdio:'ignore',windowsHide:false});
  let target;await until('packaged renderer CDP',async()=>{
    const r=await fetch('http://127.0.0.1:'+debugPort+'/json/list',{signal:AbortSignal.timeout(2000)});
    target=(await r.json()).find(t=>t.type==='page'&&t.url.startsWith('file:')&&t.webSocketDebuggerUrl);return !!target;
  },35000);
  assert(new URL(target.webSocketDebuggerUrl).hostname==='127.0.0.1'||new URL(target.webSocketDebuggerUrl).hostname==='localhost','CDP not loopback');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(!d.id)return;const p=pending.get(d.id);if(!p)return;pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);});
  const q=sel=>'document.querySelector('+JSON.stringify(sel)+')';
  const has=t=>js('document.body.innerText.includes('+JSON.stringify(t)+')');
  const button=(t,scope='body')=>js('[...('+q(scope)+')?.querySelectorAll("button")||[]].some(b=>b.innerText.trim()==='+JSON.stringify(t)+'&&!b.disabled&&b.getClientRects().length)');
  const click=async(t,scope='body')=>{await until('enabled '+t,()=>button(t,scope));assert(await js('(()=>{const b=[...('+q(scope)+').querySelectorAll("button")].find(e=>e.innerText.trim()==='+JSON.stringify(t)+'&&!e.disabled&&e.getClientRects().length);if(!b)return false;b.click();return true})()'),'button absent '+t)};
  const setValue=async(sel,value)=>assert(await js('(()=>{const e='+q(sel)+';if(!e)return false;const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}));return true})()'),'input absent '+sel);
  const capture=async(name,sel)=>{await js(q(sel)+'?.scrollIntoView({block:"start",behavior:"instant"})');await sleep(300);const shot=await cdp('Page.captureScreenshot',{format:'png'});assert(shot.data?.length>1000,'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'))};
  const checkLabel=async(part,scope)=>assert(await js('(()=>{const l=[...('+q(scope)+').querySelectorAll("label")].find(e=>e.innerText.includes('+JSON.stringify(part)+'));const b=l?.querySelector("input[type=checkbox]");if(!b||b.disabled)return false;if(!b.checked)b.click();return true})()'),'checkbox unavailable '+part);
  const version='select[aria-label="快速切换简历版本"]';
  await until('packaged editor ready',()=>js('!!'+q(version)+'&&typeof window.resumeDesktop?.ai?.requestCompletionOutcome==="function"'));
  if(await js(q(version)+'?.value')!=='runner-fixture')await setValue(version,'runner-fixture');
  await until('synthetic packaged version ready',()=>js('document.querySelector("#basic-field-name")?.value==="PACKAGED_PRIVATE_NAME"'));
  const before=await js('window.resumeDesktop.resumes.get("runner-fixture")'),beforeMaster=fs.readFileSync(path.join(data,'master.json'));
  const beforeFact=await js('window.resumeDesktop.facts.get()');
  const originalBytes=fs.readFileSync(versionPath);
  const old=await js('window.resumeDesktop.ai.getSettings()');
  const saved=await js('window.resumeDesktop.ai.saveSettings('+JSON.stringify({...old,enabled:true,providerLabel:'Synthetic packaged loopback',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',model:'synthetic-packaged-model',apiKey:'',maxOutputTokens:1600,timeoutMs:25000,deepseekThinking:'provider-default'})+')');
  assert(saved.enabled&&saved.model==='synthetic-packaged-model'&&saved.apiKey==='','packaged profile save failed');
  const panel='details[aria-label="岗位 AI 证据分析"]',result='section[aria-label="岗位 AI 分析结果"]',preview='section[aria-label="岗位 AI 发送预览"]',rewrite='section[aria-label="岗位定向改写工作区"]',rp='section[aria-label="岗位改写发送预览"]',proposal='[aria-label="岗位改写正文提案"]';
  const messages=sel=>js('Array.from(('+q(sel)+').querySelectorAll("pre")).map((e,i)=>({role:i===0?"system":"user",content:e.textContent}))');
  await click('诊断优化');await click('JD 雷达');await setValue('textarea[placeholder^="例如：招聘高中物理教师"]',source);
  await click('分析岗位原文');await until('packaged job panel',()=>js('!!'+q(panel)));await js(q(panel)+'.open=true');
  await click('读取已保存岗位 AI 模型',panel);await until('model ready',()=>has('Synthetic packaged loopback · synthetic-packaged-model'));
  await click('选择全部条款',panel);
  assert(await js('(()=>{const e=[...('+q(panel)+').querySelectorAll("input")].find(e=>e.getAttribute("aria-label")?.startsWith("AI 自述 工作经历"));if(!e||e.disabled)return false;e.click();return true})()'),'packaged evidence selection unavailable');
  await click('预览岗位 AI 分析',panel);await until('packaged analysis preview',()=>js('!!'+q(preview)));
  assert(report.calls.length===0,'packaged preview auto sent');active={phase:'analysis',expected:await messages(preview)};
  await click('确认发送岗位 AI 分析',preview);await until('packaged analysis result',()=>js('!!'+q(result)));active=null;
  const targets=await js('Array.from(('+q(result)+').querySelectorAll("article")).map(a=>Array.from(a.querySelectorAll("button")).filter(b=>b.innerText.startsWith("准备本段定向改写")).map(b=>b.innerText))');
  assert(targets.length===3&&targets[0].length===1&&!targets[1].length&&!targets[2].length&&report.calls.length===1,'packaged job target gate incorrect');
  report.checks.packagedGroundedTarget=true;await capture('packaged-job-analysis',result);
  await click(targets[0][0],result);await until('packaged guided scope',()=>js('!!'+q(rewrite)));assert(report.calls.length===1,'opening packaged draft sent');
  await capture('packaged-job-rewrite-draft',rewrite);
  await click('预览本段定向改写',rewrite);await until('packaged guided preview',()=>js('!!'+q(rp)));
  assert(report.calls.length===1&&fs.readFileSync(versionPath).equals(originalBytes),'packaged preview changed data');
  active={phase:'rewrite',expected:await messages(rp)};await capture('packaged-job-rewrite-preview',rp);
  await click('确认发送本段改写',rp);await until('packaged rewrite result',()=>js(q('[aria-label="岗位改写调用回执"]')+'?.dataset.attemptState==="received"'));
  assert(await has('未授权目标 1')&&!await has('UNAUTHORIZED_OUTSIDE_SCOPE')&&report.calls.length===2,'packaged proposal scope failure');active=null;
  const disabled=()=>js('[...('+q(rewrite)+').querySelectorAll("button")].find(b=>b.innerText.includes("应用已核对提案"))?.disabled===true');
  assert(await disabled()&&fs.readFileSync(versionPath).equals(originalBytes),'packaged result edited before approval');report.checks.packagedExplicitSeparateSend=true;await capture('packaged-job-rewrite-proposal',proposal);
  await checkLabel('已核对本条原文',rewrite);assert(await disabled(),'packaged fact approval bypassed PDF');
  await click('试渲染已选正文提案',rewrite);await until('packaged actual PDF comparison',()=>js('!!'+q('section[aria-label="真实 PDF 前后对照"]')),45000);
  assert(await disabled()&&fs.readFileSync(versionPath).equals(originalBytes),'packaged PDF generated premature write');
  await checkLabel('已检查正文修改后的真实 PDF 页面',rewrite);assert(await button('应用已核对提案（1）',rewrite),'packaged approved apply unavailable');await capture('packaged-job-rewrite-pdf','section[aria-label="真实 PDF 前后对照"]');
  report.checks.packagedFactPdfGates=true;
  await click('应用已核对提案（1）',rewrite);
  await until('packaged saved body',()=>JSON.parse(fs.readFileSync(versionPath,'utf8')).experience[0].description===next,30000);
  const after=await js('window.resumeDesktop.resumes.get("runner-fixture")'),expected={...before,updatedAt:after.updatedAt,experience:before.experience.map((e,i)=>i===0?{...e,description:next}:e)};
  assert(JSON.stringify(after)===JSON.stringify(expected)&&fs.readFileSync(path.join(data,'master.json')).equals(beforeMaster)&&JSON.stringify(await js('window.resumeDesktop.facts.get()'))===JSON.stringify(beforeFact),'packaged modified protected fields or other version');
  const snapDir=path.join(data,'.backups','runner-fixture'),snaps=fs.readdirSync(snapDir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(snapDir,f),'utf8')));
  assert(snaps.length===1&&snaps[0].meta.reason==='岗位定向改写前快照'&&JSON.stringify(snaps[0].document)===JSON.stringify(before),'packaged exact original snapshot missing');
  assert(!await js('!!'+q(rewrite))&&await has('原岗位核对会话因简历变化失效')&&report.calls.length===2&&!report.error,'packaged old approval not invalidated');
  report.checks.packagedExactBodyAndSnapshot=true;report.checks.packagedOldReviewInvalidated=true;report.checks.loopbackOnly=true;
  await capture('packaged-job-rewrite-saved','[role="status"]');write();
}
run().then(()=>{clearTimeout(watchdog);stop();process.exit(0)}).catch(e=>{clearTimeout(watchdog);report.error=String(e?.message||'package fixture error').slice(0,500);write();stop();process.exit(1)});
