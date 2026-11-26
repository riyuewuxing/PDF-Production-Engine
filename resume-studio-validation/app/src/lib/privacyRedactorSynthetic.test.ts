// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ResumeDocumentSchema } from '../schema/resumeSchema';
import { parseCustomRedactionTerms, redactResumeDocument, maskPhoneNumber } from './privacyRedactor';
import { exportToJsonResume } from './jsonResumeAdapter';
import { resumeToMarkdown } from './markdownExporter';
import { buildStandaloneResumeHtml } from './htmlExporter';
import { buildResumeExportFilename } from './resumeExportNaming';

const prefix='PRIVATE21_';
const marker=(key:string)=>prefix+key;
const off={hideName:false,maskPhone:false,maskEmail:false,hidePhoto:false};
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function fixture(){
  const doc=ResumeDocumentSchema.parse({
    id:'synthetic-redaction-21',title:marker('DOC_TITLE'),templateId:'minimal-ats',
    createdAt:'2026-01-01',updatedAt:'2026-01-01',
    basic:{name:marker('NAME'),title:marker('ROLE'),email:'private21@example.invalid',phone:'19900000000',location:marker('LOCATION'),employmentStatus:marker('STATUS'),birthDate:marker('BIRTH'),
      photo:image,customFields:[{id:'cf21',label:marker('CUSTOM_LABEL'),value:marker('CUSTOM_VALUE')}]},
    menuSections:[
      {id:'basic',title:marker('BASIC_HEADING'),order:0},
      {id:'education',title:marker('EDU_HEADING'),order:1},
      {id:'experience',title:marker('WORK_HEADING'),order:2},
      {id:'projects',title:marker('PROJECT_HEADING'),order:3},
      {id:'skills',title:marker('SKILL_HEADING'),order:4},
      {id:'selfEvaluation',title:marker('SUMMARY_HEADING'),order:5},
      {id:'custom-synthetic-21',title:marker('CUSTOM_HEADING'),order:6}],
    education:[
      {id:'edu21',school:marker('SCHOOL'),major:marker('MAJOR'),degree:marker('DEGREE'),gpa:marker('GPA'),startDate:marker('EDU_START'),endDate:marker('EDU_END'),description:marker('EDU_DESC'),logo:'resume-asset://local/synthetic-logo.png'},
      {id:'edu-keep',school:'VISIBLE_SCHOOL_21',degree:'MSc',gpa:'3.7',startDate:'20240101',endDate:'2025-06',description:'Ordinary research'}],
    experience:[{id:'work21',company:marker('COMPANY'),position:marker('POSITION'),location:marker('WORK_LOCATION'),startDate:marker('WORK_START'),endDate:marker('WORK_END'),description:marker('WORK_DESC')}],
    projects:[{id:'project21',name:'VISIBLE_PROJECT_21',role:marker('PROJECT_ROLE'),date:marker('PROJECT_DATE'),description:marker('PROJECT_DESC'),link:'https://example.invalid/'+marker('URL'),linkLabel:marker('LINK_LABEL')}],
    skillContent:'VISIBLE_SKILL_21 '+marker('SKILL'),
    selfEvaluationContent:'PRIVATE21_NAME private21@example.invalid 19900000000 '+marker('SUMMARY'),
    customData:{'custom-synthetic-21':[{id:'custom21',title:marker('CUSTOM_TITLE'),subtitle:marker('CUSTOM_SUBTITLE'),dateRange:marker('CUSTOM_DATE'),description:marker('CUSTOM_DESC'),visible:true}]},
    globalSettings:{locale:'en-US',fontFamily:'kaiti'},
  });
  doc.basic.fieldOrder=doc.basic.fieldOrder.map(f=>({...f,label:marker('FIELD_'+f.key)}));
  return doc;
}
describe('redaction field coverage with independent synthetic records',()=>{
  it('scrubs all explicitly selected user-facing fields, including labels, dates, headings, name and contacts even with automatic masks disabled',()=>{
    const doc=fixture(),before=JSON.stringify(doc);
    const terms=parseCustomRedactionTerms('PRIVATE21_, private21@example.invalid, 19900000000');
    const result=redactResumeDocument(doc,{...off,customTerms:terms});
    const data=JSON.stringify(result);
    expect(data.toLowerCase()).not.toContain('private21_');
    expect(data).not.toContain('private21@example.invalid');
    expect(data).not.toContain('19900000000');
    expect(result.basic.photo).toBe(image);
    expect(result.education[0]?.logo).toBe(doc.education[0]?.logo);
    expect(result.education[1]).toEqual(doc.education[1]);
    expect(result.projects[0]?.link).toBe('');
    expect(result.menuSections.map(({id,order,enabled})=>({id,order,enabled}))).toEqual(doc.menuSections.map(({id,order,enabled})=>({id,order,enabled})));
    expect(result.basic.fieldOrder.map(({id,key,visible})=>({id,key,visible}))).toEqual(doc.basic.fieldOrder.map(({id,key,visible})=>({id,key,visible})));
    expect(result.id).toBe(doc.id);
    expect(result.templateId).toBe(doc.templateId);
    expect(result.globalSettings).toEqual(doc.globalSettings);
    expect(ResumeDocumentSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('does not mutate or erase unrelated content, dates or independent mask options',()=>{
    const doc=fixture();
    const unchanged=redactResumeDocument(doc,off);
    expect(unchanged).toEqual(doc);
    const redacted=redactResumeDocument(doc);
    expect(redacted.basic.photo).toBe('');
    expect(redacted.basic.photoConfig.visible).toBe(false);
    expect(redacted.projects[0]?.link).toBe('');
    expect(redacted.education[1]?.startDate).toBe('20240101');
    expect(redacted.education[1]?.gpa).toBe('3.7');
    expect(redactResumeDocument(doc,{...off,hideName:true}).basic.phone).toBe(doc.basic.phone);
    expect(redactResumeDocument(doc,{...off,maskPhone:true}).basic.email).toBe(doc.basic.email);
  });
  it('matches explicit literal terms before partial automatic masks, including regex punctuation and case',()=>{
    const doc=fixture();
    doc.basic.name='Synthetic Alice';
    doc.basic.phone='19900000000';
    doc.basic.email='demo@example.invalid';
    doc.selfEvaluationContent='SYNTHETIC ALICE demo@example.invalid 19900000000 A+B a+b';
    const result=redactResumeDocument(doc,{customTerms:['Alice','demo@example.invalid','19900000000','A+B']});
    for(const s of [result.basic.name,result.basic.phone,result.basic.email,result.selfEvaluationContent]){
      expect(s.toLowerCase()).not.toContain('alice');
      expect(s).not.toContain('demo@example.invalid');
      expect(s).not.toContain('19900000000');
      expect(s.toLowerCase()).not.toContain('a+b');
    }
    expect(result.basic.phone).toBe('[某单位]');
    expect(result.basic.email).toBe('[某单位]');
    expect(result.selfEvaluationContent).not.toContain('SYNTHETIC');
  });
  it('masks case variants of a known name and literal known formatted international phone without masking ordinary dates',()=>{
    const doc=fixture();
    doc.basic.name='Synthetic Alice';doc.basic.phone='+1 (202) 555-0100';
    doc.selfEvaluationContent='SYNTHETIC ALICE +1 (202) 555-0100 20240101';
    const result=redactResumeDocument(doc);
    expect(result.selfEvaluationContent).not.toContain('SYNTHETIC ALICE');
    expect(result.basic.phone).not.toBe(doc.basic.phone);
    expect(result.selfEvaluationContent).not.toContain(doc.basic.phone);
    expect(result.selfEvaluationContent).toContain('20240101');
    expect(maskPhoneNumber('199-0000-0000')).toBe('199-****-0000');
  });
  it('clears sensitive project URLs rather than manufacturing invalid URLs; preserves unrelated URLs with masks disabled',()=>{
    const doc=fixture();doc.basic.name='Synthetic Alice';
    doc.projects[0]!.link='https://example.invalid/Synthetic%20Alice';
    const redacted=redactResumeDocument(doc,{...off,hideName:true});
    expect(redacted.projects[0]?.link).toBe('');
    doc.projects[0]!.link='https://example.invalid/private21_URL';
    expect(redactResumeDocument(doc,{...off,customTerms:['PRIVATE21_URL']}).projects[0]?.link).toBe('');
    doc.projects[0]!.link='https://example.invalid/public';
    expect(redactResumeDocument(doc,off).projects[0]?.link).toBe(doc.projects[0]?.link);
  });
  it('actual serializers and external filenames omit custom markers and preserve visible content',()=>{
    const doc=fixture(),terms=['PRIVATE21_','private21@example.invalid','19900000000'];
    const raw=[resumeToMarkdown(doc),buildStandaloneResumeHtml(doc),JSON.stringify(exportToJsonResume(doc))];
    for(const value of raw)expect(value).toContain('PRIVATE21_');
    const clean=redactResumeDocument(doc,{customTerms:terms});
    const outputs=[resumeToMarkdown(clean),buildStandaloneResumeHtml(clean),JSON.stringify(exportToJsonResume(clean))];
    for(const value of outputs){
      expect(value.toLowerCase()).not.toContain('private21_');
      expect(value).not.toContain('private21@example.invalid');
      expect(value).not.toContain('19900000000');
      expect(value).toContain('VISIBLE_PROJECT_21');
      expect(value).toContain('VISIBLE_SCHOOL_21');
    }
    expect(buildResumeExportFilename(clean,'pdf','-脱敏版')).not.toContain('PRIVATE21_');
  });
});
