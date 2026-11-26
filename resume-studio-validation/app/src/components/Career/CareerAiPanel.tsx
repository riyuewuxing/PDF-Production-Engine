import {useEffect,useRef,useState} from 'react';
import {Sparkles,ShieldCheck} from 'lucide-react';
import {apiClient,localErrorMessage} from '../../lib/apiClient';
import {assertAiPreviewSettings,requestByokCompletion,validateByokBaseUrl,type AiProfileCatalog,type ByokAiSettings} from '../../lib/byokAiClient';
import {CAREER_AI_LABELS,prepareCareerRefine,restoreCareerRefine,type CareerAiKind,type CareerRefinePrepared} from '../../lib/careerAi';
import type {ResumeDocument} from '../../schema/resumeSchema';
import type {FactBank} from '../../schema/factBankSchema';
import {collectEditableBlocks} from '../../lib/resumeBlocks';
import {isShareableFact} from '../../lib/aiContext';
import {prepareFactSelection,assertFreshFactSelection,loadLocalFactBank,type FactSelection} from '../../lib/factSelection';
type Props={document:ResumeDocument;slug:string;company:string;role:string;jdText:string;drafts:Record<CareerAiKind,string>;onApply:(kind:CareerAiKind,text:string)=>void};
type Basis={document:ResumeDocument;slug:string;company:string;role:string;jdText:string;kind:CareerAiKind;draftText:string;settings:ByokAiSettings;selection:FactSelection};
type Prepared={basis:Basis;request:CareerRefinePrepared};
type Proposal=Prepared&ReturnType<typeof restoreCareerRefine>;
export function CareerAiPanel(props:Props){
  const [catalog,setCatalog]=useState<AiProfileCatalog|null>(null);
  const [profileId,setProfileId]=useState('');
  const [kind,setKind]=useState<CareerAiKind>('coverLetter');
  const [preview,setPreview]=useState<Prepared|null>(null);
  const [proposal,setProposal]=useState<Proposal|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [bank,setBank]=useState<FactBank|null>(null);
  const [factIds,setFactIds]=useState<string[]>([]);
  const [factsBusy,setFactsBusy]=useState(false);
  const [applying,setApplying]=useState(false);
  const applyRef=useRef(false);
  const [error,setError]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null);
  const mounted=useRef(false);
  const selected=catalog?.profiles.find(p=>p.profileId===profileId);
  const current=useRef({props,kind,selected,bank,factIds});current.current={props,kind,selected,bank,factIds};
  const clearApprovals=()=>{setPreview(null);setProposal(null);setConfirmed(false);};
  const locked=busy||factsBusy||applying;
  const blocks=collectEditableBlocks(props.document);
  const eligible=bank?.records.filter(r=>isShareableFact(props.document,r))??[];
  useEffect(()=>{setFactIds([]);clearApprovals();controller.current?.abort();},[props.document,props.slug,props.company,props.role,props.jdText,props.drafts[kind],kind,profileId]);
  const refreshFacts=async()=>{
    if(locked)return;setFactsBusy(true);setError(null);clearApprovals();setFactIds([]);
    try{const loaded=await loadLocalFactBank();if(mounted.current)setBank(loaded);}
    catch(err){if(mounted.current){setBank(null);setError(localErrorMessage(err,'读取本地事实库失败'));}}
    finally{if(mounted.current)setFactsBusy(false);}
  };
  useEffect(()=>{
    mounted.current=true;
    if(window.resumeDesktop)void apiClient.listAiProfiles().then(c=>{if(mounted.current){setCatalog(c);setProfileId(c.activeProfileId);}}).catch(err=>{if(mounted.current)setError(localErrorMessage(err,'读取模型档案失败'));});
    return ()=>{mounted.current=false;controller.current?.abort();};
  },[]);
  const isCurrent=(b:Basis)=>{
    const now=current.current;
    return mounted.current&&now.props.document===b.document&&now.props.slug===b.slug&&now.props.company===b.company&&now.props.role===b.role&&now.props.jdText===b.jdText&&now.kind===b.kind&&now.props.drafts[b.kind]===b.draftText&&now.selected?.profileId===b.settings.profileId&&now.selected?.revision===b.settings.revision&&JSON.stringify(now.factIds)===JSON.stringify(b.selection.records.map(r=>r.id))&&(!b.selection.binding||now.bank?.revision===b.selection.binding.bankRevision);
  };
  const assertFresh=async(b:Basis)=>{await assertFreshFactSelection(b.document,b.selection,loadLocalFactBank);if(!isCurrent(b))throw new Error('文案、岗位、模型或事实选择已变化，旧审批作废。');};
  const prepare=()=>{
    if(!selected||locked)return;setError(null);setProposal(null);setConfirmed(false);setPreview(null);
    try{
      const keys=blocks.filter(b=>eligible.some(r=>factIds.includes(r.id)&&r.blockKey===b.key)).map(b=>b.key);
      const selection=prepareFactSelection(props.document,props.slug,keys,bank,factIds);
      const basis:Basis={document:props.document,slug:props.slug,company:props.company,role:props.role,jdText:props.jdText,kind,draftText:props.drafts[kind],settings:selected,selection};
      const request=prepareCareerRefine({...basis,records:selection.records});
      if(selection.binding)request.options.factBinding=selection.binding;
      assertAiPreviewSettings(selected,request.options);setPreview({basis,request});
    }catch(err){setError(localErrorMessage(err,'准备文案请求失败'));}
  };
  const send=async()=>{
    if(!preview||controller.current||locked)return;
    const p=preview;setPreview(null);
    if(!isCurrent(p.basis)){setError('文案、简历、岗位或模型已变化，请重新预览。');return;}
    const ctrl=new AbortController();controller.current=ctrl;setBusy(true);setError(null);setProposal(null);setConfirmed(false);
    try{
      await assertFresh(p.basis);if(ctrl.signal.aborted)return;
      const output=await requestByokCompletion({...p.request.options,settings:p.basis.settings,signal:ctrl.signal});
      if(ctrl.signal.aborted)return;
      if(!isCurrent(p.basis))throw new Error('原文已变化，已丢弃旧模型建议。');
      await assertFresh(p.basis);if(ctrl.signal.aborted)return;
      setProposal({...p,...restoreCareerRefine(output,p.request)});
    }catch(err){if(mounted.current)setError(localErrorMessage(err,'文案精修失败'));}
    finally{if(controller.current===ctrl){controller.current=null;if(mounted.current)setBusy(false);}}
  };
  const apply=async()=>{
    if(!proposal||!confirmed||locked||applyRef.current)return;
    applyRef.current=true;setApplying(true);
    try{await assertFresh(proposal.basis);
      current.current.props.onApply(proposal.basis.kind,proposal.text);clearApprovals();setFactIds([]);setError(null);
    }catch(err){if(mounted.current){clearApprovals();setError(localErrorMessage(err,'旧文案审批已失效，未替换草稿。'));}}
    finally{applyRef.current=false;if(mounted.current)setApplying(false);}
  };
  return <section aria-label="求职文案 AI 精修" className="space-y-2 rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-[11px] text-slate-800">
    <div className="flex items-center gap-1.5 font-bold text-teal-900"><Sparkles size={14}/>求职文案 AI 精修</div>
    <p>独立选择已保存的模型档案；发送前逐字预览，身份信息使用本地占位符。结果仅供审阅，不会自动覆盖或投递。</p>
    {catalog?<><label className="block">本次文案模型<select aria-label="本次文案模型" value={profileId} disabled={locked} onChange={e=>{setProfileId(e.target.value);setPreview(null);setProposal(null);setConfirmed(false);}} className="mt-1 w-full rounded border bg-white p-1.5">{catalog.profiles.map(p=><option key={p.profileId} value={p.profileId}>{p.providerLabel} · {p.model}{p.enabled?'':'（未启用）'}</option>)}</select></label>
      <label className="block">精修对象<select aria-label="文案精修对象" value={kind} disabled={locked} onChange={e=>{setKind(e.target.value as CareerAiKind);setPreview(null);setProposal(null);setConfirmed(false);}} className="mt-1 w-full rounded border bg-white p-1.5">{Object.entries(CAREER_AI_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <details className="rounded border border-slate-200 bg-white p-2 space-y-2">
        <summary className="cursor-pointer font-semibold">本地事实资料库 · 文案选择（{factIds.length} 条）</summary>
        <p>仅当前版本关联的本人确认、允许外发的事实可逐次选择。默认不发送；证据位置仅本地展示。新增、更正或撤销请前往诊断优化。</p>
        <button type="button" disabled={locked||!window.resumeDesktop?.facts} onClick={()=>void refreshFacts()} className="rounded border px-2 py-1">加载 / 刷新文案事实</button>
        {bank&&<div aria-label="文案事实选择" className="max-h-48 overflow-auto space-y-1">{!eligible.length&&<p>当前版本没有可选择外发的事实。</p>}{eligible.map(r=><label key={r.id} className="block rounded border p-2 break-words"><span className="flex items-start gap-1"><input type="checkbox" aria-label={'文案选择事实 '+r.assertion} disabled={locked||(!factIds.includes(r.id)&&factIds.length>=20)} checked={factIds.includes(r.id)} onChange={e=>{setFactIds(ids=>e.target.checked?[...ids,r.id]:ids.filter(id=>id!==r.id));clearApprovals();}}/>{r.assertion}</span><span className="block text-slate-600">{blocks.find(b=>b.key===r.blockKey)?.label} · {r.evidenceRef}</span></label>)}</div>}
      </details>
      <button type="button" disabled={locked||!selected?.enabled} onClick={prepare} className="rounded bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50">预览文案精修请求</button>
      {!selected?.enabled&&<p className="text-slate-500">请先在「诊断优化 → AI 润色 Diff」启用模型档案。</p>}
    </>:<p>桌面端模型档案尚未加载。离线文案仍可编辑。</p>}
    {busy&&<div className="flex items-center justify-between"><span>模型正在处理…</span><button type="button" onClick={()=>controller.current?.abort()} className="rounded border px-2 py-1">取消文案请求</button></div>}
    {error&&<div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</div>}
    {preview&&<section aria-label="文案 AI 数据发送预览" className="space-y-2 rounded border border-amber-300 bg-white p-2">
      <div className="font-bold text-amber-900">文案发送前确认（尚未调用模型）</div>
      <p className="break-all">接收方：{validateByokBaseUrl(preview.basis.settings.baseUrl).baseUrl}/chat/completions</p>
      <p>模型：{preview.basis.settings.model} · {preview.basis.settings.providerLabel}</p>
      <p>{preview.request.replacements.length} 类身份字段在本地替换，不发送真实映射。</p>
      {preview.request.providedFacts.length>0&&<div aria-label="文案外发事实清单" className="max-h-40 overflow-auto rounded border border-amber-200 p-2"><p className="font-semibold">本次外发 {preview.request.providedFacts.length} 条本人确认事实</p>{preview.request.providedFacts.map(r=><div key={r.id} className="border-t py-1 whitespace-pre-wrap break-words">{r.id}<div>{r.facts}</div><div className="text-slate-500">本地关联（不外发）：{r.label}</div></div>)}</div>}
      <div className="max-h-64 space-y-1 overflow-auto rounded bg-slate-100 p-2"><p className="font-semibold">系统指令</p><pre className="whitespace-pre-wrap break-words">{preview.request.options.systemPrompt}</pre><p className="font-semibold">发送内容</p><pre className="whitespace-pre-wrap break-words">{preview.request.options.userPrompt}</pre></div>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={locked} onClick={()=>void send()} className="rounded bg-teal-700 px-2 py-1 text-white">确认发送文案给模型</button><button type="button" onClick={()=>setPreview(null)} className="rounded border px-2 py-1">取消文案发送</button></div>
    </section>}
    {proposal&&<section aria-label="文案 AI 审核" className="space-y-2 rounded border border-slate-300 bg-white p-2">
      <div className="flex items-center gap-1 font-bold"><ShieldCheck size={13}/>原文与候选文案</div>
      <div className="space-y-1 max-h-72 overflow-auto"><p className="font-semibold text-slate-600">原文</p><pre className="whitespace-pre-wrap break-words rounded bg-slate-100 p-2">{proposal.request.original}</pre><p className="font-semibold text-teal-800">候选文案（本地还原）</p><pre className="whitespace-pre-wrap break-words rounded bg-teal-50 p-2">{proposal.text}</pre></div>
      {proposal.request.providedFacts.length>0&&<div className="rounded bg-amber-50 p-2 break-words"><p>已提供的事实（纯文本结果不能证明模型实际引用）：</p>{proposal.basis.selection.records.map((r,i)=><div key={r.id}>record-{i+1} · {r.assertion}<div>本地证据：{r.evidenceRef}</div></div>)}</div>}
      {proposal.warnings.map((w,i)=><p key={i} className="text-amber-800">{w.message}</p>)}
      <p>机械检测不能证明语义事实，所有改写均需人工核对。</p>
      <label className="flex items-start gap-2"><input type="checkbox" disabled={locked} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对候选文案的身份、经历、数字及其他事实，确认仅替换当前文案草稿。</label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!confirmed||locked} onClick={()=>void apply()} className="rounded bg-teal-700 px-2 py-1 text-white disabled:opacity-50">采纳文案草稿</button><button type="button" onClick={()=>{setProposal(null);setConfirmed(false);}} className="rounded border px-2 py-1">放弃候选文案</button></div>
    </section>}
  </section>;
}
