import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type RendererEntry = {type:'url'|'file';target:string;search?:Record<string,string>};

/** Exact application entry, including print job parameters. Never trust an origin alone. */
export function rendererEntryUrl(entry: RendererEntry): string {
  const url=entry.type==='file'?pathToFileURL(path.resolve(entry.target)):new URL(entry.target);
  if(entry.search)for(const [key,value] of Object.entries(entry.search))url.searchParams.set(key,value);
  return url.href;
}
export function isTrustedRendererFrame(input:{
  senderId:number; expectedSenderId:number; isMainFrame:boolean; url:string; expectedUrl:string;
}):boolean {
  if(input.senderId!==input.expectedSenderId||!input.isMainFrame)return false;
  try {
    const actual=new URL(input.url),expected=new URL(input.expectedUrl);
    // Node pathToFileURL may encode '~' as %7E while Electron loadFile
    // leaves it literal (e.g. the Windows portable 8.3 unpack path).
    // Only normalize this unreserved character in local file pathnames.
    // Never decode other escapes, the query/fragment, or a network URL.
    if(actual.protocol==='file:'&&expected.protocol==='file:'&&!actual.host&&!expected.host){
      actual.pathname=actual.pathname.replace(/%7e/gi,'~');
      expected.pathname=expected.pathname.replace(/%7e/gi,'~');
    }
    return actual.href===expected.href;
  }catch{return false;}
}

const SAFE_EXTENSIONS=new Set(['.pdf','.png','.jpg','.jpeg','.webp','.docx','.md','.txt','.json','.csv','.ics','.html']);
export function isSafeExportFileName(filePath:string):boolean {
  if(typeof filePath!=='string'||!path.isAbsolute(filePath)||filePath.includes('\0'))return false;
  if(process.platform==='win32'&&(/^[\\/]{2}/.test(filePath)||filePath.slice(2).includes(':')))return false;
  return SAFE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
export function isPathInside(root:string,target:string):boolean {
  const relative=path.relative(root,target);
  return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);
}
export function isLoopbackDevEntry(raw:string):boolean {
  try {
    const url=new URL(raw);
    return ['http:','https:'].includes(url.protocol)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash;
  }catch{return false;}
}
