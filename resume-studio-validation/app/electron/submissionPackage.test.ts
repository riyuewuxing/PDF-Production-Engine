import {describe,it,expect} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildSubmissionZip,publishSubmissionZip,packageEntryName,MAX_PACKAGE_PDFS} from './submissionPackage';
import {MAX_RECEIPT_PDF_BYTES} from './pdfReceipt';
import {readPdfFingerprint} from './pdfReceipt';
const pdf=(text:string)=>Buffer.from('%PDF-1.7\n'+text+'\n%%EOF\n');
describe('explicit submission package ZIP',()=>{
  it('uses only stable flat entry names, exact bytes and central offsets',()=>{
    const a=pdf('one'),b=pdf('two'),zip=buildSubmissionZip([a,b]);
    expect(zip.entries.map(e=>e.name)).toEqual(['resume.pdf','attachment-01.pdf']);
    expect(zip.entries[0]?.sha256).toBe(createHash('sha256').update(a).digest('hex'));
    const n=zip.bytes.readUInt16LE(26),start=30+n;
    expect(zip.bytes.subarray(start,start+a.length)).toEqual(a);
    const second=start+a.length;expect(zip.bytes.readUInt32LE(second)).toBe(0x04034b50);
    const end=zip.bytes.length-22;expect(zip.bytes.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.bytes.readUInt16LE(end+10)).toBe(2);
    const directory=zip.bytes.readUInt32LE(end+16);
    expect(zip.bytes.readUInt32LE(directory)).toBe(0x02014b50);
    expect(zip.bytes.readUInt32LE(directory+42)).toBe(0);
    const next=directory+46+zip.bytes.readUInt16LE(directory+28);
    expect(zip.bytes.readUInt32LE(next+42)).toBe(second);
  });
  it('rejects empty, non PDF, duplicate, excess and aborted inputs',()=>{
    expect(()=>buildSubmissionZip([])).toThrow();
    expect(()=>buildSubmissionZip([Buffer.from('not PDF')])).toThrow();
    expect(()=>buildSubmissionZip([pdf('a'),pdf('a')])).toThrow(/重复/);
    expect(()=>buildSubmissionZip(Array.from({length:MAX_PACKAGE_PDFS+1},(_,i)=>pdf(String(i))))).toThrow();
    expect(()=>packageEntryName(-1)).toThrow();
    const controller=new AbortController();controller.abort();
    expect(()=>buildSubmissionZip([pdf('a')],controller.signal)).toThrow();
  });
  it('refuses over-limit aggregate and individual PDF sizes before building',()=>{
    const a=Buffer.alloc(MAX_RECEIPT_PDF_BYTES);a.write('%PDF-');
    const b=Buffer.from(a);b[5]=1;
    const tooBig=Buffer.alloc(MAX_RECEIPT_PDF_BYTES+1);tooBig.write('%PDF-');
    expect(()=>buildSubmissionZip([tooBig])).toThrow(/32 MiB/);
    expect(()=>buildSubmissionZip([a,b,pdf('extra')])).toThrow(/64 MiB/);
  });
  it('captures the same fingerprinted bytes; existing non-capture API returns no bytes',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'submission-pdf-'));
    try{
      const file=path.join(dir,'one.pdf'),original=pdf('synthetic');
      await fs.writeFile(file,original);
      const a=await readPdfFingerprint(file,undefined,undefined,true);
      expect(a.status).toBe('read');if(a.status!=='read')throw Error('read failed');
      expect(a.bytes).toEqual(original);expect(a.fingerprint.sha256).toBe(createHash('sha256').update(original).digest('hex'));
      const b=await readPdfFingerprint(file);expect(b.status).toBe('read');if(b.status==='read')expect(b.bytes).toBeUndefined();
      await fs.writeFile(file,pdf('changed'));expect(a.bytes).toEqual(original);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  it('does not leave a staged output on a pre-aborted request',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'submission-abort-'));
    try{
      const controller=new AbortController();controller.abort();
      await expect(publishSubmissionZip(path.join(dir,'aborted.zip'),buildSubmissionZip([pdf('a')]).bytes,controller.signal)).rejects.toThrow();
      expect(await fs.readdir(dir)).toEqual([]);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  it('concurrent publication has one winner and never overwrites it',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'submission-race-'));
    try{
      const target=path.join(dir,'race.zip'),a=buildSubmissionZip([pdf('a')]),b=buildSubmissionZip([pdf('b')]);
      const results=await Promise.allSettled([publishSubmissionZip(target,a.bytes),publishSubmissionZip(target,b.bytes)]);
      const winners=results.flatMap((r,i)=>r.status==='fulfilled'?[i]:[]);
      expect(winners).toHaveLength(1);
      expect(await fs.readFile(target)).toEqual(winners[0]===0?a.bytes:b.bytes);
      expect(await fs.readdir(dir)).toEqual(['race.zip']);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  it('publishes exact bytes, refuses occupied targets and cleans staging',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'submission-zip-'));
    try{
      const target=path.join(dir,'pack.zip'),a=buildSubmissionZip([pdf('a')]),b=buildSubmissionZip([pdf('b')]);
      await publishSubmissionZip(target,a.bytes);expect(await fs.readFile(target)).toEqual(a.bytes);
      await expect(publishSubmissionZip(target,b.bytes)).rejects.toThrow(/未覆盖/);
      expect(await fs.readFile(target)).toEqual(a.bytes);expect(await fs.readdir(dir)).toEqual(['pack.zip']);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
});
