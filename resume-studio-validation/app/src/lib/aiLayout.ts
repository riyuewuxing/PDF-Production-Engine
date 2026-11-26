import {z} from 'zod';
import {TemplateIdSchema,TEMPLATE_IDS,ResumeDocumentSchema,type ResumeDocument} from '../schema/resumeSchema';
import {createAiTextSanitizer} from './aiContext';
import type {ByokCompletionOptions} from './byokAiClient';
export const LAYOUT_SKILL_VERSION='resume-layout-v1' as const;
export const LAYOUT_LIMITS={
  baseFontSize:{label:'基础字号 (px)',min:12,max:18,step:0.5},
  lineHeight:{label:'行高',min:1.15,max:1.8,step:0.05},
  pagePadding:{label:'页边距 (px)',min:20,max:48,step:2},
  paragraphSpacing:{label:'段落间距 (px)',min:4,max:28,step:2},
  sectionSpacing:{label:'章节间距 (px)',min:8,max:36,step:2},
  headerSize:{label:'章节标题字号 (px)',min:14,max:24,step:1},
  subheaderSize:{label:'小标题字号 (px)',min:12,max:22,step:1},
} as const;
export type LayoutKey=keyof typeof LAYOUT_LIMITS;
export const LAYOUT_KEYS=Object.keys(LAYOUT_LIMITS) as LayoutKey[];
const limitsShape=Object.fromEntries(LAYOUT_KEYS.map(k=>[k,z.number().finite().min(LAYOUT_LIMITS[k].min).max(LAYOUT_LIMITS[k].max).optional()])) as Record<LayoutKey,z.ZodOptional<z.ZodNumber>>;
const LayoutChanges=z.object(limitsShape).strict();
export const LayoutProposalSchema=z.object({reason:z.string().min(1).max(2000),changes:LayoutChanges,templateId:TemplateIdSchema.optional()}).strict();
export type LayoutProposal=z.infer<typeof LayoutProposalSchema>;
export function layoutSettings(doc:ResumeDocument){return Object.fromEntries(LAYOUT_KEYS.map(k=>[k,doc.globalSettings[k]])) as Record<LayoutKey,number>;}
export function prepareLayoutRequest(input:{document:ResumeDocument;goal:string;allowTemplate:boolean;overflowPx:number}):ByokCompletionOptions{
  if(!input.goal.trim())throw new Error('请输入版式目标。');
  const {document:doc,allowTemplate}=input;
  return {systemPrompt:[
    '你是受限简历排版助手。只允许调整以下明确的数字样式字段，不得修改事实、正文、隐私、可见性、章节顺序、分页标记、颜色、字体名称或文件。',
    '只返回 JSON 对象 {"reason":"理由","changes":{"baseFontSize":14}}。changes 只包含需要调整的字段。禁止任意路径或额外字段。保留可读性，不承诺未经真实 PDF 验证的页数。',
    '约束：'+JSON.stringify(LAYOUT_LIMITS),
    allowTemplate?'用户允许从列出的 templateId 中选择一个现有模板；可选 templateId 字段。':'用户不允许切换模板；禁止 templateId 字段。',
  ].join('\n'),userPrompt:JSON.stringify({goal:createAiTextSanitizer([doc])(input.goal),currentTemplate:doc.templateId,currentSettings:layoutSettings(doc),canvasOverflowPx:Number.isFinite(input.overflowPx)?Math.round(input.overflowPx):null,allowedTemplateIds:allowTemplate?TEMPLATE_IDS:[],note:'仅编辑画布测量，非真实 PDF 页数；未发送正文。'},null,2),temperature:0.2,maxTokens:1200,timeoutMs:40000};
}
export function parseLayoutProposal(raw:string,allowTemplate:boolean):LayoutProposal{
  const clean=raw.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
  let value:unknown;try{value=JSON.parse(clean);}catch{throw new Error('版式提案不是有效 JSON 对象。');}
  const parsed=LayoutProposalSchema.parse(value);
  if(parsed.templateId!==undefined&&!allowTemplate)throw new Error('未授权模板切换。');
  if(!Object.keys(parsed.changes).length&&parsed.templateId===undefined)throw new Error('没有可应用的版式变更。');
  return parsed;
}
export function previewLayoutProposal(document:ResumeDocument,proposal:unknown,allowTemplate:boolean):ResumeDocument{
  const p=LayoutProposalSchema.parse(proposal);
  if(p.templateId!==undefined&&!allowTemplate)throw new Error('未授权模板切换。');
  const changes=Object.fromEntries(LAYOUT_KEYS.filter(k=>p.changes[k]!==undefined).map(k=>[k,p.changes[k]]));
  const next=ResumeDocumentSchema.parse({...document,templateId:p.templateId??document.templateId,globalSettings:{...document.globalSettings,...changes}});
  if(next.globalSettings.headerSize<next.globalSettings.baseFontSize||next.globalSettings.subheaderSize<next.globalSettings.baseFontSize-1)throw new Error('候选标题字号层级不合理，请重新调整。');
  if(JSON.stringify(next)===JSON.stringify(document))throw new Error('候选版式没有实际变更。');
  return next;
}
