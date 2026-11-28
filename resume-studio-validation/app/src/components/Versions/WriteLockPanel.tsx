import { useStudioComponentSkins } from '../../studio-theme/StudioThemeProvider';
import { buttonSkin } from '../../studio-theme/componentSkins';
import {useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {apiClient,localErrorMessage} from '../../lib/apiClient';
import type {ResumeWriteLockStatus} from '../../server/localFsApi';
export function WriteLockPanel({onRecovered}:{onRecovered?:()=>void}){
  const skins=useStudioComponentSkins();
  const [status,setStatus]=useState<ResumeWriteLockStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const refresh=async()=>{
    if(busy)return;setBusy(true);setError(null);
    try{setStatus(await apiClient.inspectWriteLock());}
    catch(err){setError(localErrorMessage(err,'检查写入锁失败。'));}
    finally{setBusy(false);}
  };
  const recover=async()=>{
    if(busy||status?.state!=='recoverable'||!status.token)return;
    if(!window.confirm('确认归档已退出进程留下的写入锁？不会修改简历或投递台账文件。'))return;
    setBusy(true);setError(null);
    try{
      await apiClient.recoverWriteLock(status.token);
      setStatus(await apiClient.inspectWriteLock());
      onRecovered?.();
    }catch(err){setError(localErrorMessage(err,'恢复锁失败，请重新检查。'));}
    finally{setBusy(false);}
  };
  const names={unlocked:'未锁定',active:'进程仍在运行',recoverable:'可安全归档的遗留锁',unknown:'状态不可确认'};
  return <section className="rounded-lg border border-slate-200 studio-ui-border bg-white studio-ui-surface p-3 text-left text-xs text-slate-800 studio-ui-primary space-y-2" aria-label="本地写入锁检查">
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 font-semibold"><ShieldCheck size={14}/>本地写入锁检查</span>
      <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={busy} onClick={()=>void refresh()} className="rounded border border-slate-300 studio-ui-border px-2 py-1">检查写入锁</button>
    </div>
    {status&&<div role="status" className="rounded bg-slate-50 studio-ui-raised p-2">
      <div className="font-semibold">{names[status.state]}</div>
      <div className="mt-1">{status.reason}</div>
      {status.pid&&<div className="mt-1 text-[10px] text-slate-500 studio-ui-muted">PID {status.pid} · {status.acquiredAt?new Date(status.acquiredAt).toLocaleString():''}</div>}
      {status.state==='recoverable'&&<button {...buttonSkin(skins,'primary')} data-studio-control="true" type="button" disabled={busy} onClick={()=>void recover()} className="mt-2 rounded border border-amber-400 studio-ui-warning-border bg-amber-50 studio-ui-warning-surface px-2 py-1 text-amber-900 studio-ui-warning">确认恢复遗留锁</button>}
    </div>}
    {error&&<p role="alert" className="text-red-700 studio-ui-error">{error}</p>}
    <p className="text-[10px] text-slate-500 studio-ui-muted">不根据时间自动抢锁；恢复后仍需重试原保存，旧锁保留为本地诊断记录。</p>
  </section>;
}
