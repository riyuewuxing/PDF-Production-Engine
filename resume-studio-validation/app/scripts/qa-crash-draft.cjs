const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const exe=require('electron'),out=process.env.RESUME_STUDIO_CRASH_OUT;
if(!out)throw Error('missing crash output directory');
fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-crash-'));
let current=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function launch(stage){
 const child=spawn(exe,[path.join(process.cwd(),'validation-crash.cjs')],{cwd:process.cwd(),env:{...process.env,RESUME_STUDIO_DATA_DIR:root,RESUME_STUDIO_CRASH_STAGE:stage},stdio:['ignore','pipe','pipe'],windowsHide:false});current=child;
 let log='',closed=false;child.stdout.on('data',b=>{log=(log+b).slice(-8000)});child.stderr.on('data',b=>{log=(log+b).slice(-8000)});
 const done=new Promise(resolve=>{child.once('close',(code,signal)=>{closed=true;resolve({code,signal,log})});child.once('error',e=>{closed=true;resolve({code:-1,log:e.message})})});
 return {child,done,isClosed:()=>closed};
}
async function bounded(p,ms,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' watchdog expired')),ms)})]);}finally{clearTimeout(timer);}}
(async()=>{
 const a=launch('prepare'),marker=path.join(out,'ready-to-kill.json'),stop=Date.now()+35000;
 while(!fs.existsSync(marker)&&Date.now()<stop&&!a.isClosed())await sleep(100);
 if(!fs.existsSync(marker)||a.isClosed())throw Error('prepare did not produce durable marker '+(a.isClosed()?JSON.stringify(await a.done):''));
 const marked=JSON.parse(fs.readFileSync(marker,'utf8'));if(marked.pid!==a.child.pid)throw Error('marker PID mismatch');
 if(!a.child.kill('SIGKILL'))throw Error('force termination request failed');
 const killed=await bounded(a.done,8000,'force termination');
 if(killed.code===0)throw Error('fixture exited normally instead of force termination');
 fs.writeFileSync(path.join(out,'force-kill.json'),JSON.stringify({pid:marked.pid,code:killed.code,signal:killed.signal,forced:true}));
 const b=launch('recover');const result=await bounded(b.done,55000,'restart');
 if(result.code!==0)throw Error('recovery child failed '+JSON.stringify(result));
 console.log('Real forced process termination and new renderer recovery passed.');
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>{if(current&&!current.killed)try{current.kill('SIGKILL')}catch{};try{fs.rmSync(root,{recursive:true,force:true})}catch{}});
