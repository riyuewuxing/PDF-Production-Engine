import {constants,promises as fs,type BigIntStats} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PdfArtifactReceiptSchema,type PdfArtifactReceipt,type ApplicationPdfCheck} from '../src/schema/applicationSchema';
import {ResumeDocumentSchema} from '../src/schema/resumeSchema';
import {isSafeExportFileName,isPathInside} from './securityPolicy';

export const MAX_RECEIPT_PDF_BYTES=32*1024*1024;
const HASH_CHUNK=256*1024;
type Fingerprint={sha256:string;sizeBytes:number;pdf:boolean;realPath:string};
type ReadResult={status:'read';fingerprint:Fingerprint;bytes?:Buffer}|{status:'missing'|'unsafe'|'unavailable'};
const normalized=(file:string)=>path.resolve(file);
export const documentSha256=(document:unknown)=>createHash('sha256').update(JSON.stringify(ResumeDocumentSchema.parse(document))).digest('hex');
const safePdfPath=(file:string)=>isSafeExportFileName(file)&&path.extname(file).toLowerCase()==='.pdf'&&path.relative(normalized(file),file)==='';
const sameStat=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.nlink===b.nlink;
const ordinary=(s:BigIntStats)=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;

/** Bounded, local-only hash. Reject links, aliases, nonordinary files and
 * detectable races. A hash is a point-in-time observation, not a lease. */
export async function readPdfFingerprint(file:string,signal?:AbortSignal,allowReal?:(real:string)=>Promise<boolean>,captureBytes=false):Promise<ReadResult>{
  if(!safePdfPath(file))return {status:'unsafe'};
  let handle:Awaited<ReturnType<typeof fs.open>>|undefined;
  try{
    signal?.throwIfAborted();
    const start=await fs.lstat(file,{bigint:true});
    if(!ordinary(start))return {status:'unsafe'};
    if(start.size>BigInt(MAX_RECEIPT_PDF_BYTES))return {status:'unavailable'};
    const real=await fs.realpath(file);
    const realParent=await fs.realpath(path.dirname(file));
    if(!safePdfPath(real)||path.relative(path.join(realParent,path.basename(file)),real)!==''||(allowReal&&!await allowReal(real)))return {status:'unsafe'};
    handle=await fs.open(file,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
    const opened=await handle.stat({bigint:true});
    if(!ordinary(opened)||!sameStat(start,opened))return {status:'unsafe'};
    const chunk=Buffer.alloc(HASH_CHUNK),hash=createHash('sha256'),bytes=captureBytes?Buffer.alloc(Number(opened.size)):undefined;let offset=0,pdf=false;
    while(offset<Number(opened.size)){
      signal?.throwIfAborted();
      const {bytesRead}=await handle.read(chunk,0,Math.min(chunk.length,Number(opened.size)-offset),offset);
      if(bytesRead===0)return {status:'unavailable'};
      if(offset===0)pdf=bytesRead>=5&&chunk.subarray(0,5).toString('ascii')==='%PDF-';
      hash.update(chunk.subarray(0,bytesRead));if(bytes)chunk.copy(bytes,offset,0,bytesRead);offset+=bytesRead;
    }
    const end=await handle.stat({bigint:true}),again=await fs.lstat(file,{bigint:true});
    signal?.throwIfAborted();
    if(!ordinary(end)||!ordinary(again)||!sameStat(opened,end)||!sameStat(opened,again)||path.relative(real,await fs.realpath(file))!=='')return {status:'unsafe'};
    return {status:'read',fingerprint:{sha256:hash.digest('hex'),sizeBytes:offset,pdf,realPath:real},...(bytes?{bytes}:{})};
  }catch(error){
    const code=(error as NodeJS.ErrnoException)?.code;
    return {status:code==='ENOENT'||code==='ENOTDIR'?'missing':code==='ELOOP'?'unsafe':'unavailable'};
  }finally{await handle?.close().catch(()=>{});}
}
export function checkFingerprint(read:ReadResult,receipt:PdfArtifactReceipt):ApplicationPdfCheck{
  const checkedAt=new Date().toISOString();
  if(read.status!=='read')return {status:read.status,checkedAt};
  return {status:read.fingerprint.pdf&&read.fingerprint.sha256===receipt.sha256&&read.fingerprint.sizeBytes===receipt.sizeBytes?'verified':'changed',checkedAt};
}

/** A selected path outside exports is authorized only in the current session
 * by a successful native export or an explicit native file-picker action.
 * Do not stat/hash an arbitrary path just because a ledger says it exists. */
export function canCheckRecordedPdf(file:string,exportsDir:string,authorized:ReadonlyMap<string,string>):boolean{
  return safePdfPath(file)&&(isPathInside(normalized(exportsDir),normalized(file))||authorized.has(normalized(file)));
}
/** Canonical directory aliases are allowed, but a redirected child cannot
 * escape or change its relative location within the managed export root. */
export async function canCheckRecordedRealPdf(file:string,real:string,exportsDir:string,authorized:ReadonlyMap<string,string>):Promise<boolean>{
  if(!canCheckRecordedPdf(file,exportsDir,authorized)||!safePdfPath(real))return false;
  if(authorized.has(normalized(file))&&path.relative(authorized.get(normalized(file))!,real)==='')return true;
  if(!isPathInside(normalized(exportsDir),normalized(file)))return false;
  const root=await fs.realpath(exportsDir).catch(()=>null);
  if(!root)return false;
  const expected=path.join(root,path.relative(normalized(exportsDir),normalized(file)));
  return isPathInside(root,real)&&path.relative(expected,real)==='';
}

type BoundReceipt={filePath:string;slug:string;receipt:PdfArtifactReceipt;expires:number;queueTaskId?:string};
export class PdfReceiptVault{
  private entries=new Map<string,BoundReceipt>();
  constructor(private now=()=>Date.now()){}
  async issue(filePath:string,slug:string,document:unknown,bytes:Buffer,signal?:AbortSignal,allowReal?:(real:string)=>Promise<boolean>,queueTaskId?:string):Promise<{pdfReceipt:PdfArtifactReceipt;pdfReceiptToken:string}>{
    if(!Buffer.isBuffer(bytes)||bytes.length>MAX_RECEIPT_PDF_BYTES||bytes.subarray(0,5).toString('ascii')!=='%PDF-'||!slug)throw Error('PDF 输出不支持建立字节凭证。');
    const pdfReceipt=PdfArtifactReceiptSchema.parse({sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length,documentSha256:documentSha256(document),exportedAt:new Date(this.now()).toISOString()});
    if(checkFingerprint(await readPdfFingerprint(filePath,signal,allowReal),pdfReceipt).status!=='verified')throw Error('PDF 文件已写出，但落盘字节未能确认与生成内容相同。');
    const token=randomUUID(),now=this.now();
    for(const [id,value] of this.entries)if(value.expires<=now)this.entries.delete(id);
    while(this.entries.size>=128){const first=this.entries.keys().next().value;if(first===undefined)break;this.entries.delete(first);}
    this.entries.set(token,{filePath,slug,receipt:pdfReceipt,expires:now+24*60*60*1000,queueTaskId});
    return {pdfReceipt:{...pdfReceipt},pdfReceiptToken:token};
  }
  resolve(token:unknown,filePath:string,slug:string,document:unknown,queueTaskId?:string):PdfArtifactReceipt{
    const entry=typeof token==='string'?this.entries.get(token):undefined;
    if(!entry||entry.expires<=this.now()||entry.filePath!==filePath||entry.slug!==slug||entry.queueTaskId!==queueTaskId||entry.receipt.documentSha256!==documentSha256(document))throw Error('PDF 导出凭证已失效或与路径、版本、封存原稿不一致，请重新导出。');
    return {...entry.receipt};
  }
}
