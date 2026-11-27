import {useEffect,useRef,useState} from 'react';
import type {ResumeDocument} from '../../schema/resumeSchema';
import {apiClient,localErrorMessage} from '../../lib/apiClient';
import {assertAiPreviewSettings,requestByokCompletionWithReceipt,type AiCompletionResult,describeAiRequest,validateByokBaseUrl,type ByokAiSettings,type ByokCompletionOptions} from '../../lib/byokAiClient';
import {LAYOUT_KEYS,LAYOUT_LIMITS,LAYOUT_SKILL_VERSION,layoutSettings,prepareLayoutRequest,parseLayoutProposal,previewLayoutProposal,type LayoutProposal} from '../../lib/aiLayout';
import {renderAiComparison,type AiPdfComparison} from '../../lib/aiPdfComparison';
import {AiPdfComparisonView} from './AiPdfComparisonView';
import {AiTaskReceiptView,receivedAiTask,failedAiTask,type AiTaskReceipt} from './AiTaskReceiptView';
type Props={document:ResumeDocument;slug:string;settings:ByokAiSettings;overflowPx:number;onFlushBeforeApply:()=>Promise<void>;getCurrentRevision:()=>string;onImmediateChange:(next:ResumeDocument)=>void;assertSettings:(settings:ByokAiSettings)=>void};
type Basis={document:ResumeDocument;slug:string;settings:ByokAiSettings;goal:string;allowTemplate:boolean;overflowPx:number};
type Prepared={basis:Basis;options:ByokCompletionOptions};
type Candidate={basis:Basis;proposal:LayoutProposal;next:ResumeDocument};
export function AiLayoutPane(props:Props){
  const [goal,setGoal]=useState('');
  const [allowTemplate,setAllowTemplate]=useState(false);
  const [pending,setPending]=useState<Prepared|null>(null);
  const [candidate,setCandidate]=useState<Candidate|null>(null);
  const [attempt,setAttempt]=useState<{basis:Basis;value:AiTaskReceipt}|null>(null);
  const [comparison,setComparison]=useState<AiPdfComparison|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState<'model'|'render'|'apply'|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const ctrl=useRef<AbortController|null>(null);
  const active=useRef(false),mounted=useRef(false);
  const current=useRef({props,goal,allowTemplate});current.current={props,goal,allowTemplate};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;ctrl.current?.abort();};},[]);
  const same=(b:Basis)=>{const c=current.current;return mounted.current&&c.props.document===b.document&&c.props.slug===b.slug&&c.props.settings===b.settings&&c.goal===b.goal&&c.allowTemplate===b.allowTemplate&&c.props.overflowPx===b.overflowPx;};
  const clear=()=>{setPending(null);setCandidate(null);setComparison(null);setConfirmed(false);setAttempt(null);setError(null);setNotice(null);};
  useEffect(()=>{setPending(null);setCandidate(null);setComparison(null);setConfirmed(false);setAttempt(null);ctrl.current?.abort();},[props.document,props.slug,props.settings,props.overflowPx]);
  const prepare=()=>{
    if(active.current)return;clear();
    try{props.assertSettings(props.settings);const basis={document:props.document,slug:props.slug,settings:props.settings,goal,allowTemplate,overflowPx:props.overflowPx};const options=prepareLayoutRequest(basis);assertAiPreviewSettings(props.settings,options);setPending({basis,options});}
    catch(err){setError(localErrorMessage(err,'准备版式请求失败'));}
  };
  const send=async()=>{
    if(!pending||active.current)return;
    const req=pending;setPending(null);if(!same(req.basis)){setError('原简历或配置已经变化，请重新预览。');return;}
    const controller=new AbortController();ctrl.current=controller;active.current=true;setBusy('model');setError(null);
    let response:AiCompletionResult|undefined;
    try{response=await requestByokCompletionWithReceipt({...req.options,settings:req.basis.settings,signal:controller.signal});if(controller.signal.aborted)return;
      if(!same(req.basis))throw new Error('简历已变化，未采用旧版式建议。');
      const proposal=parseLayoutProposal(response.text,req.basis.allowTemplate);
      setCandidate({basis:req.basis,proposal,next:previewLayoutProposal(req.basis.document,proposal,req.basis.allowTemplate)});
      setAttempt({basis:req.basis,value:receivedAiTask(response)});
    }catch(err){if(same(req.basis)&&!controller.signal.aborted){setAttempt({basis:req.basis,value:failedAiTask(response)});setError(localErrorMessage(err,'版式提案失败'));}}
    finally{if(controller.signal.aborted&&same(req.basis))setAttempt({basis:req.basis,value:{status:'cancelled'}});
      ctrl.current=null;active.current=false;if(mounted.current)setBusy(null);}
  };
  const render=async()=>{
    if(!candidate||active.current)return;setComparison(null);setConfirmed(false);setError(null);
    const c=candidate;if(!same(c.basis)){setError('原简历已变化，请重新生成版式提案。');return;}
    const controller=new AbortController();ctrl.current=controller;active.current=true;setBusy('render');
    try{const result=await renderAiComparison(c.basis.document,c.next,true,controller.signal);if(controller.signal.aborted)return;if(!same(c.basis))throw new Error('试渲染期间原简历已变化，结果作废。');setComparison(result);}
    catch(err){if(mounted.current&&!controller.signal.aborted)setError(localErrorMessage(err,'真实 PDF 对照失败'));}
    finally{ctrl.current=null;active.current=false;if(mounted.current)setBusy(null);}
  };
  const apply=async()=>{
    if(!candidate||!comparison||comparison.blockers.length||!confirmed||active.current)return;
    const c=candidate;if(!same(c.basis)){setError('原简历或配置已变化，禁止应用旧候选。');return;}
    if(props.slug==='master'&&!window.confirm('确认在母库创建快照并应用已核对的版式修改？'))return;
    active.current=true;setBusy('apply');setError(null);
    try{await props.onFlushBeforeApply();if(!same(c.basis))throw new Error('原简历已变化，未应用。');
      const revision=props.getCurrentRevision();
      const next=previewLayoutProposal(props.document,c.proposal,c.basis.allowTemplate);
      if(JSON.stringify(next)!==JSON.stringify(c.next))throw new Error('候选已变化，必须重新试渲染。');
      await apiClient.createSnapshot(props.slug,'AI 版式修改前快照',revision);
      if(!same(c.basis)||props.getCurrentRevision()!==revision)throw new Error('磁盘版本已变化，未应用。');
      props.onImmediateChange(next);clear();setNotice('版式已应用，正文未修改；可 Ctrl+Z 撤回。');
    }catch(err){if(mounted.current)setError(localErrorMessage(err,'应用版式失败'));}
    finally{active.current=false;if(mounted.current)setBusy(null);}
  };
  const locked=busy!==null;
  return <section aria-label="AI 版式优化" className="space-y-3 rounded-lg border border-teal-200 bg-white p-3 text-[11px] text-slate-800">
    <div className="font-bold text-teal-900">AI 版式优化 · {LAYOUT_SKILL_VERSION}</div>
    <p>只发送目标、当前七项排版参数、模板 ID 与画布测量。默认禁止切换模板，不发送正文、照片、联系方式或本地 PDF。</p>
    <label className="block">版式目标<textarea aria-label="AI 版式目标" disabled={locked} value={goal} onChange={e=>{setGoal(e.target.value);clear();}} rows={3} placeholder="例如：在不缩小正文到难以阅读的情况下，尽量压到一页。" className="mt-1 w-full rounded border p-2"/></label>
    <label className="flex gap-2"><input type="checkbox" disabled={locked} checked={allowTemplate} onChange={e=>{setAllowTemplate(e.target.checked);clear();}}/>允许从现有模板中选择其他模板（默认关闭）</label>
    <button type="button" disabled={locked||!goal.trim()} onClick={prepare} className="rounded bg-teal-700 px-3 py-1.5 text-white disabled:opacity-50">预览版式请求</button>
    {busy&&<div className="flex items-center justify-between"><span>{busy==='model'?'模型处理中…':busy==='render'?'正在本地渲染两份 PDF…':'正在创建快照并应用…'}</span>{busy!=='apply'&&<button type="button" onClick={()=>ctrl.current?.abort()} className="rounded border px-2 py-1">取消版式任务</button>}</div>}
    {attempt&&same(attempt.basis)&&<AiTaskReceiptView label="版式调用回执" attempt={attempt.value}/>}
    {error&&<p role="alert" className="rounded bg-red-50 p-2 text-red-800">{error}</p>}
    {notice&&<p role="status" className="rounded bg-teal-50 p-2 text-teal-800">{notice}</p>}
    {pending&&same(pending.basis)&&<div aria-label="版式 AI 数据发送预览" className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2"><strong>版式发送前确认</strong><p className="break-all">{pending.basis.settings.model} · {validateByokBaseUrl(pending.basis.settings.baseUrl).baseUrl}/chat/completions</p><p>{describeAiRequest(pending.basis.settings,pending.options)}</p><div className="max-h-56 overflow-auto bg-white p-2"><pre className="whitespace-pre-wrap break-words">{pending.options.systemPrompt}</pre><pre className="whitespace-pre-wrap break-words">{pending.options.userPrompt}</pre></div><button type="button" onClick={()=>void send()} className="rounded bg-teal-700 px-2 py-1 text-white">确认发送版式请求</button><button type="button" onClick={()=>setPending(null)} className="ml-2 rounded border px-2 py-1">取消发送</button></div>}
    {candidate&&same(candidate.basis)&&<div className="space-y-2 rounded border border-slate-200 p-2"><strong>版式候选（尚未应用）</strong><p>{candidate.proposal.reason}</p>
      <table className="w-full text-left"><thead><tr><th>参数</th><th>原值</th><th>候选</th></tr></thead><tbody>{LAYOUT_KEYS.filter(k=>candidate.basis.document.globalSettings[k]!==candidate.next.globalSettings[k]).map(k=><tr key={k} className="border-t"><td>{LAYOUT_LIMITS[k].label}</td><td>{layoutSettings(candidate.basis.document)[k]}</td><td>{layoutSettings(candidate.next)[k]}</td></tr>)}{candidate.basis.document.templateId!==candidate.next.templateId&&<tr><td>模板</td><td className="break-all">{candidate.basis.document.templateId}</td><td className="break-all">{candidate.next.templateId}</td></tr>}</tbody></table>
      <button type="button" disabled={locked} onClick={()=>void render()} className="rounded border border-teal-300 px-2 py-1 text-teal-800 disabled:opacity-50">本地试渲染版式对照</button>
      {comparison&&<><AiPdfComparisonView comparison={comparison}/><label className="flex items-start gap-2"><input type="checkbox" disabled={locked||!!comparison.blockers.length} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已检查真实 PDF 前后页面、可读性与机读风险，确认应用当前候选版式。</label></>}
      <button type="button" disabled={locked||!comparison||!!comparison.blockers.length||!confirmed} onClick={()=>void apply()} className="rounded bg-teal-700 px-2 py-1 text-white disabled:opacity-50">应用已核对版式</button>
    </div>}
  </section>;
}
