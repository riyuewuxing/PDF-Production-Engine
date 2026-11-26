import {z} from 'zod';
import {ResumeDocumentSchema} from './resumeSchema';
import {ApplicationsStoreSchema} from './applicationSchema';
export const DRAFT_DIR='.resume-studio-drafts-v1';
const token=z.string().uuid();
const revision=z.string().min(1).max(2000);
const slug=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const DraftInputSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('resume'),slug,baseRevision:revision,data:ResumeDocumentSchema}).strict(),
  z.object({kind:z.literal('ledger'),baseRevision:revision,data:ApplicationsStoreSchema}).strict(),
]);
export const DraftRecordSchema=z.object({version:z.literal(1),id:token,token,session:token,createdAt:z.string().datetime(),input:DraftInputSchema}).strict();
export type DraftInput=z.infer<typeof DraftInputSchema>;
export type DraftRecord=z.infer<typeof DraftRecordSchema>;
export type DraftSummary={id:string;token:string;kind:DraftInput['kind'];title:string;slug?:string;createdAt:string;state:'same-base'|'changed'|'missing'|'already-saved'|'unreadable'};
export type DraftList={drafts:DraftSummary[];unreadable:number};
export type DraftReceipt={id:string;token:string};
