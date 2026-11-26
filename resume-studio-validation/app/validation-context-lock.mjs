import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)), scripts=path.join(dir,'scripts');
const out=process.env.RESUME_STUDIO_CONTEXT_EVIDENCE;
if(!out||!process.env.RUNNER_TEMP)throw Error('isolated public runner required');
fs.mkdirSync(out,{recursive:true});
const sandbox=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'context-lock-'));
const root=path.join(sandbox,'repo');fs.mkdirSync(root);
const instrument=path.join(sandbox,'instrument');fs.mkdirSync(instrument);
const checks={},observations={};const running=new Set();
for(const f of ['context-pack-policy.mjs','private-evidence-paths.mjs'])fs.copyFileSync(path.join(scripts,f),path.join(instrument,f));
const anchor='    verifyBaselineFile(prevManifest);';
function controlled(source,name){
  const raw=fs.readFileSync(path.join(scripts,source),'utf8');assert.equal(raw.split(anchor).length,2);
  const hook=`
    if (process.env.QA_READY && process.env.QA_RELEASE) {
      fs.writeFileSync(process.env.QA_READY, 'ready');
      const deadline = Date.now() + 12000;
      while (!fs.existsSync(process.env.QA_RELEASE)) {
        if (Date.now() > deadline) throw Error('QA barrier deadline');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);
      }
    }`;
  const p=path.join(instrument,name);fs.writeFileSync(p,raw.replace(anchor,anchor+hook));return p;
}
const previous=controlled('pack-context.integrity-baseline.mjs','previous.mjs');
const locked=controlled('pack-context.mjs','candidate.mjs');
const real=path.join(scripts,'pack-context.mjs');
function exec(cmd,args){const r=spawnSync(cmd,args,{cwd:root,encoding:'utf8',timeout:20000});if(r.error)throw r.error;return r}
function git(...args){const r=exec('git',args);assert.equal(r.status,0,r.stderr)}
const args=(script,dest,delta)=>[script,'--out',dest,...(delta?['--delta-only']:[])];
const run=(script,dest,delta=false)=>exec(process.execPath,args(script,dest,delta));
const ok=r=>assert.equal(r.status,0,r.stderr);
const meta=d=>JSON.parse(fs.readFileSync(path.join(d,'pack-meta.json'),'utf8'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const snap=d=>Object.fromEntries(fs.readdirSync(d).sort().map(n=>[n,hash(path.join(d,n))]));
function assertValid(d){const m=meta(d);assert.equal(hash(path.join(d,m.baseFileName)),m.baseSha256);assert.ok(fs.statSync(path.join(d,m.deltaFileName)).isFile());assert.equal(fs.existsSync(path.join(d,'.context-pack.lock')),false)}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function pause(script,dest,label){
  const ready=path.join(sandbox,label+'.ready'), release=path.join(sandbox,label+'.release');
  const child=spawn(process.execPath,args(script,dest,true),{cwd:root,env:{...process.env,QA_READY:ready,QA_RELEASE:release},stdio:['ignore','ignore','pipe']});
  running.add(child);let stderr='';child.stderr.on('data',v=>stderr+=v.toString());
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{running.delete(child);resolve({status:code,signal,stderr})})});
  for(let i=0;i<160&&!fs.existsSync(ready);i++){if(child.exitCode!==null)throw Error('Child exited before barrier: '+stderr);await delay(25)}
  assert.ok(fs.existsSync(ready),'child barrier not reached');
  return {release:()=>fs.writeFileSync(release,'go'),done};
}
function report(error){fs.writeFileSync(path.join(out,'context-lock-evidence.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks,observations,...(error?{error:String(error)}:{})},null,2))}
try{
  git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src','sample.ts'),'export const synthetic = 25;\n');git('add','src');git('commit','-qm','synthetic');
  const legacy=path.join(sandbox,'legacy');ok(run(previous,legacy));const oldBase=meta(legacy).baseFileName;
  let p=await pause(previous,legacy,'legacy');ok(run(previous,legacy));assert.equal(fs.existsSync(path.join(legacy,oldBase)),false);
  p.release();ok(await p.done);assert.equal(meta(legacy).baseFileName,oldBase);assert.equal(fs.existsSync(path.join(legacy,oldBase)),false);
  checks.previousInterleavingReproducesDanglingBaseline=true;
  const dest=path.join(sandbox,'candidate');ok(run(real,dest));p=await pause(locked,dest,'candidate');assert.ok(fs.existsSync(path.join(dest,'.context-pack.lock')));
  const before=snap(dest),r=run(real,dest);assert.notEqual(r.status,0);assert.match(r.stderr,/Context output is locked/);assert.deepEqual(snap(dest),before);
  checks.concurrentFullPublisherRejectedWithoutMutation=true;
  p.release();ok(await p.done);assertValid(dest);checks.deltaPublisherFinishesWithValidBaseAndNoLock=true;
  ok(run(real,dest));assertValid(dest);checks.fullRetryAfterLockRelease=true;
  const stale=path.join(dest,'.context-pack.lock');fs.writeFileSync(stale,'confirmed synthetic stale lock');const snapshot=snap(dest),staleRun=run(real,dest,true);assert.notEqual(staleRun.status,0);assert.match(staleRun.stderr,/Context output is locked/);assert.deepEqual(snap(dest),snapshot);checks.staleLockPreservedWithoutAutoRemoval=true;fs.unlinkSync(stale);ok(run(real,dest,true));assertValid(dest);
  const noBase=path.join(sandbox,'empty');const missing=run(real,noBase,true);assert.notEqual(missing.status,0);assert.match(missing.stderr,/Missing baseline manifest/);assert.equal(fs.existsSync(path.join(noBase,'.context-pack.lock')),false);checks.missingManifestDoesNotLeakLock=true;
  fs.writeFileSync(path.join(root,'src','sample.ts'),'export const invalid = {"employementStatus":"SYNTHETIC"};\n');const saved=snap(dest),bad=run(real,dest);assert.notEqual(bad.status,0);assert.deepEqual(snap(dest),saved);checks.validationFailureReleasesLockAndPreservesSet=true;
  observations.legacyMissingBaseline=true;observations.concurrentExitCode=r.status;report();console.log('Context lock checks',Object.keys(checks).length);
}catch(e){report(e);console.error(e);process.exitCode=1}finally{for(const c of running)c.kill();fs.rmSync(sandbox,{recursive:true,force:true})}
