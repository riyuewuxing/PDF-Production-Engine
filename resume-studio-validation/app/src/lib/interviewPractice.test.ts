import {describe,it,expect} from 'vitest';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
import {JobReviewArchiveSchema} from '../schema/applicationSchema';
import {generateInterviewQuestions} from './jobToolkit';
import {preparePracticeQuestions,parsePracticeKey,practiceHistory,archivedPracticeQuestions} from './interviewPractice';
import {splitJobRequirements} from './jobRequirements';
const doc=ResumeDocumentSchema.parse({id:'synthetic-doc',title:'合成',createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{title:'高中物理教师',name:'PRIVATE_MARKER'},menuSections:[{id:'basic',title:'基本',order:0},{id:'education',title:'教育',order:1},{id:'projects',title:'项目',order:2},{id:'experience',title:'工作',order:3},{id:'skills',title:'技能',order:4,enabled:false}],education:[{id:'e',school:'合成大学',major:'物理学',description:'整理12份记录'}],projects:[{id:'p1',name:'相同标题',role:'成员',description:'参与项目甲'},{id:'p2',name:'相同标题',role:'成员',description:'参与项目乙'},{id:'p3',name:'隐藏项目',visible:false,description:'HIDDEN_MARKER'}],experience:[{id:'x',company:'合成学校',position:'教学助理',description:'协助30课时，未独立主讲'}],skillContent:'DISABLED_MARKER',globalSettings:{}});
const get=(rows:Awaited<ReturnType<typeof preparePracticeQuestions>>,id:string)=>rows.find(q=>q.identity===id)!;
describe('interview practice scope and historical preservation',()=>{
  it('classifies explicit role only and separates teaching, physics and research',()=>{
    for(const role of ['科研助理','数据分析师','市场研究专员','英语教师','高中物理教师']){
      const qs=generateInterviewQuestions(doc,role);
      expect(qs.some(q=>q.id==='q-teach-difficult')).toBe(role.includes('教师'));
      expect(qs.some(q=>q.id==='q-research-method')).toBe(role==='科研助理');
      expect(qs.some(q=>q.question.includes('电磁感应'))).toBe(role==='高中物理教师');
    }
  });
  it('preserves same project draft under reorder, never reuses another project with identical labels',async()=>{
    const before=await preparePracticeQuestions(doc,'fixture','科研助理');
    const after=await preparePracticeQuestions({...doc,projects:[doc.projects[1]!,doc.projects[0]!,doc.projects[2]!]},'fixture','科研助理');
    const a=get(before,'block:proj:p1'),b=get(before,'block:proj:p2');
    expect(a.answerKey).not.toBe(b.answerKey);
    expect(get(after,'block:proj:p1').answerKey).toBe(a.answerKey);
    expect(get(after,'block:proj:p2').answerKey).toBe(b.answerKey);
    expect(practiceHistory({[a.answerKey]:'甲',[b.answerKey]:'乙'},doc.id,'fixture',after).history).toEqual([]);
    expect(a.sources[0]!.text).toContain('参与项目甲');
  });
  it('invalidates changed source, hidden/deleted source, role, slug or document identity but not timestamp',async()=>{
    const rows=await preparePracticeQuestions(doc,'fixture','科研助理'),a=get(rows,'block:proj:p1');
    const edit={...doc,projects:doc.projects.map(p=>p.id==='p1'?{...p,description:'修订后正文'}:p)};
    const changed=await preparePracticeQuestions(edit,'fixture','科研助理');
    expect(get(changed,a.identity).answerKey).not.toBe(a.answerKey);
    expect(practiceHistory({[a.answerKey]:'旧甲'},doc.id,'fixture',changed).history[0]?.answer).toBe('旧甲');
    for(const d of [{...doc,projects:doc.projects.filter(p=>p.id!=='p1')},{...doc,projects:doc.projects.map(p=>p.id==='p1'?{...p,visible:false}:p)},{...doc,projects:[...doc.projects,doc.projects[0]!]}])expect((await preparePracticeQuestions(d,'fixture','科研助理')).some(q=>q.identity===a.identity)).toBe(false);
    expect(get(await preparePracticeQuestions({...doc,updatedAt:'later'},'fixture','科研助理'),a.identity).answerKey).toBe(a.answerKey);
    expect(get(await preparePracticeQuestions(doc,'fixture','数据分析师'),a.identity).answerKey).not.toBe(a.answerKey);
    expect(get(await preparePracticeQuestions(doc,'other','科研助理'),a.identity).answerKey).not.toBe(a.answerKey);
    expect(get(await preparePracticeQuestions({...doc,id:'different'},'fixture','科研助理'),a.identity).answerKey).not.toBe(a.answerKey);
    expect(practiceHistory({[a.answerKey]:'原文档'},'different','fixture',[]).history).toEqual([]);
  });
  it('keeps old ordinal answers unbound, never associates them to a new question',async()=>{
    const rows=await preparePracticeQuestions(doc,'fixture','科研助理');
    const old={'fixture:q-proj-1':'旧答案','other:q-proj-1':'其他'};
    expect(rows.some(q=>Object.hasOwn(old,q.answerKey))).toBe(false);
    expect(practiceHistory(old,doc.id,'fixture',rows).legacy).toEqual([{key:'fixture:q-proj-1',answer:'旧答案'}]);
    expect(parsePracticeKey('interview-practice-v2:bad')).toBeNull();
    expect(JSON.stringify(rows.map(q=>[q.answerKey,q.sources]))).not.toMatch(/PRIVATE_MARKER|HIDDEN_MARKER|DISABLED_MARKER/);
  });
  it('generates historical clause practice without resolving old fact IDs or treating gaps as qualifications',async()=>{
    const source='须持教师资格证；具备科研经历；不要求班主任经历。',clauses=splitJobRequirements(source);
    const a=JobReviewArchiveSchema.parse({reviewVersion:1,id:'00000000-0000-4000-8000-000000000001',slug:'fixture',docId:doc.id,documentRevision:'old',factRevision:'old',basisHash:'a'.repeat(64),source,createdAt:'2026-01-01T00:00:00Z',applicationId:null,snapshotId:null,rows:[{clauseId:clauses[0]!.id,review:{priority:'mandatory',outcome:'gap',evidenceIds:[],note:'待核实'}},{clauseId:clauses[1]!.id,review:{priority:'preferred',outcome:'supported',evidenceIds:['fact:old-private-fact'],note:''}},{clauseId:clauses[2]!.id,review:{priority:'not-requirement',outcome:'unchecked',evidenceIds:[],note:''}}]});
    const rows=await preparePracticeQuestions(doc,'fixture','教师',a);
    expect(rows).toHaveLength(2);expect(rows[0]!.historical?.status).toContain('存在缺口');expect(rows[0]!.question).toContain('如实说明');expect(rows[0]!.sources[0]!.text).toBe(clauses[0]!.quote);
    expect(rows[1]!.historical?.status).toContain('当时');expect(rows[1]!.sources[0]!.text).toBe(clauses[1]!.quote);
    expect(rows.every(q=>q.sources.every(s=>!s.text.includes('old-private-fact')))).toBe(true);
    expect(parsePracticeKey(rows[0]!.answerKey)?.question).toContain(clauses[0]!.quote);
    expect(()=>archivedPracticeQuestions({...doc,id:'different'},'fixture',a)).toThrow('身份');
    expect(()=>archivedPracticeQuestions(doc,'other',a)).toThrow('身份');
    expect(()=>archivedPracticeQuestions(doc,'fixture',{...a,rows:[{...a.rows[0]!,clauseId:'999:1000'}]})).toThrow('位置');
    const next=await preparePracticeQuestions(doc,'fixture','教师',{...a,rows:a.rows.map(r=>({...r,review:{...r.review,note:'修改'}}))});
    expect(next[0]!.answerKey).not.toBe(rows[0]!.answerKey);
  });
});
