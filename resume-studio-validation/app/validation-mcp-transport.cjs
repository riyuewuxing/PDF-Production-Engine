const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const fixture=require('./runner-fixture.json');
const mode=process.argv[2],out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!['baseline','candidate'].includes(mode)||!out||!process.env.RUNNER_TEMP)throw Error('isolated runner required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'synthetic-mcp-transport-'));
const bundle=path.join(__dirname,'dist-electron','mcp-server.cjs');
const digest=b=>createHash('sha256').update(b).digest('hex');
const MAX=16*1024*1024;
const checks={},observations={},processes=[],children=new Set();
const globalTimer=setTimeout(()=>{for(const c of children)c.kill();console.error('transport global watchdog');process.exit(2)},115000);
let sequence=0;
const report=error=>fs.writeFileSync(path.join(out,mode+'-transport.json'),JSON.stringify({mode,platform:process.platform,node:process.version,privateBaseSha:'74a017a7760ed5c60fe77aa5877ee8a88d5cba3d',runnerSha:process.env.GITHUB_SHA,bundleSha256:digest(fs.readFileSync(bundle)),checks,observations,processes,...(error?{error:String(error)}:{})},null,2));
function seed(label,large=false){
  const folder=path.join(root,label);
  fs.mkdirSync(path.join(folder,'resumes'),{recursive:true});
  const doc={...fixture,id:'synthetic-mcp-'+label,title:'合成传输原稿',...(large?{skillContent:'合成文本😀'.repeat(120000)}:{})};
  const file=path.join(folder,'resumes','synthetic.json'),master=path.join(folder,'master.json');
  fs.writeFileSync(file,JSON.stringify(doc));fs.writeFileSync(master,JSON.stringify({...fixture,id:'synthetic-master-'+label,title:'合成母库'}));
  return {folder,file,master,doc,bytes:fs.readFileSync(file),masterBytes:fs.readFileSync(master)};
}
const req=(method,params)=>({jsonrpc:'2.0',id:++sequence,method,...(params?{params}:{})});
const call=(name,args)=>req('tools/call',{name,arguments:args});
const upsert=(s,title='合成不得执行的变更')=>call('upsert_resume_version',{slug:'synthetic',document:{...s.doc,title},expectedRevision:JSON.stringify([s.doc.id,s.doc.updatedAt])});
const body=r=>Buffer.from(JSON.stringify(r),'utf8');
const line=r=>Buffer.concat([body(r),Buffer.from('\n')]);
const frame=(b,header)=>Buffer.concat([Buffer.from(header??('Content-Length: '+b.length+'\r\n\r\n')),b]);
function decode(buf){
  const values=[];
  while(buf.length){
    if(buf[0]===123){
      const n=buf.indexOf(10);assert.ok(n>=0,'truncated NDJSON response');
      values.push({mode:'ndjson',message:JSON.parse(buf.subarray(0,n).toString('utf8'))});
      buf=buf.subarray(n+1);
    }else{
      const n=buf.indexOf('\r\n\r\n');assert.ok(n>=0,'truncated output header');
      const m=/^Content-Length: (\d+)$/.exec(buf.subarray(0,n).toString('ascii'));assert.ok(m,'invalid output header');
      const end=n+4+Number(m[1]);assert.ok(end<=buf.length,'truncated Content-Length response');
      values.push({mode:'content-length',message:JSON.parse(buf.subarray(n+4,end).toString('utf8'))});buf=buf.subarray(end);
    }
  }
  return values;
}
const payload=r=>JSON.parse(r.result.content[0].text);
function unchanged(s){
  return fs.readFileSync(s.file).equals(s.bytes)&&fs.readFileSync(s.master).equals(s.masterBytes)&&!fs.existsSync(path.join(s.folder,'.backups','synthetic'));
}
async function exchange(s,input,{delayRead=0,closeOutput=false,fragments=false,write=true}={}){
  const child=spawn(process.execPath,[bundle],{env:{...process.env,RESUME_STUDIO_DATA_DIR:s.folder,RESUME_STUDIO_MCP_ALLOW_WRITE:write?'1':'0',RESUME_STUDIO_MCP_ALLOW_MASTER_WRITE:'0'},stdio:['pipe','pipe','pipe'],windowsHide:true});
  children.add(child);let stdout=[],stderr=[],stdoutBytes=0,stderrBytes=0,inputError=null,readerTimer;
  const done=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('subprocess watchdog for '+path.basename(s.folder)))},15000);
    child.on('error',e=>{clearTimeout(timer);reject(e)});
    const attach=()=>child.stdout.on('data',b=>{stdoutBytes+=b.length;if(stdoutBytes>32*1024*1024){child.kill();reject(Error('stdout bound'));}else stdout.push(b)});
    if(closeOutput)child.stdout.destroy();else if(delayRead)readerTimer=setTimeout(attach,delayRead);else attach();
    child.stderr.on('data',b=>{stderrBytes+=b.length;if(stderrBytes<32768)stderr.push(b)});
    child.stdin.on('error',e=>{inputError=e.code??e.message});
    child.on('close',(code,signal)=>{
      clearTimeout(timer);clearTimeout(readerTimer);children.delete(child);
      const bytes=Buffer.concat(stdout),err=Buffer.concat(stderr).toString('utf8');let replies=[],decodeError=null;
      try{replies=decode(bytes)}catch(e){decodeError=String(e)}
      const detail={label:path.basename(s.folder),pid:child.pid,code,signal,stdoutBytes,stderrBytes,replyCount:replies.length,decodeError,inputError,stderr:err.slice(0,300)};
      processes.push(detail);resolve({...detail,replies});
    });
  });
  if(fragments){
    // Split headers, multibyte characters and frame boundaries.
    const marker=Buffer.from('中文😀'),i=input.indexOf(marker);assert.ok(i>9);
    const cuts=[1,7,i+1,i+5,i+8,input.length];let prev=0;
    for(const end of cuts){child.stdin.write(input.subarray(prev,end));prev=end;await new Promise(r=>setTimeout(r,5));}
    child.stdin.end();
  }else child.stdin.end(input);
  return done;
}
const messages=r=>r.replies.map(x=>x.message);
const clean=r=>{assert.equal(r.signal,null);assert.equal(r.decodeError,null);};
async function badHeader(label,make){
  const s=seed(label),b=body(upsert(s));
  const r=await exchange(s,make(b));clean(r);
  const preserved=unchanged(s);observations[label]={preserved,exit:r.code,replyCount:r.replyCount};
  if(mode==='baseline'){
    assert.equal(r.code,0);assert.equal(preserved,false,'baseline did not reproduce unintended write: '+label);
    assert.equal(JSON.parse(fs.readFileSync(s.file)).title,'合成不得执行的变更');
    assert.equal(fs.readFileSync(s.master).equals(s.masterBytes),true);
  }else{
    assert.equal(r.code,1);assert.equal(r.replyCount,0);assert.equal(preserved,true,'invalid framing modified data: '+label);
  }
  checks[label]=true;
}
async function invalidUtf8(label,framing){
  const s=seed(label),b=body(upsert(s,'UTF8_SENTINEL')),i=b.indexOf(Buffer.from('UTF8_SENTINEL'));assert.ok(i>0);b[i]=0xff;
  const ping=req('ping');
  const first=framing==='ndjson'?Buffer.concat([b,Buffer.from('\n')]):frame(b);
  const r=await exchange(s,Buffer.concat([first,line(ping)]));clean(r);assert.equal(r.code,0);
  const m=messages(r);assert.equal(m.length,2);assert.equal(m[1].id,ping.id);assert.deepEqual(m[1].result,{});
  const preserved=unchanged(s);observations[label]={preserved,firstCode:m[0].error?.code??null};
  if(mode==='baseline'){assert.equal(preserved,false);assert.ok(JSON.parse(fs.readFileSync(s.file)).title.includes('\ufffd'));}
  else{assert.equal(preserved,true);assert.equal(m[0].error.code,-32700);assert.equal(m[0].id,null);assert.equal(r.replies[0].mode,framing);}
  checks[label]=true;
}
async function incomplete(label,raw){
  const s=seed(label),ping=req('ping'),r=await exchange(s,Buffer.concat([line(ping),raw]));clean(r);
  assert.equal(r.replyCount,1);assert.equal(messages(r)[0].id,ping.id);assert.ok(unchanged(s));
  assert.equal(r.code,mode==='baseline'?0:1);observations[label]={exit:r.code,precedingReplyPreserved:true};checks[label]=true;
}
async function run(){
  await badHeader('duplicateLength',b=>frame(b,'Content-Length: '+b.length+'\r\nContent-Length: 1\r\n\r\n'));
  await badHeader('lengthSuffix',b=>frame(b,'Content-Length: '+b.length+'junk\r\n\r\n'));
  await badHeader('lookalikeLengthHeader',b=>frame(b,'X-Content-Length: '+b.length+'\r\n\r\n'));
  await badHeader('missingLengthBodyFallback',b=>Buffer.concat([Buffer.from('X-Invalid: true\r\n\r\n'),b,Buffer.from('\n')]));
  await badHeader('zeroLengthBodyFallback',b=>Buffer.concat([Buffer.from('Content-Length: 0\r\n\r\n'),b,Buffer.from('\n')]));
  await badHeader('oversizedHeader',b=>frame(b,'X-Pad: '+('x'.repeat(8193))+'\r\nContent-Length: '+b.length+'\r\n\r\n'));
  await invalidUtf8('invalidUtf8Ndjson','ndjson');await invalidUtf8('invalidUtf8ContentLength','content-length');
  await incomplete('truncatedHeader',Buffer.from('Content-Length: 2'));
  await incomplete('truncatedBody',Buffer.from('Content-Length: 999\r\n\r\n{}'));
  await incomplete('oversizedDeclaration',Buffer.from('Content-Length: '+(MAX+1)+'\r\n\r\n'));
  const s=seed('validMixed');
  const p1=req('ping'),p2=call('get_resume',{slug:'synthetic'}),p3=call('match_jd',{slug:'synthetic',jdText:'中文😀 物理实验'}),p4=req('ping');
  const p3b=body(p3);
  const r=await exchange(s,Buffer.concat([frame(body(p1)),line(p2),frame(p3b,'Content-Type: application/json\ncontent-length: '+p3b.length+'\n\n'),Buffer.from('{bad}\n'),body(p4)]),{fragments:true,write:false});
  clean(r);assert.equal(r.code,0);assert.equal(r.replyCount,5);const m=messages(r);
  assert.deepEqual(m[0].result,{});assert.equal(r.replies[0].mode,'content-length');assert.equal(payload(m[1]).title,s.doc.title);assert.equal(m[2].id,p3.id);assert.ok(payload(m[2]).match.totalKeywords>0);assert.equal(m[3].error.code,-32700);assert.equal(m[4].id,p4.id);assert.ok(unchanged(s));
  checks.validMixedFramingUtf8AndUnterminatedLine=true;
  const large=seed('largeEof',true);
  const reads=[call('get_resume',{slug:'synthetic'}),call('get_resume',{slug:'synthetic'}),call('get_resume',{slug:'synthetic'})];
  const long=await exchange(large,Buffer.concat(reads.map((x,i)=>i===1?frame(body(x)):line(x))),{delayRead:400,write:false});
  const complete=long.code===0&&!long.decodeError&&long.replyCount===3&&messages(long).every((x,i)=>x.id===reads[i].id&&payload(x).skillContent===large.doc.skillContent);
  observations.largeEof={complete,exit:long.code,bytes:long.stdoutBytes,replyCount:long.replyCount,decodeError:long.decodeError};
  assert.ok(unchanged(large));
  if(mode==='candidate')assert.equal(complete,true,'large responses lost at EOF');
  else if(process.platform!=='win32')assert.equal(complete,false,'POSIX baseline EOF loss not reproduced');
  checks.largeEofObserved=true;
  if(mode==='candidate'){
    const huge=seed('frameSize');
    const p=req('ping',{padding:''});const base=body(p).length;
    p.params.padding='x'.repeat(MAX-base);
    const exact=body(p);assert.equal(exact.length,MAX);
    const pass=await exchange(huge,Buffer.concat([exact,Buffer.from('\n')]));clean(pass);assert.equal(pass.code,0);assert.equal(messages(pass)[0].id,p.id);
    p.params.padding+='x';const over=await exchange(huge,Buffer.concat([body(p),Buffer.from('\n')]));clean(over);assert.equal(over.code,1);assert.equal(over.replyCount,0);assert.ok(unchanged(huge));
    checks.ndjsonExactLimitAcceptedAndOverLimitRefused=true;
    const h=seed('lengthFrameSize');
    const good=await exchange(h,frame(exact));clean(good);assert.equal(good.code,0);assert.equal(messages(good)[0].id,p.id);
    checks.contentLengthExactLimitAccepted=true;
    const burst=seed('burst');const requests=Array.from({length:128},()=>req('ping'));
    const br=await exchange(burst,Buffer.concat(requests.map((x,i)=>i%2?frame(body(x)):line(x))),{delayRead:100});
    clean(br);assert.equal(br.code,0);assert.deepEqual(messages(br).map(x=>x.id),requests.map(x=>x.id));assert.ok(unchanged(burst));checks.orderedBurstBackpressure=true;
    const disconnected=seed('closedOutput',true);
    const broken=await exchange(disconnected,Buffer.concat([line(call('get_resume',{slug:'synthetic'})),line(upsert(disconnected))]),{closeOutput:true});
    assert.equal(broken.code,1);assert.ok(unchanged(disconnected),'request after failed output was executed');
    checks.closedOutputStopsLaterWrites=true;
    const damaged=seed('damagedList');const brokenFile=path.join(damaged.folder,'resumes','broken.json');fs.writeFileSync(brokenFile,'{broken');
    const d=await exchange(damaged,Buffer.concat([line(call('list_resumes',{})),line(call('get_resume',{slug:'broken'})),line(call('upsert_resume_version',{slug:'broken',document:damaged.doc,expectedRevision:null}))]));
    clean(d);assert.equal(d.code,0);const dm=messages(d);assert.equal(payload(dm[0]).resumes[0].slug,'synthetic');assert.deepEqual(payload(dm[0]).issues,[{slug:'broken',reason:'CORRUPTED_JSON'}]);
    assert.equal(dm[1].result.isError,true);assert.equal(dm[2].result.isError,true);assert.equal(fs.readFileSync(brokenFile,'utf8'),'{broken');assert.ok(unchanged(damaged));checks.damagedListingAndWriteRefusalPreserved=true;
  }
  report();
}
run().then(()=>{clearTimeout(globalTimer);fs.rmSync(root,{recursive:true,force:true});console.log(mode,process.platform,Object.keys(checks).length,'checks');}).catch(e=>{clearTimeout(globalTimer);for(const c of children)c.kill();report(e);console.error(e);process.exitCode=1;});
