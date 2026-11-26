import {z} from 'zod';
import type {ResumeDocument} from '../schema/resumeSchema';
import type {ByokAiSettings} from './byokAiClient';

export const WORKFLOW_ACTIONS={
  clarify:'澄清已有事实与贡献角色',
  concise:'精简正文并保留事实限定',
  structure:'改善正文结构和表达顺序',
  align:'对齐已有事实与目标岗位（不得新增事实）',
} as const;
const actionSchema=z.enum(['clarify','concise','structure','align']);
const planSchema=z.object({steps:z.array(z.object({
  action:actionSchema,blockKeys:z.array(z.string().regex(/^B[1-9]\d*$/)).min(1).max(8),
  reason:z.string().trim().min(1).max(500),
}).strict()).min(1).max(4)}).strict();
export type WorkflowStep={id:string;action:keyof typeof WORKFLOW_ACTIONS;keys:string[];reason:string};
export function parseWorkflowPlan(raw:string,aliases:Readonly<Record<string,string>>):WorkflowStep[]{
  const cleaned=raw.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/i,'').trim();
  let value:unknown;try{value=JSON.parse(cleaned);}catch{throw new Error('分步计划不是完整 JSON 对象。');}
  const plan=planSchema.parse(value),used=new Set<string>();
  return plan.steps.map((s,i)=>{
    const keys=s.blockKeys.map(alias=>{
      if(!Object.hasOwn(aliases,alias))throw new Error('分步计划含未经授权的段落。');
      const key=aliases[alias]!;
      if(used.has(key))throw new Error('分步计划存在重复段落，不能可靠拆分。');
      used.add(key);return key;
    });
    return {id:'step-'+(i+1),action:s.action,keys,reason:s.reason};
  });
}
/** Timestamps change during legitimate saves; all other content must remain exact. */
export function workflowDocumentContent(document:ResumeDocument):string{
  const {updatedAt:_,...content}=document;
  return JSON.stringify(content);
}
export type WorkflowSession={
  slug:string;docId:string;settings:ByokAiSettings;originalGoal:string;jdText?:string;
  steps:WorkflowStep[];index:number;outcomes:('applied'|'skipped')[];
  expectedContent:string;stage:'ready'|'active'|'done';
};
export function createWorkflowSession(input:{document:ResumeDocument;slug:string;settings:ByokAiSettings;goal:string;jdText?:string;steps:WorkflowStep[]}):WorkflowSession{
  return {slug:input.slug,docId:input.document.id,settings:input.settings,originalGoal:input.goal,jdText:input.jdText,steps:input.steps,index:0,outcomes:[],expectedContent:workflowDocumentContent(input.document),stage:'ready'};
}
export function isWorkflowCurrent(session:WorkflowSession,document:ResumeDocument,slug:string,settings:ByokAiSettings,jdText:string):boolean{
  return session.slug===slug&&session.docId===document.id&&session.settings===settings&&(session.jdText===undefined||session.jdText===jdText)&&session.expectedContent===workflowDocumentContent(document);
}
export function workflowStepGoal(session:WorkflowSession):string{
  const step=session.steps[session.index];
  if(!step)throw new Error('没有待处理的分步任务。');
  // Model-written reason is display-only and never becomes a downstream instruction or source.
  return session.originalGoal+'\n本步骤：'+WORKFLOW_ACTIONS[step.action]+'。仅处理本次所选段落。';
}
export function beginWorkflowStep(session:WorkflowSession):WorkflowSession{
  if(session.stage!=='ready'||!session.steps[session.index])throw new Error('当前没有可开始的步骤。');
  return {...session,stage:'active'};
}
export function finishWorkflowStep(session:WorkflowSession,document:ResumeDocument,outcome:'applied'|'skipped'):WorkflowSession{
  if(session.stage!=='active'||session.docId!==document.id||!session.steps[session.index])throw new Error('分步任务状态已变化。');
  if(outcome==='skipped'&&workflowDocumentContent(document)!==session.expectedContent)throw new Error('简历已变化，不能跳过旧步骤。');
  return {...session,stage:'ready',index:session.index+1,outcomes:[...session.outcomes,outcome],expectedContent:workflowDocumentContent(document)};
}
export function completeWorkflow(session:WorkflowSession):WorkflowSession{
  if(session.stage!=='ready'||session.index!==session.steps.length)throw new Error('分步任务尚未结束。');
  return {...session,stage:'done'};
}
