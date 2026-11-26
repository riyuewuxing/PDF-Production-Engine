import {z} from 'zod';

export const BACKUP_PREFIX='resume-studio-backup-v1-';
export const RESTORE_PREFIX='resume-studio-restored-v1-';
export const BACKUP_MANIFEST='workspace-backup-v1.json';
export const MAX_BACKUP_FILES=5000;
export const MAX_BACKUP_FILE_BYTES=25*1024*1024;
export const MAX_BACKUP_BYTES=512*1024*1024;
const safePart=(s:string)=>/^[a-zA-Z0-9._-]{1,180}$/.test(s)&&s!=='.'&&s!=='..'&&!s.includes('..')&&!s.endsWith('.')&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s);
const slug=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const snapshot=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.json$/;
const rootFiles=new Set(['master.json','applications.json','.fact-bank-v1.json','.evidence-index-v1.json']);
export function managedBackupPath(p:string):boolean{
  const parts=p.split('/');
  if(!parts.every(safePart))return false;
  if(parts.length===1)return rootFiles.has(p);
  if(parts.length===2){
    const [dir,file]=parts as [string,string];
    if(dir==='resumes')return file.endsWith('.json')&&slug.test(file.slice(0,-5))&&file!=='master.json';
    if(dir==='assets')return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.(png|jpe?g|webp)$/i.test(file);
    if(dir==='.application-snapshots')return snapshot.test(file);
    if(dir==='.trash')return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.\d+\.[a-f0-9-]{36}\.json$/i.test(file);
    if(dir==='.evidence-files-v1')return /^[a-f0-9-]{36}\.(pdf|png|jpg|txt)$/i.test(file);
  }
  return parts.length===3&&parts[0]==='.backups'&&slug.test(parts[1]!)&&snapshot.test(parts[2]!);
}
export const BackupFileSchema=z.object({path:z.string().max(400).refine(managedBackupPath),size:z.number().int().min(1).max(MAX_BACKUP_FILE_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const WorkspaceBackupManifestSchema=z.object({
  format:z.literal('resume-studio-workspace'),version:z.literal(1),createdAt:z.string().datetime(),
  files:z.array(BackupFileSchema).min(1).max(MAX_BACKUP_FILES),
}).strict().superRefine((m,ctx)=>{
  if(!m.files.some(f=>f.path==='master.json'))ctx.addIssue({code:'custom',message:'备份缺少母库'});
  if(new Set(m.files.map(f=>f.path.toLowerCase())).size!==m.files.length)ctx.addIssue({code:'custom',message:'备份路径重复或大小写冲突'});
  if(m.files.reduce((n,f)=>n+f.size,0)>MAX_BACKUP_BYTES)ctx.addIssue({code:'custom',message:'备份总容量超限'});
});
export type WorkspaceBackupManifest=z.infer<typeof WorkspaceBackupManifestSchema>;
export type BackupFile=z.infer<typeof BackupFileSchema>;
export type BackupSummary={createdAt:string;fileCount:number;totalBytes:number;counts:Record<string,number>;warnings:string[]};
export type BackupInspection=BackupSummary&{folder:string;token:string};
export type BackupResult=BackupSummary&{folder:string};
