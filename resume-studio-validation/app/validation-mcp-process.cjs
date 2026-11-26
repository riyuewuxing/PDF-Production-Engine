const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
const mcpBundle=process.env.RESUME_STUDIO_MCP_BUNDLE||path.join(__dirname,'dist-electron','mcp-server.cjs');
if(!root||!out||fs.existsSync(root))throw Error('fresh isolated synthetic directory required');
fs.mkdirSync(path.join(root,'resumes'),{recursive:true});fs.mkdirSync(out,{recursive:true});
const fixture=require('./runner-fixture.json'),manifest=require('./runner-manifest.json');
const masterPath=path.join(root,'master.json'),versionPath=path.join(root,'resumes','runner-fixture.json');
const master={...fixture,id:'mcp-synthetic-master',title:'合成母库 MCP'};
const version={...fixture,id:'mcp-synthetic-version',title:'合成岗位 MCP 中文😀'};
fs.writeFileSync(masterPath,JSON.stringify(master));fs.writeFileSync(versionPath,JSON.stringify(version));
const masterBytes=fs.readFileSync(masterPath),versionBytes=fs.readFileSync(versionPath);
const checks={},processes=[],children=new Set();
const globalTimer=setTimeout(()=>{for(const child of children)child.kill();console.error('MCP global watchdog');process.exit(2)},90000);
let serial=0;
const req=(method,params)=>({jsonrpc:'2.0',id:++serial,method,...(params?{params}:{})});
const call=(name,args)=>req('tools/call',{name,arguments:args});
const rev=doc=>JSON.stringify([doc.id,doc.updatedAt]);
const payload=r=>JSON.parse(r.result.content[0].text);
const success=r=>{assert.ok(r.result&&!r.result.isError,JSON.stringify(r));return payload(r);};
const denied=(r,code)=>{assert.equal(r.result.isError,true);assert.equal(payload(r).code,code);};
const encode=(r,mode='ndjson')=>{const b=Buffer.from(JSON.stringify(r),'utf8');return mode==='content-length'?Buffer.concat([Buffer.from('Content-Length: '+b.length+'\r\n\r\n'),b]):Buffer.concat([b,Buffer.from('\n')]);};
function decode(buffer){
  const result=[];
  while(buffer.length){
    if(buffer[0]===123){const n=buffer.indexOf(10);assert.ok(n>=0,'truncated NDJSON');result.push({mode:'ndjson',message:JSON.parse(buffer.subarray(0,n).toString('utf8'))});buffer=buffer.subarray(n+1);}
    else{const n=buffer.indexOf('\r\n\r\n');assert.ok(n>=0,'invalid Content-Length header');const m=/^Content-Length: (\d+)$/.exec(buffer.subarray(0,n).toString('ascii'));assert.ok(m);const end=n+4+Number(m[1]);assert.ok(end<=buffer.length,'truncated UTF-8 content length');result.push({mode:'content-length',message:JSON.parse(buffer.subarray(n+4,end).toString('utf8'))});buffer=buffer.subarray(end);}
  }
  return result;
}
async function exchange(frames,policy={},fragment=false){
  const env={...process.env,RESUME_STUDIO_DATA_DIR:root,RESUME_STUDIO_MCP_ALLOW_WRITE:policy.write?'1':'0',RESUME_STUDIO_MCP_ALLOW_MASTER_WRITE:policy.master?'1':'0'};
  const child=spawn(process.execPath,[mcpBundle],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  children.add(child);let stdout=[],stderr=[],bytes=0;
  const done=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('MCP subprocess watchdog'))},12000);
    child.on('error',e=>{clearTimeout(timer);reject(e)});
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>5*1024*1024){child.kill();reject(Error('stdout bound'));}else stdout.push(b)});
    child.stderr.on('data',b=>stderr.push(b));
    child.on('close',(code,signal)=>{clearTimeout(timer);children.delete(child);try{assert.equal(code,0,Buffer.concat(stderr).toString('utf8'));assert.equal(signal,null);const decoded=decode(Buffer.concat(stdout));processes.push({pid:child.pid,policy,replyCount:decoded.length,exitCode:code,stderrBytes:Buffer.concat(stderr).length});resolve(decoded);}catch(e){reject(e)}});
    child.stdin.on('error',e=>{clearTimeout(timer);reject(e)});
  });
  const input=Buffer.concat(frames);
  if(fragment){
    const marker=Buffer.from('中文😀'),i=input.indexOf(marker);
    assert.ok(i>0,'Unicode test marker absent');
    for(const chunk of [input.subarray(0,7),input.subarray(7,i+1),input.subarray(i+1,i+7),input.subarray(i+7)]){child.stdin.write(chunk);await new Promise(r=>setTimeout(r,8));}
    child.stdin.end();
  }else child.stdin.end(input);
  return done;
}
const readVersion=()=>JSON.parse(fs.readFileSync(versionPath,'utf8'));
const snapDir=path.join(root,'.backups','runner-fixture');
const snapshots=()=>fs.existsSync(snapDir)?fs.readdirSync(snapDir).filter(n=>n.endsWith('.json')):[];
async function run(){
  const init=req('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'synthetic-stdio-client',version:'1'}});
  const list=req('tools/list'),listResumes=call('list_resumes',{}),get=call('get_resume',{slug:'runner-fixture'});
  const jd=call('match_jd',{slug:'runner-fixture',jdText:'中文😀 实验教学 科学教育'});
  const diag=call('diagnose_resume',{slug:'runner-fixture'}),questions=call('generate_interview_questions',{slug:'runner-fixture',targetRole:'合成教学助理'});
  const ping=req('ping'),unknown=req('unknown_synthetic_method');
  const replies=await exchange([encode(init,'content-length'),encode({jsonrpc:'2.0',method:'notifications/initialized'}),encode(list),encode(listResumes),encode(get,'content-length'),encode(jd,'content-length'),encode(diag),encode(questions),Buffer.from('{bad}\n'),encode(ping),encode(unknown)],{},true);
  const byId=id=>replies.find(r=>r.message.id===id);
  assert.equal(replies.length,10);assert.equal(byId(init.id).mode,'content-length');assert.equal(byId(init.id).message.result.protocolVersion,'2024-11-05');
  assert.equal(byId(list.id).message.result.tools.length,6);
  assert.equal(success(byId(listResumes.id).message).master.slug,'master');
  const original=success(byId(get.id).message);assert.equal(original.title,version.title);
  assert.equal(byId(jd.id).mode,'content-length');assert.ok(success(byId(jd.id).message).match.totalKeywords>0);
  assert.equal(typeof success(byId(diag.id).message).report.score,'number');
  assert.ok(success(byId(questions.id).message).questions.length>=8);
  assert.equal(byId(null).message.error.code,-32700);assert.deepEqual(byId(ping.id).message.result,{});
  assert.equal(byId(unknown.id).message.error.code,-32601);
  checks.realStdioBothFramings=true;checks.fragmentedUtf8AndNotification=true;checks.allSixToolsDiscoveredAndReadPaths=true;checks.malformedFrameRecovery=true;
  const upsert=(slug,document,expectedRevision,extra={})=>call('upsert_resume_version',{slug,document,expectedRevision,...extra});
  const changed={...original,title:'合成授权写入 MCP'};
  const attempted=await exchange([encode(upsert('runner-fixture',changed,rev(original),{allowMasterWrite:true})),encode(upsert('master',master,rev(master),{allowMasterWrite:true}))]);
  attempted.forEach(r=>denied(r.message,'MCP_WRITE_DISABLED'));
  assert.ok(fs.readFileSync(versionPath).equals(versionBytes));assert.ok(fs.readFileSync(masterPath).equals(masterBytes));assert.equal(snapshots().length,0);
  checks.defaultReadOnlyBytesUnchanged=true;
  const guard=await exchange([encode(upsert('master',master,rev(master),{allowMasterWrite:true})),encode(upsert('../escape',changed,null)),encode(upsert('runner-fixture',{},rev(original))),encode(call('upsert_resume_version',{slug:'runner-fixture',document:changed}))],{write:true});
  ['MASTER_WRITE_PROTECTED','INVALID_SLUG','SCHEMA_VALIDATION_ERROR','REVISION_REQUIRED'].forEach((code,i)=>denied(guard[i].message,code));
  assert.ok(fs.readFileSync(versionPath).equals(versionBytes));assert.ok(fs.readFileSync(masterPath).equals(masterBytes));assert.equal(snapshots().length,0);
  checks.localWritePolicyAndMasterGuard=true;checks.invalidSchemaSlugAndMissingRevisionRejected=true;
  const write=await exchange([encode(upsert('runner-fixture',changed,rev(original),{reason:'合成覆盖前快照'}),'content-length')],{write:true});
  const saved=success(write[0].message);assert.equal(saved.existedBefore,true);assert.ok(saved.snapshotCreatedId);
  const current=readVersion();assert.equal(current.title,changed.title);assert.notEqual(current.updatedAt,original.updatedAt);
  const snap=JSON.parse(fs.readFileSync(path.join(snapDir,saved.snapshotCreatedId+'.json'),'utf8'));assert.deepEqual(snap.document,original);assert.equal(snap.meta.reason,'合成覆盖前快照');
  checks.authorizedUpdateAndRealPrewriteSnapshot=true;
  const before=fs.readFileSync(versionPath);
  const stale=await exchange([encode(upsert('runner-fixture',original,rev(original)))],{write:true});denied(stale[0].message,'REVISION_CONFLICT');assert.ok(fs.readFileSync(versionPath).equals(before));assert.equal(snapshots().length,1);
  checks.staleCrossProcessWriteRejected=true;
  const race=await Promise.all(['A','B'].map(label=>exchange([encode(upsert('runner-fixture',{...current,title:'合成并发 '+label},rev(current),{reason:'race-'+label}))],{write:true})));
  const ok=race.filter(r=>!r[0].message.result.isError),bad=race.filter(r=>r[0].message.result.isError);
  assert.equal(ok.length,1);assert.equal(bad.length,1);denied(bad[0][0].message,'REVISION_CONFLICT');
  const winner=success(ok[0][0].message);assert.equal(readVersion().title,winner.title);assert.equal(snapshots().length,2);
  const raceSnap=JSON.parse(fs.readFileSync(path.join(snapDir,winner.snapshotCreatedId+'.json'),'utf8'));assert.deepEqual(raceSnap.document,current);
  checks.concurrentProcessesExactlyOneWriter=true;
  const created=await exchange([encode(upsert('new-synthetic',{...original,id:'mcp-new-synthetic',title:'新建合成版本'},null))],{write:true});assert.equal(success(created[0].message).existedBefore,false);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'resumes','new-synthetic.json'),'utf8')).title,'新建合成版本');
  checks.explicitNullCreatesNewVersion=true;
  assert.ok(fs.readFileSync(masterPath).equals(masterBytes));checks.masterBytesAlwaysUnchanged=true;
  fs.writeFileSync(path.join(out,'mcp-process-evidence.json'),JSON.stringify({sourceSha:manifest.sourceSha,runnerSha:process.env.GITHUB_SHA,platform:process.platform,node:process.version,bundleSha256:crypto.createHash('sha256').update(fs.readFileSync(mcpBundle)).digest('hex'),checks,processes},null,2));
}
run().then(()=>{clearTimeout(globalTimer);console.log('MCP real subprocess checks',Object.keys(checks).length);}).catch(e=>{clearTimeout(globalTimer);for(const child of children)child.kill();console.error(e);fs.writeFileSync(path.join(out,'mcp-process-failure.json'),JSON.stringify({checks,processes,error:String(e)},null,2));process.exitCode=1;});
