import {useRef,useState} from 'react';
import type {ResumeDocument} from '../../schema/resumeSchema';
import type {FactBank,FactInput,FactRecord} from '../../schema/factBankSchema';
import {factEntityId,isShareableFact} from '../../lib/aiContext';
import {canLinkFactToDocument} from '../../lib/factLink';
import {EvidenceAttachmentPane} from './EvidenceAttachmentPane';
import {localErrorMessage} from '../../lib/apiClient';
import type {EditableBlockOption} from '../../lib/resumeBlocks';

const blank:FactInput={kind:'other',assertion:'',value:'',unit:'',timeframe:'',evidenceRef:'',sensitivity:'local-only'};
type Props={document:ResumeDocument;slug:string;blocks:readonly EditableBlockOption[];keys:readonly string[];bank:FactBank|null;selected:readonly string[];locked:boolean;onBank:(bank:FactBank)=>void;onSelected:(ids:string[])=>void;onBusy:(busy:boolean)=>void;onFlush:()=>Promise<void>;getRevision:()=>string};
export function FactBankPane(props:Props){
  const [target,setTarget]=useState('');
  const [correction,setCorrection]=useState<string|null>(null);
  const [linking,setLinking]=useState<FactRecord|null>(null);
  const [linkShareable,setLinkShareable]=useState(false);
  const [linkConfirmed,setLinkConfirmed]=useState(false);
  const [draft,setDraft]=useState<FactInput>(blank);
  const [confirmedEntity,setConfirmedEntity]=useState<string|null>(null);
  const confirmed=confirmedEntity!==null&&confirmedEntity===factEntityId(props.document,target);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [showOther,setShowOther]=useState(false);
  const [query,setQuery]=useState('');
  const [evidenceId,setEvidenceId]=useState<string|null>(null);
  const evidenceRecord=props.bank?.records.find(r=>r.id===evidenceId);
  const busy=useRef(false);
  const latest=useRef(props);latest.current=props;
  const bridge=window.resumeDesktop?.facts;
  const records=(props.bank?.records.filter(r=>showOther||r.docId===props.document.id)??[]).sort((a,b)=>Number(a.verifiedStatus==='revoked')-Number(b.verifiedStatus==='revoked')||b.modifiedAt.localeCompare(a.modifiedAt));
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const visibleRecords=records.filter(r=>!normalizedQuery||[r.assertion,r.value,r.unit,r.timeframe,r.evidenceRef,r.documentTitle,r.blockLabel].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalizedQuery));
  const edit=<K extends keyof FactInput>(key:K,value:FactInput[K])=>{setDraft(d=>({...d,[key]:value}));setConfirmedEntity(null);};
  const task=async(work:()=>Promise<FactBank>,success:string)=>{
    if(busy.current||props.locked)return;
    busy.current=true;props.onBusy(true);setError('');setNotice('');
    try{const bank=await work();props.onBank(bank);setNotice(success);}
    catch(e){setError(localErrorMessage(e,'事实库操作失败'));}
    finally{busy.current=false;props.onBusy(false);}
  };
  const create=()=>{
    if(!bridge||!props.bank||!confirmed||!draft.assertion.trim()||!draft.evidenceRef.trim())return;
    const identity=factEntityId(props.document,target);
    if(!identity){setError('请选择唯一的可见段落。');return;}
    const rev=props.bank.revision,slug=props.slug,docId=props.document.id;
    void task(async()=>{
      await props.onFlush();
      const current=latest.current;
      if(current.slug!==slug||current.document.id!==docId||factEntityId(current.document,target)!==identity)throw new Error('简历或关联主体已变化，请重新核对。');
      const saved=await bridge.add({slug,docRevision:current.getRevision(),blockKey:target,bankRevision:rev,fact:draft,...(correction?{supersedesId:correction}:{}),confirmation:'CONFIRM_SELF_REPORTED_FACT'});
      setDraft(blank);setConfirmedEntity(null);setCorrection(null);return saved;
    },correction?'事实已更正，原记录保留且不再可引用。':'事实已保存到独立本地资料库。');
  };
  const beginCorrection=(r:FactRecord)=>{
    setTarget(r.blockKey);setCorrection(r.id);
    setDraft({kind:r.kind,assertion:r.assertion,value:r.value,unit:r.unit,timeframe:r.timeframe,evidenceRef:r.evidenceRef,sensitivity:'local-only'});
    setConfirmedEntity(null);setError('');setNotice('');
  };
  const link=()=>{
    if(!bridge||!props.bank||!linking||!linkConfirmed||!canLinkFactToDocument(props.document,linking))return;
    const source=linking,rev=props.bank.revision,slug=props.slug,docId=props.document.id,identity=factEntityId(props.document,source.blockKey);
    const sensitivity=linkShareable?'shareable' as const:'local-only' as const;
    void task(async()=>{
      await props.onFlush();
      const current=latest.current;
      if(current.slug!==slug||current.document.id!==docId||factEntityId(current.document,source.blockKey)!==identity)throw new Error('当前关联主体已变化。');
      const result=await bridge.link({slug,docRevision:current.getRevision(),sourceId:source.id,bankRevision:rev,sensitivity,confirmation:'CONFIRM_SAME_ENTITY_FACT_LINK'});
      setLinking(null);setLinkShareable(false);setLinkConfirmed(false);return result;
    },'已关联到当前版本；原始事实撤销或更正时，关联记录同步失效。');
  };
  const revoke=(id:string)=>{
    if(!bridge||!props.bank||!window.confirm('撤销此事实的使用授权？原始事实的跨版本关联记录也将撤销。历史记录仍保留。'))return;
    const bankRevision=props.bank.revision;
    void task(()=>bridge.revoke({id,bankRevision,confirmation:'REVOKE_FACT'}),'事实已撤销，旧 AI 审批已失效。');
  };
  const field=(label:string,key:'value'|'unit'|'timeframe'|'evidenceRef',maxLength:number)=><label className="block">{label}<input aria-label={label} disabled={props.locked} value={draft[key]} maxLength={maxLength} onChange={e=>edit(key,e.target.value)} className="mt-1 w-full rounded border p-1.5"/></label>;
  return <details className="rounded border border-slate-200 p-2 space-y-2 studio-ui-border">
    <summary data-studio-control="true" className="cursor-pointer font-semibold">本地事实资料库（{records.filter(r=>r.verifiedStatus==='user-confirmed').length} 条）</summary>
    <p className="text-slate-600 studio-ui-muted">与简历正文、母库分开保存。人工确认仅表示本人核对，不是独立证据验证。证据位置只保存在本机，默认不外发；每次任务还需单独勾选可外发事实。</p>
    {!bridge&&<p>本地事实库仅支持当前桌面桥接版本。</p>}
    <button data-studio-control="true" type="button" disabled={props.locked||!bridge} onClick={()=>bridge&&void task(()=>bridge.get(),'已读取本地事实资料库。')} className="rounded border px-2 py-1 studio-ui-border">加载 / 刷新事实库</button>
    {error&&<div role="alert" className="rounded bg-red-50 p-2 text-red-800 studio-ui-error-surface studio-ui-error">{error}</div>}
    {notice&&<div role="status" className="text-teal-800 studio-ui-info">{notice}</div>}
    {props.bank&&<>
      <label className="flex items-start gap-1"><input data-studio-control="true" type="checkbox" disabled={props.locked} checked={showOther} onChange={e=>setShowOther(e.target.checked)}/>显示其他版本及孤立记录（仅本地管理，不可直接外发）</label>
      <label className="block">本地搜索<input data-studio-control="true" aria-label="搜索本地事实" value={query} onChange={e=>setQuery(e.target.value)} placeholder="陈述、来源、时间或段落" className="mt-1 w-full rounded border p-1.5 studio-ui-border"/></label>
      <div className="text-slate-600 studio-ui-muted">有效 {records.filter(r=>r.verifiedStatus==='user-confirmed').length} 条 · 历史 {records.filter(r=>r.verifiedStatus==='revoked').length} 条 · 显示 {visibleRecords.length} 条</div>
      <div aria-label="本地事实记录列表" className="max-h-56 space-y-2 overflow-auto">{records.length===0&&<p>当前简历没有记录。请从下方手动添加。</p>}{records.length>0&&visibleRecords.length===0&&<p>没有匹配的事实。</p>}{visibleRecords.map(r=>{
        const matches=r.docId===props.document.id&&factEntityId(props.document,r.blockKey)===r.entityId;
        const eligible=isShareableFact(props.document,r)&&props.keys.includes(r.blockKey);
        return <article key={r.id} className="rounded border p-2 space-y-1 break-words studio-ui-border">
          <div className="font-semibold">{r.assertion}</div>
          <div className="text-slate-600 studio-ui-muted">关联：{r.documentTitle||'当前 / 历史简历'} · {r.blockLabel||props.blocks.find(b=>b.key===r.blockKey)?.label||'原关联段落'}</div>
          <div>{[r.value,r.unit,r.timeframe].filter(Boolean).join(' · ')}</div>
          <div className="text-slate-600 studio-ui-muted">本地证据位置：{r.evidenceRef}</div>
          {r.linkedFrom&&<div className="text-slate-600 studio-ui-muted">跨版本关联来源：{props.bank?.records.find(s=>s.id===r.linkedFrom?.recordId)?.documentTitle||'原始版本'} · {props.bank?.records.find(s=>s.id===r.linkedFrom?.recordId)?.assertion||'原始事实'}</div>}
          {r.supersedesId&&<div className="text-slate-600 studio-ui-muted">修订自：{props.bank?.records.find(s=>s.id===r.supersedesId)?.assertion||'旧记录'}</div>}
          <div className="text-slate-600 studio-ui-muted">{r.verifiedStatus==='revoked'?'已撤销':matches?'本人确认 · 非独立验证':r.docId!==props.document.id?'其他版本的本地记录':'关联主体已变更 / 隐藏'} · {r.sensitivity==='shareable'?'可按次选择外发':'仅本地'}</div>
          <label className="flex items-start gap-1"><input data-studio-control="true" type="checkbox" aria-label={'选择事实 '+r.assertion} disabled={props.locked||!eligible} checked={eligible&&props.selected.includes(r.id)} onChange={e=>props.onSelected(e.target.checked?[...props.selected,r.id]:props.selected.filter(id=>id!==r.id))}/>加入本次 AI 任务</label>
          {canLinkFactToDocument(props.document,r)&&!props.bank?.records.some(s=>s.linkedFrom?.recordId===r.id&&s.docId===props.document.id&&s.verifiedStatus==='user-confirmed')&&<button data-studio-control="true" type="button" disabled={props.locked||!bridge?.link} className="mr-3 text-teal-800 studio-ui-info" onClick={()=>{setLinking(r);setLinkShareable(false);setLinkConfirmed(false);}}>关联到当前同源段落</button>}
          {r.sourceScope==='manual'&&r.verifiedStatus==='user-confirmed'&&matches&&<button data-studio-control="true" type="button" disabled={props.locked} className="mr-3 text-teal-800 studio-ui-info" onClick={()=>beginCorrection(r)}>更正事实</button>}
          <button data-studio-control="true" type="button" disabled={props.locked||!window.resumeDesktop?.evidence} className="mr-3 text-indigo-800 studio-ui-info" onClick={()=>setEvidenceId(r.id)}>证据附件索引</button>
          {r.verifiedStatus!=='revoked'&&<button data-studio-control="true" type="button" disabled={props.locked} className="text-red-700 studio-ui-error" onClick={()=>revoke(r.id)}>撤销事实授权</button>}
        </article>;
      })}</div>
      {evidenceRecord&&<EvidenceAttachmentPane key={props.slug+':'+evidenceRecord.id} document={props.document} slug={props.slug} fact={evidenceRecord} bankRevision={props.bank.revision} locked={props.locked} onBusy={props.onBusy} onFlush={props.onFlush} getRevision={props.getRevision} onClose={()=>setEvidenceId(null)}/>}
      {linking&&<section aria-label="跨版本事实关联确认" className="rounded border border-teal-300 bg-teal-50 p-2 space-y-2 break-words studio-ui-info-border studio-ui-info-surface">
        <div className="font-semibold">跨版本关联（不修改简历正文）</div>
        <div>来源：{linking.documentTitle||'原版本'} · {linking.blockLabel||'原关联段落'}</div><div>{linking.assertion}</div>
        <div>目标：{props.document.title} · {props.blocks.find(b=>b.key===linking.blockKey)?.label}</div>
        <p>仅复制已确认事实的本地关联记录；不自动继承外发权限。原始事实撤销或更正会同步撤销关联记录。外发前还将核对原始版本。</p>
        <label className="flex items-start gap-1"><input data-studio-control="true" type="checkbox" disabled={props.locked||linking.sensitivity!=='shareable'} checked={linkShareable} onChange={e=>{setLinkShareable(e.target.checked);setLinkConfirmed(false);}}/>允许今后逐次选择该关联事实外发（默认关闭）</label>
        <label className="flex items-start gap-1"><input data-studio-control="true" type="checkbox" disabled={props.locked} checked={linkConfirmed} onChange={e=>setLinkConfirmed(e.target.checked)}/>我已核对原事实与当前段落的主体、时间及来源一致</label>
        <div className="flex gap-2"><button data-studio-control="true" type="button" disabled={props.locked||!linkConfirmed||!canLinkFactToDocument(props.document,linking)} onClick={link} className="rounded bg-teal-700 px-2 py-1 text-white disabled:opacity-50 studio-ui-fill studio-ui-on-fill">确认跨版本关联</button><button data-studio-control="true" type="button" disabled={props.locked} onClick={()=>setLinking(null)} className="rounded border px-2 py-1 studio-ui-border">取消关联</button></div>
      </section>}
      <div className="rounded bg-slate-50 p-2 space-y-2 studio-ui-raised">
        <div className="font-semibold">{correction?'更正事实（保留旧记录）':'新增本人核对的事实'}</div>
        {correction&&<button data-studio-control="true" type="button" disabled={props.locked} className="text-teal-800 studio-ui-info" onClick={()=>{setCorrection(null);setDraft(blank);setConfirmedEntity(null);}}>取消更正</button>}
        <label className="block">关联段落<select data-studio-control="true" aria-label="事实关联段落" disabled={props.locked||!!correction} value={target} onChange={e=>{setTarget(e.target.value);setConfirmedEntity(null);}} className="mt-1 w-full rounded border p-1.5 studio-ui-border"><option value="">选择可见段落</option>{props.blocks.map(b=><option key={b.key} value={b.key}>{b.label}</option>)}</select></label>
        <label className="block">类型<select data-studio-control="true" aria-label="事实类型" disabled={props.locked} value={draft.kind} onChange={e=>edit('kind',e.target.value as FactInput['kind'])} className="mt-1 w-full rounded border p-1.5 studio-ui-border">{Object.entries({experience:'经历',achievement:'成果',credential:'资质',skill:'技能',other:'其他'}).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
        <label className="block">事实陈述<textarea data-studio-control="true" aria-label="事实陈述" disabled={props.locked} rows={3} maxLength={2000} value={draft.assertion} onChange={e=>edit('assertion',e.target.value)} className="mt-1 w-full rounded border p-1.5 studio-ui-border"/></label>
        <div className="grid grid-cols-2 gap-2">{field('数值（可选）','value',200)}{field('单位（可选）','unit',80)}</div>
        {field('时间范围（可选）','timeframe',200)}{field('本地证据位置 / 来源说明','evidenceRef',1000)}
        <label className="flex items-start gap-1"><input data-studio-control="true" type="checkbox" disabled={props.locked} checked={draft.sensitivity==='shareable'} onChange={e=>edit('sensitivity',e.target.checked?'shareable':'local-only')}/>允许今后逐次选择此外发事实（默认关闭）</label>
        <label className="flex items-start gap-1"><input data-studio-control="true" type="checkbox" disabled={props.locked} checked={confirmed} onChange={e=>setConfirmedEntity(e.target.checked?factEntityId(props.document,target):null)}/>我已核对该陈述、主体和来源；确认新增本人自述事实</label>
        <button data-studio-control="true" type="button" disabled={props.locked||!target||!draft.assertion.trim()||!draft.evidenceRef.trim()||!confirmed} onClick={create} className="rounded bg-teal-700 px-2 py-1 text-white disabled:opacity-50 studio-ui-fill studio-ui-on-fill">{correction?'确认更正事实':'确认保存事实'}</button>
      </div>
    </>}
  </details>;
}
