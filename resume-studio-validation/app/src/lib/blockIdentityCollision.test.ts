import {describe,it,expect} from 'vitest';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
import {collectEditableBlocks,applyBlockUpdates} from './resumeBlocks';
import {buildAiFactSources,factEntityId} from './aiContext';
import {collectLocalJobEvidence} from './jobRequirements';
import {collectAiToolContext} from './aiSkills';
import {buildTextPatchEnvelope,previewTextPatch} from './aiTextPatch';
const base=()=>ResumeDocumentSchema.parse({id:'synthetic-collision-doc',title:'合成',createdAt:'2026-01-01',updatedAt:'2026-01-01',menuSections:[{id:'education',title:'教育',order:0},{id:'experience',title:'经历',order:1},{id:'projects',title:'项目',order:2},{id:'custom:a',title:'自定义',order:3},{id:'custom',title:'其他',order:4,enabled:false},{id:'skills',title:'技能',order:5}],education:[{id:'e',school:'HIDDEN_EDU',description:'PRIVATE_HIDDEN_EDU',visible:false},{id:'e',school:'可见教育',description:'可见正文'}],experience:[{id:'x',company:'HIDDEN_EXP',description:'PRIVATE_HIDDEN_EXP',visible:false},{id:'x',company:'可见单位',description:'可见正文'}],projects:[{id:'p',name:'HIDDEN_PROJ',description:'PRIVATE_HIDDEN_PROJ',visible:false},{id:'p',name:'可见项目',description:'可见正文'}],customData:{'custom:a':[{id:'b',title:'可见自定义',description:'可见正文'}],custom:[{id:'a:b',title:'HIDDEN_CUSTOM',description:'PRIVATE_HIDDEN_CUSTOM',visible:false}]},skillContent:'保留技能',globalSettings:{}});
describe('raw identity collision guard including hidden and disabled rows',()=>{
  it('excludes all ambiguous raw keys and never sends hidden metadata',()=>{
    const d=base(),keys=['edu:e','exp:x','proj:p','custom:custom:a:b'];
    expect(collectEditableBlocks(d).map(b=>b.key)).toEqual(['skills']);
    for(const key of keys){expect(factEntityId(d,key)).toBeNull();expect(()=>collectAiToolContext(d,[key],0)).toThrow();expect(()=>applyBlockUpdates(d,{[key]:'非法改写'})).toThrow('重复、隐藏');}
    const sources=JSON.stringify([buildAiFactSources(d),collectLocalJobEvidence(d,null)]);
    expect(sources).not.toMatch(/HIDDEN_|PRIVATE_HIDDEN/);
    expect(sources).toContain('保留技能');
  });
  it('rejects a patch prepared against a once-unique visible row after a hidden duplicate appears',async()=>{
    const d=base(),valid={...d,education:d.education.filter(e=>e.visible)};
    const p=await buildTextPatchEnvelope({document:valid,slug:'fixture',baseRevision:'revision',sourceRequestId:'00000000-0000-4000-8000-000000000001',candidates:[{blockKey:'edu:e',originalText:'可见正文',suggestedText:'合成改写',reason:'合成',factIds:[]}]});
    expect((await previewTextPatch({document:valid,slug:'fixture',revision:'revision',envelope:p})).education[0]?.description).toBe('合成改写');
    await expect(previewTextPatch({document:d,slug:'fixture',revision:'revision',envelope:p})).rejects.toThrow('未授权目标');
  });
  it('uses actual custom section identity even when section IDs contain colons, with no collision',()=>{
    const d=base(),valid={...d,customData:{'custom:a':d.customData['custom:a']!}};
    const next=applyBlockUpdates(valid,{'custom:custom:a:b':'只改这一条'});
    expect(next.customData['custom:a']?.[0]?.description).toBe('只改这一条');
    expect(valid.customData['custom:a']?.[0]?.description).toBe('可见正文');
  });
});
