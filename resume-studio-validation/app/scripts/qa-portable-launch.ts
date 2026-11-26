import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
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
  const original=await fs.readFile(path.join(root,'data','master.json'));
  const b=await createWorkspaceBackup(root,dest,ctl.signal),checked=await inspectWorkspaceBackup(b.folder,ctl.signal);
  const a=await restoreWorkspaceBackup(root,b.folder,checked.manifestHash,dest,ctl.signal);
  const c=await restoreWorkspaceBackup(root,b.folder,checked.manifestHash,dest,ctl.signal);
  const wrapper=path.resolve(process.env.RESUME_STUDIO_PORTABLE_WRAPPER||path.join('release','Resume Studio.exe'));
  await fs.access(wrapper);
  const launch=async(folder:string)=>{
    const verified=await inspectRestoredWorkspace(folder,ctl.signal,root);
    const opened=await launchWorkspace({isPackaged:true,exePath:wrapper,appDir:path.dirname(wrapper),env:{...process.env,PORTABLE_EXECUTABLE_FILE:wrapper,PORTABLE_EXECUTABLE_DIR:path.dirname(wrapper)},root:verified.root,basis:verified.basis},ctl.signal);
    pids.push(opened.pid);return opened;
  };
  const [first,second]=await Promise.all([launch(a.folder),launch(c.folder)]);
  if(first.pid===second.pid||first.folder===second.folder)throw new Error('portable instances were not independent');
  checks.twoPortableWindowsReady=true;
  if(!windowTitle(first.pid).includes('独立恢复工作区')||!windowTitle(second.pid).includes('独立恢复工作区'))throw new Error('portable native window titles missing');
  checks.portableNativeWindowTitles=true;
  const extract=async(pid:number)=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-Process -Id '+pid+' -ErrorAction Stop).Path'],{encoding:'utf8',timeout:5000}).trim();
  const [exeA,exeB]=await Promise.all([extract(first.pid),extract(second.pid)]);
  if(path.relative(path.dirname(exeA),path.dirname(exeB))===''||!exeA.toLowerCase().includes('portable-temp')||!exeB.toLowerCase().includes('portable-temp'))throw new Error('portable extraction not isolated');
  checks.portableExtractionIsolated=true;
  close(first.pid);
  process.kill(second.pid,0);
  if(!windowTitle(second.pid).includes('独立恢复工作区'))throw new Error('closing one portable window removed the other');
  await fs.access(exeB);
  checks.portableSurvivesOtherWindowClose=true;
  for(const folder of [a.folder,c.folder]){
    if(!(await fs.readFile(path.join(folder,'data','master.json'))).equals(original)||!(await fs.stat(path.join(folder,'.electron-userdata'))).isDirectory())throw new Error('portable profile or data mismatch');
  }
  if(!(await fs.readFile(path.join(root,'data','master.json'))).equals(original)||!(await fs.readFile(path.join(b.folder,'data','master.json'))).equals(original))throw new Error('source or backup changed');
  checks.portableOriginalAndBackupUnchanged=true;
  close(second.pid);
  await fs.writeFile(path.join(out,'portable-launch-evidence.json'),JSON.stringify(result,null,2));
}catch(err){
  await fs.writeFile(path.join(out,'portable-failure.json'),JSON.stringify({...result,error:err instanceof Error?err.message:String(err)},null,2));throw err;
}finally{
  clearTimeout(watchdog);
  for(const pid of pids){try{process.kill(pid);}catch{}}
  await fs.rm(parent,{recursive:true,force:true}).catch(()=>{});
}
