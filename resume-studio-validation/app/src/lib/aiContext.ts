import { collectEditableBlocks, type EditableBlockOption } from './resumeBlocks';
import type { ResumeDocument } from '../schema/resumeSchema';

export const PRIVACY_PLACEHOLDER = '【隐私已省略】';

/** Known identifiers and common contact formats are removed from EVERY outbound text field. */
export function createAiTextSanitizer(docs: readonly ResumeDocument[]): (text: string) => string {
  const terms = [...new Set(docs.flatMap(doc => [
    doc.basic.name, doc.basic.email, doc.basic.phone, doc.basic.birthDate, doc.basic.photo,
  ]).map(s => s.trim()).filter(s => s.length >= 2))].sort((a,b)=>b.length-a.length);
  return (text: string) => {
    let result = text;
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'gi'), PRIVACY_PLACEHOLDER);
    }
    return result
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, PRIVACY_PLACEHOLDER)
      .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?!\d)/g, PRIVACY_PLACEHOLDER)
      .replace(/(?:resume-asset:\/\/|\/api\/assets\/)[^\s"'<>]+/gi, PRIVACY_PLACEHOLDER)
      .replace(/data:[^\s"'<>]+/gi, PRIVACY_PLACEHOLDER);
  };
}

export interface AiFactSource {
  id: string;
  blockKey: string;
  scope: 'current' | 'master';
  label: string;
  entity: string;
  facts: string;
  status: 'self-reported';
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
