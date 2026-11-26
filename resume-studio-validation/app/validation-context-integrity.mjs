import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const out=process.env.RESUME_STUDIO_CONTEXT_EVIDENCE;
if(!out||!process.env.RUNNER_TEMP)throw Error('isolated public runner required');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'context-integrity-'));
const checks={}, observations={};
const old=path.join(dir,'scripts','pack-context.v2-baseline.mjs');
const candidate=path.join(dir,'scripts','pack-context.mjs');
function exec(cmd,args){const r=spawnSync(cmd,args,{cwd:root,encoding:'utf8',timeout:20000});if(r.error)throw r.error;return r}
function git(...args){const r=exec('git',args);assert.equal(r.status,0,r.stderr)}
const run=(script,dest,delta=false)=>exec(process.execPath,[script,'--out',dest,...(delta?['--delta-only']:[])]);
const ok=r=>assert.equal(r.status,0,r.stderr);
const meta=d=>JSON.parse(fs.readFileSync(path.join(d,'pack-meta.json'),'utf8'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const snap=d=>Object.fromEntries(fs.readdirSync(d).sort().map(n=>[n,hash(path.join(d,n))]));
function rejected(d,pattern){const before=snap(d),r=run(candidate,d,true);assert.notEqual(r.status,0);assert.match(r.stderr,pattern);assert.deepEqual(snap(d),before)}
function report(error){fs.writeFileSync(path.join(out,'context-integrity-evidence.json'),JSON.stringify({runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks,observations,...(error?{error:String(error)}:{})},null,2))}
try{
  git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
  fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src','sample.ts'),'export const synthetic = 25;\n');git('add','src');git('commit','-qm','synthetic');
  const legacy=path.join(root,'legacy'),dest=path.join(root,'candidate');
  ok(run(old,legacy));let m=meta(legacy),base=path.join(legacy,m.baseFileName);
  fs.unlinkSync(base);ok(run(old,legacy,true));assert.equal(fs.existsSync(base),false);checks.previousMissingBaselineFalseSuccess=true;
  ok(run(old,legacy));m=meta(legacy);base=path.join(legacy,m.baseFileName);fs.appendFileSync(base,'CORRUPTED_SYNTHETIC_BASE');ok(run(old,legacy,true));checks.previousCorruptedBaselineFalseSuccess=true;
  ok(run(candidate,dest));m=meta(dest);base=path.join(dest,m.baseFileName);const bytes=fs.readFileSync(base),digest=hash(base);
  assert.equal(m.baseSha256,digest);checks.baseDigestMatchesDisk=true;
  ok(run(candidate,dest,true));assert.equal(hash(base),digest);assert.equal(meta(dest).baseSha256,digest);checks.validDeltaKeepsBase=true;
  fs.unlinkSync(base);rejected(dest,/Baseline file missing/);checks.missingBasePreservesRemainingSet=true;
  fs.writeFileSync(base,bytes);fs.appendFileSync(base,'CORRUPTED_SYNTHETIC_BASE');rejected(dest,/integrity mismatch/);checks.corruptedBasePreservesSet=true;
  fs.writeFileSync(base,bytes);const mp=path.join(dest,'pack-meta.json'),original=fs.readFileSync(mp);const oldMeta=meta(dest);delete oldMeta.baseSha256;fs.writeFileSync(mp,JSON.stringify(oldMeta));rejected(dest,/no integrity digest/);checks.oldManifestRequiresRebaseline=true;fs.writeFileSync(mp,original);
  fs.unlinkSync(base);fs.mkdirSync(base);const r=run(candidate,dest,true);assert.notEqual(r.status,0);assert.match(r.stderr,/not a regular file/);assert.ok(fs.statSync(base).isDirectory());fs.rmdirSync(base);checks.directoryBaseRejected=true;
  fs.writeFileSync(base,bytes);fs.appendFileSync(base,'CORRUPTED_SYNTHETIC_BASE');fs.writeFileSync(path.join(dest,'unrelated.md'),'KEEP');ok(run(candidate,dest));const fresh=meta(dest);assert.notEqual(fresh.baseFileName,m.baseFileName);assert.equal(hash(path.join(dest,fresh.baseFileName)),fresh.baseSha256);assert.equal(fs.readFileSync(path.join(dest,'unrelated.md'),'utf8'),'KEEP');ok(run(candidate,dest,true));checks.fullRecoveryAndDelta=true;
  observations.baseDigestLength=fresh.baseSha256.length;report();console.log('Context integrity checks',Object.keys(checks).length);
}catch(e){report(e);console.error(e);process.exitCode=1}finally{fs.rmSync(root,{recursive:true,force:true})}
