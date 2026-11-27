import {JobQueueTaskSchema,type JobQueueOpenResult,type JobQueueTask} from '../schema/applicationSchema';
import {ResumeDocumentSchema,type ResumeDocument} from '../schema/resumeSchema';
import {jobQueueBindingMatches,jobQueueDocumentHash} from './jobQueueBinding';
import {sameJobReviewDocument,splitJobRequirements} from './jobRequirements';
export async function verifyQueueWorkflowOpen(reply:JobQueueOpenResult,expected:JobQueueTask,revision:string,activeSlug:string,activeDoc:ResumeDocument):Promise<JobQueueOpenResult>{
  const task=JobQueueTaskSchema.parse(reply.task),document=ResumeDocumentSchema.parse(reply.document);
  const receipt=task.execution?.result;
  if(reply.ledgerRevision!==revision||JSON.stringify(task)!==JSON.stringify(expected)||task.status!=='prepared'||!receipt||task.slug!==activeSlug||!sameJobReviewDocument(document,activeDoc))throw Error('岗位任务、台账或当前编辑简历已变化，请切换到绑定版本并重新核验。');
  if(!jobQueueBindingMatches(task,document,await jobQueueDocumentHash(document)))throw Error('岗位绑定简历摘要已变化。');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(task.jdText));
  const jdSha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  if(receipt.jdSha256!==jdSha||receipt.documentSha256!==task.documentSha256||receipt.clauseCount!==splitJobRequirements(task.jdText).length)throw Error('岗位准备回执与固定原文不一致。');
  return {task,document,ledgerRevision:revision};
}
