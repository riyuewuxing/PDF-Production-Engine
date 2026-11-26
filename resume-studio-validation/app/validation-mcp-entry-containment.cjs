const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const fixture=require('./runner-fixture.json');
const out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!out||!process.env.RUNNER_TEMP)throw Error('isolated runner required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'synthetic-mcp-entry-containment-'));
const checks={},observations={},processes=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
const bundle=path.join(__dirname,'dist-electron','mcp-server.cjs');
let serial=0,junction=null;
const call=(name,args)=>({jsonrpc:'2.0',id:++serial,method:'tools/call',params:{name,arguments:args}});
const rev=doc=>JSON.stringify([doc.id,doc.updatedAt]);
const payload=r=>JSON.parse(r.result.content[0].text);
const success=r=>{assert.ok(r.result&&!r.result.isError,JSON.stringify(r));return payload(r);};
const denied=(r,code)=>{assert.equal(r.result.isError,true);assert.equal(payload(r).code,code);};
const report=error=>fs.writeFileSync(path.join(out,'mcp-entry-containment-evidence.json'),JSON.stringify({privateBaseSha:'78d2264811a14a6ff8522235b422ccbffcec2126',runnerSha:process.env.GITHUB_SHA,platform:process.platform,bundleSha256:hash(fs.readFileSync(bundle)),checks,observations,processes,...(error?{error:String(error)}:{})},null,2));
function exchange(data,requests,write=false,master=false){
  const result=spawnSync(process.execPath,[bundle],{env:{...process.env,RESUME_STUDIO_DATA_DIR:data,RESUME_STUDIO_MCP_ALLOW_WRITE:write?'1':'0',RESUME_STUDIO_MCP_ALLOW_MASTER_WRITE:master?'1':'0'},input:requests.map(r=>JSON.stringify(r)).join('\n')+'\n',encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024,windowsHide:true});
  if(result.error)throw result.error;
  assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);
  const responses=result.stdout.trim().split('\n').map(l=>JSON.parse(l));assert.deepEqual(responses.map(x=>x.id),requests.map(x=>x.id));
  processes.push({pid:result.pid,replyCount:responses.length,write,master,exitCode:result.status});return responses;
}
function seed(label){
  const data=path.join(root,label,'data'),outside=path.join(root,label,'outside');fs.mkdirSync(path.join(data,'resumes'),{recursive:true});fs.mkdirSync(outside);return{data,outside};
}
function put(file,doc){const bytes=Buffer.from(JSON.stringify(doc));fs.writeFileSync(file,bytes);return bytes;}
try{
  const s=seed('hardlinks'),external=path.join(s.outside,'external.json');
  const outsideDoc={...fixture,id:'synthetic-external-mcp',title:'Synthetic external MCP document'};
  const healthy={...fixture,id:'synthetic-healthy-mcp',title:'合成正常 MCP'};
  const original=put(external,outsideDoc),target=path.join(s.data,'resumes','linked.json'),master=path.join(s.data,'master.json');
  fs.linkSync(external,target);fs.linkSync(external,master);
  const goodPath=path.join(s.data,'resumes','healthy.json');put(goodPath,healthy);
  const r=exchange(s.data,[call('list_resumes',{}),call('get_resume',{slug:'linked'}),call('get_resume',{slug:'master'}),call('get_resume',{slug:'healthy'})]);
  const list=success(r[0]);assert.equal(list.master,null);assert.deepEqual(list.resumes.map(x=>x.slug),['healthy']);assert.deepEqual(list.issues,[{slug:'linked',reason:'UNSAFE_ENTRY'},{slug:'master',reason:'UNSAFE_ENTRY'}]);denied(r[1],'UNSAFE_ENTRY');denied(r[2],'UNSAFE_ENTRY');const current=success(r[3]);assert.equal(current.id,healthy.id);
  checks.readOnlyListsOnlyOrdinaryDocuments=true;
  const w=exchange(s.data,[call('upsert_resume_version',{slug:'linked',document:{...outsideDoc,title:'Must not replace link'},expectedRevision:rev(outsideDoc)}),call('upsert_resume_version',{slug:'master',document:{...outsideDoc,title:'Must not replace master link'},expectedRevision:rev(outsideDoc),allowMasterWrite:true}),call('upsert_resume_version',{slug:'healthy',document:{...current,title:'合成正常授权保存'},expectedRevision:rev(current)})],true,true);
  denied(w[0],'UNSAFE_ENTRY');denied(w[1],'UNSAFE_ENTRY');const saved=success(w[2]);assert.ok(saved.snapshotCreatedId);assert.equal(JSON.parse(fs.readFileSync(goodPath,'utf8')).title,'合成正常授权保存');
  assert.ok(fs.readFileSync(external).equals(original));assert.equal(fs.statSync(external).nlink,3);assert.equal(fs.statSync(target).ino,fs.statSync(external).ino);assert.equal(fs.statSync(master).ino,fs.statSync(external).ino);
  checks.authorizedWritesRefuseLinksAndKeepOrdinaryWriteWorking=true;
  const t=seed('redirected'),outside=path.join(t.outside,'outside.json');const bytes=put(outside,outsideDoc);
  junction=path.join(t.data,'resumes');fs.rmdirSync(junction);fs.symlinkSync(t.outside,junction,process.platform==='win32'?'junction':'dir');
  const rr=exchange(t.data,[call('list_resumes',{}),call('get_resume',{slug:'outside'}),call('upsert_resume_version',{slug:'new-version',document:healthy,expectedRevision:null})],true,false);
  for(const reply of rr)denied(reply,'UNSAFE_DIRECTORY');
  assert.deepEqual(fs.readdirSync(t.outside),['outside.json']);assert.ok(fs.readFileSync(outside).equals(bytes));assert.ok(!fs.existsSync(path.join(t.data,'master.json')));
  checks.redirectedDirectoryNeverReadOrWritten=true;
  if(process.platform==='win32')fs.rmdirSync(junction);else fs.unlinkSync(junction);junction=null;
  assert.ok(fs.readFileSync(outside).equals(bytes));checks.nonRecursiveCleanupPreservesExternalSentinel=true;
  observations.originalSha256=hash(original);observations.redirectedSha256=hash(bytes);report();
}catch(error){report(error);console.error(error);process.exitCode=1;}
finally{if(junction){try{if(process.platform==='win32')fs.rmdirSync(junction);else fs.unlinkSync(junction);}catch{process.exitCode=1;}}if(!junction)fs.rmSync(root,{recursive:true,force:true});}
