// @vitest-environment jsdom
import {act,renderHook} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
import {apiClient} from '../lib/apiClient';
import {useResumeExport} from './useResumeExport';
import type {PdfExportResult} from '../types/electron';
const doc=(id:string,name:string)=>ResumeDocumentSchema.parse({id,title:'Synthetic '+name,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',basic:{name,title:'Role'},menuSections:[{id:'basic',title:'Basic',order:0}],globalSettings:{}});
const gate=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve}};
const options=(activeDocRef:{current:ReturnType<typeof doc>},flushPendingSave=async()=>{})=>({activeSlug:'first',activeDocRef,flushPendingSave,isRedacted:false,redactionTermsInput:''});
const receipt={pdfReceipt:{sha256:'a'.repeat(64),documentSha256:'b'.repeat(64),sizeBytes:12,exportedAt:'2026-01-01T00:00:00Z'},pdfReceiptToken:'synthetic-receipt'};
afterEach(()=>vi.restoreAllMocks());
describe('export receipts remain bound to the selected document',()=>{
  it('never exports a different document under the initial slug after a delayed save',async()=>{
    const ref={current:doc('first-id','First')},wait=gate<void>();
    const ipc=vi.spyOn(apiClient,'exportPdf').mockResolvedValue({canceled:false,filePath:'synthetic.pdf'});
    const {result,rerender}=renderHook(({slug})=>useResumeExport({...options(ref,()=>wait.promise),activeSlug:slug}),{initialProps:{slug:'first'}});
    await act(async()=>{
      const pending=result.current.handleExportFormat('pdf');
      ref.current=doc('second-id','Second');
      result.current.invalidateExportFeedback?.();rerender({slug:'second'});
      wait.resolve();await pending;
    });
    expect(ipc).not.toHaveBeenCalled();expect(result.current.lastExportedPdfSnapshot).toBeNull();
  });
  it('does not attach a late export receipt to a switched version even when legacy ids coincide',async()=>{
    const ref={current:doc('legacy-shared-id','First')},wait=gate<PdfExportResult>(),entered=gate<void>();
    vi.spyOn(apiClient,'exportPdf').mockImplementation(()=>{entered.resolve();return wait.promise});
    const {result,rerender}=renderHook(({slug})=>useResumeExport({...options(ref),activeSlug:slug}),{initialProps:{slug:'first'}});
    let pending!:Promise<void>;
    await act(async()=>{pending=result.current.handleExportFormat('pdf');await entered.promise;});
    await act(async()=>{ref.current=doc('legacy-shared-id','Second');result.current.invalidateExportFeedback?.();rerender({slug:'second'});});
    await act(async()=>{wait.resolve({canceled:false,filePath:'first.pdf'});await pending});
    expect(result.current.lastExportedPdfSnapshot).toBeNull();
    expect(result.current.exportStatus).toMatchObject({type:'warn',filePath:'first.pdf'});
    expect(result.current.exportStatus?.text).toContain('此前版本');
  });
  it('keeps an actual written path when automatic snapshot fails and withholds quick-log eligibility',async()=>{
    const ref={current:doc('first-id','First')};
    vi.spyOn(apiClient,'exportPdf').mockResolvedValue({canceled:false,filePath:'written.pdf',snapshotWarning:'历史目录不安全'});
    const {result}=renderHook(()=>useResumeExport(options(ref)));
    await act(async()=>{await result.current.handleExportFormat('pdf')});
    expect(result.current.exportStatus).toMatchObject({type:'warn',filePath:'written.pdf'});
    expect(result.current.exportStatus?.text).toContain('历史目录不安全');
    expect(result.current.lastExportedPdfSnapshot).toBeNull();
  });
  it('surfaces content and history warnings together, without offering an unchecked PDF for quick-log',async()=>{
    const ref={current:doc('first-id','First')};
    vi.spyOn(apiClient,'exportPdf').mockResolvedValue({canceled:false,filePath:'written.pdf',snapshotWarning:'历史目录不安全',contentWarning:'可见的本地头像资源无法读取'});
    const {result}=renderHook(()=>useResumeExport(options(ref)));
    await act(async()=>{await result.current.handleExportFormat('pdf')});
    expect(result.current.exportStatus).toMatchObject({type:'warn',filePath:'written.pdf'});
    expect(result.current.exportStatus?.text).toContain('历史目录不安全');
    expect(result.current.exportStatus?.text).toContain('可见的本地头像资源无法读取');
    expect(result.current.lastExportedPdfSnapshot).toBeNull();
  });
  it('keeps a written artifact but disallows sealing a missing or invalid native byte receipt',async()=>{
    const ref={current:doc('first-id','First')};
    const ipc=vi.spyOn(apiClient,'exportPdf').mockResolvedValueOnce({canceled:false,filePath:'written.pdf'}).mockResolvedValueOnce({canceled:false,filePath:'bad.pdf',...receipt,pdfReceipt:{...receipt.pdfReceipt,sha256:'bad'}});
    const {result}=renderHook(()=>useResumeExport(options(ref)));
    await act(async()=>{await result.current.handleExportFormat('pdf')});
    expect(result.current.exportStatus).toMatchObject({type:'warn',filePath:'written.pdf'});expect(result.current.lastExportedPdfSnapshot).toBeNull();
    await act(async()=>{await result.current.handleExportFormat('pdf')});
    expect(result.current.exportStatus).toMatchObject({type:'warn',filePath:'bad.pdf'});expect(result.current.lastExportedPdfSnapshot).toBeNull();expect(ipc).toHaveBeenCalledTimes(2);
  });
  it('never offers a raw archival receipt on a redacted PDF',async()=>{
    const ref={current:doc('first-id','First')};
    vi.spyOn(apiClient,'exportPdf').mockResolvedValue({canceled:false,filePath:'redacted.pdf',...receipt});
    const {result}=renderHook(()=>useResumeExport({...options(ref),isRedacted:true}));
    await act(async()=>{await result.current.handleExportFormat('pdf')});
    expect(result.current.lastExportedPdfSnapshot).toBeNull();expect(result.current.exportStatus?.type).toBe('ok');
  });
  it('clears the preceding quick-log receipt even if a new export is cancelled',async()=>{
    const ref={current:doc('first-id','First')};
    const ipc=vi.spyOn(apiClient,'exportPdf').mockResolvedValueOnce({canceled:false,filePath:'first.pdf',...receipt}).mockResolvedValueOnce({canceled:true});
    const {result}=renderHook(()=>useResumeExport(options(ref)));
    await act(async()=>{await result.current.handleExportFormat('pdf')});
    expect(result.current.lastExportedPdfSnapshot?.filePath).toBe('first.pdf');
    await act(async()=>{await result.current.handleExportFormat('pdf',true)});
    expect(ipc).toHaveBeenCalledTimes(2);expect(result.current.lastExportedPdfSnapshot).toBeNull();expect(result.current.exportStatus).toBeNull();
  });
  it('keeps normal PDF receipt and frozen content after same-document edit during rendering',async()=>{
    const ref={current:doc('first-id','First')},wait=gate<PdfExportResult>(),entered=gate<void>();
    const ipc=vi.spyOn(apiClient,'exportPdf').mockImplementation(()=>{entered.resolve();return wait.promise});
    const {result}=renderHook(()=>useResumeExport(options(ref)));
    let pending!:Promise<void>;
    await act(async()=>{pending=result.current.handleExportFormat('pdf');await entered.promise});
    ref.current.basic.name='Later same document edit';
    await act(async()=>{wait.resolve({canceled:false,filePath:'normal.pdf',...receipt});await pending});
    expect(ipc.mock.calls[0]?.[0].document.basic.name).toBe('First');
    expect(result.current.lastExportedPdfSnapshot?.document.basic.name).toBe('First');
    expect(result.current.lastExportedPdfSnapshot?.pdfReceipt).toEqual(receipt.pdfReceipt);
    expect(result.current.lastExportedPdfSnapshot?.pdfReceiptToken).toBe(receipt.pdfReceiptToken);
    expect(result.current.exportStatus).toMatchObject({type:'ok',filePath:'normal.pdf'});
  });
});