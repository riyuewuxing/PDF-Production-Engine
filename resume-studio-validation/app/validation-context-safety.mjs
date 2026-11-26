import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const dir=path.dirname(fileURLToPath(import.meta.url));
const candidate=path.join(dir,'scripts','pack-context.mjs');
const baseline=path.join(dir,'scripts','pack-context.baseline.mjs');
const out=process.env.RESUME_STUDIO_CONTEXT_EVIDENCE;
if(!out||!process.env.RUNNER_TEMP)throw Error('isolated public runner required');
fs.mkdirSync(out,{recursive:true});
const sandbox=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'context-safety-'));
const checks={},observations={};
function exec(command,args,cwd,options={}){
  const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024,...options});
  if(r.error)throw r.error;
  return {code:r.status,stdout:r.stdout??'',stderr:r.stderr??''};
}
function git(cwd,...args){const r=exec('git',args,cwd);if(r.code!==0)throw Error(r.stderr);return r.stdout.trim()}
function write(root,name,value){const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value,'utf8')}
function fixture(name){
  const root=path.join(sandbox,name);fs.mkdirSync(root);git(root,'init','-q');git(root,'config','user.name','Synthetic');git(root,'config','user.email','synthetic@example.invalid');
  write(root,'src/current.ts','export const value = "CURRENT_SAFE_24";\n');
  write(root,'src/remove.ts','export const obsolete = "DELETED_OLD_TEXT_24";\n');
  write(root,'src/lib/docxExporter.test.ts','export const privateTest = "PRIVATE_TEST_24";\n');
  write(root,'src/private/private.ts','PRIVATE_SOURCE_DIR_24');
  write(root,'src/ai/.ai-settings.json','{"apiKey":"SYNTHETIC_PRIVATE_KEY_24"}');
  write(root,'.env','SYNTHETIC_ROOT_ENV_24');
  write(root,'notes.md','PRIVATE_ROOT_NOTE_24');
  write(root,'docs/ARCHITECT_HANDOFF_LOG.md','PRIVATE_HANDOFF_24');
  write(root,'scripts/pack-context.mjs','SPLIT_PRIVATE_LITERAL_24');
  write(root,'src/junction/secret.ts','TRACKED_JUNCTION_FILE_24');
  write(root,'data/master.json','PRIVATE_MASTER_24');
  git(root,'add','.');git(root,'commit','-qm','Synthetic initial revision');
  write(root,'src/untracked.ts','UNTRACKED_CODE_24');
  write(root,'arbitrary-secret.txt','UNTRACKED_NOTE_24');
  write(root,'src/staged.ts','export const staged = "STAGED_SAFE_24";\n');git(root,'add','src/staged.ts');
  return root;
}
const run=(script,root,output,extra=[])=>exec(process.execPath,[script,'--out',output,...extra],root);
const generated=dir=>fs.readdirSync(dir).filter(n=>/^(01-BASE|00-DELTA)-v.*\.md$/.test(n)).sort();
const text=dir=>generated(dir).map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('\n');
const manifest=dir=>JSON.parse(fs.readFileSync(path.join(dir,'pack-meta.json'),'utf8'));
function snapshot(dir){return Object.fromEntries(fs.readdirSync(dir).sort().map(n=>[n,fs.readFileSync(path.join(dir,n)).toString('base64')]))}
const assertOk=(r,label)=>assert.equal(r.code,0,label+' '+r.stderr);
function evidence(error){fs.writeFileSync(path.join(out,'context-safety-evidence.json'),JSON.stringify({sourceSha:process.env.RESUME_STUDIO_CONTEXT_SOURCE_SHA,runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks,observations,...(error?{error:String(error)}:{})},null,2))}
try{
  const legacy=fixture('legacy'), legacyOut=path.join(sandbox,'legacy-output');fs.mkdirSync(legacyOut);
  write(legacyOut,'unrelated-notes.md','KEEP_EXTERNAL_NOTE_24');
  assertOk(run(baseline,legacy,legacyOut),'baseline');
  const oldText=text(legacyOut);
  assert.ok(oldText.includes('UNTRACKED_NOTE_24')&&oldText.includes('SYNTHETIC_ROOT_ENV_24'));
  assert.equal(fs.existsSync(path.join(legacyOut,'unrelated-notes.md')),false);
  checks.baselineUntrackedSecretAndUnrelatedMarkdownDeletionReproduced=true;
  observations.baseline={untrackedSecretIncluded:true,unrelatedMarkdownDeleted:true};

  const root=fixture('candidate'),dest=path.join(sandbox,'candidate-output');fs.mkdirSync(dest);
  write(dest,'unrelated-notes.md','KEEP_EXTERNAL_NOTE_24');
  const external=path.join(sandbox,'external');fs.mkdirSync(external);write(external,'secret.ts','EXTERNAL_JUNCTION_SECRET_24');
  fs.rmSync(path.join(root,'src','junction'),{recursive:true});fs.symlinkSync(external,path.join(root,'src','junction'),'junction');
  assertOk(run(candidate,root,dest),'first base');
  const b=manifest(dest);assert.equal(b.policyVersion,2);assert.equal(generated(dest).length,2);
  assert.ok(text(dest).includes('CURRENT_SAFE_24')&&text(dest).includes('STAGED_SAFE_24'));
  for(const s of ['PRIVATE_TEST_24','PRIVATE_SOURCE_DIR_24','SYNTHETIC_PRIVATE_KEY_24','SYNTHETIC_ROOT_ENV_24','PRIVATE_ROOT_NOTE_24','PRIVATE_HANDOFF_24','SPLIT_PRIVATE_LITERAL_24','PRIVATE_MASTER_24','UNTRACKED_CODE_24','UNTRACKED_NOTE_24','EXTERNAL_JUNCTION_SECRET_24','TRACKED_JUNCTION_FILE_24'])assert.ok(!text(dest).includes(s),'unexpected marker '+s);
  assert.equal(fs.readFileSync(path.join(dest,'unrelated-notes.md'),'utf8'),'KEEP_EXTERNAL_NOTE_24');
  checks.trackedAllowlistPrivateTestsAndJunctionsExcluded=true;
  checks.newStagedCodeAndCurrentTextIncluded=true;
  checks.unrelatedMarkdownPreserved=true;

  const prior=git(root,'rev-parse','HEAD');
  write(root,'src/current.ts','export const old = "HISTORY_SECRET_24";\n');git(root,'add','src/current.ts');git(root,'commit','-qm','HISTORY_COMMIT_MESSAGE_24');
  write(root,'src/current.ts','export const current = "CURRENT_CHANGED_24";\n');
  fs.unlinkSync(path.join(root,'src','remove.ts'));
  assertOk(run(candidate,root,dest,['--delta-only','--since',prior]),'delta');
  const after=manifest(dest);const delta=fs.readFileSync(path.join(dest,after.deltaFileName),'utf8');
  assert.ok(delta.includes('CURRENT_CHANGED_24')&&delta.includes('src/remove.ts'));
  for(const s of ['HISTORY_SECRET_24','HISTORY_COMMIT_MESSAGE_24','DELETED_OLD_TEXT_24','UNTRACKED_NOTE_24','SYNTHETIC_ROOT_ENV_24'])assert.ok(!delta.includes(s),'history/private marker '+s);
  assert.equal(fs.existsSync(path.join(dest,b.baseFileName)),true);assert.equal(fs.existsSync(path.join(dest,b.deltaFileName)),false);assert.equal(generated(dest).length,2);
  checks.deltaCurrentOnlyNoHistoryOrDeletedBody=true;
  checks.deltaRetiresOnlyPreviousDelta=true;

  const metaPath=path.join(dest,'pack-meta.json');
  const originalMeta=fs.readFileSync(metaPath);
  const oldPolicy={...after};delete oldPolicy.policyVersion;fs.writeFileSync(metaPath,JSON.stringify(oldPolicy));
  let before=snapshot(dest),r=run(candidate,root,dest,['--delta-only']);assert.notEqual(r.code,0);assert.deepEqual(snapshot(dest),before);
  fs.writeFileSync(metaPath,originalMeta);
  checks.previousPrivacyPolicyRequiresFreshBaseline=true;

  write(root,'src/current.ts','export const invalid = {"employementStatus": "SYNTHETIC_INVALID"};\n');
  before=snapshot(dest);r=run(candidate,root,dest);assert.notEqual(r.code,0);assert.deepEqual(snapshot(dest),before);
  checks.validationFailurePreservesPriorSet=true;
  write(root,'src/current.ts','export const current = "CURRENT_RETRY_24";\n');

  if(process.platform==='win32'){
    const cmd="$lock=[IO.File]::Open($env:QA_META,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { & $env:QA_NODE $env:QA_SCRIPT --out $env:QA_OUT; exit $LASTEXITCODE } finally { $lock.Dispose() }";
    before=snapshot(dest);const locked=exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',cmd],root,{env:{...process.env,QA_META:metaPath,QA_NODE:process.execPath,QA_SCRIPT:candidate,QA_OUT:dest}});
    assert.notEqual(locked.code,0,'locked manifest rename should fail');assert.deepEqual(snapshot(dest),before);
    assert.ok(/EPERM|EACCES|EBUSY|rename/i.test(locked.stderr+locked.stdout),'expected actual publish failure');
    observations.manifestLockExitCode=locked.code;checks.lockedManifestRollbackPreservesOldAndNoNewFiles=true;
  }
  const tampered={...after,baseFileName:'../unrelated-notes.md'};fs.writeFileSync(metaPath,JSON.stringify(tampered));
  before=snapshot(dest);r=run(candidate,root,dest);assert.notEqual(r.code,0);assert.deepEqual(snapshot(dest),before);fs.writeFileSync(metaPath,originalMeta);
  checks.unrecognizedManifestRefusesDeletion=true;

  assertOk(run(candidate,root,dest),'successful retry');
  const final=manifest(dest);assert.equal(final.policyVersion,2);assert.equal(generated(dest).length,2);
  assert.ok(text(dest).includes('CURRENT_RETRY_24'));assert.equal(fs.existsSync(path.join(dest,after.baseFileName)),false);assert.equal(fs.existsSync(path.join(dest,after.deltaFileName)),false);
  assert.equal(fs.readFileSync(path.join(dest,'unrelated-notes.md'),'utf8'),'KEEP_EXTERNAL_NOTE_24');
  checks.fullRetryRetiresOnlyPriorGeneratedSet=true;
  observations.finalManifestPolicy=final.policyVersion;observations.finalAllowedFiles=Object.keys(final.fileHashes);
  evidence();console.log('Context safety checks',Object.keys(checks).length);
}catch(e){evidence(e);console.error(e);process.exitCode=1}
finally{fs.rmSync(sandbox,{recursive:true,force:true})}
