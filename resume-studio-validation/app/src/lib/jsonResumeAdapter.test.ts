import { describe, expect, it } from 'vitest';
import {
  exportToJsonResume,
  importFromJsonResume,
  isJsonResumeFormat,
} from './jsonResumeAdapter';
import { adaptResumeOrLegacy } from '../schema/legacyAdapter';
import { ResumeDocumentSchema } from '../schema/resumeSchema';

describe('jsonResumeAdapter', () => {
  it('round-trips ResumeDocument -> JSON Resume -> ResumeDocument cleanly', () => {
    const doc = ResumeDocumentSchema.parse({
      id: 'doc-jr',
      title: '演示甲简历',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      basic: {
        name: '演示甲',
        title: '高中物理教师',
        email: 'fixture@example.invalid',
        phone: 'synthetic-contact',
        location: '示例城市',
      },
      menuSections: [
        { id: 'basic', title: '基本信息', order: 0 },
        { id: 'education', title: '教育经历', order: 1 },
        { id: 'experience', title: '工作经历', order: 2 },
        { id: 'projects', title: '项目经历', order: 3 },
        { id: 'skills', title: '专业技能', order: 4 },
        { id: 'custom-honors', title: '荣誉奖项', order: 5 },
        { id: 'selfEvaluation', title: '自我评价', order: 6 },
      ],
      education: [
        {
          id: 'edu-1',
          school: '示例大学',
          major: '物理学',
          degree: '硕士',
          startDate: '2022.09',
          endDate: '2025.06',
          gpa: '3.29/4.0',
          description: '- 量子场论',
        },
      ],
      experience: [
        {
          id: 'exp-1',
          company: '示例学校',
          position: '物理教师',
          startDate: '2025.09',
          endDate: '至今',
          location: '示例城市',
          description: '- 承担高二物理教学',
        },
      ],
      projects: [
        {
          id: 'proj-1',
          name: '电磁仿真',
          role: '作者',
          date: '2025.03',
          description: '- 交互演示课件',
          link: 'https://example.com/demo',
        },
      ],
      customData: {
        'custom-honors': [{ id: 'h-1', title: '虚构奖项', subtitle: '示例机构', dateRange: '2024', description: '前1%' }],
      },
      skillContent: '- 高中物理教资',
      selfEvaluationContent: '专注中学物理教学创新。',
      globalSettings: { locale: 'zh-CN', themeColor: '#167883' },
    });

    const exported = exportToJsonResume(doc);
    expect(exported.basics.name).toBe('演示甲');
    expect(exported.work[0]?.name).toBe('示例学校');
    expect(exported.education[0]?.institution).toBe('示例大学');
    expect(isJsonResumeFormat(exported)).toBe(true);
    expect(isJsonResumeFormat(doc)).toBe(false);

    const reimported = adaptResumeOrLegacy(exported);
    expect(reimported.basic.name).toBe('演示甲');
    expect(reimported.education[0]?.school).toBe('示例大学');
    expect(reimported.experience[0]?.company).toBe('示例学校');
    expect(reimported.projects[0]?.name).toBe('电磁仿真');
    expect(reimported.customData['custom-awards']?.[0]?.title).toBe('虚构奖项');
    expect(importFromJsonResume(exported).selfEvaluationContent).toBe('专注中学物理教学创新。');
  });

  it('avoids duplicating single-line or bullet-list project descriptions between description and highlights on round-trip', () => {
    const doc = ResumeDocumentSchema.parse({
      id: 'doc-proj-dedup',
      title: '项目去重验证',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      basic: { name: '演示乙', title: '物理教师' },
      menuSections: [
        { id: 'basic', title: '基本信息', order: 0 },
        { id: 'projects', title: '项目经历', order: 1 },
      ],
      projects: [
        {
          id: 'proj-single',
          name: '单行纯文本项目',
          description: '独立开发带电粒子运动演示程序',
        },
        {
          id: 'proj-multi',
          name: '多行列表项目',
          description: '- 开发机械波干涉模块\n- 构建分级错题库',
        },
      ],
      globalSettings: { locale: 'zh-CN', themeColor: '#167883' },
    });

    const exported = exportToJsonResume(doc);
    expect(exported.projects[0]).toMatchObject({
      name: '单行纯文本项目',
      description: '独立开发带电粒子运动演示程序',
      highlights: [],
    });
    expect(exported.projects[1]).toMatchObject({
      name: '多行列表项目',
      description: '',
      highlights: ['开发机械波干涉模块', '构建分级错题库'],
    });

    const roundTripped = importFromJsonResume(exported);
    expect(roundTripped.projects[0]?.description).toBe('独立开发带电粒子运动演示程序');
    expect(roundTripped.projects[1]?.description).toBe('- 开发机械波干涉模块\n- 构建分级错题库');
  });
  it('omits hidden basic fields, disabled sections, hidden entries, photos and internal identifiers',()=>{
    const doc=ResumeDocumentSchema.parse({
      id:'INTERNAL_DOC_ID',title:'PRIVATE_TITLE',createdAt:'2026-01-01',updatedAt:'2026-01-01',
      basic:{name:'演示甲',title:'示例岗位',email:'hidden@example.invalid',phone:'HIDDEN_PHONE',location:'示例城市',photo:'PRIVATE_PHOTO',
        fieldOrder:[{id:'f1',key:'name',label:'姓名'},{id:'f2',key:'title',label:'岗位'},{id:'f3',key:'email',label:'邮箱',visible:false},{id:'f4',key:'phone',label:'电话',visible:false}],
        customFields:[{id:'private-cf',label:'私人字段',value:'HIDDEN_CF',visible:false},{id:'visible-cf',label:'职业资格',value:'合成资格证明'}]},
      menuSections:[{id:'basic',title:'基本信息',order:0},{id:'education',title:'教育',order:1,enabled:false},{id:'experience',title:'经历',order:2},
        {id:'skills',title:'技能',order:3,enabled:false},{id:'selfEvaluation',title:'评价',order:4,enabled:false},{id:'private-section',title:'私人段',order:5,enabled:false}],
      education:[{id:'e1',school:'HIDDEN_SCHOOL',description:'HIDDEN_EDU'}],
      experience:[{id:'x1',company:'VISIBLE_EXPERIENCE'},{id:'x2',company:'HIDDEN_EXPERIENCE',visible:false}],
      skillContent:'HIDDEN_SKILLS',selfEvaluationContent:'HIDDEN_SUMMARY',
      customData:{'private-section':[{id:'z',title:'HIDDEN_CUSTOM',description:'PRIVATE_CUSTOM'}]},globalSettings:{}
    });
    const payload=exportToJsonResume(doc),serialized=JSON.stringify(payload);
    for(const token of ['INTERNAL_DOC_ID','PRIVATE_TITLE','hidden@example.invalid','HIDDEN_PHONE','PRIVATE_PHOTO','HIDDEN_CF','HIDDEN_SCHOOL','HIDDEN_EDU','HIDDEN_EXPERIENCE','HIDDEN_SKILLS','HIDDEN_SUMMARY','HIDDEN_CUSTOM','PRIVATE_CUSTOM','private-cf','visible-cf'])expect(serialized).not.toContain(token);
    expect(payload.basics).not.toHaveProperty('email');
    expect(payload.basics).not.toHaveProperty('phone');
    expect(payload.basics).not.toHaveProperty('location');
    expect(payload.basics).not.toHaveProperty('summary');
    expect(payload.work.map(x=>x.name)).toEqual(['VISIBLE_EXPERIENCE']);
    expect(payload.meta.resumeStudio.customFields).toEqual([{label:'职业资格',value:'合成资格证明'}]);
    expect(payload.basics.profiles).toEqual([]);
  });

  it('maps actual categories, preserves unknown content without inventing an award, and reconstructs visible custom sections',()=>{
    const doc=ResumeDocumentSchema.parse({
      id:'fixture-custom',title:'虚构简历',createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{name:'演示甲'},
      menuSections:[{id:'basic',title:'基本信息',order:0},{id:'publications',title:'论文发表',order:1},{id:'certificates',title:'资格证书',order:2},
        {id:'custom-volunteer',title:'志愿服务',order:3},{id:'custom-honors',title:'荣誉奖项',order:4},{id:'misc',title:'科研原型',order:5}],
      customData:{
        publications:[{id:'p1',title:'虚构论文',subtitle:'示例期刊',dateRange:'2026.03',description:'合成摘要'}],
        certificates:[{id:'c1',title:'虚构证书',subtitle:'示例发证单位',dateRange:'2025年',description:'证书详情'}],
        'custom-volunteer':[{id:'v1',title:'虚构公益组织',subtitle:'志愿者',dateRange:'2025.03—2025.05',description:'- 协助活动'}],
        'custom-honors':[{id:'a1',title:'虚构奖项',subtitle:'示例颁奖机构',dateRange:'2024',description:'奖项详情'}],
        misc:[{id:'m1',title:'科研原型甲',subtitle:'团队成员',dateRange:'近期',description:'设备开发'},{id:'m2',title:'HIDDEN_PROTOTYPE',visible:false}]
      },globalSettings:{}
    });
    const payload=exportToJsonResume(doc);
    expect(payload.awards.map(x=>x.title)).toEqual(['虚构奖项']);
    expect(payload.publications[0]).toMatchObject({name:'虚构论文',publisher:'示例期刊',releaseDate:'2026-03',summary:'合成摘要'});
    expect(payload.certificates[0]).toMatchObject({name:'虚构证书',issuer:'示例发证单位',resumeStudio:{description:'证书详情',dateRange:'2025年'}});
    expect(payload.certificates[0]).not.toHaveProperty('date');
    expect(payload.volunteer[0]).toMatchObject({organization:'虚构公益组织',position:'志愿者',highlights:['协助活动']});
    expect(payload.meta.resumeStudio.unmappedSections).toEqual([{title:'科研原型',items:[{title:'科研原型甲',subtitle:'团队成员',dateRange:'近期',description:'设备开发'}]}]);
    expect(JSON.stringify(payload)).not.toContain('HIDDEN_PROTOTYPE');
    const imported=importFromJsonResume(payload);
    expect(imported.customData['custom-publications']?.[0]).toMatchObject({title:'虚构论文',dateRange:'2026.03'});
    expect(imported.customData['custom-certificates']?.[0]).toMatchObject({title:'虚构证书',description:'证书详情'});
    expect(imported.customData['custom-jr-extra-1']?.[0]).toMatchObject({title:'科研原型甲',description:'设备开发'});
    expect(imported.customData['custom-awards']).toHaveLength(1);
  });

  it('normalizes known date formats without guessing and preserves external project summary plus highlights',()=>{
    const doc=ResumeDocumentSchema.parse({id:'date-fixture',title:'日期测试',createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{name:'演示甲'},
      menuSections:[{id:'basic',title:'基本信息',order:0},{id:'experience',title:'经历',order:1},{id:'projects',title:'项目',order:2}],
      experience:[{id:'x1',company:'示例学校',startDate:'2025年09月',endDate:'至今'},{id:'x2',company:'另一示例单位',startDate:'2025-02-31'}],
      projects:[{id:'p1',name:'示例项目',link:'javascript:alert(1)'}],globalSettings:{}});
    const out=exportToJsonResume(doc);
    expect(out.work[0]).toMatchObject({startDate:'2025-09',resumeStudioDates:{start:'2025年09月',end:'至今'}});
    expect(out.work[0]).not.toHaveProperty('endDate');
    expect(out.work[1]).not.toHaveProperty('startDate');
    expect(out.projects[0]).not.toHaveProperty('url');
    const imported=importFromJsonResume(out);
    expect(imported.experience[0]).toMatchObject({startDate:'2025年09月',endDate:'至今'});
    expect(imported.experience[1]?.startDate).toBe('2025-02-31');
    const external=importFromJsonResume({basics:{name:'Demo'},projects:[{name:'Demo project',description:'Summary',highlights:['Detailed task'],url:'https://example.invalid/demo'}]});
    expect(external.projects[0]?.description).toBe('Summary\n- Detailed task');
    expect(external.projects[0]?.link).toBe('https://example.invalid/demo');
  });

});
