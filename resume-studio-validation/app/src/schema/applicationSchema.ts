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

export const ApplicationsStoreSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  revision: z.string().optional(),
  applications: z.array(JobApplicationSchema).default([]),
  coverLetters: z.array(SavedCoverLetterSchema).default([]),
  interviewAnswers: z.record(z.string(), z.string()).default({}),
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

export interface ApplicationLogInput { entry:JobApplication; document:ResumeDocument; }
