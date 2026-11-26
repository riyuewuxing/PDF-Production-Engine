import { useCallback,useEffect,useRef,useState } from 'react';
import { RotateCcw,Trash2 } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import type { ResumeTrashList,ResumeTrashMeta } from '../../server/localFsApi';

export function RecycleBinPanel({onRestore,refreshKey=0}:{onRestore:(id:string,revision:string,asCopy:boolean)=>Promise<void>;refreshKey?:number}){
  const [data,setData]=useState<ResumeTrashList|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const seq=++generation.current;setLoading(true);
    try{const result=await apiClient.listTrash();if(generation.current===seq){setData(result);setError(null);}}
    catch(err){if(generation.current===seq){setError(err instanceof Error?err.message:'读取回收站失败。');}}
    finally{if(generation.current===seq)setLoading(false);}
  },[]);
  useEffect(()=>{if(open)void refresh();return()=>{generation.current++;};},[open,refresh,refreshKey]);
  const restore=async(item:ResumeTrashMeta,asCopy:boolean)=>{
    if(busy)return;
    if(!window.confirm(asCopy?'将此记录另存为新版本，原归档和原有历史保留。继续吗？':'恢复到原版本标识，不覆盖任何现有版本。继续吗？'))return;
    setBusy(true);setNotice(null);setError(null);
    try{
      await onRestore(item.id,item.revision,asCopy);
      await refresh();
      setNotice(asCopy?'已恢复为新副本，原归档保留。':'已恢复原版本。');
    }catch(err){setError(err instanceof Error?err.message:'恢复失败。');}
    finally{setBusy(false);}
  };
  const purge=async(item:ResumeTrashMeta)=>{
    if(busy)return;
    if(!window.confirm('永久删除回收站中的「'+item.title+'」？该操作不能通过回收站撤销。'))return;
    if(!window.confirm('再次确认永久删除这份归档文件。历史快照、已投递快照及资源不会被同时删除。'))return;
    setBusy(true);setError(null);setNotice(null);
    try{await apiClient.purgeTrash(item.id,item.revision);await refresh();setNotice('已永久删除指定归档。');}
    catch(err){setError(err instanceof Error?err.message:'永久删除失败。');}
    finally{setBusy(false);}
  };
  return <section className="rounded-lg border border-slate-200 bg-white p-3 text-left text-xs text-slate-800 space-y-2" aria-label="本地版本回收站">
    <button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open} className="flex w-full items-center justify-between font-semibold">
      <span className="inline-flex items-center gap-1.5"><Trash2 size={13}/>本地版本回收站{data?'（'+data.items.length+'）':''}</span><span>{open?'收起':'展开'}</span>
    </button>
    {open&&<>
      <p className="text-[11px] text-slate-500">移入回收站的版本不会自动清理。恢复原版本保留原标识；另存副本不覆盖任何文件。母库及投递历史独立保护。</p>
      <button type="button" onClick={()=>void refresh()} disabled={busy||loading} className="rounded border border-slate-300 px-2 py-1">刷新回收站</button>
      {loading&&<p>正在读取本地归档…</p>}
      {error&&<div role="alert" className="rounded bg-red-50 p-2 text-red-700">{error}</div>}
      {notice&&<div role="status" className="rounded bg-emerald-50 p-2 text-emerald-800">{notice}</div>}
      {!!data?.unreadableCount&&<div className="rounded bg-amber-50 p-2 text-amber-800">{data.unreadableCount} 条归档无法读取，文件未修改，请检查 data/.trash。</div>}
      {data?.items.length===0&&!loading&&<p className="text-slate-500">回收站为空。</p>}
      {data?.items.map(item=><div key={item.id} className="space-y-1.5 rounded border border-slate-200 p-2">
        <div className="break-words font-semibold">{item.title}</div>
        <div className="break-all text-[10px] text-slate-500">{item.slug} · {new Date(item.deletedAt).toLocaleString()}</div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={busy} onClick={()=>void restore(item,false)} className="inline-flex items-center gap-1 rounded border border-teal-300 px-2 py-1 text-teal-800 disabled:opacity-50"><RotateCcw size={11}/>恢复原版本</button>
          <button type="button" disabled={busy} onClick={()=>void restore(item,true)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50">另存恢复副本</button>
          <button type="button" disabled={busy} onClick={()=>void purge(item)} className="rounded border border-red-200 px-2 py-1 text-red-700 disabled:opacity-50">永久删除归档</button>
        </div>
      </div>)}
    </>}
  </section>;
}
