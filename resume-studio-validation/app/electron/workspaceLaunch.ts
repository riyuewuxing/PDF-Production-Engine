import {promises as fs, appendFileSync, lstatSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export type LaunchReceipt={token:string;folder:string;status:'ready'|'failed';pid:number;message?:string};
const PREFIX='resume-studio-launch-';
const TOKEN=/^[a-f0-9-]{36}$/i;
const BASIS=/^[a-f0-9]{64}$/;
export type LaunchHandoff={dir:string;token:string;basis:string};
const STAGES=['module-loaded','entry-main','profile-ready','instance-lock-acquired','app-ready','workspace-verified','window-loaded','renderer-document-ready','receipt-written'] as const;
type LaunchStage=typeof STAGES[number];
export function recordLaunchStage(handoff:LaunchHandoff|null,stage:LaunchStage):void{
  if(!handoff)return;
  try{const st=lstatSync(handoff.dir);if(st.isDirectory()&&!st.isSymbolicLink())appendFileSync(path.join(handoff.dir,'progress.txt'),stage+'\n',{mode:0o600});}catch{/* Diagnostics must not prevent safe startup. */}
}
export async function lastLaunchStage(dir:string):Promise<string>{
  try{const file=path.join(dir,'progress.txt'),st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>4096)return '无法读取启动阶段';const lines=(await fs.readFile(file,'utf8')).split('\n').filter(x=>(STAGES as readonly string[]).includes(x));return lines.at(-1)??'尚未进入应用主程序';}catch{return '尚未进入应用主程序';}
}
export function readLaunchHandoff(env:NodeJS.ProcessEnv):LaunchHandoff|null{
  const dir=env.RESUME_STUDIO_LAUNCH_DIR,token=env.RESUME_STUDIO_LAUNCH_TOKEN,basis=env.RESUME_STUDIO_LAUNCH_BASIS;
  delete env.RESUME_STUDIO_LAUNCH_DIR;delete env.RESUME_STUDIO_LAUNCH_TOKEN;delete env.RESUME_STUDIO_LAUNCH_BASIS;
  if(dir===undefined&&token===undefined&&basis===undefined)return null;
  if(!dir||!path.isAbsolute(dir)||!path.basename(dir).startsWith(PREFIX)||!token||!TOKEN.test(token)||!basis||!BASIS.test(basis))throw new Error('独立工作区启动凭据无效。');
  return {dir,token,basis};
}
export function buildWorkspaceLaunch(input:{isPackaged:boolean;exePath:string;appDir:string;env:NodeJS.ProcessEnv;root:string;handoff:LaunchHandoff}){
  const portable=input.isPackaged&&Boolean(input.env.PORTABLE_EXECUTABLE_DIR||input.env.PORTABLE_EXECUTABLE_FILE);
  const executable=portable?input.env.PORTABLE_EXECUTABLE_FILE:input.exePath;
  if(!executable||!path.isAbsolute(executable)||(!input.isPackaged&&!path.isAbsolute(input.appDir)))throw new Error('无法确定当前程序的可信启动位置。');
  if(portable&&(!input.env.PORTABLE_EXECUTABLE_DIR||path.relative(input.env.PORTABLE_EXECUTABLE_DIR,path.dirname(executable))!==''||path.extname(executable).toLowerCase()!=='.exe'))throw new Error('便携版启动位置无效，请使用手动启动方式。');
  const env={...input.env};
  for(const key of Object.keys(env))if(['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','ELECTRON_NO_ASAR','ELECTRON_OVERRIDE_DIST_PATH','VITE_DEV_SERVER_URL','RESUME_STUDIO_DATA_DIR','PORTABLE_EXECUTABLE_DIR','PORTABLE_EXECUTABLE_FILE','PORTABLE_EXECUTABLE_APP_FILENAME','RESUME_STUDIO_LAUNCH_DIR','RESUME_STUDIO_LAUNCH_TOKEN','RESUME_STUDIO_LAUNCH_BASIS'].includes(key.toUpperCase()))delete env[key];
  Object.assign(env,{RESUME_STUDIO_DATA_DIR:input.root,RESUME_STUDIO_LAUNCH_DIR:input.handoff.dir,RESUME_STUDIO_LAUNCH_TOKEN:input.handoff.token,RESUME_STUDIO_LAUNCH_BASIS:input.handoff.basis});
  // NSIS portable launches delete/re-extract their fixed unpack path. Give each
  // child a separate TEMP/TMP so the parent and child cannot remove each other's app.
  if(portable){for(const key of Object.keys(env))if(['TEMP','TMP'].includes(key.toUpperCase()))delete env[key];env.TEMP=path.join(input.handoff.dir,'portable-temp');env.TMP=env.TEMP;}
  return {executable,args:input.isPackaged?[]:[input.appDir],cwd:input.isPackaged?path.dirname(executable):input.appDir,env,portable};
}
export async function writeLaunchReceipt(handoff:LaunchHandoff,receipt:Omit<LaunchReceipt,'token'>){
  const info=await fs.lstat(handoff.dir);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('独立启动回执目录不安全。');
  const target=path.join(handoff.dir,'ready.json'),tmp=target+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(tmp,JSON.stringify({...receipt,token:handoff.token}),{flag:'wx',mode:0o600});await fs.rename(tmp,target);}
  finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
}
export function checkLaunchReceipt(raw:unknown,token:string,folder:string):LaunchReceipt{
  if(!raw||typeof raw!=='object')throw new Error('独立启动回执无效。');
  const r=raw as Partial<LaunchReceipt>;
  if(r.token!==token||typeof r.folder!=='string'||path.relative(folder,r.folder)!==''||!['ready','failed'].includes(r.status??'')||!Number.isSafeInteger(r.pid)||r.pid!<1)throw new Error('独立启动回执不匹配。');
  return r as LaunchReceipt;
}
export function outerLaunchTemp(base:string):string{
  // A second-generation portable window must not extract inside its parent's disposable directory.
  let current=path.resolve(base);
  while(path.basename(current)==='portable-temp'&&path.basename(path.dirname(current)).startsWith(PREFIX))current=path.dirname(path.dirname(current));
  return current;
}
export async function launchWorkspace(input:{isPackaged:boolean;exePath:string;appDir:string;env:NodeJS.ProcessEnv;root:string;basis:string},signal:AbortSignal){
  if(signal.aborted)throw new Error('独立工作区启动操作已取消。');
  const tempBase=await fs.realpath(outerLaunchTemp(os.tmpdir()));
  const dir=await fs.mkdtemp(path.join(tempBase,PREFIX)),handoff={dir,token:randomUUID(),basis:input.basis};
  let portable=false,started=false,finished=false,exited=false;
  try{
    const plan=buildWorkspaceLaunch({...input,handoff});portable=plan.portable;
    if(plan.portable)await fs.mkdir(path.join(dir,'portable-temp'));
    const exe=await fs.stat(plan.executable);
    if(!exe.isFile())throw new Error('当前程序启动文件不存在。');
    if(signal.aborted)throw new Error('独立工作区启动操作已取消。');
    const child=spawn(plan.executable,plan.args,{cwd:plan.cwd,env:plan.env,detached:true,stdio:'ignore',shell:false,windowsHide:false});
    started=true;
    let spawnError:Error|undefined;
    child.once('error',e=>{spawnError=e;exited=true;});
    child.once('exit',()=>{exited=true;if(finished&&portable)void fs.rm(dir,{recursive:true,force:true}).catch(()=>{});});
    child.unref();
    const deadline=Date.now()+(portable?90000:45000);
    while(Date.now()<deadline&&!signal.aborted){
      try{
        const receiptPath=path.join(dir,'ready.json'),st=await fs.lstat(receiptPath);
        if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw new Error('独立启动回执不安全。');
        const receipt=checkLaunchReceipt(JSON.parse(await fs.readFile(receiptPath,'utf8')),handoff.token,input.root);
        if(receipt.status==='failed')throw new Error(receipt.message||'独立工作区未能启动。');
        return {folder:receipt.folder,pid:receipt.pid,ready:true as const};
      }catch(err){if((err as NodeJS.ErrnoException).code!=='ENOENT')throw err;}
      if(spawnError)throw new Error('无法启动独立工作区：'+spawnError.message);
      if(exited)throw new Error('独立程序已退出，未收到就绪确认（阶段：'+await lastLaunchStage(dir)+'）。');
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    throw new Error('未收到独立窗口就绪确认（阶段：'+await lastLaunchStage(dir)+'）。原工作区仍保留；请检查是否已有新窗口，不要立即重复启动。');
  }finally{
    finished=true;
    // Never delete a portable child's executable extraction directory while it may be running.
    if(!portable||!started||exited)await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}
