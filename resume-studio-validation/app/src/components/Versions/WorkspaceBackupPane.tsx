import {useRef,useState} from 'react';
import {careerLedger} from '../../lib/careerLedgerSession';
import {localErrorMessage} from '../../lib/apiClient';
import type {BackupInspection,BackupResult,BackupSummary} from '../../schema/workspaceBackupSchema';

const labels:Record<string,string>={'master.json':'母库','resumes':'简历版本','assets':'照片与资源','.backups':'历史快照','.trash':'回收站','applications.json':'求职台账与岗位档案','.application-snapshots':'永久投递快照','.fact-bank-v1.json':'事实库','.evidence-index-v1.json':'附件索引','.evidence-files-v1':'证据附件'};
function Summary({value}:{value:BackupSummary}){
  return <div className="space-y-1 rounded border bg-white p-2">
    <p className="font-medium">已校验 {value.fileCount} 个文件 · {(value.totalBytes/1024/1024).toFixed(2)} MB</p>
    <p>备份时间：{new Date(value.createdAt).toLocaleString()}</p>
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{Object.entries(value.counts).map(([k,n])=><div key={k}>{labels[k]??k}：{n}</div>)}</div>
    {value.warnings.length>0&&<div className="max-h-40 overflow-auto rounded bg-amber-50 p-2 text-amber-900"><p className="font-semibold">原数据存在异常，备份不会修复这些问题：</p>{value.warnings.map((w,i)=><p key={i}>{w}</p>)}</div>}
  </div>;
}
export function WorkspaceBackupPane({onFlush}:{onFlush:()=>Promise<void>}){
  const bridge=window.resumeDesktop?.workspaceBackup;
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [inspection,setInspection]=useState<BackupInspection|null>(null),[result,setResult]=useState<BackupResult|null>(null),[confirmed,setConfirmed]=useState(false);
  const guard=useRef(false);
  if(!bridge)return null;
  const run=async(label:string,work:()=>Promise<void>)=>{
    if(guard.current)return;
    guard.current=true;setBusy(label);setError('');setNotice('');
    try{await work();}catch(e){setError(localErrorMessage(e,'工作区备份操作失败；未确认完成。'));}
    finally{guard.current=false;setBusy('');}
  };
  return <section aria-label="工作区备份与安全恢复" className="space-y-2 rounded-lg border border-teal-200 bg-teal-50/50 p-3 text-xs break-words">
    <div className="font-bold text-teal-900">工作区备份与安全恢复</div>
    <p>备份已落盘的母库、简历、资源、历史快照、回收站、求职台账、事实库与附件。逐文件 SHA-256 校验；恢复仅创建独立新工作区，不覆盖当前数据。</p>
    <p className="rounded bg-amber-50 p-2 text-amber-900">备份文件夹含未加密私人资料，请保存在可信本地磁盘。不会备份 AI 密钥/模型配置、已导出成品、外部原件或临时锁；未保存的编辑不属于备份。</p>
    {busy&&<p role="status">{busy}…</p>}{error&&<p role="alert" className="rounded bg-red-50 p-2 text-red-800">{error}</p>}{notice&&<p role="status" className="text-teal-800">{notice}</p>}
    <div className="flex flex-wrap gap-1">
      <button type="button" disabled={!!busy} className="rounded bg-teal-700 px-2 py-1.5 text-white disabled:opacity-50" onClick={()=>void run('正在创建备份',async()=>{
        setResult(null);setInspection(null);setConfirmed(false);
        await onFlush();await careerLedger.flush();
        if(careerLedger.getSnapshot().dirty||careerLedger.getSnapshot().saving)throw new Error('投递台账还有未确认写入，请先保存。');
        const saved=await bridge.create();if(saved){setResult(saved);setNotice('已创建并校验工作区备份。');}
      })}>创建本地工作区备份</button>
      <button type="button" disabled={!!busy} className="rounded border bg-white px-2 py-1.5" onClick={()=>void run('正在检查备份',async()=>{
        setInspection(null);setResult(null);setConfirmed(false);
        const checked=await bridge.inspect();if(checked){setInspection(checked);setNotice('备份文件清单及内容校验完成，当前工作区未改动。');}
      })}>检查已有备份</button>
    </div>
    {inspection&&<div className="space-y-2">
      <p className="break-all">{inspection.folder}</p><Summary value={inspection}/>
      <label className="flex items-start gap-1"><input type="checkbox" aria-label="确认恢复到独立新工作区" checked={confirmed} disabled={!!busy} onChange={e=>setConfirmed(e.target.checked)}/>我已检查备份范围及异常提示，确认仅恢复到独立新工作区，不切换或覆盖当前工作区。</label>
      <button type="button" disabled={!!busy||!confirmed} className="rounded bg-teal-700 px-2 py-1.5 text-white disabled:opacity-50" onClick={()=>void run('正在恢复到新工作区',async()=>{
        const basis=inspection;setInspection(null);setConfirmed(false);
        const restored=await bridge.restore(basis.token,'RESTORE_TO_NEW_WORKSPACE');
        if(restored){setResult(restored);setNotice('已恢复并校验独立新工作区，当前工作区未改动。');}
      })}>恢复到独立新工作区</button>
    </div>}
    {result&&<div aria-label="工作区备份结果" className="space-y-1">
      <p className="break-all">{result.folder}</p><Summary value={result}/>
      {result.folder.includes('resume-studio-restored-v1-')&&<p className="rounded bg-white p-2">请保留原工作区。关闭工作台后，通过 RESUME_STUDIO_DATA_DIR 环境变量指向上述新文件夹（不是其中的 data）再启动，可打开恢复副本。外部导出文件路径可能仍指向旧位置；需要重新配置 AI 密钥。</p>}
    </div>}
  </section>;
}
