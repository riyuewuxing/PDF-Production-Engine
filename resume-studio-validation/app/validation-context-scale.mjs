import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {collectTrackedContextFiles,isAllowedContextPath} from './scripts/context-pack-policy.mjs';
const root=process.cwd();
const evidence=process.env.RESUME_STUDIO_CONTEXT_EVIDENCE;
if(!evidence||!process.env.RUNNER_TEMP)throw Error('isolated public runner required');
fs.mkdirSync(evidence,{recursive:true});
const out=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'context-scale-'));
const checks={};
const manifestPath=path.join(out,'pack-meta.json');
function run(extra=[]){
 const r=spawnSync(process.execPath,['scripts/pack-context.mjs','--out',out,...extra],{cwd:root,timeout:60000,encoding:'utf8',maxBuffer:2*1024*1024});
 if(r.error)throw r.error;
 assert.equal(r.status,0,r.stderr);
}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const readMeta=()=>JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const report={sourceSha:process.env.RESUME_STUDIO_CONTEXT_SOURCE_SHA,runnerSha:process.env.GITHUB_SHA,platform:process.platform,checks};
try{
 const allowed=collectTrackedContextFiles(root);
 assert.ok(allowed.length>=100,'expected project-scale source inventory');
 assert.ok(allowed.includes('src/App.tsx')&&allowed.includes('electron/main.ts')&&allowed.includes('package.json'));
 assert.ok(!allowed.includes('scripts/pack-context.mjs')&&!allowed.includes('runner-fixture.json'));
 assert.ok(allowed.every(isAllowedContextPath));checks.actualPublicSourceInventory=true;
 run();
 const first=readMeta(),baseFile=path.join(out,first.baseFileName),deltaFile=path.join(out,first.deltaFileName);
 assert.deepEqual(Object.keys(first.fileHashes).sort(),[...allowed].sort());
 const base=fs.readFileSync(baseFile),delta=fs.readFileSync(deltaFile);
 assert.ok(base.length>100000&&delta.length>1000);
 assert.equal(first.policyVersion,2);checks.fullRealSourceTreePack=true;
 const baseHash=sha(base);
 run(['--delta-only']);
 const second=readMeta();
 assert.equal(second.baseFileName,first.baseFileName);assert.equal(sha(fs.readFileSync(baseFile)),baseHash);
 assert.ok(!fs.existsSync(deltaFile));assert.equal(second.lastSeq,first.lastSeq+1);
 assert.equal(Object.keys(second.fileHashes).length,allowed.length);
 checks.zeroChangeDeltaKeepsActualBase=true;
 report.allowedFileCount=allowed.length;report.baseBytes=base.length;report.baseSha256=baseHash;report.deltaBytes=fs.statSync(path.join(out,second.deltaFileName)).size;
 report.generatedFilesUploaded=false;
}catch(e){report.error=String(e);process.exitCode=1}
finally{
 fs.writeFileSync(path.join(evidence,'context-scale-evidence.json'),JSON.stringify(report,null,2));
 fs.rmSync(out,{recursive:true,force:true});
}
