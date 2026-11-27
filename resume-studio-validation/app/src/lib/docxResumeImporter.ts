import { BoundedDocxZip, DOCX_MAX_ARCHIVE_BYTES } from './boundedDocxZip';
import { matchHeadingLine, parseExtractedResumeText, RESUME_IMPORT_TEXT_MAX_CHARS, type PdfImportDraft } from './pdfResumeImporter';

export const RESUME_IMPORT_DOCX_MAX_BYTES=DOCX_MAX_ARCHIVE_BYTES;
const W_NS=['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main'];
const CT_NS='http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS='http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL=['http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument','http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument'];
const MAIN_TYPE='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const err=(message:string):never=>{throw new Error('DOCX 解析拒绝：'+message);};
function xml(bytes:Uint8Array):Document{
  let raw:string;
  try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return err('XML 不是有效 UTF-8，请另存为常规 DOCX。');}
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw)||/<\?(?!xml(?:\s|\?>))/i.test(raw))err('不允许 DTD、实体声明或外部处理指令。');
  const declared=/^\s*<\?xml\s[^?]*\bencoding\s*=\s*(['"])([^'"]+)\1/i.exec(raw)?.[2];
  if(declared&&declared.toLowerCase()!=='utf-8')err('XML 声明编码不是 UTF-8。');
  const d=new DOMParser().parseFromString(raw,'application/xml');
  if(d.doctype||d.getElementsByTagNameNS('*','parsererror').length||!d.documentElement)err('XML 无效。');
  const pending:{node:Element;depth:number}[]=[{node:d.documentElement,depth:0}];let count=0;
  while(pending.length){const item=pending.pop()!;if(++count>100_000||item.depth>80)err('XML 节点或深度超过安全上限。');for(const child of item.node.children)pending.push({node:child,depth:item.depth+1});}
  return d;
}
function direct(node:Element,ns:string,name:string):Element|undefined{return [...node.children].find(x=>x.namespaceURI===ns&&x.localName===name);}
function attr(node:Element|undefined,ns:string,name:string){return node?.getAttributeNS(ns,name)??'';}
function validateTypes(d:Document){
  if(d.documentElement.namespaceURI!==CT_NS||d.documentElement.localName!=='Types')err('缺少规范的内容类型表。');
  const nodes=[...d.documentElement.children];
  const main=nodes.filter(e=>e.namespaceURI===CT_NS&&e.localName==='Override'&&e.getAttribute('PartName')==='/word/document.xml');
  if(main.length!==1||main[0]!.getAttribute('ContentType')!==MAIN_TYPE)err('只支持常规非宏 DOCX 正文。');
  if(nodes.some(e=>/macroenabled|vbaproject|activex|oleobject/i.test(e.getAttribute('ContentType')??'')))err('不支持含宏、ActiveX 或 OLE 的文档。');
}
function validateRootRels(d:Document){
  if(d.documentElement.namespaceURI!==REL_NS||d.documentElement.localName!=='Relationships')err('包关系表无效。');
  const main=[...d.documentElement.children].filter(e=>e.namespaceURI===REL_NS&&e.localName==='Relationship'&&OFFICE_REL.includes(e.getAttribute('Type')??''));
  if(main.length!==1||!['word/document.xml','/word/document.xml'].includes(main[0]!.getAttribute('Target')??'')||!['','Internal'].includes(main[0]!.getAttribute('TargetMode')??''))err('只支持标准本地正文部件，不跟随外部或替代正文路径。');
}
function validateBodyStyles(d:Document,zip:BoundedDocxZip){
  if(d.documentElement.namespaceURI!==REL_NS||d.documentElement.localName!=='Relationships')err('正文关系表无效。');
  const seen=new Set<string>();
  for(const e of d.documentElement.children){
    if(e.namespaceURI!==REL_NS||e.localName!=='Relationship')continue;
    const type=e.getAttribute('Type')??'', suffix=type.split('/').pop();
    if(suffix!=='styles'&&suffix!=='stylesWithEffects')continue;
    const target=suffix+'.xml';
    if(seen.has(suffix)||!['','Internal'].includes(e.getAttribute('TargetMode')??'')||![target,'/word/'+target].includes(e.getAttribute('Target')??'')||!zip.has('word/'+target))err('不支持外部、缺失或替代样式部件。');
    seen.add(suffix);
  }
}
function assertClean(d:Document,ns:string){
  for(const tag of ['vanish','webHidden','specVanish','ins','del','delText','moveFrom','moveTo','moveFromRangeStart','moveToRangeStart','rPrChange','pPrChange','tblPrChange','trPrChange','tcPrChange','sectPrChange','cellIns','cellDel','cellMerge']){
    const nodes=[...d.getElementsByTagNameNS(ns,tag)];
    if(nodes.some(n=>!['vanish','webHidden','specVanish'].includes(tag)||!['0','false','off'].includes(attr(n,ns,'val').toLowerCase())))err('检测到隐藏文字或未处理修订，请在 Word 中检查并另存为干净副本。');
  }
}
type Para={text:string;level:number|null};
function styleLevels(d:Document|undefined,ns:string):Map<string,number>{
  const out=new Map<string,number>();
  if(!d)return out;
  if(d.documentElement.namespaceURI!==ns||d.documentElement.localName!=='styles')err('样式部件无效。');
  for(const s of d.getElementsByTagNameNS(ns,'style')){
    if(attr(s,ns,'type')!=='paragraph')continue;
    const id=attr(s,ns,'styleId');if(!id)continue;
    const level=attr(direct(direct(s,ns,'pPr')??s,ns,'outlineLvl'),ns,'val');
    const name=attr(direct(s,ns,'name'),ns,'val');
    const heading=/^(?:heading|标题)\s*([1-9])$/i.exec(name)||/^Heading([1-9])$/i.exec(id);
    if(/^[0-8]$/.test(level))out.set(id,Number(level)+1);
    else if(heading)out.set(id,Number(heading[1]));
  }
  return out;
}
function extractBody(doc:Document,styles:Document|undefined):{paras:Para[];warnings:string[]}{
  const ns=doc.documentElement.namespaceURI??'';
  if(!W_NS.includes(ns)||doc.documentElement.localName!=='document')err('正文不是受支持的 WordprocessingML。');
  assertClean(doc,ns);if(styles)assertClean(styles,ns);
  const body=direct(doc.documentElement,ns,'body');if(!body) return err('缺少正文。');
  const levels=styleLevels(styles,ns);
  const warnings=new Set<string>();
  warnings.add('仅导入主正文文字；页眉、页脚、批注、脚注、尾注、图片、附件、编号样式和版式不会导入。');
  warnings.add('表格按行、单元格及段落顺序读取；非语义标题及复杂排版仍需人工分组。');
  warnings.add('这不是视觉脱敏：白字、遮盖、颜色或其他排版隐藏的正文仍可能被提取。请与原件逐项核对。');
  const paras:Para[]=[];let chars=0;
  const note=(s:string)=>warnings.add(s);
  const is=(e:Element,name:string)=>e.namespaceURI===ns&&e.localName===name;
  const paragraph=(p:Element)=>{
    const pPr=direct(p,ns,'pPr'),style=attr(pPr?direct(pPr,ns,'pStyle'):undefined,ns,'val');
    const ol=attr(pPr?direct(pPr,ns,'outlineLvl'):undefined,ns,'val');
    const level=/^[0-8]$/.test(ol)?Number(ol)+1:levels.get(style)??null;
    const parts:string[]=[];
    let fieldDepth=0;
    const walk=(e:Element)=>{
      if(is(e,'r')||is(e,'hyperlink')||is(e,'smartTag')||is(e,'customXml')){
        for(const child of e.children)walk(child);return;
      }
      if(is(e,'fldChar')){
        note('动态域及缓存结果已跳过；需要时请在原文中核对。');
        const k=attr(e,ns,'fldCharType');
        if(k==='begin')fieldDepth++;else if(k==='end'){if(!fieldDepth)err('动态域边界不完整。');fieldDepth--;}else if(k!=='separate'||!fieldDepth)err('动态域边界不完整。');
        return;
      }
      if(is(e,'fldSimple')||is(e,'instrText')){note('动态域及缓存结果已跳过；需要时请在原文中核对。');return;}
      if(is(e,'t')){if(e.children.length)err('正文文字节点包含不支持的结构。');if(!fieldDepth)parts.push(e.textContent??'');return;}
      if(is(e,'tab')){if(!fieldDepth)parts.push('\t');return;}
      if(is(e,'br')||is(e,'cr')){if(!fieldDepth)parts.push('\n');return;}
      if(is(e,'noBreakHyphen')){if(!fieldDepth)parts.push('\u2011');return;}
      if(is(e,'softHyphen'))return;
      if(is(e,'rPr')||is(e,'pPr')||is(e,'bookmarkStart')||is(e,'bookmarkEnd')||is(e,'proofErr')||is(e,'commentRangeStart')||is(e,'commentRangeEnd')||is(e,'commentReference')||is(e,'lastRenderedPageBreak')||is(e,'permStart')||is(e,'permEnd'))return;
      note('图片、文本框、内容控件或其他非普通正文节点已跳过。');
    };
    for(const c of p.children)walk(c);
    if(fieldDepth)err('动态域跨段落或未闭合；请另存静态文字副本。');
    const text=parts.join('').trim();
    if(text){chars+=text.length+1;if(chars>RESUME_IMPORT_TEXT_MAX_CHARS)err('正文超过 120000 字符上限，没有截断。');paras.push({text,level});}
  };
  const blocks=(parent:Element)=>{
    for(const c of parent.children){
      if(is(c,'p'))paragraph(c);
      else if(is(c,'tbl')){for(const row of c.children){if(is(row,'tr')){for(const cell of row.children)if(is(cell,'tc'))blocks(cell);else if(!is(cell,'trPr'))note('表格内不支持的结构已跳过。');}else if(!is(row,'tblPr')&&!is(row,'tblGrid'))note('表格内不支持的结构已跳过。');}}
      else if(!is(c,'sectPr')&&!is(c,'tcPr'))note('图片、文本框、内容控件或其他非普通正文节点已跳过。');
    }
  };
  blocks(body);
  if(!paras.length)err('没有可提取的主正文文字，不会创建空简历。');
  return {paras,warnings:[...warnings]};
}
function makeDraft(paras:Para[],fileName:string,warnings:string[]):PdfImportDraft{
  const marked:string[]=[];
  let active:ReturnType<typeof matchHeadingLine>=null;
  for(const p of paras){
    const text=p.text;
    const oneLine=!text.includes('\n');
    const known=oneLine&&!/^\s*#/.test(text)?matchHeadingLine(text):null;
    if(known){marked.push('## '+text);active=known;continue;}
    if(p.level===1&&oneLine){marked.push('## '+text);active=null;continue;}
    if(p.level!==null&&p.level>=2&&oneLine&&['education','experience','projects'].includes(active??'')){marked.push('### '+text);continue;}
    // Literal Word text is not Markdown syntax; use an invisible guard on lines starting with it.
    const lines=text.split('\n').map(l=>/^\s*(?:#|~{3}|\x60{3})/.test(l)?'\u200b'+l:l);
    marked.push(...lines);
  }
  const d=parseExtractedResumeText(marked.join('\n'),fileName.replace(/\.docx$/i,'')||'DOCX 导入简历',undefined,{markdown:true,docx:true});
  // Keep guards in experience draft until its Markdown splitting step, then remove them.
  return {...d,rawText:paras.map(p=>p.text).join('\n'),sourceKind:'docx',importWarnings:warnings};
}
export async function parseDocxResume(input:ArrayBuffer|Uint8Array,fileName:string,signal?:AbortSignal):Promise<PdfImportDraft>{
  if(!/\.docx$/i.test(fileName))err('仅支持 .docx，不支持 .doc 或 .docm。');
  if(signal?.aborted)err('本地解析已取消。');
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined,rejectAbort:((e:Error)=>void)|undefined;
  const abort=()=>{controller.abort();rejectAbort?.(new Error('DOCX 本地解析已取消。'));};
  signal?.addEventListener('abort',abort,{once:true});
  const read=async()=>{
    const z=new BoundedDocxZip(input,controller.signal);
    if(z.names().some(n=>/(?:^|\/)(?:vbaProject[^/]*|activeX|embeddings)(?:\/|$)/i.test(n)))err('不支持含宏、ActiveX 或嵌入对象的文档。');
    const get=async(name:string)=>xml(await z.readPart(name,controller.signal));
    validateTypes(await get('[Content_Types].xml'));
    validateRootRels(await get('_rels/.rels'));
    const main=await get('word/document.xml');
    if(z.has('word/_rels/document.xml.rels'))validateBodyStyles(await get('word/_rels/document.xml.rels'),z);
    const styles=z.has('word/styles.xml')?await get('word/styles.xml'):undefined;
    if(z.has('word/stylesWithEffects.xml')){const alternate=await get('word/stylesWithEffects.xml');const ns=main.documentElement.namespaceURI??'';if(alternate.documentElement.namespaceURI!==ns||alternate.documentElement.localName!=='styles')err('替代样式部件无效。');assertClean(alternate,ns);}
    const {paras,warnings}=extractBody(main,styles);
    if(controller.signal.aborted)err('本地解析已取消。');
    return makeDraft(paras,fileName,warnings);
  };
  try{return await Promise.race([read(),new Promise<never>((_,reject)=>{rejectAbort=reject;timer=setTimeout(()=>{controller.abort();reject(new Error('DOCX 本地解析超过 20 秒，已请求停止。'));},20_000);})]);}
  finally{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
