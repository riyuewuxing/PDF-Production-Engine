import { z } from 'zod';
import {JobPdfOriginSchema,validJobPdfOrigin} from './jobPdfSourceSchema';
import type { ResumeDocument, TemplateId } from './resumeSchema';

export const APPLICATION_STATUSES = [
  'wishlist',
  'applied',
  'written',
  'interview',
  'offer',
  'closed',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_META: Record<
  ApplicationStatus,
  { label: string; badgeClass: string }
> = {
  wishlist: { label: '待投递', badgeClass: 'bg-slate-100 text-slate-700 border-slate-300' },
  applied: { label: '已投递', badgeClass: 'bg-sky-50 text-sky-700 border-sky-200' },
  written: { label: '笔试试讲', badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  interview: { label: '面试中', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  offer: { label: 'Offer', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  closed: { label: '已结束', badgeClass: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export const COVER_LETTER_HEADER_VARIANTS = [
  'classic-line',
  'wave-banner',
  'sidebar-accent',
  'academic-serif',
] as const;

export type CoverLetterHeaderVariant = (typeof COVER_LETTER_HEADER_VARIANTS)[number];

/** Receipt of the actual generated and reread PDF bytes, not evidence of delivery. */
export const PdfArtifactReceiptSchema=z.object({
  sha256:z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes:z.number().int().positive().max(32*1024*1024),
  documentSha256:z.string().regex(/^[a-f0-9]{64}$/),
  exportedAt:z.string().datetime(),
}).strict();
export type PdfArtifactReceipt=z.infer<typeof PdfArtifactReceiptSchema>;
export type ApplicationPdfCheck={status:'verified'|'changed'|'missing'|'unsafe'|'unavailable'|'unknown';checkedAt:string;opened?:boolean};
export function samePdfReceipt(a:unknown,b:unknown):boolean{
  if(a===undefined||b===undefined)return a===b;
  const x=PdfArtifactReceiptSchema.safeParse(a),y=PdfArtifactReceiptSchema.safeParse(b);
  return x.success&&y.success&&x.data.sha256===y.data.sha256&&x.data.sizeBytes===y.data.sizeBytes&&x.data.documentSha256===y.data.documentSha256&&x.data.exportedAt===y.data.exportedAt;
}

export const JobApplicationSchema = z.object({
  id: z.string().min(1),
  company: z.string().default(''),
  role: z.string().default(''),
  city: z.string().default(''),
  salary: z.string().default(''),
  resumeSlug: z.string().default(''),
  status: z.enum(APPLICATION_STATUSES).default('applied'),
  appliedDate: z.string().default(''),
  notes: z.string().default(''),
  jdText: z.string().default(''),
  snapshotId: z.string().default(''),
  exportedFilePath: z.string().default(''),
  pdfReceipt: PdfArtifactReceiptSchema.optional(),
  interviewAt: z.string().default(''),
  interviewLocation: z.string().default(''),
  atsScore: z.number().min(0).max(100).nullable().default(null),
  updatedAt: z.string().default(''),
});

export type JobApplication = z.infer<typeof JobApplicationSchema>;

export const SavedCoverLetterSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  company: z.string().default(''),
  role: z.string().default(''),
  bodyText: z.string().default(''),
  headerVariant: z.enum(COVER_LETTER_HEADER_VARIANTS).default('classic-line'),
  resumeSlug: z.string().default(''),
  updatedAt: z.string().default(''),
});

export type SavedCoverLetter = z.infer<typeof SavedCoverLetterSchema>;

/** Historical, explicitly saved local job review. No source evidence text is duplicated. */
export const JobReviewArchiveSchema = z.object({
  reviewVersion:z.literal(1),
  id:z.string().uuid(),
  slug:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
  docId:z.string().min(1).max(500),
  documentRevision:z.string().min(1).max(1000),
  factRevision:z.string().min(1).max(64).nullable(),
  basisHash:z.string().regex(/^[a-f0-9]{64}$/),
  source:z.string().min(1).max(20000).refine(s=>!!s.trim()),
  pdfOrigin:JobPdfOriginSchema.optional(),
  createdAt:z.string().datetime(),
  applicationId:z.string().min(1).max(200).nullable(),
  snapshotId:z.string().min(1).max(120).nullable(),
  rows:z.array(z.object({
    clauseId:z.string().regex(/^\d+:\d+$/).max(24),
    review:z.object({
      priority:z.enum(['mandatory','preferred','unknown','not-requirement']),
      outcome:z.enum(['unchecked','supported','gap']),
      evidenceIds:z.array(z.string().min(1).max(2000)).max(5),
      note:z.string().max(500),
    }),
  })).min(1).max(80),
}).superRefine((a,ctx)=>{
  if(a.pdfOrigin&&!validJobPdfOrigin(a.source,a.pdfOrigin))ctx.addIssue({code:'custom',message:'PDF 页码与确认文本区间不一致'});
  if((a.applicationId===null)!==(a.snapshotId===null))ctx.addIssue({code:'custom',message:'投递关联与快照标识须同时存在或同时为空'});
  if(new Set(a.rows.map(r=>r.clauseId)).size!==a.rows.length)ctx.addIssue({code:'custom',message:'岗位条款标识重复'});
});
export type JobReviewArchive = z.infer<typeof JobReviewArchiveSchema>;
export const MAX_JOB_REVIEW_ARCHIVES=40;
export const MAX_JOB_REVIEW_ARCHIVE_CHARS=2000000;

/** Local queue: immutable binding plus an independently controlled preparation attempt. */
export const JOB_QUEUE_RUN_MS=30000;
export const MAX_JOB_QUEUE_ATTEMPTS=5;
export const JOB_QUEUE_STATES=['pending','running','paused','canceled','failed','prepared'] as const;
const canonicalUuid=z.string().uuid().refine(s=>s===s.toLowerCase(),'任务标识必须规范');
export const JobQueueFailureSchema=z.enum(['local-error','source-changed','timeout','interrupted']);
export type JobQueueFailure=z.infer<typeof JobQueueFailureSchema>;
export const JobQueueResultSchema=z.object({
  kind:z.literal('local-preflight-v1'),
  jdSha256:z.string().regex(/^[a-f0-9]{64}$/),
  documentSha256:z.string().regex(/^[a-f0-9]{64}$/),
  clauseCount:z.number().int().min(1).max(80),
}).strict();
export type JobQueueResult=z.infer<typeof JobQueueResultSchema>;
const JobQueueExecutionSchema=z.object({
  attempts:z.number().int().min(0).max(MAX_JOB_QUEUE_ATTEMPTS),
  attemptId:canonicalUuid.nullable(),
  updatedAt:z.string().datetime(),
  deadlineAt:z.string().datetime().nullable(),
  failure:JobQueueFailureSchema.nullable(),
  result:JobQueueResultSchema.nullable(),
}).strict();
export const JobQueueCommandSchema=z.object({
  taskId:canonicalUuid,
  ledgerRevision:z.string().regex(/^[a-f0-9]{64}$/),
  action:z.enum(['start','retry','pause','cancel','recover']),
}).strict();
export type JobQueueCommand=z.infer<typeof JobQueueCommandSchema>;
export const MAX_JOB_QUEUE_TASKS=30;
export const MAX_JOB_QUEUE_BYTES=600000;
export const MAX_JOB_QUEUE_JD_CHARS=20000;
const queueLabel=z.string().min(1).max(200).refine(s=>s===s.trim(),'名称必须为非空且首尾无空格');
export const JobQueueTaskSchema=z.object({
  taskVersion:z.literal(1),
  id:z.string().uuid().refine(s=>s===s.toLowerCase(),'任务标识必须规范'),
  company:queueLabel,
  role:queueLabel,
  jdText:z.string().min(1).max(MAX_JOB_QUEUE_JD_CHARS).refine(s=>!!s.trim(),'岗位原文不能为空'),
  slug:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
  docId:z.string().min(1).max(500),
  documentRevision:z.string().min(1).max(1000),
  documentSha256:z.string().regex(/^[a-f0-9]{64}$/),
  createdAt:z.string().datetime(),
  status:z.enum(JOB_QUEUE_STATES),
  execution:JobQueueExecutionSchema.optional(),
}).strict().superRefine((task,ctx)=>{
  try{
    const revision:unknown=JSON.parse(task.documentRevision);
    if(!Array.isArray(revision)||revision.length!==2||revision[0]!==task.docId||typeof revision[1]!=='string'||!revision[1]||JSON.stringify(revision)!==task.documentRevision)throw Error('invalid');
  }catch{ctx.addIssue({code:'custom',path:['documentRevision'],message:'任务文档身份与版本不一致'});}
  const e=task.execution;
  const valid=task.status==='pending'?e===undefined:!!e&&
    (e.attempts===0)===(e.attemptId===null)&&
    (task.status==='canceled'||e.attempts>0)&&
    (task.status==='running'?e.deadlineAt!==null&&Date.parse(e.deadlineAt)-Date.parse(e.updatedAt)===JOB_QUEUE_RUN_MS:e.deadlineAt===null)&&
    (task.status==='failed'?e.failure!==null:e.failure===null)&&
    (task.status==='prepared'?e.result!==null&&e.result.documentSha256===task.documentSha256:e.result===null);
  if(!valid)ctx.addIssue({code:'custom',path:['execution'],message:'岗位执行状态、尝试或回执不一致'});
});
export type JobQueueTask=z.infer<typeof JobQueueTaskSchema>;
export function jobQueueBasisKey(task:JobQueueTask):string{
  return JSON.stringify([task.company,task.role,task.jdText,task.slug,task.docId,task.documentRevision,task.documentSha256]);
}
export const JobQueueSchema=z.array(JobQueueTaskSchema).max(MAX_JOB_QUEUE_TASKS)
  .refine(tasks=>new Set(tasks.map(t=>t.id)).size===tasks.length,'岗位任务标识重复')
  .refine(tasks=>new Set(tasks.map(jobQueueBasisKey)).size===tasks.length,'同一岗位及绑定版本已登记')
  .refine(tasks=>tasks.filter(t=>t.status==='running').length<=1,'同一工作区仅允许一项任务运行')
  .refine(tasks=>{const ids=tasks.flatMap(t=>t.execution?.attemptId?[t.execution.attemptId]:[]);return new Set(ids).size===ids.length;},'执行尝试标识重复')
  // Execution metadata must not consume the registration quota of a valid legacy queue.
  .refine(tasks=>new TextEncoder().encode(JSON.stringify(tasks.map(({execution:_execution,...t})=>({...t,status:'pending'})))).byteLength<=MAX_JOB_QUEUE_BYTES,'岗位队列容量已达上限')
  .refine(tasks=>new TextEncoder().encode(JSON.stringify(tasks)).byteLength<=MAX_JOB_QUEUE_BYTES+30000,'岗位执行数据容量已达上限');

export const ApplicationsStoreSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  revision: z.string().optional(),
  applications: z.array(JobApplicationSchema).default([]),
  coverLetters: z.array(SavedCoverLetterSchema).default([]),
  interviewAnswers: z.record(z.string(), z.string()).default({}),
  jobQueue:JobQueueSchema.optional(),
  jobReviews: z.array(JobReviewArchiveSchema).max(MAX_JOB_REVIEW_ARCHIVES).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'岗位核对档案标识重复').refine(rows=>JSON.stringify(rows).length<=MAX_JOB_REVIEW_ARCHIVE_CHARS,'岗位核对档案总容量已达上限').optional(),
});

export type ApplicationsStoreData = z.infer<typeof ApplicationsStoreSchema>;

export interface CoverLetterPdfPayload {
  title: string;
  company: string;
  role: string;
  candidateName: string;
  candidateTitle?: string;
  contactLine: string;
  bodyText: string;
  themeColor: string;
  fontFamily: string;
  customFontFamily?: string;
  headerVariant?: CoverLetterHeaderVariant;
  dateText?: string;
}

export interface ApplicationSnapshotMeta {
  id: string;
  applicationId: string;
  resumeSlug: string;
  exportedFilePath: string;
  pdfReceipt?:PdfArtifactReceipt;
  createdAt: string;
  title: string;
  templateId: TemplateId;
  atsScore: number | null;
}

export interface ApplicationSnapshotRecord {
  meta: ApplicationSnapshotMeta;
  document: ResumeDocument;
}

export interface ApplicationSnapshotLink { applicationId:string; snapshotId:string; ledgerRevision:string; }
/** Local ZIP result only; no application status or delivery claim. */
export type SubmissionPackageResult={canceled:true}|{canceled:false;filePath:string;sha256:string;entries:{name:string;sizeBytes:number;sha256:string}[]};

export interface ApplicationLogInput { entry:JobApplication; document:ResumeDocument; pdfReceiptToken?:string; }
