import type { ResumeDocument } from '../schema/resumeSchema';

const HAS_HTML_TAG_REGEX = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function convertInlineHtmlToMarkdown(html: string): string {
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) => {
    const cleanInner = convertInlineHtmlToMarkdown(inner).trim();
    return cleanInner ? `**${cleanInner}**` : '';
  });
  out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) => {
    return convertInlineHtmlToMarkdown(inner);
  });
  // Strip remaining safe/unknown inline tags without dropping literal `< 10` inequalities
  out = out.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g, '');
  return decodeEntities(out);
}

/**
 * Converts legacy HTML (`<ul><li>...</li></ul>`, `<strong>`, `<p>`, `<br>`)
 * into clean Markdown (`- ...`, `**...**`). Idempotent on plain/Markdown text
 * and preserves literal math/physics inequalities like `E < 10 MeV`.
 */
export function htmlToCleanMarkdown(raw: string): string {
  if (!raw || !HAS_HTML_TAG_REGEX.test(raw)) {
    return raw;
  }

  let working = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const lines: string[] = [];

  // Process top-level blocks sequentially
  const blockRegex = /<(ul|ol|p|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushPlain = (fragment: string) => {
    const liMatches = [...fragment.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
    if (liMatches.length > 0) {
      for (const li of liMatches) {
        const text = convertInlineHtmlToMarkdown(li[1] ?? '')
          .replace(/\r?\n+/g, ' ')
          .trim();
        if (text) lines.push(`- ${text}`);
      }
      return;
    }
    const text = convertInlineHtmlToMarkdown(fragment).trim();
    if (text) {
      for (const l of text.split(/\r?\n/)) {
        const trimmed = l.trim();
        if (trimmed) lines.push(trimmed);
      }
    }
  };

  while ((match = blockRegex.exec(working)) !== null) {
    if (match.index > lastIndex) {
      pushPlain(working.slice(lastIndex, match.index));
    }
    const tag = (match[1] ?? '').toLowerCase();
    const inner = match[2] ?? '';

    if (tag === 'ul' || tag === 'ol') {
      const liMatches = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
      if (liMatches.length > 0) {
        liMatches.forEach((li, idx) => {
          const text = convertInlineHtmlToMarkdown(li[1] ?? '')
            .replace(/\r?\n+/g, ' ')
            .trim();
          if (text) {
            lines.push(tag === 'ol' ? `${idx + 1}. ${text}` : `- ${text}`);
          }
        });
      } else {
        pushPlain(inner);
      }
    } else {
      pushPlain(inner);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < working.length) {
    pushPlain(working.slice(lastIndex));
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function cleanResumeRichText(doc: ResumeDocument): ResumeDocument {
  const cleanCustomData: ResumeDocument['customData'] = {};
  for (const [secId, items] of Object.entries(doc.customData)) {
    cleanCustomData[secId] = items.map((item) => ({
      ...item,
      description: htmlToCleanMarkdown(item.description),
    }));
  }

  return {
    ...doc,
    education: doc.education.map((edu) => ({
      ...edu,
      description: htmlToCleanMarkdown(edu.description),
    })),
    experience: doc.experience.map((exp) => ({
      ...exp,
      description: htmlToCleanMarkdown(exp.description),
    })),
    projects: doc.projects.map((proj) => ({
      ...proj,
      description: htmlToCleanMarkdown(proj.description),
    })),
    skillContent: htmlToCleanMarkdown(doc.skillContent),
    selfEvaluationContent: htmlToCleanMarkdown(doc.selfEvaluationContent),
    customData: cleanCustomData,
  };
}
