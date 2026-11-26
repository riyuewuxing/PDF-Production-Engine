import type { ResumeDocument } from '../schema/resumeSchema';

const CJK_CHAR = '[\\u4e00-\\u9fff\\u3400-\\u4dbf]';
const CJK_BEFORE_ASCII = new RegExp(`(${CJK_CHAR})([A-Za-z0-9])`, 'g');
const ASCII_BEFORE_CJK = new RegExp(`([A-Za-z0-9%])(${CJK_CHAR})`, 'g');

interface MaskedEntry {
  text: string;
  spaceAsciiEdges: boolean;
}

const PROTECTED_PATTERNS: Array<{ pattern: RegExp; spaceAsciiEdges: boolean }> = [
  { pattern: /https?:\/\/[^\s<>"')\]]+/gi, spaceAsciiEdges: true },
  { pattern: /\bwww\.[^\s<>"')\]]+/gi, spaceAsciiEdges: true },
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, spaceAsciiEdges: true },
  {
    pattern: /\d{2,4}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*[日号])?)?|\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g,
    spaceAsciiEdges: false,
  },
  {
    pattern: /[A-Za-z0-9._+-]+\s*(?:<=|>=|<|>|≤|≥)\s*[A-Za-z0-9._+-]+(?:\s*[A-Za-z%]+)?/g,
    spaceAsciiEdges: true,
  },
];

/**
 * 在中文与英文字母/数字间智能补全清晰半角空格，同时保护邮箱、URL、日期（如 2025年09月）与物理不等式（如 E < 10 MeV）。
 */
export function formatCjkSpacing(input: string): string {
  if (!input) return input;

  const masked: MaskedEntry[] = [];
  let working = input;

  for (const rule of PROTECTED_PATTERNS) {
    working = working.replace(rule.pattern, (match) => {
      const token = `\uE000${masked.length}\uE001`;
      masked.push({ text: match, spaceAsciiEdges: rule.spaceAsciiEdges });
      return token;
    });
  }

  working = working
    .replace(CJK_BEFORE_ASCII, '$1 $2')
    .replace(ASCII_BEFORE_CJK, '$1 $2');

  // Re-insert masked spans and add edge space between CJK and ASCII-edged tokens (URLs, emails, inequalities)
  working = working.replace(
    new RegExp(`(${CJK_CHAR})?\uE000(\\d+)\uE001(${CJK_CHAR})?`, 'g'),
    (_, leftCjk: string | undefined, idxStr: string, rightCjk: string | undefined) => {
      const entry = masked[Number(idxStr)];
      if (!entry) return '';
      const span = entry.text;
      let out = '';
      if (leftCjk) {
        out += leftCjk;
        if (entry.spaceAsciiEdges && /^[A-Za-z0-9]/.test(span)) {
          out += ' ';
        }
      }
      out += span;
      if (rightCjk) {
        if (entry.spaceAsciiEdges && /[A-Za-z0-9%]$/.test(span)) {
          out += ' ';
        }
        out += rightCjk;
      }
      return out;
    },
  );

  return working;
}

export function applyCjkSpacingToDocument(doc: ResumeDocument): ResumeDocument {
  const customDataEntries = Object.entries(doc.customData).map(([sectionId, items]) => [
    sectionId,
    items.map((item) => ({
      ...item,
      title: formatCjkSpacing(item.title),
      subtitle: formatCjkSpacing(item.subtitle),
      description: formatCjkSpacing(item.description),
    })),
  ]);

  return {
    ...doc,
    basic: {
      ...doc.basic,
      title: formatCjkSpacing(doc.basic.title),
      employmentStatus: formatCjkSpacing(doc.basic.employmentStatus),
      customFields: doc.basic.customFields.map((cf) => ({
        ...cf,
        value: formatCjkSpacing(cf.value),
      })),
    },
    education: doc.education.map((edu) => ({
      ...edu,
      school: formatCjkSpacing(edu.school),
      major: formatCjkSpacing(edu.major),
      degree: formatCjkSpacing(edu.degree),
      gpa: formatCjkSpacing(edu.gpa),
      description: formatCjkSpacing(edu.description),
    })),
    experience: doc.experience.map((exp) => ({
      ...exp,
      company: formatCjkSpacing(exp.company),
      position: formatCjkSpacing(exp.position),
      location: formatCjkSpacing(exp.location),
      description: formatCjkSpacing(exp.description),
    })),
    projects: doc.projects.map((proj) => ({
      ...proj,
      name: formatCjkSpacing(proj.name),
      role: formatCjkSpacing(proj.role),
      linkLabel: formatCjkSpacing(proj.linkLabel),
      description: formatCjkSpacing(proj.description),
    })),
    skillContent: formatCjkSpacing(doc.skillContent),
    selfEvaluationContent: formatCjkSpacing(doc.selfEvaluationContent),
    customData: Object.fromEntries(customDataEntries),
  };
}
