import {constants,promises as fs,type BigIntStats} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {MAX_RECEIPT_PDF_BYTES} from './pdfReceipt';

export const MAX_PACKAGE_PDFS=8;
export const MAX_PACKAGE_BYTES=64*1024*1024;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const crcTable=Uint32Array.from({length:256},(_,i)=>{
  let v=i;for(let j=0;j<8;j++)v=(v&1)?(0xedb88320^(v>>>1)):(v>>>1);return v>>>0;
});
function crc32(bytes:Buffer):number{
  let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]!^(crc>>>8);return (crc^0xffffffff)>>>0;
}
export function packageEntryName(index:number):string{
  if(!Number.isInteger(index)||index<0||index>=MAX_PACKAGE_PDFS)throw Error('无效的投递包文件编号。');
  return index===0?'resume.pdf':'attachment-'+String(index).padStart(2,'0')+'.pdf';
}
/** ZIP32, stored entries, fixed ASCII names. No user paths, document metadata,
 * manifest or hidden ledger data are included. Each input is an already frozen
 * byte buffer. A PDF signature is not a semantic/visual/safety validation. */
export function buildSubmissionZip(pdfs:readonly Buffer[],signal?:AbortSignal){
  if(pdfs.length<1||pdfs.length>MAX_PACKAGE_PDFS)throw Error('投递包须包含 1～8 份 PDF。');
  let total=0;
  for(const bytes of pdfs){
    signal?.throwIfAborted();
    if(!Buffer.isBuffer(bytes)||bytes.length<5||bytes.length>MAX_RECEIPT_PDF_BYTES||bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw Error('投递包仅支持普通 PDF 文件，每份最多 32 MiB。');
    total+=bytes.length;if(total>MAX_PACKAGE_BYTES)throw Error('投递包 PDF 总大小超过 64 MiB。');
  }
  const hashes=new Set<string>();
  const parts:Buffer[]=[],central:Buffer[]=[];
  const entries:{name:string;sizeBytes:number;sha256:string}[]=[];
  let offset=0,centralSize=0;
  for(const [index,bytes] of pdfs.entries()){
    signal?.throwIfAborted();
    const digest=hash(bytes);if(hashes.has(digest))throw Error('投递包包含字节完全相同的重复文件。');hashes.add(digest);
    const entryName=packageEntryName(index),name=Buffer.from(entryName,'ascii'),crc=crc32(bytes);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);
    local.writeUInt16LE(0x21,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
    const directory=Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x0800,8);
    directory.writeUInt16LE(0x21,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(bytes.length,20);directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
    parts.push(local,name,bytes);central.push(directory,name);offset+=local.length+name.length+bytes.length;centralSize+=directory.length+name.length;
    entries.push({name:entryName,sizeBytes:bytes.length,sha256:digest});
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
  signal?.throwIfAborted();
  const bytes=Buffer.concat([...parts,...central,end],offset+centralSize+end.length);
  return {bytes,entries,sha256:hash(bytes)};
}
function safeZipPath(filePath:string):boolean{
  return typeof filePath==='string'&&path.isAbsolute(filePath)&&!filePath.includes('\0')&&path.extname(filePath).toLowerCase()==='.zip'&&path.relative(path.resolve(filePath),filePath)===''&&!(process.platform==='win32'&&(/^[\\/]{2}/.test(filePath)||filePath.slice(2).includes(':')));
}
/** Exact bounded readback of an already-created ordinary file. */
async function confirmZipBytes(file:string,bytes:Buffer,expected:BigIntStats,links:bigint,signal?:AbortSignal):Promise<void>{
  const sameIdentity=(s:BigIntStats)=>s.isFile()&&!s.isSymbolicLink()&&s.dev===expected.dev&&s.ino===expected.ino&&s.size===BigInt(bytes.length)&&s.nlink===links;
  const unchanged=(a:BigIntStats,b:BigIntStats)=>sameIdentity(a)&&sameIdentity(b)&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
  signal?.throwIfAborted();
  const start=await fs.lstat(file,{bigint:true});
  if(!sameIdentity(start))throw Error('ZIP 读回身份不一致。');
  const handle=await fs.open(file,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
  try{
    const opened=await handle.stat({bigint:true});if(!unchanged(start,opened))throw Error('ZIP 读回身份变化。');
    const chunk=Buffer.alloc(256*1024);let offset=0;
    while(offset<bytes.length){
      signal?.throwIfAborted();
      const {bytesRead}=await handle.read(chunk,0,Math.min(chunk.length,bytes.length-offset),offset);
      if(!bytesRead||!chunk.subarray(0,bytesRead).equals(bytes.subarray(offset,offset+bytesRead)))throw Error('ZIP 读回字节不一致。');
      offset+=bytesRead;
    }
    const end=await handle.stat({bigint:true}),again=await fs.lstat(file,{bigint:true});
    if(!unchanged(opened,end)||!unchanged(opened,again))throw Error('ZIP 读回期间文件发生变化。');
    signal?.throwIfAborted();
  }finally{await handle.close();}
}
/** Same-directory staging and exclusive hard-link publication. No overwrite
 * fallback on filesystems without hard links. After publication a failed
 * readback is explicitly unconfirmed; never delete a potentially replaced
 * destination. The user-selected parent is a trust boundary. */
export async function publishSubmissionZip(filePath:string,bytes:Buffer,signal?:AbortSignal):Promise<void>{
  if(!safeZipPath(filePath)||!Buffer.isBuffer(bytes)||bytes.length>MAX_PACKAGE_BYTES+4096||bytes.subarray(0,4).toString('hex')!=='504b0304')throw Error('无效投递包或 ZIP 目标路径。');
  signal?.throwIfAborted();
  const parent=await fs.realpath(path.dirname(filePath)),target=path.join(parent,path.basename(filePath));
  const stage=path.join(parent,'.resume-package-'+randomUUID()+'.tmp');
  let created=false,published=false;
  try{
    const handle=await fs.open(stage,'wx',0o600);created=true;
    try{await handle.writeFile(bytes);signal?.throwIfAborted();await handle.sync();}finally{await handle.close();}
    signal?.throwIfAborted();
    const stat=await fs.lstat(stage,{bigint:true});
    if(!stat.isFile()||stat.nlink!==1n||stat.size!==BigInt(bytes.length))throw Error('投递包暂存文件异常。');
    await confirmZipBytes(stage,bytes,stat,1n,signal);
    signal?.throwIfAborted();
    await fs.link(stage,target);published=true; // refuses existing file or symlink
    await fs.unlink(stage);created=false;
    await confirmZipBytes(target,bytes,stat,1n,signal);
  }catch(error){
    if(published)throw Error('ZIP 可能已写入，但无法确认最终状态，请手动检查：'+filePath);
    const code=(error as NodeJS.ErrnoException)?.code;
    if(code==='EEXIST')throw Error('目标 ZIP 已存在，未覆盖；请另选新文件名。');
    if(code==='EXDEV'||code==='ENOTSUP'||code==='ENOSYS'||code==='EPERM')throw Error('目标目录不支持安全无覆盖发布或权限不足，请选择其他本地目录。');
    throw error;
  }finally{
    if(created)try{await fs.unlink(stage);}catch{throw Error('投递包临时文件未能清理，请检查：'+stage+(published?'；输出可能已存在：'+filePath:''));}
  }
}
