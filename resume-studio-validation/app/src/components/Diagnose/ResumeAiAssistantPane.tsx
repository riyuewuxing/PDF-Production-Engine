import {useEffect,useMemo,useRef,useState} from 'react';
import {BookOpen,ClipboardList,Sparkles} from 'lucide-react';
import type {ResumeDocument} from '../../schema/resumeSchema';
import {apiClient,localErrorMessage} from '../../lib/apiClient';
import {collectEditableBlocks} from '../../lib/resumeBlocks';
import {assertAiPreviewSettings,requestByokCompletion,validateByokBaseUrl,type ByokAiSettings} from '../../lib/byokAiClient';
import {ASSISTANT_MODES,prepareAssistantTask,parseAssistantReply,type AssistantMode,type PreparedAssistantTask} from '../../lib/aiAssistant';
import {AI_TOOL_CATALOG,AI_SKILL_VERSION} from '../../lib/aiSkills';
import {buildTextPatchEnvelope,previewTextPatch} from '../../lib/aiTextPatch';
import {scanScopedProposalWarnings,type TailorBlockProposal} from '../../lib/aiTailor';
import {PRIVACY_PLACEHOLDER} from '../../lib/aiContext';
type Props={document:ResumeDocument;slug:string;settings:ByokAiSettings;jdText:string;overflowPx:number;onFlushBeforeApply:()=>Promise<void>;getCurrentRevision:()=>string;onImmediateChange:(next:ResumeDocument)=>void;assertSettings:(settings:ByokAiSettings)=>void};
type Basis={document:ResumeDocument;slug:string;settings:ByokAiSettings;goal:string;mode:AssistantMode;keys:string[];jdText?:string;overflowPx:number;requestId:string};
type Pending={basis:Basis;prepared:PreparedAssistantTask};
type Result={request:Pending;reply:ReturnType<typeof parseAssistantReply>};
export function ResumeAiAssistantPane(props:Props){
  const blocks=useMemo(()=>collectEditableBlocks(props.document),[props.document]);
  const [mode,setMode]=useState<AssistantMode>('ask');
  const [goal,setGoal]=useState('');
  const [keys,setKeys]=useState<string[]>(()=>blocks.slice(0,1).map(b=>b.key));
  const [includeJd,setIncludeJd]=useState(false);
  const [pending,setPending]=useState<Pending|null>(null);
  const [result,setResult]=useState<Result|null>(null);
  const [accepted,setAccepted]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [applying,setApplying]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const abortRef=useRef<AbortController|null>(null);
  const applyRef=useRef(false);
  const mounted=useRef(false);
  const current=useRef({props,mode,goal,keys,includeJd});current.current={props,mode,goal,keys,includeJd};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abortRef.current?.abort();};},[]);
  useEffect(()=>{setKeys(prev=>prev.filter(k=>blocks.some(b=>b.key===k)));},[blocks]);
  const isCurrent=(b:Basis)=>{
    const c=current.current;
    return mounted.current&&c.props.document===b.document&&c.props.slug===b.slug&&c.props.settings===b.settings&&c.mode===b.mode&&c.goal===b.goal&&JSON.stringify(c.keys)===JSON.stringify(b.keys)&&(c.includeJd?c.props.jdText:undefined)===b.jdText&&c.props.overflowPx===b.overflowPx;
  };
  const reset=()=>{setPending(null);setResult(null);setAccepted([]);setNotice(null);setError(null);};
  const prepare=()=>{
    if(busy||applying)return;reset();
    try{
      props.assertSettings(props.settings);
      const basis:Basis={document:props.document,slug:props.slug,settings:props.settings,mode,goal,keys:[...keys],jdText:includeJd?props.jdText:undefined,overflowPx:props.overflowPx,requestId:crypto.randomUUID()};
      const prepared=prepareAssistantTask(basis);assertAiPreviewSettings(props.settings,prepared.options);setPending({basis,prepared});
    }catch(err){setError(localErrorMessage(err,'无法准备 AI 任务'));}
  };
  const send=async()=>{
    if(!pending||abortRef.current||applyRef.current)return;
    const req=pending;setPending(null);
    if(!isCurrent(req.basis)){setError('任务范围或模型已经变化，请重新预览。');return;}
    const ctrl=new AbortController();abortRef.current=ctrl;setBusy(true);setError(null);
    try{
      const text=await requestByokCompletion({...req.prepared.options,settings:req.basis.settings,signal:ctrl.signal});
      if(ctrl.signal.aborted)return;
      if(!isCurrent(req.basis))throw new Error('任务目标或简历已变化，旧结果未采纳。');
      const reply=parseAssistantReply(text,req.prepared);setResult({request:req,reply});setAccepted([]);
      if(reply.kind==='proposals'&&!reply.proposals.length)setNotice('未返回可用正文提案；不代表简历已达到目标。');
    }catch(err){if(mounted.current)setError(localErrorMessage(err,'AI 任务失败'));}
    finally{if(abortRef.current===ctrl){abortRef.current=null;if(mounted.current)setBusy(false);}}
  };
  const toggle=(p:TailorBlockProposal,checked:boolean)=>{
    if(p.suggestedText.includes(PRIVACY_PLACEHOLDER))return;
    setAccepted(prev=>checked?[...new Set([...prev,p.id])]:prev.filter(id=>id!==p.id));
  };
  const apply=async()=>{
    if(!result||result.reply.kind!=='proposals'||applyRef.current||busy||!accepted.length)return;
    const {request,reply}=result;
    if(!isCurrent(request.basis)){setError('简历或任务范围已变化，禁止应用旧提案。');return;}
    if(props.slug==='master'&&!window.confirm('当前目标是母库。确认在创建本地快照后应用已逐项核对的正文修改？'))return;
    const selected=reply.proposals.filter(p=>accepted.includes(p.id));
    applyRef.current=true;setApplying(true);setError(null);
    try{
      for(const p of selected){
        const warnings=scanScopedProposalWarnings(p.suggestedText,p.blockKey,request.prepared.sourceMap,p.factIds);
        if(JSON.stringify(warnings)!==JSON.stringify(p.factWarnings))throw new Error('提案事实警告变化，请重新审核。');
      }
      await props.onFlushBeforeApply();
      if(!isCurrent(request.basis))throw new Error('简历已变化，未应用修改。');
      const revision=props.getCurrentRevision();
      const envelope=await buildTextPatchEnvelope({document:props.document,slug:props.slug,baseRevision:revision,sourceRequestId:request.basis.requestId,candidates:selected});
      const next=await previewTextPatch({document:props.document,slug:props.slug,revision,envelope});
      if(!isCurrent(request.basis)||props.getCurrentRevision()!==revision)throw new Error('简历版本已变化。');
      await apiClient.createSnapshot(props.slug,'AI 协作任务前快照',revision);
      if(!isCurrent(request.basis)||props.getCurrentRevision()!==revision)throw new Error('简历版本已变化。');
      props.onImmediateChange(next);setResult(null);setAccepted([]);setNotice('已应用 '+selected.length+' 条已核对正文提案，可使用 Ctrl+Z 撤回。');
    }catch(err){if(mounted.current)setError(localErrorMessage(err,'提案应用失败'));}
    finally{applyRef.current=false;if(mounted.current)setApplying(false);}
  };
  const locked=busy||applying;
  return <section aria-label="简历 AI 自由任务" className="space-y-3 rounded-lg border border-teal-200 bg-white p-3 text-[11px] text-slate-800">
    <div className="flex items-center gap-1.5 font-bold text-teal-900"><Sparkles size={14}/>AI 协作任务 · {AI_SKILL_VERSION}</div>
    <p>从实际可见段落、事实来源和当前排版测量构建上下文。模型没有磁盘写入权限。问答和计划永远不修改简历。</p>
    <div className="grid grid-cols-3 gap-1">{Object.entries(ASSISTANT_MODES).map(([id,label])=><button key={id} type="button" disabled={locked} onClick={()=>{setMode(id as AssistantMode);reset();}} className={'rounded border px-1.5 py-1.5 '+(mode===id?'border-teal-700 bg-teal-700 text-white':'bg-slate-50 text-slate-700')}>{label}</button>)}</div>
    <label className="block font-semibold">任务目标<textarea aria-label="AI 自由任务目标" rows={3} disabled={locked} value={goal} onChange={e=>{setGoal(e.target.value);reset();}} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal" placeholder="例如：保留科研事实，精简冗余语言；检查教师岗位表达是否明确。"/></label>
    <div className="rounded border border-slate-200 bg-slate-50 p-2 space-y-1">
      <div className="flex items-center justify-between gap-1"><span className="font-semibold">发送段落（{keys.length}/{blocks.length}）</span><button type="button" disabled={locked} onClick={()=>{setKeys(blocks.map(b=>b.key));reset();}} className="text-teal-700">全选可见段落</button><button type="button" disabled={locked} onClick={()=>{setKeys([]);reset();}} className="text-slate-600">清空</button></div>
      <div className="max-h-36 overflow-auto space-y-1">{blocks.map(b=><label key={b.key} className="flex items-start gap-1"><input type="checkbox" disabled={locked} checked={keys.includes(b.key)} onChange={e=>{setKeys(prev=>e.target.checked?[...prev,b.key]:prev.filter(k=>k!==b.key));reset();}}/><span>{b.label}</span></label>)}</div>
      <label className="flex items-center gap-1"><input type="checkbox" disabled={locked} checked={includeJd} onChange={e=>{setIncludeJd(e.target.checked);reset();}}/>同时发送当前岗位 JD（默认关闭）</label>
    </div>
    <details className="rounded border border-slate-200 p-2"><summary className="cursor-pointer font-semibold"><BookOpen size={12} className="inline"/> 本地工具权限说明</summary>{AI_TOOL_CATALOG.map(tool=><div key={tool.name} className="mt-1"><span className="font-mono text-teal-800">{tool.name}</span> · {tool.description}</div>)}</details>
    <button type="button" disabled={locked||!goal.trim()} onClick={prepare} className="rounded bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50">预览 AI 自由任务</button>
    {busy&&<div className="flex items-center justify-between"><span>正在运行模型任务…</span><button type="button" onClick={()=>abortRef.current?.abort()} className="rounded border px-2 py-1">取消自由任务</button></div>}
    {error&&<div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</div>}
    {notice&&<div role="status" className="rounded bg-teal-50 p-2 text-teal-800">{notice}</div>}
    {pending&&<section aria-label="自由任务发送预览" className="rounded border border-amber-300 bg-amber-50 p-2 space-y-2">
      <div className="font-bold">自由任务发送前确认</div><div className="break-all">{pending.basis.settings.providerLabel} · {pending.basis.settings.model} · {validateByokBaseUrl(pending.basis.settings.baseUrl).baseUrl}/chat/completions</div>
      <div className="max-h-64 overflow-auto rounded bg-white p-2 space-y-1"><pre className="whitespace-pre-wrap break-words">{pending.prepared.options.systemPrompt}</pre><pre className="whitespace-pre-wrap break-words">{pending.prepared.options.userPrompt}</pre></div>
      <div className="flex gap-1"><button type="button" onClick={()=>void send()} className="rounded bg-teal-700 px-2 py-1 text-white">确认发送自由任务</button><button type="button" onClick={()=>setPending(null)} className="rounded border px-2 py-1">取消预览</button></div>
    </section>}
    {result&&result.reply.kind==='text'&&<div className="space-y-2 rounded border border-slate-200 p-2"><div className="flex items-center gap-1 font-bold"><ClipboardList size={13}/>模型建议（不修改正文）</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{result.reply.text}</pre><p className="text-slate-500">模型分析不是独立事实证明。</p></div>}
    {result&&result.reply.kind==='proposals'&&<div className="space-y-2" aria-label="自由任务正文提案">
      {result.reply.proposals.map(p=><article key={p.id} className="rounded border border-slate-200 p-2 space-y-1"><div className="font-semibold">{p.label}</div><p>{p.reason}</p><p className="text-slate-500">事实引用：{p.factIds.join('、')||'无'}</p><div className="max-h-40 overflow-auto space-y-1"><pre className="whitespace-pre-wrap break-words rounded bg-slate-100 p-1.5">{p.originalText}</pre><pre className="whitespace-pre-wrap break-words rounded bg-emerald-50 p-1.5">{p.suggestedText}</pre></div>{p.factWarnings.map((w,i)=><p key={i} className="text-amber-800">{w.message}</p>)}<label className="flex items-start gap-1"><input type="checkbox" disabled={locked||p.suggestedText.includes(PRIVACY_PLACEHOLDER)} checked={accepted.includes(p.id)} onChange={e=>toggle(p,e.target.checked)}/>已核对本条原文、事实及候选正文，批准应用</label></article>)}
      <button type="button" disabled={locked||!accepted.length} onClick={()=>void apply()} className="rounded bg-teal-700 px-3 py-1.5 text-white disabled:opacity-50">应用已核对提案（{accepted.length}）</button>
    </div>}
  </section>;
}
