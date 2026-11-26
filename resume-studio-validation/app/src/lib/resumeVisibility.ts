import type { ResumeDocument } from '../schema/resumeSchema';

const BASIC_KEYS = ['name', 'title', 'email', 'phone', 'birthDate', 'location', 'employmentStatus'] as const;
type BasicKey = typeof BASIC_KEYS[number];

export function visibleBasicValue(doc: ResumeDocument, key: BasicKey): string {
  return doc.menuSections.some(s => s.id === 'basic' && s.enabled)
    && doc.basic.fieldOrder.some(f => f.key === key && f.visible) ? doc.basic[key] : '';
}

/** Presentation-only projection. Never save this object back to the editor.
 * Clear hidden values themselves, not just their DOM labels, so a template
 * cannot accidentally expose them through alternative layouts or image alt text.
 */
export function projectVisibleResume(doc: ResumeDocument): ResumeDocument {
  const basicEnabled = doc.menuSections.some(s => s.id === 'basic' && s.enabled);
  const basic = {...doc.basic};
  for (const key of BASIC_KEYS) basic[key] = visibleBasicValue(doc, key);
  basic.fieldOrder = doc.basic.fieldOrder.map(f => basicEnabled ? f : {...f, visible:false});
  // Legacy imports can supply partial fieldOrder. Several templates default an
  // absent name/title flag to true; add explicit hidden entries on this view only.
  for (const key of ['name', 'title'] as const) {
    if (!basic.fieldOrder.some(f => f.key === key)) {
      basic.fieldOrder.push({id:'presentation-hidden-'+key,key,label:key,type:'text',visible:false});
    }
  }
  basic.customFields = basicEnabled ? doc.basic.customFields.filter(f=>f.visible) : [];
  if (!basicEnabled || !doc.basic.photoConfig.visible) {
    basic.photo = '';
    basic.photoConfig = {...doc.basic.photoConfig, visible:false};
  }
  return {...doc, basic};
}
