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
  sourceScope:z.literal('manual'),supersedesId:z.string().uuid().optional(),
  verifiedStatus:z.enum(['user-confirmed','revoked']),
  modifiedAt:z.string().datetime(),
}).strict();
export const FactBankSchema=z.object({
  schemaVersion:z.literal(1),revision:z.string().min(1).max(64),
  records:z.array(FactRecordSchema).max(1000),
}).strict().superRefine((bank,ctx)=>{
  if(new Set(bank.records.map(r=>r.id)).size!==bank.records.length)
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'事实记录 ID 重复'});
  const prior=new Map<string,z.infer<typeof FactRecordSchema>>(),superseded=new Set<string>();
  for(const record of bank.records){
    if(record.supersedesId){
      const old=prior.get(record.supersedesId);
      if(!old||old.verifiedStatus!=='revoked'||superseded.has(old.id)||old.entityId!==record.entityId||old.docId!==record.docId||old.blockKey!==record.blockKey)
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'事实修订链不一致'});
      superseded.add(record.supersedesId);
    }
    prior.set(record.id,record);
  }
});
export const AddFactSchema=z.object({
  slug:z.string().min(1).max(80),docRevision:z.string().min(1).max(1000),
  blockKey:z.string().min(1).max(500),bankRevision:z.string().min(1).max(64),
  fact:FactInputSchema,supersedesId:z.string().uuid().optional(),confirmation:z.literal('CONFIRM_SELF_REPORTED_FACT'),
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

/** Internal IPC metadata; never sent to a model provider. */
export const FactRequestBindingSchema=z.object({
  slug:z.string().min(1).max(80),docId:z.string().min(1).max(500),
  bankRevision:z.string().min(1).max(64),ids:z.array(z.string().uuid()).min(1).max(20),
  selectedKeys:z.array(z.string().min(1).max(500)).min(1).max(200),
}).strict().refine(b=>new Set(b.ids).size===b.ids.length&&new Set(b.selectedKeys).size===b.selectedKeys.length,'事实或段落绑定重复');
export type FactRequestBinding=z.infer<typeof FactRequestBindingSchema>;
