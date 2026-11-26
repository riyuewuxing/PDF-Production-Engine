// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumeDocumentSchema } from '../schema/resumeSchema';
import { apiClient } from './apiClient';
import { buildResumeExportFilename, buildResumeExportStem, printResumeInBrowser } from './resumeExportNaming';
import { useResumeExport } from '../hooks/useResumeExport';

const date = new Date(2026,10,26,12);
function fixture(){
  return ResumeDocumentSchema.parse({id:'synthetic-export-20',title:'INTERNAL_TITLE_20',createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{name:'SYNTH_NAME_20',title:'SYNTH_ROLE_20',email:'demo@example.invalid'},menuSections:[{id:'basic',title:'Basic',order:0},{id:'skills',title:'Skills',order:1}],skillContent:'VISIBLE_SKILL_20',globalSettings:{}});
}
function hidden(){
  const doc=fixture();doc.basic.fieldOrder=doc.basic.fieldOrder.map(f=>['name','title'].includes(f.key)?{...f,visible:false}:f);return doc;
}

describe('external export filename visibility',()=>{
  it('retains visible names, removes path separators, uses deterministic local date and suffix',()=>{
    const doc=fixture();doc.basic.name='A / B';doc.basic.title='X:Y';
    expect(buildResumeExportFilename(doc,'pdf','-脱敏版',date)).toBe('A_B-X_Y-20261126-脱敏版.pdf');
    expect(buildResumeExportStem(doc,'',date)).not.toContain(doc.title);
  });
  it('uses generic names when individual fields, entire module or legacy field order are hidden',()=>{
    const doc=hidden();
    expect(buildResumeExportFilename(doc,'md','',date)).toBe('个人简历-求职简历-20261126.md');
    doc.basic.fieldOrder=[];expect(buildResumeExportStem(doc,'',date)).toBe('个人简历-求职简历-20261126');
    const disabled=fixture();disabled.menuSections=disabled.menuSections.map(s=>s.id==='basic'?{...s,enabled:false}:s);
    expect(buildResumeExportFilename(disabled,'png','-脱敏版',date)).toBe('个人简历-求职简历-20261126-脱敏版.png');
  });
});

describe('browser and interchange export integration',()=>{
  let names:string[];
  let originalCreate:PropertyDescriptor|undefined;
  let originalRevoke:PropertyDescriptor|undefined;
  beforeEach(()=>{
    names=[];
    originalCreate=Object.getOwnPropertyDescriptor(URL,'createObjectURL');
    originalRevoke=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL');
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:synthetic-export')});
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){names.push(this.download);});
    window.document.title='WORKBENCH_TITLE_20';
  });
  afterEach(()=>{
    window.dispatchEvent(new Event('afterprint'));
    vi.useRealTimers();
    vi.restoreAllMocks();
    if(originalCreate)Object.defineProperty(URL,'createObjectURL',originalCreate);else Reflect.deleteProperty(URL,'createObjectURL');
    if(originalRevoke)Object.defineProperty(URL,'revokeObjectURL',originalRevoke);else Reflect.deleteProperty(URL,'revokeObjectURL');
  });

  it('uses visible-only names on actual browser Markdown, HTML and Word download links',async()=>{
    const doc=hidden(), before=JSON.stringify(doc);
    const opts={document:doc,slug:'PRIVATE_SLUG_20',fileNameSuffix:'-脱敏版'};
    await apiClient.exportMarkdown(opts);
    await apiClient.exportHtml(opts);
    await apiClient.exportDocx(opts);
    expect(names).toEqual(['md','html','docx'].map(ext=>buildResumeExportFilename(doc,ext as 'md'|'html'|'docx','-脱敏版')));
    expect(names.every(n=>!n.includes('PRIVATE_SLUG_20')&&!n.includes('SYNTH_NAME_20')&&!n.includes('SYNTH_ROLE_20'))).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('uses safe print title at invocation and restores afterprint, including thrown print errors',async()=>{
    const doc=hidden();
    const print=vi.spyOn(window,'print').mockImplementation(()=>{expect(window.document.title).toBe(buildResumeExportStem(doc));});
    await apiClient.exportPdf({document:doc,slug:'PRIVATE_SLUG_20'});
    expect(print).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('afterprint'));
    expect(window.document.title).toBe('WORKBENCH_TITLE_20');
    print.mockImplementation(()=>{throw Error('synthetic print failure');});
    expect(()=>printResumeInBrowser(doc)).toThrow('synthetic print failure');
    expect(window.document.title).toBe('WORKBENCH_TITLE_20');
  });
  it('clears stale print cleanup on a second print and preserves externally changed titles',()=>{
    vi.useFakeTimers();
    vi.spyOn(window,'print').mockImplementation(()=>{});
    printResumeInBrowser(hidden());
    vi.advanceTimersByTime(30000);
    const doc=fixture();printResumeInBrowser(doc);
    vi.advanceTimersByTime(30001);
    expect(window.document.title).toBe(buildResumeExportStem(doc));
    window.document.title='NEW_WORKBENCH_TITLE_20';
    window.dispatchEvent(new Event('afterprint'));
    expect(window.document.title).toBe('NEW_WORKBENCH_TITLE_20');
  });
  it('standard JSON Resume download uses visible-only filename; full native JSON backup retains internal slug',async()=>{
    const doc=hidden();
    const flush=vi.fn(async()=>{});
    const {result}=renderHook(()=>useResumeExport({activeSlug:'PRIVATE_SLUG_20',activeDocRef:{current:doc},flushPendingSave:flush,isRedacted:false,redactionTermsInput:''}));
    await act(async()=>{await result.current.handleExportFormat('jsonResume');});
    expect(names).toEqual([buildResumeExportStem(doc)+'-jsonresume.json']);
    await act(async()=>{await result.current.handleExportFormat('json');});
    expect(names[1]).toBe('PRIVATE_SLUG_20.json');
    expect(flush).toHaveBeenCalledTimes(2);
  });
  it('suppresses simultaneous export actions before React state has rerendered',async()=>{
    const doc=hidden();
    let release:()=>void=()=>{};
    const flush=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
    const {result}=renderHook(()=>useResumeExport({activeSlug:'PRIVATE_SLUG_20',activeDocRef:{current:doc},flushPendingSave:flush,isRedacted:false,redactionTermsInput:''}));
    await act(async()=>{
      const a=result.current.handleExportFormat('markdown');
      const b=result.current.handleExportFormat('html');
      release();
      await Promise.all([a,b]);
    });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(names).toEqual([buildResumeExportFilename(doc,'md')]);
    expect(result.current.isExporting).toBe(false);
  });
});
