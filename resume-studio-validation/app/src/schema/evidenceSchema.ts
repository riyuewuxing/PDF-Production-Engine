import {z} from 'zod';

export const MAX_EVIDENCE_FILE_BYTES=20*1024*1024;
export const MAX_EVIDENCE_VAULT_BYTES=200*1024*1024;
export const MAX_EVIDENCE_RECORDS=200;
export const EvidenceKindSchema=z.enum(['pdf','png','jpg','txt']);
export type EvidenceKind=z.infer<typeof EvidenceKindSchema>;
export const EvidenceEntrySchema=z.object({
  id:z.string().uuid(),factId:z.string().uuid(),docId:z.string().min(1).max(500),
  originalName:z.string().min(1).max(255).refine(s=>!/[\\/\x00-\x1f\x7f]/.test(s),'invalid evidence name'),
  kind:EvidenceKindSchema,size:z.number().int().min(1).max(MAX_EVIDENCE_FILE_BYTES),
  sha256:z.string().regex(/^[0-9a-f]{64}$/),
  note:z.string().trim().max(500),createdAt:z.string().datetime(),
  status:z.enum(['attached','detached','purged']),changedAt:z.string().datetime(),
}).strict();
export const EvidenceIndexSchema=z.object({
  schemaVersion:z.literal(1),revision:z.string().min(1).max(64),
  entries:z.array(EvidenceEntrySchema).max(MAX_EVIDENCE_RECORDS),
}).strict().superRefine((index,ctx)=>{
  const ids=new Set<string>(),active=new Set<string>();
  for(const entry of index.entries){
    const key=entry.factId+':'+entry.sha256;
    if(ids.has(entry.id)||(entry.status==='attached'&&active.has(key)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'证据索引含重复记录'});
    ids.add(entry.id);if(entry.status==='attached')active.add(key);
  }
});
export const AttachEvidenceSchema=z.object({
  slug:z.string().min(1).max(80),docRevision:z.string().min(1).max(1000),
  factId:z.string().uuid(),bankRevision:z.string().min(1).max(64),indexRevision:z.string().min(1).max(64),
  note:z.string().trim().max(500),confirmation:z.literal('CONFIRM_LOCAL_EVIDENCE_COPY'),
}).strict();
export const EvidenceReadSchema=z.object({id:z.string().uuid(),indexRevision:z.string().min(1).max(64)}).strict();
export const DetachEvidenceSchema=EvidenceReadSchema.extend({confirmation:z.literal('DETACH_LOCAL_EVIDENCE')}).strict();
export const PurgeEvidenceSchema=EvidenceReadSchema.extend({confirmation:z.literal('DELETE_MANAGED_EVIDENCE_COPY')}).strict();
export type EvidenceEntry=z.infer<typeof EvidenceEntrySchema>;
export type EvidenceIndex=z.infer<typeof EvidenceIndexSchema>;
export type AttachEvidenceInput=z.infer<typeof AttachEvidenceSchema>;
export type EvidenceReadInput=z.infer<typeof EvidenceReadSchema>;
export type DetachEvidenceInput=z.infer<typeof DetachEvidenceSchema>;
export type PurgeEvidenceInput=z.infer<typeof PurgeEvidenceSchema>;
export type EvidenceIntegrity={id:string;state:'intact'|'missing'|'changed'|'unreadable'|'purged';checkedAt:string};

/** Directory-level reconciliation, not a full-content hash check. No raw paths returned. */
export type EvidenceVaultAudit={checkedAt:string;exists:boolean;totalBytes:number;regularFiles:number;missingCopies:number;sizeMismatches:number;unsafeEntries:number;unindexedFiles:number;purgedResiduals:number};
