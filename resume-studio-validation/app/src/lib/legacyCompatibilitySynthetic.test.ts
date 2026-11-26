import { describe, expect, it } from 'vitest';
import { adaptLegacyMagicResume, adaptResumeOrLegacy } from '../schema/legacyAdapter';
import { GlobalSettingsSchema, MenuSectionSchema, PhotoConfigSchema, ResumeDocumentSchema, normalizeSectionsOrder } from '../schema/resumeSchema';
import { htmlToCleanMarkdown, cleanResumeRichText } from './htmlToMarkdown';
import { extractJdKeywords, matchResumeWithJd } from './jdMatcher';
import { mergeMasterItemsIntoResume } from './masterMerge';
import { maskEmailAddress, maskPersonName, maskPhoneNumber, parseCustomRedactionTerms, redactResumeDocument } from './privacyRedactor';
import { analyzeResumeDiagnostics } from './resumeDiagnostics';

function legacyFixture() {
  return {
    id: 'synthetic-legacy-19', title: 'Independent compatibility fixture',
    templateId: 'classic', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    basic: {
      name: '测试甲', title: '科学教学助理', employementStatus: '示例状态',
      email: 'sample19@example.invalid', phone: '0000000000', location: '虚构地点',
      fieldOrder: [{id:'f1',key:'name',label:'姓名'}, {id:'f2',key:'title',label:'职位'},
        {id:'f3',key:'employementStatus',label:'状态'}],
      icons: {employementStatus:'Briefcase'},
      customFields: [{id:'cf1',label:'示例字段',value:'保留值',visible:false}],
    },
    menuSections: [
      {id:'education',title:'教育经历',order:7},
      {id:'basic',title:'基本信息',order:1},
      {id:'experience',title:'工作经历',order:8},
      {id:'projects',title:'项目经历',order:9},
      {id:'skills',title:'技能',order:10},
      {id:'selfEvaluation',title:'自我评价',order:11},
      {id:'custom-awards',title:'荣誉',order:12},
    ],
    education: [{id:'edu-1',school:'虚构学院',major:'科学教育',degree:'硕士',
      description:'<ul><li><strong>课程</strong>：科学实验</li></ul>'}],
    experience: [{id:'exp-1',company:'虚构单位',position:'助理',description:'课堂教学，协助 12 次实验。'}],
    projects: [
      {id:'project-1',name:'示例工具',role:'成员',startDate:'2024.01',endDate:'2024.03',
        description:'<ul><li>整理 6 项记录</li></ul>'},
      {id:'project-hidden',name:'HIDDEN_PROJECT_19',visible:false,description:'班主任'},
    ],
    customData: {'custom-awards': [{id:'award-1',title:'示例荣誉',description:'<p>独立记录</p>'}]},
    publications: [{id:'paper-1',name:'Synthetic publication',journal:'Example Journal',date:'2025',summary:'Synthetic abstract'}],
    certificates: [{id:'cert-1',certificateName:'Synthetic certificate',issuer:'Example institute',issueDate:'2025'}],
    skillContent:'<ul><li>Python</li><li>实验教学</li></ul>',
    selfEvaluationContent:'<p>遵守实验流程</p>',
    globalSettings:{baseFontSize:15,themeColor:'#123456'},
  };
}
describe('synthetic legacy compatibility', () => {
  it('migrates typo, alias, section order, hidden records, links, custom fields and legacy collections without dropping them', () => {
    const raw=legacyFixture(), before=JSON.stringify(raw), doc=adaptLegacyMagicResume(raw);
    expect(ResumeDocumentSchema.safeParse(doc).success).toBe(true);
    expect(doc.templateId).toBe('classic-serif');
    expect(doc.basic.employmentStatus).toBe('示例状态');
    expect(doc.basic.fieldOrder.some(f=>f.key==='employmentStatus')).toBe(true);
    expect(doc.basic.icons.employmentStatus).toBe('Briefcase');
    expect(doc.basic.customFields[0]).toMatchObject({value:'保留值',visible:false});
    expect(doc.education[0]?.description).toBe('- **课程**：科学实验');
    expect(doc.projects[0]?.date).toBe('2024.01 - 2024.03');
    expect(doc.projects[1]?.visible).toBe(false);
    expect(doc.customData['custom-awards']?.[0]?.description).toBe('独立记录');
    expect(doc.customData.publications?.[0]).toMatchObject({title:'Synthetic publication',subtitle:'Example Journal',dateRange:'2025',description:'Synthetic abstract'});
    expect(doc.customData.certificates?.[0]).toMatchObject({title:'Synthetic certificate',subtitle:'Example institute',dateRange:'2025'});
    expect(doc.menuSections.map(s=>s.id)).toContain('publications');
    expect(doc.menuSections.map(s=>s.id)).toContain('certificates');
    expect(doc.menuSections.map(s=>s.order)).toEqual(doc.menuSections.map((_,i)=>i));
    expect(doc.menuSections[0]?.id).toBe('basic');
    expect(doc.skillContent).toBe('- Python\n- 实验教学');
    expect(adaptResumeOrLegacy(doc)).toEqual(doc);
    expect(JSON.stringify(raw)).toBe(before);
  });
  it('rejects malformed data and retains backwards-compatible schema defaults',()=>{
    for(const value of [null,[],{foo:'bar'}])expect(()=>adaptLegacyMagicResume(value)).toThrow();
    const settings=GlobalSettingsSchema.parse({});
    expect(settings).toMatchObject({locale:'zh-CN',paperBackground:'#ffffff',surfaceStyle:'solid',headingStyle:'auto',fontFamily:'sans',customFontFamily:'',letterSpacing:0,headingWeight:'bold',tabularNums:true,showPageGuide:true,avoidItemSplit:true,autoCjkSpacing:false});
    for(const value of [{baseFontSize:9},{baseFontSize:21},{themeColor:'red'},{paperBackground:'#123'}])expect(GlobalSettingsSchema.safeParse(value).success).toBe(false);
    expect(MenuSectionSchema.parse({id:'x',title:'X',order:2}).pageBreakBefore).toBe(false);
    expect(PhotoConfigSchema.parse({})).toMatchObject({frameStyle:'none',bgBackdrop:''});
    expect(normalizeSectionsOrder([{id:'a',title:'A',icon:'FileText',enabled:true,order:10},{id:'b',title:'B',icon:'FileText',enabled:true,order:3}]).map(s=>[s.id,s.order])).toEqual([['b',0],['a',1]]);
  });
  it('converts legacy rich text, strips script/style content and preserves math inequalities idempotently',()=>{
    const raw='<script>DROP_SCRIPT</script><style>DROP_STYLE</style><ul><li><strong>Alpha</strong></li><li>E &lt; 10 MeV</li></ul><p>Line A<br>Line B</p>';
    const md=htmlToCleanMarkdown(raw);
    expect(md).toBe('- **Alpha**\n- E < 10 MeV\nLine A\nLine B');
    expect(htmlToCleanMarkdown(md)).toBe(md);
    const doc=adaptLegacyMagicResume(legacyFixture());
    doc.skillContent='<ol><li>A</li><li>B</li></ol>';
    expect(cleanResumeRichText(doc).skillContent).toBe('1. A\n2. B');
    expect(doc.skillContent).toContain('<ol>');
  });
  it('distinguishes visible JD matches, hidden evidence and missing keywords',()=>{
    const doc=adaptLegacyMagicResume(legacyFixture());
    const jd='课堂教学，实验教学，Python，班主任，React';
    expect(extractJdKeywords(jd)).toEqual(expect.arrayContaining(['课堂教学','实验教学','Python','班主任','React']));
    const result=matchResumeWithJd(doc,jd);
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['课堂教学','实验教学','Python']));
    expect(result.missingKeywords).toEqual(expect.arrayContaining(['班主任','React']));
    expect(result.matchedCount+result.missingKeywords.length).toBe(result.totalKeywords);
    expect(result.coveragePercent).toBe(Math.round(result.matchedCount/result.totalKeywords*100));
    doc.menuSections=doc.menuSections.map(s=>s.id==='skills'?{...s,enabled:false}:s);
    expect(matchResumeWithJd(doc,jd).matchedKeywords).not.toContain('Python');
  });
  it('copies only selected master entries, creates fresh IDs and re-enables target sections without mutating sources',()=>{
    const master=adaptLegacyMagicResume(legacyFixture());
    const target=ResumeDocumentSchema.parse({id:'target',title:'target',createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{},menuSections:[{id:'basic',title:'Basic',order:0},{id:'education',title:'Education',order:1,enabled:false}],skillContent:'Original',globalSettings:{}});
    const before=JSON.stringify([master,target]);
    const merged=mergeMasterItemsIntoResume(target,master,{educationIds:['edu-1'],experienceIds:[],projectIds:['project-1'],customItems:{'custom-awards':['award-1']},includeSkillContent:'append',includeSelfEvaluation:'replace'});
    expect(merged.education).toHaveLength(1);
    expect(merged.education[0]?.id).not.toBe('edu-1');
    expect(merged.education[0]?.school).toBe('虚构学院');
    expect(merged.projects.map(p=>p.name)).toEqual(['示例工具']);
    expect(merged.customData['custom-awards']?.[0]?.title).toBe('示例荣誉');
    expect(merged.menuSections.find(s=>s.id==='education')?.enabled).toBe(true);
    expect(merged.skillContent).toContain('Original');
    expect(merged.skillContent).toContain('Python');
    expect(merged.selfEvaluationContent).toBe('遵守实验流程');
    expect(JSON.stringify([master,target])).toBe(before);
  });
  it('masks supported identifier patterns and custom terms without modifying original content',()=>{
    const doc=adaptLegacyMagicResume(legacyFixture());
    doc.basic.photo='data:image/png;base64,AAA=';
    // Artificial test numbers, not real contact records.
    doc.basic.phone='19900000000';
    doc.selfEvaluationContent='测试甲 sample19@example.invalid 19900000000 虚构学院';
    const before=JSON.stringify(doc);
    const redacted=redactResumeDocument(doc,{customTerms:parseCustomRedactionTerms('虚构学院，虚构单位；虚构学院')});
    expect(redacted.basic.name).toBe('测某');
    expect(redacted.basic.phone).toBe('199****0000');
    expect(redacted.basic.email).toBe('sam****@example.invalid');
    expect(redacted.basic.photo).toBe('');
    expect(redacted.basic.photoConfig.visible).toBe(false);
    expect(redacted.education[0]?.school).toBe('[某单位]');
    expect(redacted.selfEvaluationContent).not.toContain('测试甲');
    expect(redacted.selfEvaluationContent).not.toContain('sample19@example.invalid');
    expect(redacted.selfEvaluationContent).not.toContain('19900000000');
    expect(redacted.selfEvaluationContent).toContain('199****0000');
    expect(JSON.stringify(doc)).toBe(before);
    expect(maskPersonName('Demo')).toBe('D***');
    expect(maskPhoneNumber('199-0000-0000')).toBe('199-****-0000');
    expect(maskEmailAddress('demo@example.invalid')).toBe('dem****@example.invalid');
  });
  it('flags incomplete contact fields and overflow; observes quantified entries after explicit edits',()=>{
    const doc=adaptLegacyMagicResume(legacyFixture());
    doc.basic.name='[姓名]';doc.basic.phone='';
    const before=analyzeResumeDiagnostics(doc,{overflowPx:40});
    expect(before.findings.map(f=>f.id)).toEqual(expect.arrayContaining(['placeholder-basic','missing-contacts','slight-overflow']));
    doc.basic.name='测试甲';doc.basic.phone='synthetic-contact';
    const after=analyzeResumeDiagnostics(doc,{overflowPx:0});
    expect(after.findings.map(f=>f.id)).not.toContain('placeholder-basic');
    expect(after.findings.map(f=>f.id)).not.toContain('missing-contacts');
    expect(after.metrics.quantifiedRate).toBe(100);
    expect(after.score).toBeGreaterThan(before.score);
  });
});
