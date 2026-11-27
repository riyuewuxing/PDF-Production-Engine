/** Read-only, bounded single-disk ZIP subset for conventional DOCX; never extracts files. */
export const DOCX_MAX_ARCHIVE_BYTES=20*1024*1024;
const MAX_TOTAL=64*1024*1024, MAX_ENTRIES=512, MAX_PART=4*1024*1024;
type Entry={name:string;method:number;crc:number;compressed:number;size:number;start:number;end:number;offset:number};
const invalid=(reason:string):never=>{throw new Error('DOCX ZIP 不受支持或已损坏：'+reason);};
const limit=(reason:string):never=>{throw new Error('DOCX 安全上限：'+reason+'；没有截断。');};
function checkAbort(signal?:AbortSignal){if(signal?.aborted)throw new Error('DOCX 本地解析已取消。');}
const table=Uint32Array.from({length:256},(_,i)=>{let v=i;for(let j=0;j<8;j++)v=(v&1)?(0xedb88320^(v>>>1)):(v>>>1);return v>>>0;});
export function zipCrc32(bytes:Uint8Array){let crc=0xffffffff;for(const b of bytes)crc=(crc>>>8)^table[(crc^b)&255]!;return (crc^0xffffffff)>>>0;}
function decodeName(bytes:Uint8Array,flags:number):string{
  if(!(flags&0x800)&&bytes.some(b=>b>127))invalid('非 UTF-8 文件名');
  let name:string;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return invalid('非法文件名编码');}
  if(!name||name.length>240||/[\u0000-\u001f\u007f\\:%]/.test(name)||name.startsWith('/')||name.split('/').filter((_,i,a)=>i!==a.length-1||!name.endsWith('/')).some(x=>!x||x==='.'||x==='..'))invalid('不安全的 ZIP 部件路径');
  return name;
}
function extraCheck(v:DataView,start:number,length:number){const end=start+length;let pos=start;while(pos<end){if(pos+4>end)invalid('额外字段长度');const id=v.getUint16(pos,true),n=v.getUint16(pos+2,true);pos+=4;if(pos+n>end)invalid('额外字段越界');if(id===1||id===0x7075)invalid('ZIP64 或替代文件名');pos+=n;}}
export class BoundedDocxZip{
  private bytes:Uint8Array;
  private entries=new Map<string,Entry>();
  constructor(input:ArrayBuffer|Uint8Array,signal?:AbortSignal){
    this.bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(this.bytes.byteLength>DOCX_MAX_ARCHIVE_BYTES)limit('文件超过 20 MiB');
    const b=this.bytes,n=b.length,v=new DataView(b.buffer,b.byteOffset,n),u16=(p:number)=>v.getUint16(p,true),u32=(p:number)=>v.getUint32(p,true);
    checkAbort(signal);
    if(n<22)invalid('缺少 ZIP 结束目录');
    let eocd=-1;
    for(let i=n-22;i>=Math.max(0,n-22-65535);i--){if(u32(i)===0x06054b50&&i+22+u16(i+20)===n){eocd=i;break;}}
    if(eocd<0)invalid('缺少 ZIP 结束目录');
    const count=u16(eocd+10),cdSize=u32(eocd+12),cdStart=u32(eocd+16);
    if(u16(eocd+4)||u16(eocd+6)||u16(eocd+8)!==count||count===65535||cdSize===0xffffffff||cdStart===0xffffffff)invalid('分卷或 ZIP64');
    if(count>MAX_ENTRIES)limit('部件超过 512 个');
    if(!count||cdStart+cdSize!==eocd)invalid('中央目录边界');
    const folded=new Set<string>(),intervals:Entry[]=[];
    let pos=cdStart,total=0;
    for(let i=0;i<count;i++){
      checkAbort(signal);
      if(pos+46>eocd||u32(pos)!==0x02014b50)invalid('中央目录记录');
      const flags=u16(pos+8),method=u16(pos+10),crc=u32(pos+16),compressed=u32(pos+20),size=u32(pos+24),nameLen=u16(pos+28),extraLen=u16(pos+30),commentLen=u16(pos+32),offset=u32(pos+42);
      const next=pos+46+nameLen+extraLen+commentLen;
      if(next>eocd||!nameLen||u16(pos+34)||compressed===0xffffffff||size===0xffffffff||offset===0xffffffff)invalid('目录记录越界或 ZIP64');
      if(flags&~0x080e)invalid('加密或不支持的 ZIP 标志');
      if(method!==0&&method!==8)invalid('不支持的压缩方式');
      if(method===0&&compressed!==size)invalid('存储部件大小不一致');
      const raw=b.subarray(pos+46,pos+46+nameLen),name=decodeName(raw,flags);
      const key=name.toLowerCase();
      if(folded.has(key))invalid('重复部件路径');
      folded.add(key);extraCheck(v,pos+46+nameLen,extraLen);
      total+=size;if(total>MAX_TOTAL)limit('声明解压总量超过 64 MiB');
      if(name.endsWith('/')&&size!==0)invalid('目录含数据');
      if(offset+30>cdStart||u32(offset)!==0x04034b50)invalid('本地记录边界');
      if(u16(offset+6)!==flags||u16(offset+8)!==method)invalid('本地与中央记录不一致');
      const ln=u16(offset+26),le=u16(offset+28),start=offset+30+ln+le;
      if(start>cdStart||ln!==nameLen||raw.some((x,j)=>x!==b[offset+30+j]))invalid('本地部件名不一致');
      extraCheck(v,offset+30+ln,le);
      const lc=u32(offset+14),lcomp=u32(offset+18),lsize=u32(offset+22);
      let end=start+compressed;
      if(end>cdStart)invalid('压缩数据越界');
      if(flags&8){
        if((lc!==0&&lc!==crc)||(lcomp!==0&&lcomp!==compressed)||(lsize!==0&&lsize!==size))invalid('数据描述符头冲突');
        const match=(p:number)=>p+12<=cdStart&&u32(p)===crc&&u32(p+4)===compressed&&u32(p+8)===size;
        if(end+16<=cdStart&&u32(end)===0x08074b50&&match(end+4))end+=16;
        else if(match(end))end+=12;else invalid('数据描述符不一致');
      }else if(lc!==crc||lcomp!==compressed||lsize!==size)invalid('本地大小或 CRC 不一致');
      const entry={name,method,crc,compressed,size,start,end,offset};
      this.entries.set(name,entry);intervals.push(entry);pos=next;
    }
    if(pos!==eocd)invalid('中央目录长度不一致');
    intervals.sort((x,y)=>x.offset-y.offset);
    for(let i=1;i<intervals.length;i++)if(intervals[i]!.offset<intervals[i-1]!.end)invalid('本地部件数据重叠');
  }
  names():string[]{return [...this.entries.keys()];}
  has(name:string):boolean{return this.entries.has(name);}
  async readPart(name:string,signal?:AbortSignal):Promise<Uint8Array>{
    checkAbort(signal);
    const e=this.entries.get(name);if(!e)return invalid('缺少必要部件 '+name);
    if(e.size>MAX_PART)limit('XML 部件超过 4 MiB');
    const data=this.bytes.subarray(e.start,e.start+e.compressed);
    let result:Uint8Array;
    if(e.method===0)result=new Uint8Array(data);
    else{
      if(typeof DecompressionStream==='undefined')throw new Error('当前运行环境不支持本地 DOCX 解压。');
      const out=new Uint8Array(e.size);let length=0;
      const reader=new Blob([new Uint8Array(data).buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const abort=()=>{void reader.cancel().catch(()=>{});};
      signal?.addEventListener('abort',abort,{once:true});
      try{
        while(true){
          checkAbort(signal);
          const {done,value}=await reader.read();
          checkAbort(signal);
          if(done)break;
          if(length+value.byteLength>e.size||length+value.byteLength>MAX_PART)limit('实际解压量超过声明大小或 XML 部件上限');
          out.set(value,length);length+=value.byteLength;
        }
        if(length!==e.size)invalid('实际解压长度不一致');
        result=out;
      }catch(err){abort();throw err instanceof Error?err:new Error('DOCX 本地解压失败。');}
      finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
    }
    checkAbort(signal);
    if(zipCrc32(result)!==e.crc)invalid('XML 部件 CRC 校验失败');
    return result;
  }
}
