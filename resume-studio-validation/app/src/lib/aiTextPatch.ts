import {z} from 'zod';
import {AI_SKILL_VERSION,TEXT_FIELDS,fieldForBlock} from './aiSkills';
import {applyBlockUpdates,collectEditableBlocks} from './resumeBlocks';
import {PRIVACY_PLACEHOLDER} from './aiContext';
import {ResumeDocumentSchema,type ResumeDocument} from '../schema/resumeSchema';
const OperationSchema=z.object({
  op:z.literal('replace-text'),targetStableId:z.string().min(1).max(500),field:z.enum(TEXT_FIELDS),
  oldValueHash:z.string().regex(/^[a-f0-9]{64}$/),newValue:z.string().min(1).max(100000),
  reason:z.string().min(1).max(2000),factIds:z.array(z.string().min(1).max(200)).max(20),
}).strict();
export const TextPatchEnvelopeSchema=z.object({
  docId:z.string().min(1),slug:z.string().min(1),baseRevision:z.string().min(1),
  sourceRequestId:z.string().uuid(),skillVersion:z.literal(AI_SKILL_VERSION),
  operations:z.array(OperationSchema).min(1).max(8),
}).strict();
export type TextPatchEnvelope=z.infer<typeof TextPatchEnvelopeSchema>;
export type TextPatchCandidate={blockKey:string;originalText:string;suggestedText:string;reason:string;factIds:readonly string[]};
async function hashText(value:string):Promise<string>{
  if(!globalThis.crypto?.subtle)throw new Error('当前运行环境无法执行正文完整性校验。');
  const data=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data),b=>b.toString(16).padStart(2,'0')).join('');
}
/** Local adapter binds a reviewed candidate to the actual revision. The model never supplies disk identity. */
export async function buildTextPatchEnvelope(input:{document:ResumeDocument;slug:string;baseRevision:string;sourceRequestId:string;candidates:readonly TextPatchCandidate[]}):Promise<TextPatchEnvelope>{
  const operations=await Promise.all(input.candidates.map(async c=>({
    op:'replace-text' as const,targetStableId:c.blockKey,field:fieldForBlock(c.blockKey),
    oldValueHash:await hashText(c.originalText),newValue:c.suggestedText,reason:c.reason.slice(0,2000)||'已审核正文改写',factIds:[...c.factIds],
  })));
  return TextPatchEnvelopeSchema.parse({docId:input.document.id,slug:input.slug,baseRevision:input.baseRevision,sourceRequestId:input.sourceRequestId,skillVersion:AI_SKILL_VERSION,operations});
}
/** Pure preview: strict allowlist, revision and old value checks. Does not write disk or approve facts. */
export async function previewTextPatch(input:{document:ResumeDocument;slug:string;revision:string;envelope:unknown}):Promise<ResumeDocument>{
  const patch=TextPatchEnvelopeSchema.parse(input.envelope);
  const {document}=input;
  if(patch.docId!==document.id||patch.slug!==input.slug||patch.baseRevision!==input.revision)throw new Error('AI 提案目标版本已变化，禁止应用。');
  const blocks=collectEditableBlocks(document),updates:Record<string,string>=Object.create(null);
  for(const op of patch.operations){
    const matches=blocks.filter(b=>b.key===op.targetStableId);
    const block=matches[0];
    if(matches.length!==1||!block||Object.hasOwn(updates,op.targetStableId)||fieldForBlock(block.key)!==op.field)throw new Error('AI 提案含重复、隐藏或未授权目标。');
    if(await hashText(block.text)!==op.oldValueHash)throw new Error('AI 提案原文已变化。');
    if(!op.newValue.trim()||op.newValue.length>block.maxCharsHint||op.newValue.includes(PRIVACY_PLACEHOLDER))throw new Error('AI 提案正文无效或超过字数预算。');
    updates[op.targetStableId]=op.newValue;
  }
  const next=ResumeDocumentSchema.parse(applyBlockUpdates(document,updates));
  const after=collectEditableBlocks(next);
  for(const [key,value] of Object.entries(updates))if(after.filter(b=>b.key===key&&b.text===value).length!==1)throw new Error('AI 提案无法确定性映射至原段落。');
  return next;
}
