import {ResumeDocumentSchema,resumeRevision,type ResumeDocument} from '../schema/resumeSchema';
import {JobQueueTaskSchema,type JobQueueTask} from '../schema/applicationSchema';

/** Canonical parsed document (including the persisted revision). This is not
 * a PDF receipt or an authenticity/signature guarantee. Assets are references. */
export function jobQueueDocumentText(doc:ResumeDocument):string{
  return JSON.stringify(ResumeDocumentSchema.parse(doc),(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
}
export async function jobQueueDocumentHash(doc:ResumeDocument):Promise<string>{
  if(!globalThis.crypto?.subtle)throw Error('当前环境无法校验岗位任务绑定。');
  const bytes=new TextEncoder().encode(jobQueueDocumentText(doc));
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export function jobQueueBindingMatches(task:JobQueueTask,doc:ResumeDocument,digest:string):boolean{
  return task.docId===doc.id&&task.documentRevision===resumeRevision(doc)&&task.documentSha256===digest;
}
export async function prepareJobQueueTask(input:{id:string;company:string;role:string;jdText:string;slug:string;createdAt:string},doc:ResumeDocument):Promise<JobQueueTask>{
  return JobQueueTaskSchema.parse({taskVersion:1,...input,company:input.company.trim(),role:input.role.trim(),
    docId:doc.id,documentRevision:resumeRevision(doc),documentSha256:await jobQueueDocumentHash(doc),status:'pending'});
}
