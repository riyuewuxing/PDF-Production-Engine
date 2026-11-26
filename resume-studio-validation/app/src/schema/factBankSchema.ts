import {z} from 'zod';

const text=(max:number)=>z.string().trim().max(max);
export const FactInputSchema=z.object({
  kind:z.enum(['experience','achievement','credential','skill','other']),
  assertion:text(2000).min(1),value:text(200),unit:text(80),timeframe:text(200),
  evidenceRef:text(1000).min(1),
  sensitivity:z.enum(['local-only','shareable']),
}).strict();
export const FactRecordSchema=FactInputSchema.extend({
  id:z.string().uuid(),docId:z.string().min(1).max(500),
  blockKey:z.string().min(1).max(500),entityId:z.string().min(1).max(8000),
  sourceScope:z.literal('manual'),
  verifiedStatus:z.enum(['user-confirmed','revoked']),
  modifiedAt:z.string().datetime(),
}).strict();
export const FactBankSchema=z.object({
  schemaVersion:z.literal(1),revision:z.string().min(1).max(64),
  records:z.array(FactRecordSchema).max(1000),
}).strict().superRefine((bank,ctx)=>{
  if(new Set(bank.records.map(r=>r.id)).size!==bank.records.length)
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'事实记录 ID 重复'});
});
export const AddFactSchema=z.object({
  slug:z.string().min(1).max(80),docRevision:z.string().min(1).max(1000),
  blockKey:z.string().min(1).max(500),bankRevision:z.string().min(1).max(64),
  fact:FactInputSchema,confirmation:z.literal('CONFIRM_SELF_REPORTED_FACT'),
}).strict();
export const RevokeFactSchema=z.object({
  id:z.string().uuid(),bankRevision:z.string().min(1).max(64),
  confirmation:z.literal('REVOKE_FACT'),
}).strict();
export type FactInput=z.infer<typeof FactInputSchema>;
export type FactRecord=z.infer<typeof FactRecordSchema>;
export type FactBank=z.infer<typeof FactBankSchema>;
export type AddFactInput=z.infer<typeof AddFactSchema>;
export type RevokeFactInput=z.infer<typeof RevokeFactSchema>;
