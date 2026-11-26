import type {FactBank,FactRecord,FactRequestBinding} from '../schema/factBankSchema';
import type {ResumeDocument} from '../schema/resumeSchema';
import {isShareableFact} from './aiContext';

export type FactSelection={records:FactRecord[];binding?:FactRequestBinding};
/** Only exact, expressly selected records enter a task. An unavailable bank is not an empty selection. */
export function prepareFactSelection(document:ResumeDocument,slug:string,keys:readonly string[],bank:FactBank|null,ids:readonly string[]):FactSelection{
  if(!ids.length)return {records:[]};
  if(!bank||!slug||ids.length>20||new Set(ids).size!==ids.length)throw new Error('事实库或所选事实无效，请刷新。');
  const records=ids.map(id=>bank.records.find(r=>r.id===id));
  if(!records.every(r=>r!==undefined&&keys.includes(r.blockKey)&&isShareableFact(document,r)))throw new Error('所选事实已撤销、不可外发或与当前段落不匹配。');
  return {records:records as FactRecord[],binding:{slug,docId:document.id,bankRevision:bank.revision,ids:[...ids],selectedKeys:[...keys]}};
}
/** Re-read persisted records before sending, showing a result, rendering, and applying. */
export async function assertFreshFactSelection(document:ResumeDocument,selection:FactSelection,load:()=>Promise<FactBank>):Promise<void>{
  if(!selection.records.length)return;
  const b=selection.binding;
  if(!b)throw new Error('本地事实授权绑定缺失。');
  const latest=await load();
  if(latest.revision!==b.bankRevision||!selection.records.every(r=>latest.records.some(s=>s.id===r.id&&JSON.stringify(s)===JSON.stringify(r)&&isShareableFact(document,s))))
    throw new Error('本地事实库已变化，请刷新并重新预览；旧审批作废。');
}
export function loadLocalFactBank():Promise<FactBank>{
  const bridge=typeof window!=='undefined'?window.resumeDesktop?.facts:undefined;
  if(!bridge)throw new Error('本地事实库不可用，旧审批作废。');
  return bridge.get();
}
