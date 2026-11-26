import type {ResumeDocument} from '../schema/resumeSchema';
import type {ExtractedPdfPageTokens} from './pdfTextLayout';
import {inspectAtsFromExtractedPages,normalizeForMatch} from './atsInspector';
import {collectEditableBlocks} from './resumeBlocks';
import {visibleBasicValue} from './aiContext';
export const MAX_COMPARE_PAGES=12;
export type PdfAudit={pages:number;characters:number;atsScore:number;blankPages:number;nonA4Pages:number;outsideSpans:number;garbled:number;compat:number;missingLabels:string[];missingBlockKeys:string[];warnings:string[];text:string;characterBag:Record<string,number>};
function normalizedText(text:string){return normalizeForMatch(text).replace(/[\p{P}\p{S}]/gu,'');}
function bag(text:string){const result:Record<string,number>=Object.create(null);for(const ch of normalizedText(text))result[ch]=(result[ch]??0)+1;return result;}
function textLines(value:string){return value.replace(/<br\s*\/?\s*>|<\/(?:li|p|ul|ol)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').split(/\r?\n/).map(normalizedText).filter(s=>s.length>=3);}
/** Visibility-aware local probes; no private contents included in model requests. */
export function auditPdfCandidate(doc:ResumeDocument,pages:readonly ExtractedPdfPageTokens[]):PdfAudit{
  if(!pages.length||pages.length>MAX_COMPARE_PAGES)throw new Error('PDF 页数超出本地对照范围（1–12页）。');
  const ats=inspectAtsFromExtractedPages(doc,pages);
  const raw=pages.map(p=>p.tokens.map(t=>t.str).join('')).join('');
  const text=normalizedText(ats.rawExtractedText),columnText=normalizedText(ats.columnAwareText),stream=normalizedText(raw);
  const present=(s:string)=>[text,columnText,stream].some(t=>t.includes(s));
  const missingLabels:string[]=[],missingBlockKeys:string[]=[];
  for(const b of collectEditableBlocks(doc)){const lines=textLines(b.text);if(lines.some(l=>!present(l))){missingLabels.push(b.label);missingBlockKeys.push(b.key);}}
  for(const key of ['name','email','phone'] as const){const v=normalizedText(visibleBasicValue(doc,key));if(v&&!present(v))missingLabels.push('基本资料 · '+key);}
  const visible=new Set(doc.menuSections.filter(s=>s.enabled).map(s=>s.id));
  const entities:[string,string][]=[
    ...(visible.has('education')?doc.education.filter(x=>x.visible).map(x=>['教育 · '+x.school,x.school] as [string,string]):[]),
    ...(visible.has('experience')?doc.experience.filter(x=>x.visible).map(x=>['经历 · '+x.company,x.company] as [string,string]):[]),
    ...(visible.has('projects')?doc.projects.filter(x=>x.visible).map(x=>['项目 · '+x.name,x.name] as [string,string]):[]),
    ...Object.entries(doc.customData).filter(([id])=>visible.has(id)).flatMap(([,items])=>items.filter(x=>x.visible).map(x=>['自定义 · '+x.title,x.title] as [string,string])),
  ];
  for(const [label,value] of entities){const v=normalizedText(value);if(v&&!present(v))missingLabels.push(label);}
  const blankPages=pages.filter(p=>!p.tokens.some(t=>t.str.trim())).length;
  const nonA4Pages=pages.filter(p=>Math.abs(p.pageWidth-595.276)>2||Math.abs(p.pageHeight-841.89)>2).length;
  const outsideSpans=pages.reduce((sum,p)=>sum+p.tokens.filter(t=>t.str.trim()&&(t.x<-2||t.y<-2||t.x+t.width>p.pageWidth+2||t.y>p.pageHeight+2)).length,0);
  return {pages:pages.length,characters:ats.charCount,atsScore:ats.score,blankPages,nonA4Pages,outsideSpans,garbled:ats.garbledCharCount,compat:ats.compatCharCount,missingLabels:[...new Set(missingLabels)],missingBlockKeys,warnings:ats.checks.filter(c=>c.severity!=='pass').map(c=>c.label),text:ats.columnAwareText,characterBag:bag(raw)};
}
export function comparePdfAudits(before:PdfAudit,after:PdfAudit,styleOnly:boolean){
  const blockers:string[]=[],warnings:string[]=[];
  if(after.blankPages)blockers.push('候选 PDF 存在无可提取正文的页面。');
  if(after.nonA4Pages)blockers.push('候选 PDF 存在非 A4 页面。');
  if(after.outsideSpans)blockers.push('候选 PDF 存在超出页面边界的文字位置。');
  if(after.garbled>before.garbled||after.compat>before.compat)blockers.push('候选 PDF 新增乱码或兼容汉字污染。');
  const missing=after.missingLabels.filter(l=>!before.missingLabels.includes(l));
  if(missing.length)blockers.push('新增未读出内容：'+missing.join('、'));
  if(styleOnly){
    const lost=Object.entries(before.characterBag).reduce((n,[ch,count])=>n+Math.max(0,count-(after.characterBag[ch]??0)),0);
    if(lost)blockers.push('仅调整版式时，PDF 机读字符减少 '+lost+' 个；拒绝应用，需检查是否有内容丢失。');
  }
  if(after.pages>before.pages)warnings.push('真实 PDF 页数增加。');
  if(after.atsScore<before.atsScore)warnings.push('本地 ATS 启发式评分下降，并非真实招聘系统结果。');
  if(after.missingLabels.length)warnings.push('存在未完整匹配的正文/实体，可能与原版模板或文本重建顺序有关；请查看逐页图像。');
  if(after.garbled||after.compat)warnings.push('候选仍存在字体机读问题。');
  return {blockers,warnings};
}
