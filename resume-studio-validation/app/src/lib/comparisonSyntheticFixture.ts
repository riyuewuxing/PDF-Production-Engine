import { ResumeDocumentSchema, type ResumeDocument } from '../schema/resumeSchema';
export function comparisonFixture():ResumeDocument {
  return ResumeDocumentSchema.parse({
    id:'synthetic-compare-doc',title:'基准合成版本',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',
    basic:{name:'合成候选甲',title:'物理教师',email:'baseline@example.invalid',phone:'HIDDEN_PHONE_A',photo:'data:image/png;base64,SYNTHETIC_PHOTO_A',fieldOrder:[
      {id:'basic-name',key:'name',label:'姓名',visible:true},{id:'basic-title',key:'title',label:'职位',visible:true},{id:'basic-email',key:'email',label:'邮箱',visible:true},{id:'basic-phone',key:'phone',label:'电话',visible:false}
    ],customFields:[{id:'c1',label:'隐藏自定义',value:'HIDDEN_CUSTOM_A',visible:false}]},
    menuSections:[
      {id:'basic',title:'基本信息',order:0},{id:'education',title:'教育经历',order:1},{id:'experience',title:'工作经历',order:2},
      {id:'projects',title:'项目经历',order:3},{id:'skills',title:'专业技能',order:4},{id:'selfEvaluation',title:'自我评价',order:5,enabled:false},
      {id:'custom-x',title:'合成自定义',order:6},{id:'private-section',title:'HIDDEN_SECTION_LABEL_A',order:7,enabled:false}
    ],
    education:[{id:'edu-a',school:'甲示例学院',description:'BASE_COURSE'},{id:'edu-b',school:'乙示例学院',description:'SECOND_COURSE'}],
    experience:[{id:'work-a',company:'示例单位',description:'WORK_BASE'}],
    projects:[{id:'project-a',name:'合成项目',description:'PROJECT_BASE'}],
    skillContent:'BASE_SKILL',selfEvaluationContent:'HIDDEN_EVAL_A',
    customData:{'custom-x':[{id:'item-a',title:'公开栏目',description:'CUSTOM_BASE'}],'private-section':[{id:'item-a',title:'HIDDEN_TITLE_A',description:'HIDDEN_BODY_A',visible:true}]},
    globalSettings:{themeColor:'#123456'}
  });
}
export function changedComparisonFixture():ResumeDocument{
  const doc=comparisonFixture();
  return {...doc,id:'synthetic-other-doc',title:'对照合成版本',updatedAt:'2026-01-02T00:00:00Z',templateId:'minimal-ats',
    basic:{...doc.basic,email:'target@example.invalid',phone:'HIDDEN_PHONE_B',photo:'data:image/png;base64,SYNTHETIC_PHOTO_B',customFields:doc.basic.customFields.map(f=>({...f,value:'HIDDEN_CUSTOM_B'}))},
    menuSections:doc.menuSections.map(s=>s.id==='skills'?{...s,pageBreakBefore:true}:s.id==='private-section'?{...s,title:'HIDDEN_SECTION_LABEL_B'}:s),
    education:[{...doc.education[1]!,description:'SECOND_COURSE_CHANGED'},{...doc.education[0]!,description:'BASE_COURSE_CHANGED'},{...doc.education[0]!,id:'edu-c',school:'丙示例学院',description:'NEW_COURSE'}],
    experience:[],skillContent:'TARGET_SKILL',selfEvaluationContent:'HIDDEN_EVAL_B',
    customData:{...doc.customData,'private-section':doc.customData['private-section']!.map(i=>({...i,title:'HIDDEN_TITLE_B',description:'HIDDEN_BODY_B'}))},
    globalSettings:{...doc.globalSettings,themeColor:'#2468ac',baseFontSize:16}
  };
}
