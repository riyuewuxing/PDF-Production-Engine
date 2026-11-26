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
  documentTitle:text(500).optional(),blockLabel:text(1000).optional(),
  sourceScope:z.enum(['manual','linked']),supersedesId:z.string().uuid().optional(),
  linkedFrom:z.object({recordId:z.string().uuid(),slug:z.string().min(1).max(80)}).strict().optional(),
  verifiedStatus:z.enum(['user-confirmed','revoked']),
  modifiedAt:z.string().datetime(),
}).strict();
/** Exact subject identity, not similarity or general skills/evaluation. */
export function comparableFactEntity(record:{docId:string;blockKey:string;entityId:string}):string|null{
  try{
    const parsed:unknown=JSON.parse(record.entityId);
    if(!Array.isArray(parsed)||parsed.length!==3||parsed[0]!==record.docId||parsed[1]!==record.blockKey||typeof parsed[2]!=='string'||!parsed[2])return null;
    const identity:unknown=JSON.parse(parsed[2]);
    if(!Array.isArray(identity)||!identity.every(x=>typeof x==='string'))return null;
    const custom=record.blockKey.startsWith('custom:');
    const expected=record.blockKey.startsWith('edu:')?5:record.blockKey.startsWith('exp:')?4:record.blockKey.startsWith('proj:')?3:custom?4:0;
    if(!expected||identity.length!==expected||!identity[custom?1:0]?.trim())return null;
    return JSON.stringify(identity);
  }catch{return null;}
}
export function sameFactEvidence(a:z.infer<typeof FactInputSchema>,b:z.infer<typeof FactInputSchema>):boolean{
  return a.kind===b.kind&&a.assertion===b.assertion&&a.value===b.value&&a.unit===b.unit&&a.timeframe===b.timeframe&&a.evidenceRef===b.evidenceRef;
}
export const FactBankSchema=z.object({
  schemaVersion:z.literal(1),revision:z.string().min(1).max(64),
  records:z.array(FactRecordSchema).max(1000),
}).strict().superRefine((bank,ctx)=>{
  if(new Set(bank.records.map(r=>r.id)).size!==bank.records.length)
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'事实记录 ID 重复'});
  const prior=new Map<string,z.infer<typeof FactRecordSchema>>(),superseded=new Set<string>(),activeLinks=new Set<string>();
  for(const record of bank.records){
    if(record.supersedesId){
      const old=prior.get(record.supersedesId);
      if(!old||old.verifiedStatus!=='revoked'||superseded.has(old.id)||old.entityId!==record.entityId||old.docId!==record.docId||old.blockKey!==record.blockKey)
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'事实修订链不一致'});
      superseded.add(record.supersedesId);
    }
    if(record.sourceScope==='linked'){
      const root=record.linkedFrom?prior.get(record.linkedFrom.recordId):undefined;
      const signature=comparableFactEntity(record);
      const key=JSON.stringify([record.linkedFrom?.recordId,record.docId,record.blockKey]);
      if(!root||root.sourceScope!=='manual'||root.linkedFrom||record.supersedesId||root.docId===record.docId||root.blockKey!==record.blockKey||!signature||signature!==comparableFactEntity(root)||!sameFactEvidence(record,root)||
        (record.sensitivity==='shareable'&&root.sensitivity!=='shareable')||
        (record.verifiedStatus==='user-confirmed'&&(root.verifiedStatus!=='user-confirmed'||activeLinks.has(key))))
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'跨版本事实来源或授权链不一致'});
      if(record.verifiedStatus==='user-confirmed')activeLinks.add(key);
    }else if(record.linkedFrom)ctx.addIssue({code:z.ZodIssueCode.custom,message:'手工事实不能伪造跨版本来源'});
    prior.set(record.id,record);
  }
});
export const AddFactSchema=z.object({
  slug:z.string().min(1).max(80),docRevision:z.string().min(1).max(1000),
  blockKey:z.string().min(1).max(500),bankRevision:z.string().min(1).max(64),
  fact:FactInputSchema,supersedesId:z.string().uuid().optional(),confirmation:z.literal('CONFIRM_SELF_REPORTED_FACT'),
}).strict();
export const LinkFactSchema=z.object({
  slug:z.string().min(1).max(80),docRevision:z.string().min(1).max(1000),
  sourceId:z.string().uuid(),bankRevision:z.string().min(1).max(64),
  sensitivity:z.enum(['local-only','shareable']).default('local-only'),
  confirmation:z.literal('CONFIRM_SAME_ENTITY_FACT_LINK'),
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
export type LinkFactInput=z.input<typeof LinkFactSchema>;

/** Internal IPC metadata; never sent to a model provider. */
export const FactRequestBindingSchema=z.object({
  slug:z.string().min(1).max(80),docId:z.string().min(1).max(500),
  bankRevision:z.string().min(1).max(64),ids:z.array(z.string().uuid()).min(1).max(20),
  selectedKeys:z.array(z.string().min(1).max(500)).min(1).max(200),
  masterRevision:z.string().min(1).max(1000).optional(),
}).strict().refine(b=>new Set(b.ids).size===b.ids.length&&new Set(b.selectedKeys).size===b.selectedKeys.length,'事实或段落绑定重复');
export type FactRequestBinding=z.infer<typeof FactRequestBindingSchema>;
