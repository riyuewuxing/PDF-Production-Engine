// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {ResumeDocumentSchema,resumeRevision} from '../schema/resumeSchema';
import type {FactBank,FactRecord} from '../schema/factBankSchema';
import {factEntityId} from './aiContext';
import {prepareFactSelection,assertFreshFactSelection} from './factSelection';
import {prepareScopedPolishRequest,prepareTailorRequest,parseTailorProposalsResponse} from './aiTailor';
import {prepareAssistantTask} from './aiAssistant';
import {assertBoundFactPrompt,hasRecordFactSources} from './factPromptGate';

const doc=()=>ResumeDocumentSchema.parse({id:'synthetic-private-document',title:'虚构测试',createdAt:'2026-01-01',updatedAt:'2026-01-01',
  basic:{name:'演示甲',email:'fixture@example.invalid'},menuSections:[{id:'basic',title:'Basic',order:0},{id:'education',title:'Education',order:1},{id:'skills',title:'Skills',order:2}],
  education:[{id:'private-edu',school:'示例学校',description:'设计实验。'}],skillContent:'Python 整理数据。',globalSettings:{}});
const record=(d:ReturnType<typeof doc>,key:string,id:string,assertion:string):FactRecord=>({
  id,docId:d.id,blockKey:key,entityId:factEntityId(d,key)!,kind:'achievement',assertion,value:'',unit:'',timeframe:'2025',
  evidenceRef:'SYNTHETIC_LOCAL_EVIDENCE',sensitivity:'shareable',sourceScope:'manual',verifiedStatus:'user-confirmed',modifiedAt:'2026-01-01T00:00:00Z',
});
const fixture=()=>{const d=doc(),a=record(d,'edu:private-edu','cf287c55-76d4-4b50-95f3-36ba681263e9','演示甲 核对 12 份资料'),b=record(d,'skills','cf287c55-76d4-4b50-95f3-36ba681263e8','整理 6 份合成记录');const bank:FactBank={schemaVersion:1,revision:'revision-1',records:[a,b]};return {d,a,b,bank};};
describe('unified fact selection and text modes',()=>{
  it('does not read a bank or add fact payload without explicit selection',async()=>{
    const {d}=fixture(),s=prepareFactSelection(d,'demo',['skills'],null,[]),load=vi.fn();
    expect(s).toEqual({records:[]});await assertFreshFactSelection(d,s,load);expect(load).not.toHaveBeenCalled();
    expect(hasRecordFactSources(prepareScopedPolishRequest({document:d,blockKey:'skills',mode:'star'}).options.userPrompt)).toBe(false);
    expect(hasRecordFactSources(prepareTailorRequest({document:d,jdText:'示例'}).options.userPrompt)).toBe(false);
  });
  it('uses the same exact request gate for assistant, single, and whole-resume payloads',()=>{
    const {d,a,b,bank}=fixture();
    const one=prepareFactSelection(d,'demo',[a.blockKey],bank,[a.id]);
    const whole=prepareFactSelection(d,'demo',[a.blockKey,b.blockKey],bank,[b.id,a.id]);
    const prompts=[
      [prepareScopedPolishRequest({document:d,blockKey:a.blockKey,mode:'star',records:one.records}).options.userPrompt,one],
      [prepareAssistantTask({document:d,mode:'ask',goal:'检查',keys:[a.blockKey],overflowPx:0,records:one.records}).options.userPrompt,one],
      [prepareTailorRequest({document:d,jdText:'示例',records:whole.records}).options.userPrompt,whole],
    ] as const;
    for(const [prompt,selection] of prompts){
      expect(hasRecordFactSources(prompt)).toBe(true);
      expect(()=>assertBoundFactPrompt(d,selection.binding!,selection.records,prompt)).not.toThrow();
      for(const value of [a.id,b.id,d.id,a.blockKey,a.evidenceRef,'演示甲','fixture@example.invalid'])expect(prompt).not.toContain(value);
      expect(()=>assertBoundFactPrompt(d,selection.binding!,selection.records,prompt.replace('核对 12 份资料','虚构成果'))).toThrow('事实外发清单');
    }
    const single=JSON.parse(prompts[0][0]);expect(single.toolResults.inspect_block_facts[0].sources.filter((s:any)=>s.scope==='record')).toHaveLength(1);
    expect(prompts[0][0]).not.toContain('整理 6 份合成记录');
    const full=JSON.parse(prompts[2][0]);expect(full.blocks[0].sources.find((s:any)=>s.scope==='record').id).toBe('record-2');expect(full.blocks[1].sources.find((s:any)=>s.scope==='record').id).toBe('record-1');
  });
  it('sanitizes selected records against both current and explicitly referenced master identities',()=>{
    const {d,a,bank}=fixture();
    const master={...d,id:'synthetic-master',basic:{...d.basic,name:'母库隐私标记'}};
    const changed={...a,assertion:a.assertion+' 母库隐私标记'};
    const s=prepareFactSelection(d,'demo',[a.blockKey,'skills'],{...bank,records:[changed]},[a.id]);
    const binding={...s.binding!,masterRevision:resumeRevision(master)};
    const req=prepareTailorRequest({document:d,masterDocument:master,jdText:'示例',records:s.records});
    expect(req.options.userPrompt).not.toContain('母库隐私标记');
    expect(()=>assertBoundFactPrompt(d,binding,s.records,req.options.userPrompt,master)).not.toThrow();
    expect(()=>assertBoundFactPrompt(d,binding,s.records,req.options.userPrompt)).toThrow('事实外发清单');
  });
  it('rejects copied records under a different block alias and duplicate supported containers',()=>{
    const {d,a,b,bank}=fixture(),s=prepareFactSelection(d,'demo',[a.blockKey,b.blockKey],bank,[a.id]);
    const req=prepareTailorRequest({document:d,jdText:'示例',records:s.records}),payload=JSON.parse(req.options.userPrompt);
    payload.toolResults={inspect_block_facts:[payload.blocks[0]]};
    expect(()=>assertBoundFactPrompt(d,s.binding!,s.records,JSON.stringify(payload))).toThrow();
    delete payload.toolResults;const src=payload.blocks[0].sources.pop();payload.blocks[1].sources.push(src);
    expect(()=>assertBoundFactPrompt(d,s.binding!,s.records,JSON.stringify(payload))).toThrow();
    const proposal=parseTailorProposalsResponse(JSON.stringify([{blockKey:'B2',suggestedText:'整理 12 份资料。',factIds:['record-1']}]),req.blocks,req.sourceMap,[],req.aliases);
    expect(proposal[0]?.factWarnings.some(w=>w.token==='source')).toBe(true);
    expect(proposal[0]?.accepted).toBe(false);
  });
  it('rejects cross-block, local-only, revoked, duplicate and missing selected records',()=>{
    const {d,a,b,bank}=fixture();
    for(const ids of [[b.id],[a.id,a.id],['missing']])expect(()=>prepareFactSelection(d,'demo',[a.blockKey],bank,ids)).toThrow();
    for(const change of [{sensitivity:'local-only' as const},{verifiedStatus:'revoked' as const}])expect(()=>prepareFactSelection(d,'demo',[a.blockKey],{...bank,records:[{...a,...change}]},[a.id])).toThrow();
  });
  it('rechecks current bank revision, exact contents and eligibility on each stage',async()=>{
    const {d,a,bank}=fixture(),s=prepareFactSelection(d,'demo',[a.blockKey],bank,[a.id]);
    await expect(assertFreshFactSelection(d,s,async()=>bank)).resolves.toBeUndefined();
    for(const changed of [{...bank,revision:'revision-2'},{...bank,records:[{...a,assertion:'changed'}]},{...bank,records:[{...a,verifiedStatus:'revoked' as const}]}])
      await expect(assertFreshFactSelection(d,s,async()=>changed)).rejects.toThrow('旧审批作废');
    await expect(assertFreshFactSelection(d,s,async()=>{throw new Error('storage failure')})).rejects.toThrow('storage failure');
  });
});
