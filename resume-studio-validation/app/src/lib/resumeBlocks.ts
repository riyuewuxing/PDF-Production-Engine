import type { ResumeDocument } from '../schema/resumeSchema';

export interface EditableBlockOption {
  key: string;
  sectionId: string;
  label: string;
  text: string;
  maxCharsHint: number;
}

function estimateMaxChars(text: string): number {
  const len = text.trim().length;
  return Math.max(80, Math.round(Math.max(len, 60) * 1.25));
}

/** Count identities across all raw rows, including hidden and disabled ones.
 * Otherwise a visible row can accidentally read hidden metadata or a patch can write both. */
function rawBlockKeyCounts(doc:ResumeDocument):Map<string,number>{
  const counts=new Map<string,number>();
  const add=(key:string)=>counts.set(key,(counts.get(key)??0)+1);
  doc.education.forEach(e=>add('edu:'+e.id));
  doc.experience.forEach(e=>add('exp:'+e.id));
  doc.projects.forEach(e=>add('proj:'+e.id));
  for(const [section,items] of Object.entries(doc.customData))items.forEach(item=>add('custom:'+section+':'+item.id));
  add('skills');add('selfEvaluation');return counts;
}
export function collectEditableBlocks(doc: ResumeDocument): EditableBlockOption[] {
  const blocks: EditableBlockOption[] = [];
  const enabled = new Set(doc.menuSections.filter((section) => section.enabled).map((section) => section.id));

  for (const edu of doc.education) {
    if (!enabled.has('education') || !edu.visible) continue;
    blocks.push({
      key: `edu:${edu.id}`,
      sectionId: 'education',
      label: `教育经历 · ${edu.school || '未命名'}`,
      text: edu.description,
      maxCharsHint: estimateMaxChars(edu.description),
    });
  }

  for (const exp of doc.experience) {
    if (!enabled.has('experience') || !exp.visible) continue;
    blocks.push({
      key: `exp:${exp.id}`,
      sectionId: 'experience',
      label: `工作经历 · ${exp.company || '未命名'}`,
      text: exp.description,
      maxCharsHint: estimateMaxChars(exp.description),
    });
  }

  for (const proj of doc.projects) {
    if (!enabled.has('projects') || !proj.visible) continue;
    blocks.push({
      key: `proj:${proj.id}`,
      sectionId: 'projects',
      label: `项目经历 · ${proj.name || '未命名'}`,
      text: proj.description,
      maxCharsHint: estimateMaxChars(proj.description),
    });
  }

  const orderedCustomSections = [...doc.menuSections]
    .sort((a, b) => a.order - b.order)
    .filter((sec) => sec.enabled && Array.isArray(doc.customData[sec.id]));

  for (const sec of orderedCustomSections) {
    const items = doc.customData[sec.id] ?? [];
    for (const item of items) {
      if (!item.visible) continue;
      blocks.push({
        key: `custom:${sec.id}:${item.id}`,
        sectionId: sec.id,
        label: `${sec.title} · ${item.title || '未命名'}`,
        text: item.description,
        maxCharsHint: estimateMaxChars(item.description),
      });
    }
  }

  if (enabled.has('skills')) blocks.push({
    key: 'skills',
    sectionId: 'skills',
    label: '专业技能',
    text: doc.skillContent,
    maxCharsHint: estimateMaxChars(doc.skillContent),
  });

  if (enabled.has('selfEvaluation')) blocks.push({
    key: 'selfEvaluation',
    sectionId: 'selfEvaluation',
    label: '自我评价',
    text: doc.selfEvaluationContent,
    maxCharsHint: estimateMaxChars(doc.selfEvaluationContent),
  });

  const raw=rawBlockKeyCounts(doc),visible=new Map<string,number>();
  for(const b of blocks)visible.set(b.key,(visible.get(b.key)??0)+1);
  return blocks.filter(b=>raw.get(b.key)===1&&visible.get(b.key)===1);
}

/**
 * 纯函数：把多个可编辑段落的改写结果一次性不可变合入 `ResumeDocument`（便于 1 步入栈 Undo）。
 */
export function applyBlockUpdates(
  doc: ResumeDocument,
  updates: Record<string, string>,
): ResumeDocument {
  let next: ResumeDocument = doc;
  const entries = Object.entries(updates);
  if (entries.length === 0) return next;

  const allowed=new Map(collectEditableBlocks(doc).map(b=>[b.key,b]));
  if(entries.some(([key])=>!allowed.has(key)))throw new Error('正文目标重复、隐藏、已禁用或不存在，未应用修改。');
  for (const [key, nextText] of entries) {
    if (key === 'skills') {
      next = { ...next, skillContent: nextText };
      continue;
    }
    if (key === 'selfEvaluation') {
      next = { ...next, selfEvaluationContent: nextText };
      continue;
    }
    if (key.startsWith('edu:')) {
      const id = key.slice('edu:'.length);
      next = {
        ...next,
        education: next.education.map((item) =>
          item.id === id ? { ...item, description: nextText } : item,
        ),
      };
      continue;
    }
    if (key.startsWith('exp:')) {
      const id = key.slice('exp:'.length);
      next = {
        ...next,
        experience: next.experience.map((item) =>
          item.id === id ? { ...item, description: nextText } : item,
        ),
      };
      continue;
    }
    if (key.startsWith('proj:')) {
      const id = key.slice('proj:'.length);
      next = {
        ...next,
        projects: next.projects.map((item) =>
          item.id === id ? { ...item, description: nextText } : item,
        ),
      };
      continue;
    }
    if (key.startsWith('custom:')) {
      const secId=allowed.get(key)!.sectionId;
      const existing=next.customData[secId];
      if(Array.isArray(existing)){
        next={...next,customData:{...next.customData,[secId]:existing.map(entry=>
          'custom:'+secId+':'+entry.id===key?{...entry,description:nextText}:entry)}};
      }
    }
  }

  return next;
}
