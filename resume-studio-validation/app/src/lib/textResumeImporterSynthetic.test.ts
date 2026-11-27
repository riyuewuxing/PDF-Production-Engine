import { describe, expect, it } from 'vitest';
import { buildResumeDocumentFromPdfDraft, parseExtractedResumeText, parseResumeTextFile, extractAndParsePdfResume, RESUME_IMPORT_TEXT_MAX_BYTES, RESUME_IMPORT_PDF_MAX_BYTES } from './pdfResumeImporter';
const encode=(s:string)=>new TextEncoder().encode(s);
describe('synthetic local text import',()=>{
  it('reads UTF-8 Markdown headings, candidate contacts and awards; never asserts availability',()=>{
    const d=parseResumeTextFile(encode('# 姓名：测试甲\n邮箱：test@example.invalid\n## 教育经历\n合成大学\n## 荣誉奖项\n合成荣誉'), 'synthetic.md');
    expect(d.sourceKind).toBe('text');
    expect(d.title).toBe('synthetic');
    expect(d.email).toBe('test@example.invalid');
    expect(d.educationText).toBe('合成大学');
    expect(d.honorsText).toBe('合成荣誉');
    expect(buildResumeDocumentFromPdfDraft(d).basic.employmentStatus).toBe('');
  });
  it('keeps unknown header lines only on explicit opt in, in a disabled section',()=>{
    const d=parseResumeTextFile(encode('原文标记\n## 教育经历\n合成大学'),'test.txt');
    expect(d.unclassifiedText).toContain('原文标记');
    expect(buildResumeDocumentFromPdfDraft(d).customData['custom-import-unclassified']).toBeUndefined();
    const doc=buildResumeDocumentFromPdfDraft({...d,keepUnclassified:true});
    expect(doc.menuSections.find(s=>s.id==='custom-import-unclassified')?.enabled).toBe(false);
    expect(doc.customData['custom-import-unclassified']?.[0]?.description).toBe('原文标记');
  });
  it('supports explicit correction of inferred fields before building a new document',()=>{
    const d=parseExtractedResumeText('测试甲\n邮箱：old@example.invalid\n荣誉奖项\n旧荣誉');
    const doc=buildResumeDocumentFromPdfDraft({...d,email:'new@example.invalid',location:'合成城市',birthDate:'2000-01',honorsText:'新荣誉'});
    expect(doc.basic).toMatchObject({email:'new@example.invalid',location:'合成城市',birthDate:'2000-01',employmentStatus:''});
    expect(doc.customData['custom-honors']?.[0]?.title).toBe('新荣誉');
  });
  it.each([[new Uint8Array([0xff]),'UTF-8'],[encode('   '),'为空'],[encode('a\u0000b'),'控制字符'],[new Uint8Array(RESUME_IMPORT_TEXT_MAX_BYTES+1),'1 MiB'],[encode('a'.repeat(120001)),'120000']])('rejects invalid or oversized text without truncation', (bytes,reason)=>{
    expect(()=>parseResumeTextFile(bytes as Uint8Array,'synthetic.txt')).toThrow(String(reason));
  });
  it('keeps separate Markdown entries and unknown headings out of preceding sections',()=>{
    const d=parseResumeTextFile(encode('# Demo Candidate\n> Target Role: Teacher | Email: demo@example.invalid\n## Education\n### Alpha School\nCourse A\n### Beta School\nCourse B\n## Publications\nUNCLASSIFIED_PUBLICATION\n## Honors & Awards\nHonor A'), 'synthetic.md');
    expect(d.name).toBe('Demo Candidate');
    expect(d.jobTitle).toBe('Teacher');
    expect(d.educationText).not.toContain('UNCLASSIFIED_PUBLICATION');
    expect(d.unclassifiedText).toContain('UNCLASSIFIED_PUBLICATION');
    expect(d.honorsText).toBe('Honor A');
    const doc=buildResumeDocumentFromPdfDraft(d);
    expect(doc.education.map(x=>x.school)).toEqual(['Alpha School','Beta School']);
    expect(doc.education[1]?.description).toContain('Course B');
  });
  it('does not infer self-evaluation or header contacts from unclassified body',()=>{
    const unstructured=parseResumeTextFile(encode('Unclassified note\nSecond line'),'note.txt');
    expect(unstructured.selfEvaluationText).toBe('');
    expect(unstructured.unclassifiedText).toContain('Second line');
    const md=parseResumeTextFile(encode('# Demo Candidate\n## Publications\ncontact: other@example.invalid'),'note.md');
    expect(md.email).toBe('');
    expect(md.unclassifiedText).toContain('other@example.invalid');
  });
  it('preserves explicit availability only when provided',()=>{
    const d=parseResumeTextFile(encode('# Demo Candidate\n> Status: Contract ends in May | Email: demo@example.invalid\n## Education\n### Alpha School'),'note.md');
    expect(buildResumeDocumentFromPdfDraft(d).basic.employmentStatus).toBe('Contract ends in May');
  });
  it('does not treat fenced heading text as a section or another entry',()=>{
    const d=parseResumeTextFile(encode('# Demo Candidate\n## Projects\n### Alpha\n```\n## Education\n### Not an entry\n```\n### Beta\nBody'),'note.md');
    const doc=buildResumeDocumentFromPdfDraft(d);
    expect(doc.education).toEqual([]);
    expect(doc.projects.map(x=>x.name)).toEqual(['Alpha','Beta']);
    expect(doc.projects[0]?.description).toContain('Not an entry');
  });
  it('rejects already-cancelled PDF imports before parsing',async()=>{
    const c=new AbortController();c.abort();
    await expect(extractAndParsePdfResume(new Uint8Array([1]),'cancel.pdf',c.signal)).rejects.toThrow('取消');
  });
  it('does not accept other file formats as text',()=>{expect(()=>parseResumeTextFile(encode('test'),'synthetic.docx')).toThrow('TXT');});
  it('rejects oversized PDF before invoking the parser',async()=>{await expect(extractAndParsePdfResume(new Uint8Array(RESUME_IMPORT_PDF_MAX_BYTES+1),'large.pdf')).rejects.toThrow('20 MiB');});
});
