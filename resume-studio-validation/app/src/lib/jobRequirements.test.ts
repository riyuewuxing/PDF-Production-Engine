// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {JobReviewArchiveSchema} from '../schema/applicationSchema';
import {ResumeDocumentSchema,resumeRevision} from '../schema/resumeSchema';
import {factEntityId} from './aiContext';
import {splitJobRequirements,suggestRequirementPriority,collectLocalJobEvidence,validateRequirementReview,blankRequirementReview,evidenceKeywordHints,MAX_JD_CLAUSES,MAX_JD_SOURCE,jobReviewBasisHash,restoreArchivedJobReview,sameJobReviewDocument} from './jobRequirements';
import type {FactBank,FactRecord} from '../schema/factBankSchema';
const doc=ResumeDocumentSchema.parse({id:'synthetic-jd-doc',title:'合成岗位',createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{name:'PRIVATE_NAME',email:'fixture@example.invalid',employmentStatus:'合成应届毕业生'},
  menuSections:[{id:'basic',title:'Basic',order:0},{id:'education',title:'Education',order:1},{id:'experience',title:'Experience',order:2},{id:'skills',title:'Skills',order:3,enabled:false}],
  education:[{id:'visible-edu',school:'示例大学',major:'物理学',degree:'硕士',description:'合成实验设计'},{id:'hidden-edu',school:'HIDDEN_SCHOOL',visible:false}],
  experience:[{id:'visible-exp',company:'示例机构',position:'助理',description:'尚无班主任经验。'}],skillContent:'HIDDEN_SKILL',globalSettings:{}});
const r:FactRecord={id:'a45c1bda-c090-43b9-99cb-c7587507e1c1',docId:doc.id,blockKey:'edu:visible-edu',entityId:factEntityId(doc,'edu:visible-edu')!,kind:'credential',assertion:'本人核对合成教师资格证',value:'',unit:'',timeframe:'2025',evidenceRef:'SYNTHETIC_LOCAL_SOURCE',sourceScope:'manual',sensitivity:'local-only',verifiedStatus:'user-confirmed',modifiedAt:'2026-01-01T00:00:00Z'};
describe('source-grounded offline job review',()=>{
  it('preserves original clause offsets, order and line numbers including CRLF, compound clauses and negation',()=>{
    const source='  合成公告\r\n须持高中物理教师资格证；硕士优先。\n不要求班主任经验；必须硕士且经验优先\n报名截止2026-12-01。';
    const rows=splitJobRequirements(source);
    expect(rows.map(r=>r.line)).toEqual([1,2,2,3,3,4]);
    expect(rows.map(r=>r.quote)).toEqual(['合成公告','须持高中物理教师资格证；','硕士优先。','不要求班主任经验；','必须硕士且经验优先','报名截止2026-12-01。']);
    for(const row of rows)expect(source.slice(row.start,row.end)).toBe(row.quote);
    expect(rows.map(r=>r.priorityHint)).toEqual(['unknown','mandatory','preferred','unknown','unknown','unknown']);
    expect(rows[1]?.categories).toContain('教师资格');expect(rows[1]?.categories).toContain('学段');expect(rows[5]?.categories).toContain('时间');
    expect(suggestRequirementPriority('本科或硕士均可')).toBe('unknown');
    expect(suggestRequirementPriority('专业不限，相关经历优先')).toBe('unknown');
  });
  it('rejects oversized sources and excessive clauses rather than silently dropping requirements',()=>{
    expect(()=>splitJobRequirements('甲'.repeat(MAX_JD_SOURCE+1))).toThrow('未截断');
    expect(()=>splitJobRequirements(Array.from({length:MAX_JD_CLAUSES+1},()=> '合成要求').join('；'))).toThrow('未截断');
    expect(splitJobRequirements('  \n；\r\n')).toEqual([]);
  });
  it('collects only current visible self-reports and matching active original facts including local-only',()=>{
    const bank:FactBank={schemaVersion:1,revision:'r1',records:[r,{...r,id:'b45c1bda-c090-43b9-99cb-c7587507e1c1',verifiedStatus:'revoked',assertion:'REVOKED_MARKER'},{...r,id:'c45c1bda-c090-43b9-99cb-c7587507e1c1',docId:'another',assertion:'OTHER_MARKER'},{...r,id:'d45c1bda-c090-43b9-99cb-c7587507e1c1',entityId:'wrong',assertion:'WRONG_MARKER'}]};
    const rows=collectLocalJobEvidence(doc,bank),raw=JSON.stringify(rows);
    for(const hidden of ['PRIVATE_NAME','fixture@example.invalid','HIDDEN_SCHOOL','HIDDEN_SKILL','REVOKED_MARKER','OTHER_MARKER','WRONG_MARKER'])expect(raw).not.toContain(hidden);
    expect(rows.find(e=>e.id==='fact:'+r.id)).toMatchObject({kind:'fact',reference:r.evidenceRef});
    expect(rows.find(e=>e.id==='resume:edu:visible-edu')?.text).toContain('硕士');
    expect(rows.find(e=>e.id==='resume:exp:visible-exp')?.text).toContain('尚无班主任经验');
  });
  it('keyword hints are not eligibility and support requires explicit current evidence selection',()=>{
    const clause=splitJobRequirements('必须具备班主任经验')[0]!,rows=collectLocalJobEvidence(doc,null);
    const evidence=rows.find(e=>e.id==='resume:exp:visible-exp')!;
    expect(evidenceKeywordHints(clause,evidence)).toContain('班主任');
    const review=blankRequirementReview();expect(review.outcome).toBe('unchecked');
    expect(()=>validateRequirementReview({...review,outcome:'supported'},rows)).toThrow('至少一条');
    expect(()=>validateRequirementReview({...review,outcome:'supported',evidenceIds:['missing']},rows)).toThrow('失效');
    expect(()=>validateRequirementReview({...review,priority:'not-requirement',outcome:'gap'},rows)).toThrow('非条件');
    expect(validateRequirementReview({...review,priority:'mandatory',outcome:'gap',evidenceIds:[evidence.id],note:' 尚无经验 '},rows)).toMatchObject({outcome:'gap',note:'尚无经验'});
  });
});

it('binds saved review to exact source, full content and current evidence revision',async()=>{
  const source='须持高中物理教师资格证；硕士优先。',bank:FactBank={schemaVersion:1,revision:'r1',records:[r]};
  const first=splitJobRequirements(source)[0]!;
  const archive=JobReviewArchiveSchema.parse({reviewVersion:1,id:crypto.randomUUID(),slug:'demo',docId:doc.id,documentRevision:resumeRevision(doc),factRevision:bank.revision,basisHash:await jobReviewBasisHash(doc,bank,source),source,createdAt:'2026-11-26T00:00:00Z',applicationId:null,snapshotId:null,rows:[{clauseId:first.id,review:{priority:'mandatory',outcome:'supported',evidenceIds:['fact:'+r.id],note:'合成'}}]});
  expect((await restoreArchivedJobReview(archive,doc,bank,resumeRevision(doc)))[first.id]?.outcome).toBe('supported');
  await expect(restoreArchivedJobReview(archive,doc,{...bank,revision:'r2'},resumeRevision(doc))).rejects.toThrow('事实库版本');
  await expect(restoreArchivedJobReview(archive,{...doc,title:'changed'},bank,resumeRevision(doc))).rejects.toThrow('内容已变化');
  await expect(restoreArchivedJobReview(archive,doc,{...bank,records:[{...r,assertion:'changed'}]},resumeRevision(doc))).rejects.toThrow('内容已变化');
  await expect(restoreArchivedJobReview({...archive,rows:[{...archive.rows[0]!,clauseId:'0:1'}]},doc,bank,resumeRevision(doc))).rejects.toThrow('条款位置');
  await expect(restoreArchivedJobReview({...archive,source:source.replace('高中','初中')},doc,bank,resumeRevision(doc))).rejects.toThrow('内容已变化');
  await expect(restoreArchivedJobReview(archive,doc,bank,'changed')).rejects.toThrow('简历版本');
  expect(sameJobReviewDocument(doc,{...doc,updatedAt:'2026-11-26'})).toBe(true);
  expect(sameJobReviewDocument(doc,{...doc,title:'different'})).toBe(false);
  expect(()=>JobReviewArchiveSchema.parse({...archive,applicationId:'app'})).toThrow();
});
