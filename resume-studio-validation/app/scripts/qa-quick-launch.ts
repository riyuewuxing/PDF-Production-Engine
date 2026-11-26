import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createWorkspaceBackup,inspectWorkspaceBackup,restoreWorkspaceBackup,inspectRestoredWorkspace} from '../src/server/workspaceBackup';
import {LocalResumeStore} from '../src/server/localFsApi';
import {launchWorkspace} from '../electron/workspaceLaunch';

const out=process.env.RESUME_STUDIO_PORTABLE_EVIDENCE;
if(!out||process.platform!=='win32')throw new Error('Windows portable validation only');
await fs.mkdir(out,{recursive:true});
const ctl=new AbortController(),watchdog=setTimeout(()=>ctl.abort(),180000);
const parent=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-portable-acceptance-'));
const pids:number[]=[];
const checks:Record<string,boolean>={};
const result={sourceSha:JSON.parse(await fs.readFile('runner-manifest.json','utf8')).sourceSha,runnerSha:process.env.GITHUB_SHA,checks};
function close(pid:number){
  const ps='$p=Get-Process -Id '+pid+' -ErrorAction Stop; if(!$p.CloseMainWindow()){throw "no independent main window"}; $p.WaitForExit(10000)';
  const answer=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8',timeout:15000});
  if(!answer.includes('True'))throw new Error('portable window did not close');
  pids.splice(pids.indexOf(pid),1);
}
function windowTitle(pid:number){
  return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','$p=Get-Process -Id '+pid+' -ErrorAction Stop; $p.MainWindowTitle'],{encoding:'utf8',timeout:5000}).trim();
}
try{
  const root=path.join(parent,'live'),dest=path.join(parent,'copies');await fs.mkdir(dest,{recursive:true});
  const source=new LocalResumeStore(path.join(root,'data')),fixture=JSON.parse(await fs.readFile('runner-fixture.json','utf8'));
  await source.saveResume('master',fixture);
  const b=await createWorkspaceBackup(root,dest,ctl.signal),checked=await inspectWorkspaceBackup(b.folder,ctl.signal);
  const a=await restoreWorkspaceBackup(root,b.folder,checked.manifestHash,dest,ctl.signal);
  const exe=createRequire(import.meta.url)('electron') as string;
  const verified=await inspectRestoredWorkspace(a.folder,ctl.signal,root);
  const opened=await launchWorkspace({isPackaged:false,exePath:exe,appDir:process.cwd(),env:process.env,root:verified.root,basis:verified.basis},ctl.signal);
  pids.push(opened.pid);checks.sourceReady=true;
  if(!windowTitle(opened.pid).includes('独立恢复工作区'))throw new Error('source native window title missing');
  checks.sourceTitle=true;
  close(opened.pid);
  await fs.writeFile(path.join(out,'quick-launch-evidence.json'),JSON.stringify(result,null,2));
}catch(err){
  await fs.writeFile(path.join(out,'portable-failure.json'),JSON.stringify({...result,error:err instanceof Error?err.message:String(err)},null,2));throw err;
}finally{
  clearTimeout(watchdog);
  for(const pid of pids){try{process.kill(pid);}catch{}}
  await fs.rm(parent,{recursive:true,force:true}).catch(()=>{});
}
