const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,phase=process.env.T47_PHASE;
if(!root||!out||!path.basename(root).startsWith('synthetic-t47-native-')||!['main','restart'].includes(phase))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
const key='synthetic-t47-loopback-key',hidden='SYNTHETIC_ERROR_BODY_ONLY',model='synthetic-t47-loopback',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={runnerSha:process.env.GITHUB_SHA,phase,checks:{},observations:{},calls:[],externalAttempts:0,redirectHits:0,rendererNetwork:0};
const assert=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const safeError=e=>String(e?.message??e).split(key).join('[redacted]').split(hidden).join('[redacted]').slice(0,400);
const output=()=>{const s=JSON.stringify(report,null,2);assert(!s.includes(key)&&!s.includes(hidden),'unsafe report');fs.writeFileSync(path.join(out,phase+'.json'),s)};
const timer=setTimeout(()=>{report.error='native watchdog';output();app.exit(2)},130000);
async function until(label,fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(80)}throw Error('timeout '+label)}
let mode='success',origin='',server,serverError=null;
const nativeFetch=global.fetch.bind(global);
global.fetch=async (url,init)=>{
  if(String(url)!==origin+'/v1/chat/completions'||init?.redirect!=='error'){
    report.externalAttempts++;throw Error('fixture outbound policy denied');
  }
  return nativeFetch(url,init);
};
async function serve(port){
  server=http.createServer((req,res)=>{
    if(req.url==='/redirect-target'){report.redirectHits++;res.end('not authorized');return;}
    let body='',n=0;req.on('data',b=>{n+=b.length;if(n>16384){req.destroy();serverError='request body limit';return;}body+=b;});
    req.on('end',()=>{
      try{
        const v=JSON.parse(body),current=mode;
        assert(req.method==='POST'&&req.url==='/v1/chat/completions'&&req.headers.authorization==='Bearer '+key,'unexpected route/auth');
        assert(v.model===model&&v.max_tokens===64&&!v.thinking&&JSON.stringify(v.messages)===JSON.stringify([{role:'system',content:'Synthetic local check'},{role:'user',content:'Synthetic data only'}]),'unexpected request payload');
        const call={mode:current,bodyExact:true,authorizationExact:true,closed:false};report.calls.push(call);
        res.on('close',()=>{call.closed=true});
        if(current==='hold')return;
        if(current==='redirect'){res.writeHead(307,{Location:origin+'/redirect-target'});res.end();return;}
        if(current==='http'){res.writeHead(429);res.end(hidden+' '+key);return;}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'synthetic-reported-model',choices:[{finish_reason:'stop',message:{content:'OK'}}],usage:{prompt_tokens:7,completion_tokens:2,total_tokens:9,prompt_tokens_details:{cached_tokens:3}}}));
      }catch(e){serverError=safeError(e);res.statusCode=500;res.end('synthetic invalid');}
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  origin='http://127.0.0.1:'+server.address().port;
}
async function run(){
  const cfg=path.join(main.dataDir,'.ai-settings.json'),src=main.store.resolveResumePath('runner-fixture').filePath,master=main.store.masterPath;
  const expectation=path.join(out,'restart-expectation.json');
  if(phase==='main'){
    assert(!fs.existsSync(cfg),'unexpected preconfigured AI');
    await main.store.saveResume('master',{...fixture,id:'synthetic-t47-master',title:'合成离线母库'});
    await main.store.saveResume('runner-fixture',{...fixture,id:'synthetic-t47-doc',title:'合成离线工作稿'});
    await serve(0);
  }else{
    const expected=JSON.parse(fs.readFileSync(expectation,'utf8'));
    assert(sha(fs.readFileSync(cfg))===expected.catalogSha256&&sha(fs.readFileSync(src))===expected.sourceSha256&&sha(fs.readFileSync(master))===expected.masterSha256,'cold restart bytes differ');
    await serve(expected.port);
  }
  assert(safeStorage.isEncryptionAvailable(),'OS encryption unavailable');
  const originals=[fs.readFileSync(src),fs.readFileSync(master)];
  const preserve=()=>{assert(fs.readFileSync(src).equals(originals[0])&&fs.readFileSync(master).equals(originals[1]),'source changed')};
  await main.registerAssetProtocol();main.registerIpcHandlers();
  const win=await main.createMainWindow();win.unmaximize();win.setSize(1440,920);
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{report.rendererNetwork++;cb({cancel:true})});
  const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
  const has=t=>js(t=>document.body.innerText.includes(t),t);
  const click=async label=>{await until('button '+label,()=>js(label=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()===label&&!b.disabled),label));assert(await js(label=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===label&&!b.disabled);if(!b)return false;b.scrollIntoView({block:'center'});b.click();return true},label),'missing button '+label)};
  const capture=async name=>{await js(()=>document.fonts.ready.then(()=>true));await sleep(250);const shot=await win.webContents.capturePage();assert(!shot.isEmpty(),'empty screenshot');fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG())};
  const settings=()=>js(()=>window.resumeDesktop.ai.getSettings());
  const safeView=v=>v.apiKey===''&&!JSON.stringify(v).includes(key)&&!JSON.stringify(v).includes('encryptedApiKey');
  const request=(v,requestId=crypto.randomUUID())=>({requestId,profile:{profileId:v.profileId,revision:v.revision,baseUrl:v.baseUrl,model:v.model},systemPrompt:'Synthetic local check',userPrompt:'Synthetic data only',temperature:0,maxTokens:64,timeoutMs:1000});
  const outcome=r=>js(r=>window.resumeDesktop.ai.requestCompletionOutcome(r),r);
  const refusal=async r=>assert(await js(r=>window.resumeDesktop.ai.requestCompletionOutcome(r).then(()=>false,()=>true),r),'invalid request not rejected');
  const ready=()=>js(()=>!!document.querySelector('#basic-field-name'));
  await until('editor',ready);
  // Use real offline screens plus real native PDF output, without an enabled provider.
  async function offline(name){
    const count=report.calls.length;
    await click('诊断优化');await click('JD 雷达');
    await until('offline JD input',()=>js(()=>!!document.querySelector('textarea[placeholder^="例如：招聘高中物理教师"]')));
    assert(await js(()=>{const e=document.querySelector('textarea[placeholder^="例如：招聘高中物理教师"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'合成物理教师招聘，须具备实验教学能力。');e.dispatchEvent(new Event('input',{bubbles:true}));return true}),'offline input unavailable');
    await until('offline JD value',()=>js(()=>document.querySelector('textarea[placeholder^="例如：招聘高中物理教师"]')?.value.includes('实验教学')));
    await capture(name+'-offline-jd');
    const doc=await main.store.getResume('runner-fixture');
    const pdf=await js(doc=>window.resumeDesktop.pdf.export({slug:'runner-fixture',document:doc,saveAs:false}),doc);
    assert(pdf.filePath&&fs.readFileSync(pdf.filePath).subarray(0,5).toString()==='%PDF-','offline real PDF unavailable');
    report.observations[name+'PdfBytes']=fs.statSync(pdf.filePath).size;
    assert(report.calls.length===count&&report.externalAttempts===0&&report.rendererNetwork===0,'offline network attempt');preserve();
  }
  if(phase==='main'){
    const initial=await settings();assert(!initial.enabled&&!initial.hasApiKey&&safeView(initial)&&!fs.existsSync(cfg),'fresh settings wrote or exposed a credential');
    await refusal(request(initial));
    await offline('no-key');report.checks.freshOfflineAndDisabledRequest=true;
    const v=await js(v=>window.resumeDesktop.ai.saveSettings(v),{...initial,enabled:true,baseUrl:origin+'/v1',model,providerLabel:'合成本地接口',apiKey:key,deepseekThinking:'provider-default',timeoutMs:1000,maxOutputTokens:64});
    assert(safeView(v)&&v.hasApiKey&&v.enabled,'saved public view exposed credential');
    const catalog=fs.readFileSync(cfg),stored=JSON.parse(catalog).profiles[0];
    assert(!catalog.includes(key)&&stored.encryptedApiKey&&safeStorage.decryptString(Buffer.from(stored.encryptedApiKey,'base64'))===key,'actual OS credential encryption failed');
    report.checks.actualOsEncryptionAndPublicMask=true;
    win.webContents.reload();await until('editor reload',ready);await click('诊断优化');await click('AI 润色 Diff');await until('enabled model UI',()=>has('已启用 · 修改'));
    await click('已启用 · 修改');await capture('encrypted-profile');
    const success=await outcome(request(v));
    assert(success.ok&&success.result.text==='OK'&&success.result.receipt.reportedModel==='synthetic-reported-model'&&success.result.receipt.totalTokens===9&&success.result.receipt.cachedInputTokens===3,'actual loopback receipt mismatch');
    report.checks.realHttpSuccessReceipt=true;
    mode='http';const httpFail=await outcome(request(v));
    assert(!httpFail.ok&&httpFail.error.code==='HTTP'&&httpFail.error.message.includes('429')&&!JSON.stringify(httpFail).includes(key)&&!JSON.stringify(httpFail).includes(hidden),'HTTP body leaked or wrong classification');
    report.checks.realHttpFailureSanitized=true;
    mode='redirect';const redirect=await outcome(request(v));
    assert(!redirect.ok&&redirect.error.code==='NETWORK'&&report.redirectHits===0,'redirect reached unapproved route');
    report.checks.actualRedirectNotFollowed=true;
    mode='hold';let count=report.calls.length;const start=Date.now(),timed=await outcome(request(v)),elapsed=Date.now()-start;
    assert(!timed.ok&&timed.error.code==='TIMEOUT'&&elapsed>=900&&elapsed<8000&&report.calls.length===count+1,'actual timeout incorrect');
    await until('timed socket closed',()=>report.calls.at(-1)?.closed);
    report.observations.timeoutElapsedMs=elapsed;report.checks.actualTimeoutNoRetry=true;
    count=report.calls.length;const r=request(v),pending=outcome(r);
    await until('cancel request received',()=>report.calls.length===count+1);
    await js(id=>window.resumeDesktop.ai.cancelCompletion(id),r.requestId);
    const canceled=await pending;assert(!canceled.ok&&canceled.error.code==='CANCELLED','actual cancellation wrong');
    await until('canceled socket closed',()=>report.calls.at(-1)?.closed);
    report.checks.actualCancellationNoRetry=true;
    mode='success';count=report.calls.length;
    const external=path.join(root,'synthetic-external-catalog.json');fs.linkSync(cfg,external);
    try{
      assert(await js(()=>window.resumeDesktop.ai.getSettings().then(()=>false,()=>true)),'linked catalog public read succeeded');
      await refusal(request(v));
      assert(await js(v=>window.resumeDesktop.ai.saveSettings(v).then(()=>false,()=>true),{...v,model:'must-not-write'}),'linked catalog save succeeded');
      assert(fs.lstatSync(cfg).nlink===2&&fs.readFileSync(cfg).equals(catalog)&&fs.readFileSync(external).equals(catalog)&&report.calls.length===count,'unsafe catalog read/write/network side effect');
      report.checks.linkedCatalogRejectedBeforeNetwork=true;
      await offline('linked-config');
      report.checks.unsafeConfigDoesNotBlockOffline=true;
    }finally{fs.unlinkSync(external);}
    assert((await settings()).revision===v.revision,'catalog not reusable after removing synthetic link');
    preserve();assert(report.calls.length===5&&report.redirectHits===0,'unexpected paid-style retry');
    fs.writeFileSync(expectation,JSON.stringify({port:server.address().port,catalogSha256:sha(catalog),sourceSha256:sha(originals[0]),masterSha256:sha(originals[1]),profileRevision:v.revision}));
  }else{
    const expected=JSON.parse(fs.readFileSync(expectation,'utf8')),v=await settings();
    assert(v.revision===expected.profileRevision&&safeView(v)&&v.hasApiKey&&v.enabled&&v.baseUrl===origin+'/v1','cold settings state mismatch');
    const result=await outcome(request(v));assert(result.ok&&result.result.text==='OK'&&report.calls.length===1,'cold restart credential unusable');
    report.checks.coldRestartActualCredential=true;
    const cleared=await js(v=>window.resumeDesktop.ai.saveSettings(v),{...v,enabled:false,clearApiKey:true});
    assert(!cleared.enabled&&!cleared.hasApiKey&&safeView(cleared)&&!fs.readFileSync(cfg,'utf8').includes('encryptedApiKey'),'credential not cleared');
    await refusal(request(cleared));await offline('cleared');
    assert(report.calls.length===1,'disabled config attempted network');report.checks.clearedCredentialOffline=true;
  }
  assert(!serverError&&report.externalAttempts===0&&report.rendererNetwork===0,'unexpected external or renderer network');preserve();
  report.checks.noExternalNetworkOrSourceChanges=true;output();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);server?.closeAllConnections?.();server?.close();app.exit(0)}).catch(e=>{clearTimeout(timer);report.error=safeError(e);output();server?.closeAllConnections?.();server?.close();app.exit(1)});
