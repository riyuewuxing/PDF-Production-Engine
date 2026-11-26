import {apiClient} from './apiClient';
import {auditPdfCandidate,comparePdfAudits,MAX_COMPARE_PAGES} from './aiPdfAudit';
import {extractTokensFromPdfArrayBuffer,renderPdfPageImages} from './pdfResumeImporter';
import {collectEditableBlocks} from './resumeBlocks';
import type {ResumeDocument} from '../schema/resumeSchema';
export async function renderAiComparison(before:ResumeDocument,after:ResumeDocument,styleOnly:boolean,signal:AbortSignal){
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  const deadline=setTimeout(cancel,90000);
  signal.addEventListener('abort',cancel,{once:true});
  const check=()=>{if(signal.aborted||controller.signal.aborted)throw new Error('本地 PDF 对照已取消或达到90秒时限。');};
  const inspect=async(doc:ResumeDocument)=>{
    check();const bytes=await apiClient.renderPdfBuffer(doc);check();
    const pages=await extractTokensFromPdfArrayBuffer(bytes,MAX_COMPARE_PAGES,controller.signal);check();
    const audit=auditPdfCandidate(doc,pages);
    const images=await renderPdfPageImages(bytes,MAX_COMPARE_PAGES,controller.signal);check();
    return {audit,images};
  };
  try{
    const original=await inspect(before);const candidate=await inspect(after);
    const assessment=comparePdfAudits(original.audit,candidate.audit,styleOnly);
    const beforeBlocks=new Map(collectEditableBlocks(before).map(b=>[b.key,b.text]));
    for(const b of collectEditableBlocks(after))if(!styleOnly&&beforeBlocks.get(b.key)!==b.text&&candidate.audit.missingBlockKeys.includes(b.key)){
      assessment.blockers.push('修改后的正文未能完整从实际 PDF 读出：'+b.label);
    }
    return {original,candidate,...assessment};
  }catch(err){if(controller.signal.aborted||signal.aborted)throw new Error('本地 PDF 对照已取消或达到90秒时限。');throw err;}
  finally{clearTimeout(deadline);signal.removeEventListener('abort',cancel);}
}
export type AiPdfComparison=Awaited<ReturnType<typeof renderAiComparison>>;
