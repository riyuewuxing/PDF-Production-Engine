import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const req=createRequire(import.meta.url);
const builder=createRequire(req.resolve('electron-builder'));
const lib=createRequire(builder.resolve('app-builder-lib'));
const asar=lib('@electron/asar');
const root=process.cwd();
const archive=path.join(root,'release','win-unpacked','resources','app.asar');
const paths=asar.listPackage(archive).map(s=>s.replace(/^[/\\]+/,'').replaceAll('\\','/'));
const bad=paths.filter(s=>!(s==='package.json'||s==='dist'||s.startsWith('dist/')||s==='dist-electron'||s.startsWith('dist-electron/')));
if(bad.length)throw Error('Unexpected packaged paths: '+JSON.stringify(bad));
for(const must of ['package.json','dist/index.html','dist-electron/main.cjs','dist-electron/preload.cjs','dist-electron/mcp-server.cjs'])if(!paths.includes(must))throw Error('Missing '+must);
const hash=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const exactEntries={};
for(const file of ['dist/index.html','dist-electron/main.cjs','dist-electron/preload.cjs','dist-electron/mcp-server.cjs']){
  const packed=asar.extractFile(archive,file),built=fs.readFileSync(path.join(root,file));
  if(!packed.equals(built))throw Error('Packaged file differs from built bytes: '+file);
  exactEntries[file]={size:packed.length,sha256:crypto.createHash('sha256').update(packed).digest('hex')};
}
if(!process.env.RUNNER_TEMP)throw Error('isolated extraction directory required');
const extractedMcp=path.join(process.env.RUNNER_TEMP,'synthetic-packaged-mcp.cjs');
fs.writeFileSync(extractedMcp,asar.extractFile(archive,'dist-electron/mcp-server.cjs'),{flag:'wx'});
const report={entryCount:paths.length,expectedOnly:true,hasMainPreloadMcp:true,archiveSha256:hash,paths,exactEntries,runnerSha:process.env.GITHUB_SHA};
const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'asar-content-evidence.json'),JSON.stringify(report,null,2));
