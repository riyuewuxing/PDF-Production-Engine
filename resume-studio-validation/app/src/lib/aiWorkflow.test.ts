// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
import {parseWorkflowPlan,createWorkflowSession,beginWorkflowStep,finishWorkflowStep,completeWorkflow,isWorkflowCurrent,workflowStepGoal,workflowDocumentContent} from './aiWorkflow';
import {prepareAssistantTask,parseAssistantReply} from './aiAssistant';
import type {ByokAiSettings} from './byokAiClient';
const d=()=>ResumeDocumentSchema.parse({id:'synthetic-workflow',title:'合成简历',createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{name:'演示甲'},menuSections:[{id:'education',title:'Education',order:0},{id:'skills',title:'Skills',order:1}],education:[{id:'internal-edu',school:'示例学校',description:'设计实验。'}],skillContent:'整理记录。',globalSettings:{}});
const settings:ByokAiSettings={enabled:true,providerLabel:'Mock',model:'synthetic',baseUrl:'http://127.0.0.1:1234/v1',apiKey:''};
const raw=JSON.stringify({steps:[{action:'clarify',blockKeys:['B1'],reason:'DISPLAY_ONLY_INSTRUCTION'},{action:'concise',blockKeys:['B2'],reason:'精简技能'}]});
const aliases={B1:'edu:internal-edu',B2:'skills'};
describe('bounded workflow planning',()=>{
  it('returns only approved aliases and local step actions, never executable model instructions',()=>{
    const doc=d(),prepared=prepareAssistantTask({document:doc,mode:'workflow',goal:'改善表达',keys:Object.values(aliases),overflowPx:0});
    expect(prepared.options.userPrompt).not.toContain(doc.id);
    expect(prepared.options.userPrompt).not.toContain('internal-edu');
    const reply=parseAssistantReply(raw,prepared);expect(reply.kind).toBe('workflow');
    if(reply.kind!=='workflow')throw Error('expected plan');
    const s=createWorkflowSession({document:doc,slug:'demo',settings,goal:'改善表达',steps:reply.steps});
    expect(s.steps.map(s=>s.keys)).toEqual([['edu:internal-edu'],['skills']]);
    expect(workflowStepGoal(s)).not.toContain('DISPLAY_ONLY_INSTRUCTION');
    expect(workflowStepGoal(s)).toContain('澄清已有事实');
    expect(s.index).toBe(0);expect(s.stage).toBe('ready');
  });
  it('rejects arbitrary tools, extra properties, duplicate targets, unknown aliases and overlong plans',()=>{
    const step={action:'clarify',blockKeys:['B1'],reason:'核对'};
    for(const input of [{steps:[{...step,action:'delete'}]},{steps:[{...step,blockKeys:['B3']}]},{steps:[step,step]},{steps:[{...step,blockKeys:['B1','B1']}]},{steps:[{...step,path:'basic.name'}]},{steps:Array(5).fill(step)},{steps:[]},{steps:[step],write:true}])
      expect(()=>parseWorkflowPlan(JSON.stringify(input),aliases)).toThrow();
    expect(()=>parseWorkflowPlan(raw+' trailing text',aliases)).toThrow();
  });
  it('binds plan to actual document, model, version and included JD but tolerates save timestamp changes',()=>{
    const doc=d(),s=createWorkflowSession({document:doc,slug:'demo',settings,goal:'x',jdText:'岗位',steps:parseWorkflowPlan(raw,aliases)});
    expect(isWorkflowCurrent(s,{...doc,updatedAt:'2026-01-02'},'demo',settings,'岗位')).toBe(true);
    expect(isWorkflowCurrent(s,{...doc,skillContent:'changed'},'demo',settings,'岗位')).toBe(false);
    expect(isWorkflowCurrent(s,doc,'other',settings,'岗位')).toBe(false);
    expect(isWorkflowCurrent(s,doc,'demo',{...settings},'岗位')).toBe(false);
    expect(isWorkflowCurrent(s,doc,'demo',settings,'其他')).toBe(false);
  });
  it('requires an explicit active step, tracks approved edits and skip, and disallows premature completion',()=>{
    const doc=d(),s=createWorkflowSession({document:doc,slug:'demo',settings,goal:'x',steps:parseWorkflowPlan(raw,aliases)});
    expect(()=>completeWorkflow(s)).toThrow();expect(()=>finishWorkflowStep(s,doc,'applied')).toThrow();
    const active=beginWorkflowStep(s);expect(()=>beginWorkflowStep(active)).toThrow();
    const next={...doc,education:doc.education.map(e=>({...e,description:'已批准正文'}))};
    const ready=finishWorkflowStep(active,next,'applied');
    expect(ready.expectedContent).toBe(workflowDocumentContent(next));expect(ready.index).toBe(1);
    const second=beginWorkflowStep(ready);expect(()=>finishWorkflowStep(second,doc,'skipped')).toThrow();
    const done=completeWorkflow(finishWorkflowStep(second,next,'skipped'));
    expect(done.stage).toBe('done');expect(done.outcomes).toEqual(['applied','skipped']);
  });
});
