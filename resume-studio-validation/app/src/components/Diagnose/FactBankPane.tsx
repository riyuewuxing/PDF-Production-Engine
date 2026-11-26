import {useRef,useState} from 'react';
import type {ResumeDocument} from '../../schema/resumeSchema';
import type {FactBank,FactInput} from '../../schema/factBankSchema';
import {factEntityId,isShareableFact} from '../../lib/aiContext';
import {localErrorMessage} from '../../lib/apiClient';
import type {EditableBlockOption} from '../../lib/resumeBlocks';

const blank:FactInput={kind:'other',assertion:'',value:'',unit:'',timeframe:'',evidenceRef:'',sensitivity:'local-only'};
type Props={document:ResumeDocument;slug:string;blocks:readonly EditableBlockOption[];keys:readonly string[];bank:FactBank|null;selected:readonly string[];locked:boolean;onBank:(bank:FactBank)=>void;onSelected:(ids:string[])=>void;onBusy:(busy:boolean)=>void;onFlush:()=>Promise<void>;getRevision:()=>string};
export function FactBankPane(props:Props){
  const [target,setTarget]=useState('');
  const [draft,setDraft]=useState<FactInput>(blank);
  const [confirmed,setConfirmed]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const busy=useRef(false);
  const latest=useRef(props);latest.current=props;
  const bridge=window.resumeDesktop?.facts;
  const records=props.bank?.records.filter(r=>r.docId===props.document.id)??[];
  const edit=<K extends keyof FactInput>(key:K,value:FactInput[K])=>{setDraft(d=>({...d,[key]:value}));setConfirmed(false);};
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
      const saved=await bridge.add({slug,docRevision:current.getRevision(),blockKey:target,bankRevision:rev,fact:draft,confirmation:'CONFIRM_SELF_REPORTED_FACT'});
      setDraft(blank);setConfirmed(false);return saved;
    },'事实已保存到独立本地资料库。');
  };
  const revoke=(id:string)=>{
    if(!bridge||!props.bank||!window.confirm('撤销此事实的使用授权？记录将保留用于追溯，不再允许引用。'))return;
    const bankRevision=props.bank.revision;
    void task(()=>bridge.revoke({id,bankRevision,confirmation:'REVOKE_FACT'}),'事实已撤销，旧 AI 审批已失效。');
  };
  const field=(label:string,key:'value'|'unit'|'timeframe'|'evidenceRef',maxLength:number)=><label className="block">{label}<input aria-label={label} disabled={props.locked} value={draft[key]} maxLength={maxLength} onChange={e=>edit(key,e.target.value)} className="mt-1 w-full rounded border p-1.5"/></label>;
  return <details className="rounded border border-slate-200 p-2 space-y-2">
    <summary className="cursor-pointer font-semibold">本地事实资料库（{records.filter(r=>r.verifiedStatus==='user-confirmed').length} 条）</summary>
    <p className="text-slate-600">与简历正文、母库分开保存。人工确认仅表示本人核对，不是独立证据验证。证据位置只保存在本机，默认不外发；每次任务还需单独勾选可外发事实。</p>
    {!bridge&&<p>本地事实库仅支持当前桌面桥接版本。</p>}
    <button type="button" disabled={props.locked||!bridge} onClick={()=>bridge&&void task(()=>bridge.get(),'已读取本地事实资料库。')} className="rounded border px-2 py-1">加载 / 刷新事实库</button>
    {error&&<div role="alert" className="rounded bg-red-50 p-2 text-red-800">{error}</div>}
    {notice&&<div role="status" className="text-teal-800">{notice}</div>}
    {props.bank&&<>
      <div className="max-h-52 space-y-2 overflow-auto">{records.length===0&&<p>当前简历没有记录。请从下方手动添加。</p>}{records.map(r=>{
        const matches=factEntityId(props.document,r.blockKey)===r.entityId;
        const eligible=isShareableFact(props.document,r)&&props.keys.includes(r.blockKey);
        return <article key={r.id} className="rounded border p-2 space-y-1 break-words">
          <div className="font-semibold">{r.assertion}</div>
          <div>{[r.value,r.unit,r.timeframe].filter(Boolean).join(' · ')}</div>
          <div className="text-slate-600">本地证据位置：{r.evidenceRef}</div>
          <div className="text-slate-600">{r.verifiedStatus==='revoked'?'已撤销':matches?'本人确认 · 非独立验证':'关联主体已变更 / 隐藏'} · {r.sensitivity==='shareable'?'可按次选择外发':'仅本地'}</div>
          <label className="flex items-start gap-1"><input type="checkbox" aria-label={'选择事实 '+r.assertion} disabled={props.locked||!eligible} checked={eligible&&props.selected.includes(r.id)} onChange={e=>props.onSelected(e.target.checked?[...props.selected,r.id]:props.selected.filter(id=>id!==r.id))}/>加入本次 AI 任务</label>
          {r.verifiedStatus!=='revoked'&&<button type="button" disabled={props.locked} className="text-red-700" onClick={()=>revoke(r.id)}>撤销事实授权</button>}
        </article>;
      })}</div>
      <div className="rounded bg-slate-50 p-2 space-y-2">
        <div className="font-semibold">新增本人核对的事实</div>
        <label className="block">关联段落<select aria-label="事实关联段落" disabled={props.locked} value={target} onChange={e=>{setTarget(e.target.value);setConfirmed(false);}} className="mt-1 w-full rounded border p-1.5"><option value="">选择可见段落</option>{props.blocks.map(b=><option key={b.key} value={b.key}>{b.label}</option>)}</select></label>
        <label className="block">类型<select aria-label="事实类型" disabled={props.locked} value={draft.kind} onChange={e=>edit('kind',e.target.value as FactInput['kind'])} className="mt-1 w-full rounded border p-1.5">{Object.entries({experience:'经历',achievement:'成果',credential:'资质',skill:'技能',other:'其他'}).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
        <label className="block">事实陈述<textarea aria-label="事实陈述" disabled={props.locked} rows={3} maxLength={2000} value={draft.assertion} onChange={e=>edit('assertion',e.target.value)} className="mt-1 w-full rounded border p-1.5"/></label>
        <div className="grid grid-cols-2 gap-2">{field('数值（可选）','value',200)}{field('单位（可选）','unit',80)}</div>
        {field('时间范围（可选）','timeframe',200)}{field('本地证据位置 / 来源说明','evidenceRef',1000)}
        <label className="flex items-start gap-1"><input type="checkbox" disabled={props.locked} checked={draft.sensitivity==='shareable'} onChange={e=>edit('sensitivity',e.target.checked?'shareable':'local-only')}/>允许今后逐次选择此外发事实（默认关闭）</label>
        <label className="flex items-start gap-1"><input type="checkbox" disabled={props.locked} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对该陈述、主体和来源；确认新增本人自述事实</label>
        <button type="button" disabled={props.locked||!target||!draft.assertion.trim()||!draft.evidenceRef.trim()||!confirmed} onClick={create} className="rounded bg-teal-700 px-2 py-1 text-white disabled:opacity-50">确认保存事实</button>
      </div>
    </>}
  </details>;
}
