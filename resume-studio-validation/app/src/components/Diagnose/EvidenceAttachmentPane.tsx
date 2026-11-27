import {useEffect,useRef,useState} from 'react';
import type {FactRecord} from '../../schema/factBankSchema';
import type {EvidenceEntry,EvidenceIndex,EvidenceIntegrity,EvidenceVaultAudit} from '../../schema/evidenceSchema';
import {MAX_EVIDENCE_FILE_BYTES,MAX_EVIDENCE_RECORDS,MAX_EVIDENCE_VAULT_BYTES} from '../../schema/evidenceSchema';
import type {ResumeDocument} from '../../schema/resumeSchema';
import {factEntityId} from '../../lib/aiContext';
import {localErrorMessage} from '../../lib/apiClient';

type Props={document:ResumeDocument;slug:string;fact:FactRecord;bankRevision:string;locked:boolean;onBusy:(busy:boolean)=>void;onFlush:()=>Promise<void>;getRevision:()=>string;onClose:()=>void};
const INTEGRITY:Record<EvidenceIntegrity['state'],string>={intact:'字节校验一致',missing:'本地副本缺失',changed:'本地副本已变化',unreadable:'本地副本不可安全读取',purged:'副本已删除'};
const sizeLabel=(n:number)=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';

export function EvidenceAttachmentPane(props:Props){
  const [index,setIndex]=useState<EvidenceIndex|null>(null);
  const [audit,setAudit]=useState<EvidenceVaultAudit|null>(null);
  const [integrity,setIntegrity]=useState<Record<string,EvidenceIntegrity>>({});
  const [note,setNote]=useState('');
  const [consent,setConsent]=useState(false);
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const busyRef=useRef(false),mounted=useRef(false),latest=useRef(props);latest.current=props;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const bridge=window.resumeDesktop?.evidence;
  const rootId=props.fact.linkedFrom?.recordId??props.fact.id;
  const rootOnly=props.fact.sourceScope==='manual';
  const canAttach=rootOnly&&props.fact.verifiedStatus==='user-confirmed'&&props.fact.docId===props.document.id&&factEntityId(props.document,props.fact.blockKey)===props.fact.entityId;
  const locked=props.locked||busy;
  const rows=(index?.entries.filter(e=>e.factId===rootId)??[]).slice().reverse();
  const search=query.trim().toLocaleLowerCase();
  const shown=rows.filter(e=>!search||[e.originalName,e.note,e.kind,e.sha256].join(' ').toLocaleLowerCase().includes(search));
  const update=(value:EvidenceIndex)=>{setIndex(value);setIntegrity({});setAudit(null);};
  const task=async(work:()=>Promise<void>)=>{
    if(!bridge||busyRef.current||props.locked)return;
    busyRef.current=true;setBusy(true);props.onBusy(true);setError('');setNotice('');
    try{await work();}catch(err){if(mounted.current)setError(localErrorMessage(err,'本地证据附件操作失败'));}
    finally{busyRef.current=false;props.onBusy(false);if(mounted.current)setBusy(false);}
  };
  const refresh=()=>void task(async()=>{const value=await bridge!.get();if(mounted.current){update(value);setNotice('已读取本地证据索引。');}});
  const attach=()=>{
    if(!index||!consent||!canAttach)return;
    const before=props,rev=index.revision,description=note;
    void task(async()=>{
      await before.onFlush();
      const now=latest.current;
      if(!mounted.current||now.slug!==before.slug||now.document.id!==before.document.id||now.fact.id!==before.fact.id||now.bankRevision!==before.bankRevision||now.fact.verifiedStatus!=='user-confirmed'||factEntityId(now.document,now.fact.blockKey)!==now.fact.entityId)
        throw new Error('事实或当前版本已变化，请重新核对附件关联。');
      const result=await bridge!.attach({slug:now.slug,docRevision:now.getRevision(),factId:now.fact.id,bankRevision:now.bankRevision,indexRevision:rev,note:description,confirmation:'CONFIRM_LOCAL_EVIDENCE_COPY'});
      if(!mounted.current)return;
      if(result.canceled){setNotice('已取消文件选择，未保存附件。');return;}
      update(result.index);setNote('');setConsent(false);setNotice('附件已复制到独立本地证据目录，未修改原始文件或事实。');
    });
  };
  const verify=(e:EvidenceEntry)=>index&&void task(async()=>{
    const result=await bridge!.verify({id:e.id,indexRevision:index.revision});
    if(mounted.current)setIntegrity(map=>({...map,[e.id]:result}));
  });
  const reveal=(e:EvidenceEntry)=>index&&void task(()=>bridge!.reveal({id:e.id,indexRevision:index.revision}));
  const detach=(e:EvidenceEntry)=>{
    if(!index||!rootOnly||!window.confirm('解除此证据附件关联？保留本地副本及历史索引，不改变原事实或 AI 授权。'))return;
    void task(async()=>{const value=await bridge!.detach({id:e.id,indexRevision:index.revision,confirmation:'DETACH_LOCAL_EVIDENCE'});if(mounted.current){update(value);setNotice('已解除附件关联，副本与历史索引仍保留。');}});
  };
  const purge=(e:EvidenceEntry)=>{
    if(!index||!rootOnly||!window.confirm('永久删除工作台管理的附件副本？不会删除你选择的原始文件，历史文件名、摘要和说明仍保留。此操作不可撤销。'))return;
    void task(async()=>{const value=await bridge!.purge({id:e.id,indexRevision:index.revision,confirmation:'DELETE_MANAGED_EVIDENCE_COPY'});if(mounted.current){update(value);setNotice('已删除工作台副本，保留历史索引。');}});
  };
  return <section aria-label="本地证据附件索引" className="space-y-2 rounded border border-indigo-200 bg-indigo-50/50 p-2 break-words studio-ui-info-border studio-ui-info-surface">
    <div className="flex items-start justify-between gap-2"><div className="font-semibold text-indigo-900 studio-ui-info">本地证据附件索引</div><button data-studio-control="true" type="button" disabled={locked} onClick={props.onClose} className="rounded border px-2 py-0.5 studio-ui-border">关闭附件索引</button></div>
    <div>事实：{props.fact.assertion}</div>
    {!rootOnly&&<p className="text-indigo-900 studio-ui-info">跨版本关联：只读查看原始事实的附件；增删请管理原始记录。</p>}
    <p>附件、文件名、说明和 SHA-256 仅存本地，不进入 AI 请求或简历导出。字节一致仅表示与导入副本相符，不代表内容真实或已独立鉴证。附件管理不改变既有事实外发授权。</p>
    {!bridge&&<p>当前仅桌面版支持本地附件管理。</p>}
    <button data-studio-control="true" type="button" disabled={locked||!bridge} onClick={refresh} className="rounded border bg-white px-2 py-1 studio-ui-surface studio-ui-border">加载 / 刷新附件索引</button>
    <div className="flex flex-wrap gap-1">
      <button data-studio-control="true" type="button" disabled={locked||!bridge} onClick={()=>void task(async()=>{const value=await bridge!.audit();if(mounted.current)setAudit(value);})} className="rounded border bg-white px-2 py-1 studio-ui-surface studio-ui-border">核对本地附件目录</button>
      <button data-studio-control="true" type="button" disabled={locked||!bridge} onClick={()=>void task(()=>bridge!.openVault())} className="rounded border bg-white px-2 py-1 studio-ui-surface studio-ui-border">打开本地证据目录</button>
    </div>
    {audit&&<div aria-label="本地附件目录核对结果" className="rounded border border-indigo-200 bg-white p-2 space-y-1 studio-ui-info-border studio-ui-surface">
      <div className="font-semibold">目录核对（全库，非全文哈希）</div>
      <div>普通文件 {audit.regularFiles} 个 · {sizeLabel(audit.totalBytes)} / {MAX_EVIDENCE_VAULT_BYTES/1048576} MB</div>
      <div>缺失副本 {audit.missingCopies} · 大小变化 {audit.sizeMismatches} · 未索引文件 {audit.unindexedFiles}</div>
      <div>异常项目 {audit.unsafeEntries} · 已删除记录残留 {audit.purgedResiduals}</div>
      {audit.indexMissingWithFiles&&<p className="font-semibold text-red-800 studio-ui-error">证据索引缺失但目录仍有文件：已禁止新增附件。请先备份并恢复原索引，不自动重建。</p>}
      <div className="text-slate-600 studio-ui-muted">检查时间：{audit.checkedAt.replace('T',' ').slice(0,19)} UTC。仅报告，不自动删除或修复；同大小内容变化需逐个 SHA-256 校验。</div>
      {(audit.missingCopies+audit.sizeMismatches+audit.unindexedFiles+audit.unsafeEntries+audit.purgedResiduals)>0&&<p className="text-amber-800 studio-ui-warning">发现目录差异，请先核对并备份；系统未自动更改任何附件。</p>}
    </div>}
    {busy&&<p role="status">正在处理本地附件…</p>}
    {error&&<div role="alert" className="rounded bg-red-50 p-2 text-red-800 studio-ui-error-surface studio-ui-error">{error}</div>}
    {notice&&<div role="status" className="text-teal-800 studio-ui-info">{notice}</div>}
    {index&&<>
      <div className="text-slate-600 studio-ui-muted">有效关联 {rows.filter(e=>e.status==='attached').length} · 历史 {rows.filter(e=>e.status!=='attached').length} · 本地索引 {index.entries.length}/{MAX_EVIDENCE_RECORDS}</div>
      <label className="block">搜索附件<input data-studio-control="true" aria-label="搜索证据附件" value={query} onChange={e=>setQuery(e.target.value)} className="mt-1 w-full rounded border p-1.5 studio-ui-border" placeholder="名称、来源说明、格式、SHA-256"/></label>
      <div aria-label="本地附件列表" className="max-h-64 space-y-2 overflow-auto">
        {!shown.length&&<p>没有匹配的附件记录。</p>}
        {shown.map(e=><div key={e.id} className="space-y-1 rounded border bg-white p-2 studio-ui-surface studio-ui-border">
          <div className="font-semibold">{e.originalName}</div>
          <div>{e.kind.toUpperCase()} · {sizeLabel(e.size)} · {e.status==='attached'?'有效关联':e.status==='detached'?'已解除关联，保留副本':'已删除副本，保留历史'}</div>
          <div className="text-slate-600 studio-ui-muted">{e.note||'（无补充说明）'}</div>
          <div className="text-slate-600 studio-ui-muted">SHA-256：<span className="font-mono break-all">{e.sha256}</span></div>
          <div className="text-slate-600 studio-ui-muted">导入：{e.createdAt.replace('T',' ').slice(0,19)} UTC</div>
          {integrity[e.id]&&<div role="status" className={integrity[e.id]?.state==='intact'?'text-teal-800 studio-ui-info':'text-red-800 studio-ui-error'}>{INTEGRITY[integrity[e.id]!.state]} · {integrity[e.id]!.checkedAt.replace('T',' ').slice(0,19)} UTC</div>}
          <div className="flex flex-wrap gap-1">
            <button data-studio-control="true" type="button" disabled={locked||e.status==='purged'} onClick={()=>verify(e)} className="rounded border px-2 py-1 studio-ui-border">校验副本 SHA-256</button>
            <button data-studio-control="true" type="button" disabled={locked||e.status==='purged'} onClick={()=>reveal(e)} className="rounded border px-2 py-1 studio-ui-border">在文件夹定位副本</button>
            {rootOnly&&e.status==='attached'&&<button data-studio-control="true" type="button" disabled={locked} onClick={()=>detach(e)} className="rounded border px-2 py-1 text-amber-800 studio-ui-warning studio-ui-border">解除附件关联</button>}
            {rootOnly&&e.status==='detached'&&<button data-studio-control="true" type="button" disabled={locked} onClick={()=>purge(e)} className="rounded border px-2 py-1 text-red-800 studio-ui-error studio-ui-border">删除本地附件副本</button>}
          </div>
        </div>)}
      </div>
      {canAttach?<div className="space-y-2 rounded border bg-white p-2 studio-ui-surface studio-ui-border">
        <div className="font-semibold">关联新的本地文件</div>
        <p>支持 PDF、PNG、JPG、UTF-8 TXT；单文件 {MAX_EVIDENCE_FILE_BYTES/1048576} MB，目录最多 {MAX_EVIDENCE_VAULT_BYTES/1048576} MB。只复制明确选择的文件，不扫描目录、不自动打开附件。</p>
        <label className="block">来源说明（可选）<textarea data-studio-control="true" aria-label="附件来源说明" disabled={locked} rows={2} maxLength={500} value={note} onChange={e=>{setNote(e.target.value);setConsent(false);}} className="mt-1 w-full rounded border p-1.5 studio-ui-border"/></label>
        <label className="flex items-start gap-1"><input data-studio-control="true" type="checkbox" disabled={locked} checked={consent} onChange={e=>setConsent(e.target.checked)}/>我确认将选择的附件复制到本地并关联该事实，不允许自动外发</label>
        <button data-studio-control="true" type="button" disabled={locked||!consent||audit?.indexMissingWithFiles===true||index.entries.length>=MAX_EVIDENCE_RECORDS} onClick={attach} className="rounded bg-indigo-700 px-2 py-1 text-white disabled:opacity-50 studio-ui-fill studio-ui-on-fill">选择文件并关联证据</button>
      </div>:<p className="text-slate-600 studio-ui-muted">只有当前版本的有效原始事实可新增附件；历史或其他版本记录仍可本地追溯。</p>}
    </>}
  </section>;
}
