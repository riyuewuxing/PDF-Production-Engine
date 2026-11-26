import {TEMPLATE_IDS,ResumeDocumentSchema,type ResumeDocument} from '../schema/resumeSchema';
import {collectEditableBlocks} from './resumeBlocks';
import {buildAiFactSources,createAiTextSanitizer,outboundFactSources} from './aiContext';

export const AI_SKILL_VERSION='resume-text-v1' as const;
export const AI_TOOL_CATALOG=[
  {name:'list_visible_blocks',mode:'read',description:'读取已启用章节的可见正文段落；返回临时编号与长度预算。'},
  {name:'inspect_block_facts',mode:'read',description:'读取对应段落的候选人自述事实，不证明外部真实性。'},
  {name:'inspect_layout',mode:'read',description:'读取当前模板与排版溢出测量；不声称已试渲染改写结果。'},
  {name:'propose_text_patch',mode:'propose',description:'仅提出可见正文替换建议，必须通过本地校验和用户审批。'},
] as const;
export const TEXT_FIELDS=['description','skillContent','selfEvaluationContent'] as const;
export type AiTextField=typeof TEXT_FIELDS[number];
export function fieldForBlock(key:string):AiTextField{
  if(key==='skills')return 'skillContent';
  if(key==='selfEvaluation')return 'selfEvaluationContent';
  if(/^(edu|exp|proj|custom):/.test(key))return 'description';
  throw new Error('未授权的正文目标。');
}
/** This is generated from the runtime schema and actual allowed operations, not a writable JSON API. */
export function buildAiSkillGuide(){
  const topLevel=Object.keys(ResumeDocumentSchema.shape);
  const protectedFields=topLevel.filter(k=>!['education','experience','projects','customData','skillContent','selfEvaluationContent'].includes(k));
  return {version:AI_SKILL_VERSION,tools:AI_TOOL_CATALOG,editableFields:TEXT_FIELDS,protectedFields,
    templateCount:TEMPLATE_IDS.length,restrictions:['仅可见正文允许替换；身份、日期、学历、机构、证书标题、资产、模板源代码均不可通过 AI 正文工具直接修改。','模型不可执行写入、删除、网络工具或任意 JSON 路径。','所有事实为候选人自述，JD 不提供新事实。','应用前必须显示原文、候选内容、理由和事实编号，并经用户确认。']};
}
export type AiReadToolName='list_visible_blocks'|'inspect_block_facts'|'inspect_layout';
/** Read operations run locally; only the explicit sanitized output can enter a model request. */
export function collectAiToolContext(doc:ResumeDocument,selectedKeys:readonly string[],overflowPx:number){
  const all=collectEditableBlocks(doc),selected=new Set(selectedKeys);
  const blocks=all.filter(b=>selected.has(b.key));
  if(blocks.length!==selected.size||new Set(blocks.map(b=>b.key)).size!==blocks.length)throw new Error('选择的段落已经变化或标识重复。');
  const sanitize=createAiTextSanitizer([doc]),sourceMap=buildAiFactSources(doc);
  const aliases=Object.fromEntries(blocks.map((b,i)=>['B'+(i+1),b.key]));
  const toolResults={
    list_visible_blocks:blocks.map((b,i)=>({blockKey:'B'+(i+1),label:sanitize(b.label),field:fieldForBlock(b.key),text:sanitize(b.text),maxCharsHint:b.maxCharsHint})),
    inspect_block_facts:blocks.map((b,i)=>({blockKey:'B'+(i+1),sources:outboundFactSources(sourceMap[b.key]??[])})),
    inspect_layout:{templateId:doc.templateId,overflowPx:Number.isFinite(overflowPx)?Math.max(0,Math.round(overflowPx)):null,measuredOn:'current-document-only'},
  };
  return {blocks,sourceMap,aliases,toolResults};
}
