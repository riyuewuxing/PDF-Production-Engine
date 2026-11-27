import {AiSettingsStore,type CredentialCodec} from './electron/aiSettingsStore';
import {withResumeWriteLock} from './src/server/localFsApi';
import {promises as fs} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!root||!out||!path.basename(root).startsWith('synthetic-t47-process-'))throw Error('isolated process gate required');
const file=path.join(root,'catalog.json'),key='synthetic-process-key',secondKey='synthetic-second-process-key';
const codec:CredentialCodec={available:()=>true,encrypt:value=>Buffer.from(Buffer.from(value).map(b=>b^0xa5)),decrypt:bytes=>Buffer.from(bytes.map(b=>b^0xa5)).toString('utf8')};
const store=new AiSettingsStore(file,codec);
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const settings={enabled:true,providerLabel:'Synthetic process',baseUrl:'https://example.invalid/v1',model:'synthetic-model',deepseekThinking:'provider-default'};
const argv=process.argv.slice(2);
if(argv[0]==='worker'){
  // Worker receives only public metadata plus a synthetic test credential.
  const args=JSON.parse(argv[2]??'{}');
  void (async()=>{
    try{
      const v=argv[1]==='read'?await store.getPublicSettings():await store.save(args);
      process.stdout.write(JSON.stringify({ok:true,value:v,pid:process.pid}));
    }catch(e){process.stdout.write(JSON.stringify({ok:false,message:e instanceof Error?e.message:'error',code:(e as {code?:string})?.code,pid:process.pid}));}
  })().catch(()=>{process.exitCode=1});
}else{
  const report:{runnerSha?:string;platform:string;checks:Record<string,boolean>;observations:Record<string,unknown>;error?:string}={runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks:{},observations:{}};
  const children=new Set<ReturnType<typeof spawn>>();
  const watchdog=setTimeout(()=>{for(const c of children)c.kill();process.exit(2)},65000);
  const invoke=(op:string,args:unknown={})=>new Promise<{ok:boolean;value:any;message?:string;code?:string;pid:number}>((resolve,reject)=>{
    const child=spawn(process.execPath,[__filename,'worker',op,JSON.stringify(args)],{env:process.env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    children.add(child);let stdout='',stderr='';
    const t=setTimeout(()=>{child.kill();reject(Error('child watchdog'))},12000);
    child.on('error',e=>{clearTimeout(t);reject(e)});
    child.stdout!.on('data',b=>{stdout+=b;if(stdout.length>100000){child.kill();reject(Error('stdout limit'));}});
    child.stderr!.on('data',b=>{stderr+=b;if(stderr.length>100000){child.kill();reject(Error('stderr limit'));}});
    child.on('close',code=>{clearTimeout(t);children.delete(child);try{assert.equal(code,0);assert.equal(stderr,'');assert(!stdout.includes(key)&&!stdout.includes(secondKey)&&!stdout.includes('encryptedApiKey'),'secret in public child response');resolve(JSON.parse(stdout));}catch(e){reject(e)}});
  });
  async function run(){
    await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
    assert(!await fs.stat(file).then(()=>true,()=>false),'existing credential fixture');
    await fs.writeFile(file,JSON.stringify({...settings,apiKey:key}));
    const legacy=await Promise.all([invoke('read'),invoke('read')]);
    assert(legacy.every(x=>x.ok&&x.value.hasApiKey&&x.value.apiKey==='')&&legacy[0].pid!==legacy[1].pid);
    assert.equal(legacy[0].value.revision,legacy[1].value.revision);
    const migrated=await fs.readFile(file);assert(!migrated.includes(key)&&JSON.parse(migrated.toString()).schemaVersion===2);
    assert.equal((await store.getRequestSettings()).apiKey,key);
    report.checks.concurrentLegacyMigrationExactlyOneRevision=true;
    const old=legacy[0].value;
    const same=await Promise.all([invoke('save',{...old,model:'A'}),invoke('save',{...old,model:'B'})]);
    const winners=same.filter(x=>x.ok),losers=same.filter(x=>!x.ok);
    assert.equal(winners.length,1);assert.equal(losers.length,1);assert(losers[0].message?.includes('重新读取'));
    assert.deepEqual(await store.getPublicSettings(),winners[0].value);assert.equal((await store.getRequestSettings()).apiKey,key);
    report.checks.sameRevisionCrossProcessExactlyOneWinner=true;
    const first=winners[0].value,catalog=await store.create({providerLabel:'Second',baseUrl:'https://other.invalid/v1',model:'second'});
    const second=catalog.profiles.find(x=>x.profileId===catalog.activeProfileId)!;
    const distinct=await Promise.all([invoke('save',{...first,model:'first-new'}),invoke('save',{...second,enabled:true,model:'second-new',apiKey:secondKey})]);
    assert(distinct.every(x=>x.ok));const final=await store.getCatalog();
    for(const x of distinct)assert.deepEqual(final.profiles.find(p=>p.profileId===x.value.profileId),x.value);
    assert.equal((await store.getRequestSettings(first.profileId,distinct[0].value.revision)).apiKey,key);
    assert.equal((await store.getRequestSettings(second.profileId,distinct[1].value.revision)).apiKey,secondKey);
    report.checks.concurrentDifferentProfilesNoLostAcknowledgedUpdate=true;
    const before=await fs.readFile(file),start=Date.now();
    const busy=await withResumeWriteLock(root,()=>invoke('save',{...distinct[1].value,model:'must-not-publish'}));
    const elapsed=Date.now()-start;
    assert(!busy.ok&&busy.code==='RESUME_WRITE_LOCKED'&&elapsed>=3500&&elapsed<10000);
    assert((await fs.readFile(file)).equals(before));
    const retried=await invoke('save',{...distinct[1].value,model:'explicit-retry'});
    assert(retried.ok);assert.deepEqual(await store.getPublicSettings(),retried.value);
    assert.deepEqual((await fs.readdir(root)).sort(),['catalog.json']);
    report.checks.actualLockDeadlineAndExplicitRetry=true;
    const raw=await fs.readFile(file);assert(!raw.includes(key)&&!raw.includes(secondKey));
    report.observations={lockDeadlineMs:elapsed,distinctPids:[...legacy,...same,...distinct,busy,retried].map(x=>x.pid),catalogSha256:digest(raw),profileCount:(await store.getCatalog()).profiles.length,codec:'synthetic reversible codec, not OS encryption proof'};
    report.checks.noPlaintextOrTemporaryFiles=true;
  }
  const finish=(e?:unknown)=>{clearTimeout(watchdog);for(const c of children)c.kill();if(e){report.error=String(e).split(key).join('[redacted]').split(secondKey).join('[redacted]').slice(0,500);process.exitCode=1;}const json=JSON.stringify(report,null,2);if(json.includes(key)||json.includes(secondKey))throw Error('unsafe evidence');require('node:fs').writeFileSync(path.join(out,'credential-process.json'),json)};
  run().then(()=>finish(),finish);
}
