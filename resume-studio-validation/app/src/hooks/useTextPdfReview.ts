import {useEffect,useRef,useState} from 'react';
import type {ResumeDocument} from '../schema/resumeSchema';
import {buildTextPatchEnvelope,previewTextPatch,type TextPatchCandidate} from '../lib/aiTextPatch';
import {renderAiComparison,type AiPdfComparison} from '../lib/aiPdfComparison';
import {localErrorMessage} from '../lib/apiClient';
type Input={document:ResumeDocument;slug:string;requestId:string;enabled:boolean;candidates:readonly TextPatchCandidate[]};
export function useTextPdfReview(input:Input){
  const {document,slug,requestId,enabled,candidates}=input;
  const fingerprint=JSON.stringify([slug,requestId,candidates]);
  const [review,setReview]=useState<{document:ResumeDocument;fingerprint:string;next:ResumeDocument;comparison:AiPdfComparison}|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null),mounted=useRef(false);
  const latest=useRef({document,fingerprint,enabled,confirmed});latest.current={document,fingerprint,enabled,confirmed};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
  useEffect(()=>{setReview(null);setConfirmed(false);setError(null);controller.current?.abort();},[document,fingerprint,enabled]);
  const valid=Boolean(review&&review.document===document&&review.fingerprint===fingerprint&&enabled);
  const canApply=valid&&confirmed&&!busy&&!review!.comparison.blockers.length;
  const render=async()=>{
    if(!enabled||controller.current||!candidates.length||!requestId)return;
    const ctrl=new AbortController();controller.current=ctrl;setBusy(true);setError(null);setReview(null);setConfirmed(false);
    const stillCurrent=()=>mounted.current&&latest.current.enabled&&latest.current.document===document&&latest.current.fingerprint===fingerprint&&!ctrl.signal.aborted;
    try{
      const envelope=await buildTextPatchEnvelope({document,slug,baseRevision:'local-preview-only',sourceRequestId:requestId,candidates});
      const next=await previewTextPatch({document,slug,revision:'local-preview-only',envelope});
      if(!stillCurrent())return;
      const comparison=await renderAiComparison(document,next,false,ctrl.signal);
      if(!stillCurrent())return;
      setReview({document,fingerprint,next,comparison});
    }catch(err){if(stillCurrent())setError(localErrorMessage(err,'正文 PDF 对照失败'));}
    finally{if(controller.current===ctrl){controller.current=null;if(mounted.current)setBusy(false);}}
  };
  return {review:valid?review:null,busy,error,confirmed,canApply,render,cancel:()=>controller.current?.abort(),setConfirmed,
    matches:(next:ResumeDocument)=>Boolean(canApply&&review&&latest.current.document===document&&latest.current.fingerprint===fingerprint&&latest.current.enabled&&latest.current.confirmed&&JSON.stringify(next)===JSON.stringify(review.next))};
}
