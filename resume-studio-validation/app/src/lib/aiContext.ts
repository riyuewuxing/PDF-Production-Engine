import type {FactRecord} from '../schema/factBankSchema';
import { collectEditableBlocks, type EditableBlockOption } from './resumeBlocks';
import type { ResumeDocument } from '../schema/resumeSchema';

export const PRIVACY_PLACEHOLDER = '【隐私已省略】';

/** Known identifiers and common contact formats are removed from EVERY outbound text field. */
export function visibleBasicValue(doc:ResumeDocument,key:'name'|'title'|'email'|'phone'|'birthDate'|'location'|'employmentStatus'):string {
  return doc.menuSections.some(s=>s.id==='basic'&&s.enabled)&&doc.basic.fieldOrder.some(f=>f.key===key&&f.visible)?doc.basic[key]:'';
}
export function createAiTextSanitizer(docs:readonly ResumeDocument[]):(text:string)=>string{
  const terms=[...new Set(docs.flatMap(doc=>[
    doc.basic.name,doc.basic.email,doc.basic.phone,doc.basic.birthDate,doc.basic.photo,doc.basic.location,
    ...doc.basic.customFields.filter(f=>!f.visible).map(f=>f.value),
    ...(!visibleBasicValue(doc,'title')?[doc.basic.title]:[]),
    ...(!visibleBasicValue(doc,'employmentStatus')?[doc.basic.employmentStatus]:[]),
  ]).map(s=>s.trim()).filter(s=>s.length>0&&s.length<=4096))].sort((a,b)=>b.length-a.length);
  const escaped=terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const pattern=escaped.length?new RegExp(escaped.join('|'),'gi'):null;
  return (text:string)=>{
    const value=pattern?text.replace(pattern,PRIVACY_PLACEHOLDER):text;
    return value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,PRIVACY_PLACEHOLDER)
      .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?!\d)/g,PRIVACY_PLACEHOLDER)
      .replace(/(?:resume-asset:\/\/|\/api\/assets\/)[^\s"'<>]+/gi,PRIVACY_PLACEHOLDER)
      .replace(/data:[^\s"'<>]+/gi,PRIVACY_PLACEHOLDER);
  };
}

export interface AiFactSource {
  id: string;
  blockKey: string;
  scope: 'current' | 'master' | 'record';
  label: string;
  entity: string;
  facts: string;
  status: 'self-reported' | 'user-confirmed';
}

export type AiFactSourceMap = Record<string, AiFactSource[]>;

function blockDetails(doc: ResumeDocument, block: EditableBlockOption): {entity: string; facts: string[]} {
  const key = block.key;
  if (key.startsWith('edu:')) {
    const item = doc.education.find(e => key === `edu:${e.id}`);
    if (item) return {entity: JSON.stringify([item.school,item.major,item.degree,item.startDate,item.endDate]), facts:[item.school,item.major,item.degree,item.startDate,item.endDate,item.gpa]};
  }
  if (key.startsWith('exp:')) {
    const item = doc.experience.find(e => key === `exp:${e.id}`);
    if (item) return {entity: JSON.stringify([item.company,item.position,item.startDate,item.endDate]), facts:[item.company,item.position,item.startDate,item.endDate]};
  }
  if (key.startsWith('proj:')) {
    const item = doc.projects.find(e => key === `proj:${e.id}`);
    if (item) return {entity: JSON.stringify([item.name,item.role,item.date]), facts:[item.name,item.role,item.date]};
  }
  if (key.startsWith('custom:')) {
    for (const [section, items] of Object.entries(doc.customData)) {
      const item = items.find(e => key === `custom:${section}:${e.id}`);
      if (item) return {entity: JSON.stringify([section,item.title,item.subtitle,item.dateRange]), facts:[item.title,item.subtitle,item.dateRange]};
    }
  }
  return {entity:'', facts:[]};
}

/** Local identity includes the version's document ID and the stable block/entity.
 * It intentionally does not include wording, so an approved rewrite preserves the link.
 * Changing the subject or timeframe (or hiding the block) invalidates the link. */
export function factEntityId(doc:ResumeDocument,blockKey:string):string|null{
  const matches=collectEditableBlocks(doc).filter(b=>b.key===blockKey);
  if(matches.length!==1)return null;
  return JSON.stringify([doc.id,blockKey,blockDetails(doc,matches[0]!).entity]);
}
export function isShareableFact(doc:ResumeDocument,record:FactRecord):boolean{
  return record.docId===doc.id&&record.verifiedStatus==='user-confirmed'&&record.sensitivity==='shareable'&&factEntityId(doc,record.blockKey)===record.entityId;
}
/** Only explicitly selected, matching records are sent; source references and persistent IDs never leave the app. */
export function appendSelectedFactSources(doc:ResumeDocument,map:AiFactSourceMap,records:readonly FactRecord[],selectedKeys:readonly string[],additionalPrivateDocs:readonly ResumeDocument[]=[]):AiFactSourceMap{
  if(records.length>20||new Set(records.map(r=>r.id)).size!==records.length)throw new Error('事实选择重复或超过20条。');
  const keys=new Set(selectedKeys),sanitize=createAiTextSanitizer([doc,...additionalPrivateDocs]);
  const next={...map};
  const blocks=collectEditableBlocks(doc);
  records.forEach((r,i)=>{
    const sources=next[r.blockKey];
    if(!keys.has(r.blockKey)||!isShareableFact(doc,r)||!sources)throw new Error('所选事实已撤销、不可外发或与当前主体不匹配。');
    next[r.blockKey]=[...sources,{
      id:'record-'+(i+1),blockKey:r.blockKey,scope:'record',entity:r.entityId,label:'本人确认的事实 · '+sanitize(blocks.find(b=>b.key===r.blockKey)?.label??'当前段落'),
      facts:sanitize([r.assertion,r.value,r.unit,r.timeframe].filter(Boolean).join('\n')),
      status:'user-confirmed',
    }];
  });
  return next;
}

function makeSources(doc: ResumeDocument, scope: AiFactSource['scope'], sanitize: (text:string)=>string): AiFactSource[] {
  return collectEditableBlocks(doc).map((block,index)=>{
    const details = blockDetails(doc,block);
    return {
      id:`${scope}-${index+1}`, blockKey:block.key, scope,
      label:sanitize(block.label), entity:details.entity,
      facts:sanitize([...details.facts,block.text].filter(Boolean).join('\n')),
      status:'self-reported',
    };
  });
}

/**
 * One source per visible current block. Mother-bank reference is opt-in and restricted
 * to matching block identity AND entity/timeframe. Unrelated experiences never authorize claims.
 * These are candidate-reported facts, not independent verification.
 */
export function buildAiFactSources(doc: ResumeDocument, master?: ResumeDocument | null): AiFactSourceMap {
  const sanitize = createAiTextSanitizer(master ? [doc,master] : [doc]);
  const current = makeSources(doc,'current',sanitize);
  const references = master ? makeSources(master,'master',sanitize) : [];
  return Object.fromEntries(current.map(source=>{
    const related = source.entity ? references.filter(ref=>ref.blockKey===source.blockKey && ref.entity===source.entity) : [];
    return [source.blockKey,[source,...related]];
  }));
}

export function currentSourceCorpus(sources: readonly AiFactSource[]): string {
  return sources.filter(s=>s.scope==='current').map(s=>s.facts).join('\n');
}

/** Never serialize internal entity identity, hidden fields, document IDs, or photos. */
export function outboundFactSources(sources: readonly AiFactSource[]) {
  return sources.map(({id,scope,label,facts,status})=>({id,scope,label,facts,status}));
}
