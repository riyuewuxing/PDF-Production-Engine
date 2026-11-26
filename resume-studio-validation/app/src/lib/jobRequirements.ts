import type {ResumeDocument} from '../schema/resumeSchema';
import type {FactBank} from '../schema/factBankSchema';
import {factEntityId,visibleBasicValue} from './aiContext';
import {collectEditableBlocks} from './resumeBlocks';
import {extractJdKeywords} from './jdMatcher';

export const MAX_JD_SOURCE=20000;
export const MAX_JD_CLAUSES=80;
export type RequirementPriority='mandatory'|'preferred'|'unknown'|'not-requirement';
export type RequirementOutcome='unchecked'|'supported'|'gap';
export type RequirementCategory='学历'|'专业'|'学段'|'教师资格'|'应届身份'|'地区'|'时间'|'经历与能力'|'其他';
export type RequirementClause={id:string;start:number;end:number;line:number;quote:string;priorityHint:RequirementPriority;categories:RequirementCategory[]};
export type LocalJobEvidence={id:string;kind:'resume'|'fact';label:string;text:string;reference?:string};
const CATEGORY_RULES:readonly [RequirementCategory,RegExp][]=[
  ['学历',/学历|学位|本科|硕士|博士|研究生|bachelor|master.s degree|phd|doctorate/i],
  ['专业',/专业|学科|major|discipline/i],
  ['学段',/高中|初中|小学|中学|幼儿园|senior high|middle school|primary school/i],
  ['教师资格',/教师资格|教资|普通话|teaching licen[cs]e/i],
  ['应届身份',/应届|择业期|毕业生|毕业年度|fresh graduate/i],
  ['地区',/户籍|生源地|工作地点|地区|地域|所在地|region|location/i],
  ['时间',/截止|报名时间|年龄|年满|出生|\d{4}年|\d{4}[-/]\d|deadline|application date/i],
  ['经历与能力',/经历|经验|年限|能力|熟练|技能|experience|skills?|proficient/i],
];
export function suggestRequirementPriority(text:string):RequirementPriority{
  // Suggestions only; exceptions, compound clauses and scope are not legal interpretation.
  if(/不要求|不限制|不限|无需|不必|不作为|可放宽|not required|no requirement|not mandatory/i.test(text))return 'unknown';
  const hard=/必须|须持|须具备|须取得|须为|不得|不低于|至少|仅限|限于|必备|mandatory|\bmust\b|\brequired\b/i.test(text);
  const soft=/优先|优先考虑|preferred|nice to have|desirable/i.test(text);
  return hard===soft?'unknown':hard?'mandatory':'preferred';
}
export function splitJobRequirements(source:string):RequirementClause[]{
  if(source.length>MAX_JD_SOURCE)throw new Error('岗位原文超过 20000 字符，请分批核对；未截断分析。');
  const rows:RequirementClause[]=[];
  let start=0,line=1;
  function append(end:number){
    const raw=source.slice(start,end),quote=raw.trim();
    if(!quote||/^[；;。]+$/.test(quote))return;
    const first=start+raw.indexOf(quote),last=first+quote.length;
    const categories=CATEGORY_RULES.filter(([,rule])=>rule.test(quote)).map(([category])=>category);
    rows.push({id:first+':'+last,start:first,end:last,line,quote,priorityHint:suggestRequirementPriority(quote),categories:categories.length?categories:['其他']});
    if(rows.length>MAX_JD_CLAUSES)throw new Error('候选条款超过 80 条，请分批核对；未截断分析。');
  }
  for(const match of source.matchAll(/[；;。]|\r\n|\r|\n/g)){
    const pos=match.index!,delimiter=match[0];
    const newline=/[\r\n]/.test(delimiter);
    append(newline?pos:pos+delimiter.length);
    start=pos+delimiter.length;if(newline)line++;
  }
  append(source.length);
  return rows;
}
/** Local-only evidence. Visible resume claims are self-reported, not verified facts.
 * Linked records require independent source-version review and are intentionally not included here. */
export function collectLocalJobEvidence(doc:ResumeDocument,bank:FactBank|null):LocalJobEvidence[]{
  const rows:LocalJobEvidence[]=[],enabled=new Set(doc.menuSections.filter(s=>s.enabled).map(s=>s.id));
  const add=(id:string,label:string,parts:string[])=>{
    const text=parts.filter(s=>s.trim()).join('\n');
    if(text)rows.push({id:'resume:'+id,kind:'resume',label,text});
  };
  for(const [field,label] of [['title','求职意向'],['employmentStatus','求职身份'],['location','所在地']] as const)add('basic:'+field,label,[visibleBasicValue(doc,field)]);
  if(enabled.has('basic'))doc.basic.customFields.filter(f=>f.visible).forEach((f,i)=>add('basic:custom:'+i,f.label,[f.value]));
  const blocks=collectEditableBlocks(doc);
  for(const b of blocks){
    // Ambiguous duplicate stable keys cannot support a review.
    if(!factEntityId(doc,b.key))continue;
    const e=doc.education.find(e=>b.key==='edu:'+e.id);
    const x=doc.experience.find(x=>b.key==='exp:'+x.id);
    const j=doc.projects.find(j=>b.key==='proj:'+j.id);
    let fields:string[]=[];
    if(e)fields=[e.school,e.major,e.degree,e.startDate,e.endDate];
    else if(x)fields=[x.company,x.position,x.location,x.startDate,x.endDate];
    else if(j)fields=[j.name,j.role];
    else if(b.key.startsWith('custom:')){
      const item=doc.customData[b.sectionId]?.find(i=>b.key==='custom:'+b.sectionId+':'+i.id);
      if(item)fields=[item.title,item.subtitle,item.dateRange];
    }
    add(b.key,b.label,[...fields,b.text]);
  }
  for(const r of bank?.records??[]){
    if(r.sourceScope!=='manual'||r.verifiedStatus!=='user-confirmed'||r.docId!==doc.id||factEntityId(doc,r.blockKey)!==r.entityId)continue;
    rows.push({id:'fact:'+r.id,kind:'fact',label:r.blockLabel||'本人确认事实',text:[r.assertion,r.value,r.unit,r.timeframe].filter(Boolean).join('\n'),reference:r.evidenceRef});
  }
  return rows;
}
export function evidenceKeywordHints(clause:RequirementClause,evidence:LocalJobEvidence):string[]{
  const corpus=evidence.text.toLocaleLowerCase();
  return extractJdKeywords(clause.quote).filter(k=>corpus.includes(k.toLocaleLowerCase()));
}
export type RequirementReview={priority:RequirementPriority;outcome:RequirementOutcome;evidenceIds:string[];note:string};
export const blankRequirementReview=():RequirementReview=>({priority:'unknown',outcome:'unchecked',evidenceIds:[],note:''});
export function validateRequirementReview(review:RequirementReview,evidence:readonly LocalJobEvidence[]):RequirementReview{
  if(review.evidenceIds.length>5||new Set(review.evidenceIds).size!==review.evidenceIds.length||review.evidenceIds.some(id=>!evidence.some(e=>e.id===id)))throw new Error('证据选择已失效或超过五条，请重新核对。');
  if(review.priority==='not-requirement'&&(review.outcome!=='unchecked'||review.evidenceIds.length))throw new Error('非条件条款不能标记为支持或缺口。');
  if(review.outcome==='supported'&&!review.evidenceIds.length)throw new Error('标记自述支持前须明确选择至少一条本地依据。');
  return {...review,evidenceIds:[...review.evidenceIds],note:review.note.trim().slice(0,500)};
}
