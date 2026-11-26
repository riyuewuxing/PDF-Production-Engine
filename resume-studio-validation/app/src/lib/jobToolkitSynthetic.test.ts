import {describe,it,expect} from 'vitest';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
import {generateCoverLetterBundle,generateInterviewQuestions} from './jobToolkit';
function fixture(){return ResumeDocumentSchema.parse({id:'demo',title:'合成简历',createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{name:'演示甲',title:'示例教师',email:'demo@example.invalid',phone:'synthetic-contact'},
  menuSections:[{id:'basic',title:'基本',order:0},{id:'education',title:'教育',order:1},{id:'projects',title:'项目',order:2},{id:'experience',title:'经历',order:3},{id:'skills',title:'技能',order:4}],
  education:[{id:'e',school:'示例大学',major:'科学教育',degree:'硕士'}],projects:[{id:'p',name:'示例教学工具',role:'团队成员',description:'整理实验记录。'}],
  experience:[{id:'x',company:'示例机构',position:'教学助理',description:'协助课程。'}],skillContent:'实验设计',globalSettings:{}});}
describe('offline career draft grounding',()=>{
  it('produces a coherent cover letter, email and opener without inventing graduation, leadership, availability or achievement',()=>{
    const doc=fixture(),bundle=generateCoverLetterBundle(doc,{company:'虚构学校',role:'高中物理教师'});
    expect(bundle.coverLetterText).toContain('演示甲');expect(bundle.coverLetterText).toContain('示例大学');
    expect(bundle.emailSubject).toBe('应聘高中物理教师-示例大学科学教育(硕士)-演示甲');
    expect(bundle.emailBody).toContain('虚构学校');expect(bundle.bossGreeting).toContain('团队成员');
    for(const word of ['可尽快到岗','可随时到岗','主导/参与','量化成果','毕业于'])expect(JSON.stringify(bundle)).not.toContain(word);
    const questions=generateInterviewQuestions(doc,'高中物理教师');expect(questions.length).toBeGreaterThanOrEqual(8);expect(questions.length).toBeLessThanOrEqual(12);
    expect(questions.some(q=>q.question.includes('示例大学'))).toBe(true);
    expect(questions.some(q=>q.category==='项目深挖')).toBe(true);expect(questions.some(q=>/电磁感应|实验|试讲/.test(q.question))).toBe(true);
    for(const q of questions){expect(q.intent.length).toBeGreaterThan(4);expect(q.starHints.length).toBeGreaterThan(0);}
  });
  it('respects hidden fields and disabled sections even when existing data remains on disk',()=>{
    const doc=fixture();doc.basic.fieldOrder=doc.basic.fieldOrder.map(f=>['name','email','phone','title'].includes(f.key)?{...f,visible:false}:f);
    doc.menuSections=doc.menuSections.map(s=>({...s,enabled:s.id==='basic'}));
    doc.skillContent='DISABLED_SKILL_MARKER';
    const combined=JSON.stringify([generateCoverLetterBundle(doc,{role:'通用岗位'}),generateInterviewQuestions(doc,'通用岗位')]);
    for(const secret of ['演示甲','demo@example.invalid','synthetic-contact','示例教师','示例大学','示例教学工具','示例机构','DISABLED_SKILL_MARKER'])expect(combined).not.toContain(secret);
    expect(combined).not.toContain('近期主要以学术/备考');
  });
});
