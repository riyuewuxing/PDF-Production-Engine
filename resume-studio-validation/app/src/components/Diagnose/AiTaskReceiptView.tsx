import {describeAiCompletionReceipt,AiGatewayError,type AiCompletionReceipt,type AiCompletionResult} from '../../lib/byokAiClient';

/** Transient metadata only; never store model text, credentials, prompts or a billing estimate. */
export type AiTaskReceipt = {status:'received'|'rejected';receipt:AiCompletionReceipt|null}|{status:'unconfirmed'|'cancelled'};
export function receivedAiTask(response:AiCompletionResult):AiTaskReceipt{
  return {status:'received',receipt:response.receipt};
}
export function failedAiTask(response:AiCompletionResult|undefined,error?:unknown):AiTaskReceipt{
  if(response)return {status:'rejected',receipt:response.receipt};
  if(error instanceof AiGatewayError&&error.receipt)return {status:'rejected',receipt:error.receipt};
  return {status:'unconfirmed'};
}
export function AiTaskReceiptView({label,attempt}:{label:string;attempt:AiTaskReceipt|null}){
  if(!attempt)return null;
  const state=attempt.status;
  return <section aria-label={label} data-attempt-state={state} className="space-y-1 break-words rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700">
    <div className="font-semibold">{label}</div>
    {state==='received'?<><p>已收到模型响应；不代表内容真实、已批准或已应用。</p><div style={{overflowWrap:"anywhere"}}>{describeAiCompletionReceipt(attempt.receipt).map((line,i)=><p key={i}>{line}</p>)}</div></>:
      state==='rejected'?<><p>已收到模型响应，但本地未形成可用结果；不会自动重试。</p><div style={{overflowWrap:"anywhere"}}>{describeAiCompletionReceipt(attempt.receipt).map((line,i)=><p key={i}>{line}</p>)}</div></>:
      <p>{state==='cancelled'?'已取消本次任务，未采用模型结果。':'本次任务未取得可用调用回执。'} 未知服务端是否已处理或计费，不视为零用量；不会自动重试。</p>}
  </section>;
}
