import type {DraftInput,DraftReceipt} from '../schema/recoveryDraftSchema';
export type Checkpoint=Promise<DraftReceipt|null>;
/** Submit immediately, independent of the regular autosave debounce. A checkpoint
 * is only acknowledged when the main process has finished writing it. */
export function checkpointRecovery(input:DraftInput,onError:(message:string|null)=>void):Checkpoint{
  const api=typeof window==='undefined'?undefined:window.resumeDesktop?.recoveryDrafts;
  if(!api)return Promise.resolve(null);
  try{return api.checkpoint(input).then(receipt=>{onError(null);return receipt;},()=>{onError('自动恢复草稿写入失败；请立即保存或另存草稿。');return null;});}
  catch{onError('自动恢复草稿写入失败；请立即保存或另存草稿。');return Promise.resolve(null);}
}
export async function clearRecovery(checkpoint:Checkpoint|undefined,onError:(message:string|null)=>void){
  const api=typeof window==='undefined'?undefined:window.resumeDesktop?.recoveryDrafts;
  if(!api||!checkpoint)return;
  const receipt=await checkpoint;
  if(!receipt)return;
  try{await api.clear(receipt,'SAVED_OR_DISCARDED');}
  catch{onError('正式数据已处理，但旧恢复草稿未能清理；下次启动时可检查。');}
}
