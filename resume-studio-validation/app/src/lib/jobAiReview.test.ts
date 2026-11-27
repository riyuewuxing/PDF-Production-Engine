import {describe,it,expect} from 'vitest';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
import {splitJobRequirements} from './jobRequirements';
import {collectJobAiEvidence,prepareJobAiReview,parseJobAiReview,JOB_AI_MAX_CLAUSES} from './jobAiReview';
const doc=ResumeDocumentSchema.parse({
  id:'SYNTHETIC_DOC_ID',title:'合成评测',createdAt:'2026-01-01',updatedAt:'2026-01-01',
  basic:{name:'PRIVATE_PERSON',email:'private@example.invalid',location:'PRIVATE_LOCATION',customFields:[{id:'hidden-basic',label:'私密',value:'PRIVATE_BASIC_MARKER',visible:false}]},
  menuSections:[{id:'basic',title:'基本',order:0},{id:'education',title:'教育',order:1},{id:'experience',title:'工作',order:2},{id:'projects',title:'项目',order:3},{id:'skills',title:'技能',order:4,enabled:false}],
  education:[{id:'edu-secret-id',school:'合成大学',major:'物理学',degree:'硕士',description:'参与整理12份实验记录；未独立主持课题。'}],
  experience:[{id:'exp-secret-id',company:'合成学校',position:'教学助理',description:'协助组织30课时教学活动，未独立主讲。联系人 PRIVATE_PERSON private@example.invalid PRIVATE_BASIC_MARKER。'},{id:'hidden-exp',company:'HIDDEN_SCHOOL',description:'HIDDEN_EXP',visible:false}],
  projects:[{id:'proj-secret-id',name:'示例软件',role:'成员',description:'使用 Python 清洗数据；参与小组开发。'}],
  skillContent:'HIDDEN_SKILL',globalSettings:{},
});
const source='须持高中物理教师资格证；硕士优先。\n必须具备独立主讲经验；不要求班主任经历。';
const prepare=(jd=source)=>prepareJobAiReview({document:doc,source:jd,clauseIds:splitJobRequirements(jd).map(c=>c.id),evidenceIds:collectJobAiEvidence(doc).map(e=>e.id)});
const row=(requirementId:string,assessment:string,citations:{evidenceId:string;quote:string}[],missing:string[]=[])=>({requirementId,assessment,citations,reason:'合成核对说明',missing});
describe('source grounded job AI evidence suggestions',()=>{
  it('sends only selected sanitized visible resume claims and temporary aliases',()=>{
    const p=prepare();const json=p.options.userPrompt;
    for(const s of ['SYNTHETIC_DOC_ID','edu-secret-id','exp-secret-id','proj-secret-id','PRIVATE_PERSON','private@example.invalid','PRIVATE_BASIC_MARKER','PRIVATE_LOCATION','HIDDEN_EXP','HIDDEN_SCHOOL','HIDDEN_SKILL'])expect(json).not.toContain(s);
    expect(p.sources.map(s=>s.id)).toEqual(['E1','E2','E3']);
    expect(p.requirements.map(s=>s.id)).toEqual(['R1','R2','R3','R4']);
    expect(p.sources[1]?.text).toContain('未独立主讲');
    expect(p.options.factBinding).toBeUndefined();
    expect(p.options.systemPrompt).toContain('协助不等于独立负责');
  });
  it('rejects empty, stale, duplicate and excessive choices without truncation',()=>{
    const p=prepare();
    for(const ids of [[],['missing'],[p.clauses[0]!.id,p.clauses[0]!.id]])expect(()=>prepareJobAiReview({document:doc,source,clauseIds:ids,evidenceIds:p.evidence.map(e=>e.id)})).toThrow('选择无效');
    const big=Array.from({length:JOB_AI_MAX_CLAUSES+1},(_,i)=>'合成条件'+i).join('；');
    expect(()=>prepare(big)).toThrow('上限');
    expect(()=>prepareJobAiReview({document:doc,source,clauseIds:[p.clauses[0]!.id],evidenceIds:['fact:local-only']})).toThrow('选择无效');
  });
  it('maps each selected clause to exact evidence and preserves distinction between gaps and nonrequirements',()=>{
    const p=prepare();const out=parseJobAiReview(JSON.stringify([
      row('R3','gap',[{evidenceId:'E2',quote:'未独立主讲'}],['独立主讲记录']),
      row('R1','gap',[],['高中物理教师资格证']),
      row('R2','supported',[{evidenceId:'E1',quote:'硕士'}]),
      row('R4','not-requirement',[]),
    ]),p);
    expect(out.map(r=>r.assessment)).toEqual(['gap','supported','gap','not-requirement']);
    expect(out[2]?.citations[0]).toMatchObject({quote:'未独立主讲',caution:true,evidence:{id:'resume:exp:exp-secret-id'}});
    expect(out[0]?.clause.quote).toBe('须持高中物理教师资格证；');
  });
  it('rejects fabricated quotes, wrong sources, duplicate and omitted clauses and unsupported support',()=>{
    const p=prepare();
    const valid=[row('R1','gap',[],['证书']),row('R2','supported',[{evidenceId:'E1',quote:'硕士'}]),row('R3','partial',[{evidenceId:'E2',quote:'协助组织30课时'}],['独立教学']),row('R4','not-requirement',[])];
    expect(parseJobAiReview(JSON.stringify(valid),p)).toHaveLength(4);
    for(const replacement of [row('R2','supported',[{evidenceId:'E2',quote:'硕士'}]),row('R2','supported',[{evidenceId:'E1',quote:'博士'}]),row('R2','supported',[]),row('R2','gap',[]),row('R2','supported',[{evidenceId:'E1',quote:'硕士'}],['未知']),row('R5','gap',[],['缺口']),row('R1','gap',[],['重复']),row('R2','supported',[{evidenceId:'E2',quote:'【隐私已省略】'}])])
      expect(()=>parseJobAiReview(JSON.stringify([valid[0],replacement,valid[2],valid[3]]),p)).toThrow();
    expect(()=>parseJobAiReview(JSON.stringify(valid.slice(1)),p)).toThrow('重复、缺失或越权');
    expect(()=>parseJobAiReview(JSON.stringify(valid.map(r=>({...r,apply:true}))),p)).toThrow('字段');
  });
  it('keeps research and general-role constraints scoped without treating similar text as independent evidence',()=>{
    const p=prepare('必须独立主持课题；熟悉 Python；至少具备三年管理经验。');
    const v=parseJobAiReview(JSON.stringify([row('R1','gap',[{evidenceId:'E1',quote:'未独立主持课题'}],['主持课题证明']),row('R2','supported',[{evidenceId:'E3',quote:'使用 Python 清洗数据'}]),row('R3','gap',[],['管理年限及职责'])]),p);
    expect(v.map(r=>r.assessment)).toEqual(['gap','supported','gap']);
    expect(v[0]?.citations[0]?.caution).toBe(true);
    expect(v[2]?.missing).toEqual(['管理年限及职责']);
  });
});

it('exposes a negation hidden by a literal substring citation rather than trusting the positive fragment',()=>{
  const p=prepare('必须具备独立主讲经验');
  const out=parseJobAiReview(JSON.stringify([row('R1','supported',[{evidenceId:'E2',quote:'独立主讲'}])]),p);
  expect(out[0]?.citations[0]).toMatchObject({quote:'独立主讲',occurrences:1,caution:true,qualifierClipped:true});
  expect(out[0]?.citations[0]?.context).toContain('未独立主讲');
  // The model suggestion remains explicitly unverified; no eligibility or write result is produced.
  expect(out[0]?.assessment).toBe('supported');
  expect(out[0]?.reviewAssessment).toBe('uncertain');
});
