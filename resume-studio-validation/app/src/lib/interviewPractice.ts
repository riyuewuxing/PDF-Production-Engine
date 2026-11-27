import type {ResumeDocument} from '../schema/resumeSchema';
import {JobReviewArchiveSchema,type JobReviewArchive} from '../schema/applicationSchema';
import {jobPdfPageForRange} from '../schema/jobPdfSourceSchema';
import {factEntityId,visibleBasicValue} from './aiContext';
import {collectLocalJobEvidence,splitJobRequirements,type LocalJobEvidence} from './jobRequirements';
import {generateInterviewQuestions,type InterviewQuestionItem} from './jobToolkit';

const PREFIX='interview-practice-v2:';
export type PracticeSource={id:string;label:string;text:string};
export type PracticeQuestion=InterviewQuestionItem&{identity:string;sources:PracticeSource[];basis:unknown;historical?:{archiveId:string;createdAt:string;status:string;note:string;location:string}};
export type PreparedPractice=PracticeQuestion&{answerKey:string};
export type PracticeKey={slug:string;docId:string;role:string;identity:string;question:string;digest:string};
export function interviewRole(doc:ResumeDocument,role:string){return role.trim()||visibleBasicValue(doc,'title').trim()||'目标岗位';}
const status={unchecked:'当时待核对',supported:'当时本人标记已有自述依据',gap:'当时本人标记存在缺口'} as const;
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
/** No independent fact bank or hidden sections are loaded into ordinary offline practice. */
export function currentPracticeQuestions(doc:ResumeDocument,role:string):PracticeQuestion[]{
  const evidence=collectLocalJobEvidence(doc,null).filter(e=>!e.id.startsWith('resume:basic:')||e.id==='resume:basic:employmentStatus').map(e=>{
    const edu=doc.education.find(x=>e.id==='resume:edu:'+x.id);
    const proj=doc.projects.find(x=>e.id==='resume:proj:'+x.id);
    const extra=[edu?.gpa,proj?.date].filter(Boolean);
    return extra.length?{...e,text:[e.text,...extra].join('\n')}:e;
  });
  const rowBasis=(e:LocalJobEvidence)=>[e.id,e.label,e.text,e.id.startsWith('resume:basic:')?null:factEntityId(doc,e.id.slice(7))];
  const all=evidence.map(rowBasis).sort((a,b)=>compare(String(a[0]),String(b[0])));
  return generateInterviewQuestions(doc,role).flatMap(q=>{
    const rows=q.sourceKey?evidence.filter(e=>e.id==='resume:'+q.sourceKey):[];
    if(q.sourceKey&&rows.length!==1)return [];
    return [{...q,identity:q.sourceKey?'block:'+q.sourceKey:q.id,sources:rows.map(e=>({id:e.id,label:e.label,text:e.text})),basis:q.sourceKey?rows.map(rowBasis):all}];
  });
}
/** Archive-based practice is explicitly historical; never resolve old evidence IDs to current facts. */
export function archivedPracticeQuestions(doc:ResumeDocument,slug:string,input:JobReviewArchive):PracticeQuestion[]{
  const a=JobReviewArchiveSchema.parse(input);
  if(a.slug!==slug||a.docId!==doc.id)throw Error('该历史核对档案不属于当前简历身份。');
  const clauses=splitJobRequirements(a.source);
  if(a.rows.some(r=>!clauses.some(c=>c.id===r.clauseId)))throw Error('历史岗位条款位置无效，请检查原档案。');
  return a.rows.filter(r=>r.review.priority!=='not-requirement').map(r=>{
    const clause=clauses.find(c=>c.id===r.clauseId)!;
    const page=jobPdfPageForRange(a.pdfOrigin,clause.start,clause.end);
    const location=(page!==undefined?'PDF 第 '+page+' 页 · ':'')+'原文第 '+clause.line+' 行';
    const outcome=r.review.outcome;
    return {id:'archive:'+a.id+':'+clause.id,identity:'archive:'+a.id+':'+clause.id,category:'专业能力',
      question:outcome==='supported'?'针对这条历史岗位条件，你能用哪些本人实际经历和可核实材料说明相关能力或资质？':outcome==='gap'?'针对这条历史岗位条件，哪些材料或能力尚待核实？如果确实不具备，应怎样如实说明？':'针对这条历史岗位条件，需要澄清哪些限定与本人实际情况，才能准备真实回答？',
      intent:'根据保存的人工核对记录安排练习，不判定现时资格。',
      starHints:['先核对完整公告与最新要求，区分硬条件、偏好和例外','只陈述真实经历；区分本人贡献、团队工作与拟采用的方法','若缺少证明或事实，明确待补项；不得把岗位要求转写成已有资质'],
      sources:[{id:clause.id,label:'历史公告 · '+location,text:clause.quote}],
      historical:{archiveId:a.id,createdAt:a.createdAt,status:status[outcome],note:r.review.note,location},
      basis:[a.id,a.basisHash,a.documentRevision,a.factRevision,a.source,a.pdfOrigin??null,r],
    };
  });
}
export async function preparePracticeQuestions(doc:ResumeDocument,slug:string,roleInput:string,archive?:JobReviewArchive):Promise<PreparedPractice[]>{
  if(!globalThis.crypto?.subtle)throw Error('当前环境无法校验面试草稿的依据。');
  const role=interviewRole(doc,roleInput);
  const rows=archive?archivedPracticeQuestions(doc,slug,archive):currentPracticeQuestions(doc,role);
  const prepared=await Promise.all(rows.map(async q=>{
    const bytes=new TextEncoder().encode(JSON.stringify([q.identity,q.question,q.intent,q.starHints,q.basis]));
    const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
    const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
    const historicalLabel=q.historical?q.sources[0]?.text+' — '+q.question:q.question;
    return {...q,answerKey:PREFIX+JSON.stringify([slug,doc.id,role,q.identity,historicalLabel,digest])};
  }));
  if(new Set(prepared.map(q=>q.answerKey)).size!==prepared.length)throw Error('面试练习问题身份重复，未关联草稿。');
  return prepared;
}
export function parsePracticeKey(key:string):PracticeKey|null{
  if(!key.startsWith(PREFIX))return null;
  try{const v:unknown=JSON.parse(key.slice(PREFIX.length));
    if(!Array.isArray(v)||v.length!==6||v.some(x=>typeof x!=='string'||!x)||!/^[a-f0-9]{64}$/.test(v[5]))return null;
    const [slug,docId,role,identity,question,digest]=v as [string,string,string,string,string,string];
    return {slug,docId,role,identity,question,digest};
  }catch{return null;}
}
/** Old ordinal keys are unbound; never infer which project or document they belonged to. */
export function practiceHistory(answers:Readonly<Record<string,string>>,docId:string,slug:string,current:readonly PreparedPractice[]){
  const keys=new Set(current.map(q=>q.answerKey));
  const history:{key:string;meta:PracticeKey;answer:string}[]=[],legacy:{key:string;answer:string}[]=[];
  for(const [key,answer] of Object.entries(answers)){
    if(!answer.trim()||keys.has(key))continue;
    const meta=parsePracticeKey(key);
    if(meta&&meta.slug===slug&&meta.docId===docId)history.push({key,meta,answer});
    else if(!meta&&key.startsWith(slug+':q-'))legacy.push({key,answer});
  }
  return {history,legacy};
}
