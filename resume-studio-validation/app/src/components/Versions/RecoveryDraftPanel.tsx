import { useStudioComponentSkins } from '../../studio-theme/StudioThemeProvider';
import { buttonSkin } from '../../studio-theme/componentSkins';
import {useStudioThemeId} from '../../studio-theme/StudioThemeProvider';
import {surfaceStyle} from '../../studio-theme/surfaces';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {apiClient,localErrorMessage} from '../../lib/apiClient';
import {careerLedger} from '../../lib/careerLedgerSession';
import type {DraftSummary,DraftList,DraftRecord} from '../../schema/recoveryDraftSchema';
const labels:Record<DraftSummary['state'],string>={'same-base':'原版本未变化',changed:'原版本已变化',missing:'原版本已不存在','already-saved':'内容与正式保存一致',unreadable:'无法核对原版本',active:'原进程可能仍在运行，暂不可操作'};
export function RecoveryDraftPanel({onImport}:{onImport:(raw:unknown,title:string)=>Promise<void>}){
  const skins=useStudioComponentSkins();
  const themeId=useStudioThemeId();
  const bridge=window.resumeDesktop?.recoveryDrafts;
  const ledger=useSyncExternalStore(careerLedger.subscribe,careerLedger.getSnapshot);
  const [data,setData]=useState<DraftList>({drafts:[],unreadable:0}),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false);
  const [review,setReview]=useState<DraftRecord|null>(null);
  async function refresh(){setReview(null);if(bridge)setData(await bridge.list());}
  useEffect(()=>{if(!bridge)return;let active=true;void bridge.list().then(value=>{if(active)setData(value);},()=>{if(active)setError('无法检查自动恢复草稿；原文件未清理。');});return()=>{active=false;};},[bridge]);
  if(!bridge)return null;
  const run=async(work:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError(localErrorMessage(e,'恢复草稿操作失败。'));}finally{setBusy(false);}};
  const exportDraft=(row:DraftSummary)=>void run(async()=>{
    const record=await bridge.get(row.id,row.token);
    const saved=await apiClient.saveTextFile({defaultFileName:'recovery-'+row.id+'.json',content:JSON.stringify(record.input.data,null,2)+'\n',extension:'json',saveAs:true,dialogTitle:'另存恢复草稿'});
    if(!saved.canceled)setNotice('草稿已另存为本地 JSON；原草稿仍保留。');
  });
  const restoreResume=(row:DraftSummary)=>void run(async()=>{
    const record=await bridge.get(row.id,row.token);
    if(record.input.kind!=='resume')throw Error('此草稿不是简历。');
    if(!window.confirm('恢复为新的独立简历版本？不会覆盖原版本或母库。'))return;
    await onImport({...record.input.data,title:record.input.data.title+'（恢复草稿）'},'恢复草稿');
    setReview(null);
    setNotice('已创建恢复简历副本；原草稿保留，核对后可手动清除。');
  });
  const restoreLedger=(row:DraftSummary)=>void run(async()=>{
    if(review?.id!==row.id||review.token!==row.token)throw Error('请先查看这份台账草稿的实际内容。');
    if(row.state!=='same-base')throw Error('原台账版本已变化，请先另存草稿并人工核对。');
    const record=await bridge.get(row.id,row.token);
    if(record.input.kind!=='ledger')throw Error('此草稿不是台账。');
    if(!window.confirm('确认将草稿恢复到未变化的正式台账？如磁盘版本已变化将拒绝覆盖。'))return;
    // Prevent unsaved renderer edits being overwritten by an independent recovery.
    await careerLedger.restoreRecovery(record.input.data,record.input.baseRevision);
    setNotice('台账草稿已恢复并重新读取；原草稿保留，核对后可清除。');await refresh();
  });
  const discard=(row:DraftSummary)=>void run(async()=>{
    if(!window.confirm('永久清除这一份自动恢复草稿？不会删除正式简历或台账。'))return;
    if(!await bridge.clear({id:row.id,token:row.token},'DISCARD_RECOVERY'))throw Error('草稿已变化或不存在，请重新检查。');
    await refresh();setNotice('所选恢复草稿已清除。');
  });
  if(!data.drafts.length&&!data.unreadable&&!error&&!notice&&!ledger.recoveryError)return null;
  return <section data-studio-region="recovery-drafts" data-studio-surface="panel" data-studio-theme={themeId} style={surfaceStyle(themeId,'panel')} data-studio-status="warning" aria-label="异常退出草稿恢复" className="no-print shrink-0 border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
    <div className="flex flex-wrap items-center gap-2"><strong>本地自动恢复草稿 {data.drafts.length} 份</strong><span>不会自动覆盖正式资料。</span><button data-studio-control="true" type="button" className="rounded border bg-white px-2 py-1 studio-ui-surface studio-ui-primary studio-ui-border" onClick={()=>setExpanded(x=>!x)}>{expanded?'收起恢复草稿':'检查恢复草稿'}</button></div>
    {ledger.recoveryError&&<p role="alert">{ledger.recoveryError}</p>}{error&&<p role="alert" className="text-red-800 studio-ui-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {expanded&&<div className="mt-2 max-h-64 space-y-2 overflow-y-auto"><p>草稿只保存在本地、未加密，只能恢复已完成检查点写入的内容。不会随正式工作区备份复制。</p>
      {!!data.unreadable&&<p role="alert">{data.unreadable} 份草稿无法读取，文件保留供人工检查。</p>}
      <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={busy} onClick={()=>void run(refresh)} className="rounded border bg-white px-2 py-1 studio-ui-surface studio-ui-primary studio-ui-border">重新检查恢复草稿</button>
      {data.drafts.map(row=><article key={row.id} className="rounded border border-amber-200 bg-white p-2 studio-ui-surface studio-ui-primary studio-ui-warning-border">
        <p className="break-all font-semibold">{row.title}</p><p>{new Date(row.createdAt).toLocaleString()} · {labels[row.state]}{row.slug?' · '+row.slug:''}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {row.kind==='resume'&&row.state!=='already-saved'&&row.state!=='active'&&<button {...buttonSkin(skins,'primary')} data-studio-control="true" type="button" disabled={busy} onClick={()=>restoreResume(row)} className="rounded bg-teal-700 px-2 py-1 text-white studio-ui-fill studio-ui-on-fill">恢复为新简历</button>}
          {row.kind==='ledger'&&row.state==='same-base'&&<button {...buttonSkin(skins,'primary')} data-studio-control="true" type="button" disabled={busy||ledger.dirty||ledger.saving||ledger.loading||review?.id!==row.id||review.token!==row.token} onClick={()=>restoreLedger(row)} className="rounded bg-teal-700 px-2 py-1 text-white studio-ui-fill studio-ui-on-fill">恢复未变化台账</button>}
          <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={busy||row.state==='active'} onClick={()=>void run(async()=>{setReview(await bridge.get(row.id,row.token));})} className="rounded border px-2 py-1 studio-ui-border studio-ui-surface studio-ui-primary">查看草稿内容</button>
          <button {...buttonSkin(skins)} data-studio-control="true" type="button" disabled={busy||row.state==='active'} onClick={()=>exportDraft(row)} className="rounded border px-2 py-1 studio-ui-border studio-ui-surface studio-ui-primary">另存恢复草稿 JSON</button>
          <button {...buttonSkin(skins,'danger')} data-studio-control="true" type="button" disabled={busy||row.state==='active'} onClick={()=>discard(row)} className="rounded border px-2 py-1 text-red-700 studio-ui-border studio-ui-error">清除这份草稿</button>
        </div>
        {review?.id===row.id&&review.token===row.token&&<div aria-label="恢复草稿内容" className="mt-2"><p>本地草稿原始 JSON（仅预览，不写入）：</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-100 p-2 studio-ui-raised studio-ui-primary">{JSON.stringify(review.input.data,null,2)}</pre></div>}
      </article>)}
    </div>}
  </section>;
}
