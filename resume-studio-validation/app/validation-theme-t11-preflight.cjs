// Verify static relative dependencies before Electron starts. Never execute an Electron entrypoint in Node.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const seen=new Set();
function verify(file) {
 const p=path.resolve(file);
 if(seen.has(p))return;
 seen.add(p);
 if(!fs.statSync(p).isFile())throw Error('Missing dependency '+p);
 if(!p.endsWith('.cjs')&&!p.endsWith('.js'))return;
 const checked=cp.spawnSync(process.execPath,['--check',p],{stdio:'inherit',timeout:30000});
 if(checked.error||checked.status!==0)throw Error('Syntax preflight failed '+p);
 if(p.includes(path.sep+'dist-electron'+path.sep))return;
 const code=fs.readFileSync(p,'utf8');
 for(const m of code.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g))verify(path.resolve(path.dirname(p),m[1]));
}
verify(process.argv[2]);
if(process.argv[2].includes('interview-gate')){
 verify('./validation-theme-t08-matrix.cjs');
 verify('./validation-theme-t08-baseline-matrix.cjs');
 const a=require('./validation-interview-adapters.cjs');
 for(const key of ['parsePracticeKey','jobReviewBasisHash','splitJobRequirements'])if(typeof a[key]!=='function')throw Error('adapter export missing '+key);
}
console.log('Preflight files:',[...seen].map(x=>path.relative(process.cwd(),x)));
