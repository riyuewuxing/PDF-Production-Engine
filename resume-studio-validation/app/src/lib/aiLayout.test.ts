// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
import {parseLayoutProposal,prepareLayoutRequest,previewLayoutProposal} from './aiLayout';
import {auditPdfCandidate,comparePdfAudits} from './aiPdfAudit';
import type {ExtractedPdfPageTokens} from './pdfTextLayout';
import {collectExpectedEntities,inspectAtsFromExtractedPages} from './atsInspector';
import {collectResumePlainText,matchResumeWithJd} from './jdMatcher';
function doc(){return ResumeDocumentSchema.parse({id:'synthetic-id',title:'合成简历',createdAt:'2026-01-01',updatedAt:'2026-01-01',templateId:'minimal-ats',basic:{name:'演示甲',email:'fixture@example.invalid',phone:'synthetic-contact'},menuSections:[{id:'basic',title:'基本',order:0},{id:'education',title:'教育',order:1},{id:'skills',title:'技能',order:2},{id:'experience',title:'经历',order:3,enabled:false}],education:[{id:'edu',school:'示例大学',description:'参与实验设计。'}],experience:[{id:'exp',company:'隐藏标记',description:'HIDDEN_BODY'}],skillContent:'Python 实验记录',globalSettings:{}})}
function page(lines:string[]):ExtractedPdfPageTokens{return {pageIndex:0,pageWidth:595.28,pageHeight:841.89,tokens:lines.map((str,i)=>({str,x:30,y:790-i*20,width:str.length*8,height:10}))};}
const lines=['演示甲','fixture@example.invalid','synthetic-contact','教育','示例大学','参与实验设计。','技能','Python 实验记录'];
describe('AI layout proposal and native PDF audits',()=>{
  it('sends only numeric settings, template metadata and sanitized goal, never document data',()=>{
    const d=doc(),p=prepareLayoutRequest({document:d,goal:'演示甲 希望紧凑',allowTemplate:false,overflowPx:100});
    for(const v of ['演示甲','fixture@example.invalid','synthetic-contact','示例大学','HIDDEN_BODY','Python','synthetic-id'])expect(p.userPrompt).not.toContain(v);
    expect(JSON.parse(p.userPrompt).allowedTemplateIds).toEqual([]);
    expect(JSON.parse(p.userPrompt).canvasOverflowPx).toBe(100);
  });
  it('only changes the whitelisted style fields, preserving all content, identity and visibility',()=>{
    const d=doc(),p=parseLayoutProposal('{"reason":"紧凑","changes":{"baseFontSize":14,"pagePadding":24}}',false);
    expect(previewLayoutProposal(d,p,false)).toEqual({...d,globalSettings:{...d.globalSettings,baseFontSize:14,pagePadding:24}});
    expect(d.globalSettings.baseFontSize).toBe(15);
  });
  it('rejects arbitrary paths, unapproved template, excessive density and no-op changes',()=>{
    for(const raw of ['{"reason":"x","changes":{"baseFontSize":9}}','{"reason":"x","changes":{"lineHeight":1}}','{"reason":"x","changes":{"pagePadding":0}}','{"reason":"x","changes":{"customFontFamily":"evil"}}','{"reason":"x","changes":{},"basic":{"name":"changed"}}','{"reason":"x","changes":{},"templateId":"unknown"}','{"reason":"x","changes":{}}','{"reason":"x","changes":{},"templateId":"minimal-ats"}'])expect(()=>parseLayoutProposal(raw,false)).toThrow();
    const d=doc();
    const permitted=parseLayoutProposal('{"reason":"x","changes":{},"templateId":"harvard-academic"}',true);
    expect(previewLayoutProposal(d,permitted,true).templateId).toBe('harvard-academic');
    expect(()=>previewLayoutProposal(d,permitted,false)).toThrow();
    expect(()=>previewLayoutProposal(d,{reason:'same',changes:{baseFontSize:15}},false)).toThrow();
  });
  it('rejects blank, non-A4, out-of-bounds and newly missing text',()=>{
    const d=doc(),before=auditPdfCandidate(d,[page(lines)]);
    expect(before.missingLabels).toEqual([]);
    const removed=auditPdfCandidate(d,[page(lines.filter(x=>x!=='参与实验设计。'))]);
    expect(comparePdfAudits(before,removed,true).blockers.join('')).toContain('未读出');
    const p=page(lines);p.pageWidth=500;p.tokens[0]!.x=-5;
    const bad=auditPdfCandidate(d,[p,{...page([]),pageIndex:1}]);
    const assessment=comparePdfAudits(before,bad,true);
    expect(assessment.blockers.join('')).toContain('无可提取正文');
    expect(assessment.blockers.join('')).toContain('非 A4');
    expect(assessment.blockers.join('')).toContain('边界');
  });
  it('rejects style-only loss of duplicate characters even if a normalized substring probe still matches',()=>{
    const d=doc(),before=auditPdfCandidate(d,[page([...lines,'附加标识'])]),after=auditPdfCandidate(d,[page(lines)]);
    expect(comparePdfAudits(before,after,true).blockers.join('')).toContain('机读字符减少');
    expect(comparePdfAudits(before,after,false).blockers).toEqual([]);
  });
  it('reports more pages and newly corrupted glyphs; ignores hidden section expectations',()=>{
    const d=doc(),before=auditPdfCandidate(d,[page(lines)]);
    expect(before.missingLabels.join()).not.toContain('隐藏标记');
    const more=auditPdfCandidate(d,[page(lines),{...page(['追加页']),pageIndex:1}]);
    expect(comparePdfAudits(before,more,true).warnings.join()).toContain('页数增加');
    const garbled=auditPdfCandidate(d,[page([...lines,'\ufffd'])]);
    expect(comparePdfAudits(before,garbled,false).blockers.join()).toContain('乱码');
    expect(()=>auditPdfCandidate(d,Array.from({length:13},()=>page(lines)))).toThrow();
  });
  it('does not reward JD matches from hidden sections or penalize undisplayed identity fields',()=>{
    const d=doc();
    d.basic.fieldOrder=d.basic.fieldOrder.map(f=>f.key==='email'?{...f,visible:false}:f);
    d.experience[0]!.description='React 隐藏技能';
    d.title='INTERNAL_TITLE React';
    const visible=collectResumePlainText(d);
    expect(visible).not.toContain('internal_title');
    expect(visible).not.toContain('react');
    expect(matchResumeWithJd(d,'React Python').matchedKeywords).toEqual(['Python']);
    expect(collectExpectedEntities(d)).not.toContain('隐藏标记');
    const result=inspectAtsFromExtractedPages(d,[page(lines.filter(l=>!l.includes('@')))]);
    expect(result.checks.find(c=>c.id==='contact-email')?.severity).toBe('pass');
    expect(result.coverageRatio).toBe(1);
  });

});
