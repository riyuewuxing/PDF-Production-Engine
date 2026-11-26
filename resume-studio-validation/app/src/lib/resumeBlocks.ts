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

  return blocks;
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
      const rest = key.slice('custom:'.length);
      const sepIdx = rest.indexOf(':');
      if (sepIdx > 0) {
        const secId = rest.slice(0, sepIdx);
        const itemId = rest.slice(sepIdx + 1);
        const existing = next.customData[secId];
        if (Array.isArray(existing)) {
          next = {
            ...next,
            customData: {
              ...next.customData,
              [secId]: existing.map((entry) =>
                entry.id === itemId ? { ...entry, description: nextText } : entry,
              ),
            },
          };
        }
      }
    }
  }

  return next;
}
