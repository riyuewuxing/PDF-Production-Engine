import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {LocalResumeStore,localFsApiPlugin} from './src/server/localFsApi.ts';
import {comparisonFixture,changedComparisonFixture} from './src/lib/comparisonSyntheticFixture.ts';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
const require=createRequire(import.meta.url);
const electron=require('electron');
const out=process.env.RESUME_STUDIO_BROWSER_EVIDENCE;
if(!out||process.platform!=='win32')throw Error('isolated Windows browser validation required');
await fs.mkdir(out,{recursive:true});
const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-browser-application-review-'));
const store=new LocalResumeStore(path.join(root,'data'));
let vite,child,timer,startupTimer;
const report={runnerSha:process.env.GITHUB_SHA,sourceSha:require('./runner-manifest.json').sourceSha,mode:'real Chromium browser window without preload, loopback Vite middleware',checks:{}};
const write=()=>fs.writeFile(path.join(out,'application-review-browser-server.json'),JSON.stringify(report,null,2));
const hash=async f=>crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex');
function kill(){if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:8000});}catch{}}}
try{
  const sealed=await store.saveResume('gone-version',{...comparisonFixture(),title:'浏览器封存原稿',basic:{...comparisonFixture().basic,email:'browser-sealed@example.invalid'},skillContent:'BROWSER_SEALED_SKILL_39'});
  const logged=await store.logApplication({entry:{id:crypto.randomUUID(),company:'浏览器合成学校',role:'物理教师',resumeSlug:'gone-version',exportedFilePath:'C:/synthetic/missing.pdf',atsScore:60,updatedAt:'2026-01-01T00:00:00Z'},document:sealed});
  await store.deleteResume('gone-version',JSON.stringify([sealed.id,sealed.updatedAt]));
  const current=await store.saveResume('runner-fixture',{...changedComparisonFixture(),title:'浏览器当前合成稿',basic:{...changedComparisonFixture().basic,name:'合成候选甲',email:'browser-current@example.invalid'},skillContent:'BROWSER_CURRENT_SKILL_39'});
  await store.saveResume('target-compare',{...current,id:'browser-target-39',title:'浏览器其他磁盘稿',basic:{...current.basic,email:'browser-other@example.invalid'}});
  await store.saveResume('master',{...current,id:'browser-master-39',title:'浏览器合成母库'});
  const historyDir=store.appSnapshotsDir;
  const snapshot={id:logged.entry.snapshotId};
  const files=[store.resolveResumePath('runner-fixture').filePath,store.resolveResumePath('target-compare').filePath,store.resolveResumePath('master').filePath,store.applicationsPath,path.join(historyDir,snapshot.id+'.json')];
  const inventory=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[path.relative(root,f),await hash(f)])));
  // Abort the child on watchdog; server remains foreground and is closed in finally.
  const start=new Promise((_,reject)=>{startupTimer=setTimeout(()=>reject(Error('Vite startup watchdog 45s')),45000)});
  vite=await Promise.race([createServer({configFile:false,root:process.cwd(),base:'./',plugins:[react(),tailwindcss(),localFsApiPlugin({rootDir:root})],server:{host:'127.0.0.1',port:0,strictPort:false}}),start]);
  await Promise.race([vite.listen(),start]);clearTimeout(startupTimer);
  const address=vite.httpServer?.address();
  if(!address||typeof address==='string'||address.address!=='127.0.0.1')throw Error('server is not bound to loopback');
  const url='http://127.0.0.1:'+address.port;
  const initial=await inventory();
  report.loopback=true;
  child=spawn(electron,[path.resolve('validation-browser-application-review.cjs')],{env:{...process.env,RESUME_STUDIO_BROWSER_URL:url,RESUME_STUDIO_BROWSER_ROOT:root,RESUME_STUDIO_BROWSER_SNAPSHOT:snapshot.id,RESUME_STUDIO_BROWSER_APP_ID:logged.entry.id,RESUME_STUDIO_BROWSER_LEDGER_REVISION:logged.store.revision},stdio:'inherit',windowsHide:false});
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);timer=setTimeout(()=>{kill();reject(Error('browser child watchdog 130s'));},130000);});
  if(exit!==0)throw Error('browser child returned '+exit);
  if(JSON.stringify(await inventory())!==JSON.stringify(initial)|| (await fs.readdir(historyDir)).length!==1||(await fs.readdir(store.resumesDir)).filter(n=>n.endsWith('.json')).length!==2||(await fs.stat(store.resolveResumePath('gone-version').filePath).then(()=>true,()=>false)))throw Error('browser comparison modified documents or snapshots');
  report.checks.exactDiskAndHistoryHashesPreserved=true;report.checks.childExitedNormally=true;report.hashes=initial;await write();
}catch(error){report.error=String(error);await write();process.exitCode=1;}
finally{clearTimeout(timer);clearTimeout(startupTimer);kill();if(vite)await vite.close();await fs.rm(root,{recursive:true,force:true}).catch(()=>{});}
