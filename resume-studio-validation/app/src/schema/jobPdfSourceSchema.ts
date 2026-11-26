import {z} from 'zod';

export const MAX_JOB_PDF_PAGES=40;
export const MAX_JOB_PDF_BYTES=10*1024*1024;
export const MAX_JOB_PDF_TEXT=20000;
export const JobPdfOriginSchema=z.object({
  version:z.literal(1),
  fileName:z.string().min(1).max(255).refine(s=>!/[\\/\u0000-\u001f]/.test(s)),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),
  totalPages:z.number().int().min(1).max(MAX_JOB_PDF_PAGES),
  pages:z.array(z.object({page:z.number().int().min(1).max(MAX_JOB_PDF_PAGES),start:z.number().int().nonnegative().max(MAX_JOB_PDF_TEXT),end:z.number().int().positive().max(MAX_JOB_PDF_TEXT)})).min(1).max(MAX_JOB_PDF_PAGES),
});
export type JobPdfOrigin=z.infer<typeof JobPdfOriginSchema>;

/** Exact offsets in the confirmed extracted text, not PDF byte offsets or an authenticity certificate. */
export function validJobPdfOrigin(source:string,origin:JobPdfOrigin):boolean{
  if(!JobPdfOriginSchema.safeParse(origin).success)return false;
  let next=0,lastPage=0;
  for(const row of origin.pages){
    if(row.page<=lastPage||row.page>origin.totalPages||row.start!==next||row.end<=row.start||row.end>source.length||!source.slice(row.start,row.end).trim())return false;
    if(row.start>0&&source[row.start-1]!=='\n')return false;
    next=row.end+1;lastPage=row.page;
  }
  return next===source.length+1;
}
export function jobPdfPageForRange(origin:JobPdfOrigin|undefined,start:number,end:number):number|undefined{
  if(end<=start)return undefined;
  return origin?.pages.find(p=>p.start<=start&&end<=p.end)?.page;
}
export function sameJobPdfOrigin(a:JobPdfOrigin|undefined,b:JobPdfOrigin|undefined):boolean{
  return a===b||JSON.stringify(a)===JSON.stringify(b);
}
