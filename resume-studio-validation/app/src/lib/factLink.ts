import {comparableFactEntity,sameFactEvidence,type FactBank,type FactRecord} from '../schema/factBankSchema';
import type {ResumeDocument} from '../schema/resumeSchema';
import {createAiTextSanitizer,factEntityId,isShareableFact} from './aiContext';
import {collectEditableBlocks} from './resumeBlocks';

export function canLinkFactToDocument(target:ResumeDocument,root:FactRecord):boolean{
  if(root.sourceScope!=='manual'||root.verifiedStatus!=='user-confirmed'||root.docId===target.id)return false;
  const entityId=factEntityId(target,root.blockKey);
  const signature=comparableFactEntity(root);
  return !!entityId&&!!signature&&signature===comparableFactEntity({docId:target.id,blockKey:root.blockKey,entityId});
}
export function isLinkedPrivacyCompatible(target:ResumeDocument,source:ResumeDocument,root:FactRecord):boolean{
  const content=[collectEditableBlocks(target).find(b=>b.key===root.blockKey)?.label,root.assertion,root.value,root.unit,root.timeframe].filter(Boolean).join('\n');
  return createAiTextSanitizer([target,source])(content)===createAiTextSanitizer([target])(content);
}
/** Source version and root fact are checked again before any linked fact may leave the app. */
export async function assertLinkedFactOrigin(bank:FactBank,target:ResumeDocument,record:FactRecord,loadDoc:(slug:string)=>Promise<ResumeDocument>):Promise<void>{
  if(record.sourceScope!=='linked')return;
  const link=record.linkedFrom;
  const root=link?bank.records.find(r=>r.id===link.recordId):undefined;
  if(!link||!root||!canLinkFactToDocument(target,root)||!sameFactEvidence(record,root)||root.sensitivity!=='shareable')
    throw new Error('跨版本来源已失效，请重新关联；旧审批作废。');
  let source:ResumeDocument;
  try{source=await loadDoc(link.slug);}catch{throw new Error('跨版本来源简历不可读取，请重新关联；旧审批作废。');}
  if(!isShareableFact(source,root)||!isLinkedPrivacyCompatible(target,source,root))
    throw new Error('跨版本来源主体或隐私范围已变化，请重新关联；旧审批作废。');
}
