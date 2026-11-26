import type { ResumeDocument } from '../schema/resumeSchema';
import { getBasicMetaItems, getOrderedVisibleSections, resolveFontFamilyStack } from '../templates/shared';
import { getLocaleLabels } from './resumeLocale';
import { visibleBasicValue } from './aiContext';
import { parseRichTextBlocks } from './richText';

export interface StandaloneHtmlOptions {
  embeddedPhotoDataUrl?: string;
}

export function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function renderInlineMarkdownToHtml(raw: string): string {
  let out = '';
  const boldRegex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = boldRegex.exec(raw)) !== null) {
    if (match.index > lastIdx) {
      out += escapeHtml(raw.slice(lastIdx, match.index));
    }
    out += `<strong>${escapeHtml(match[1] ?? '')}</strong>`;
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < raw.length) {
    out += escapeHtml(raw.slice(lastIdx));
  }
  return out;
}

function renderRichTextToHtml(rawContent: string): string {
  const blocks = parseRichTextBlocks(rawContent);
  if (blocks.length === 0) return '';
  return blocks
    .map((block) => {
      if (block.type === 'ul' || block.type === 'ol') {
        const tag = block.type === 'ol' ? 'ol' : 'ul';
        const itemsHtml = block.items
          .map((tokens) => {
            const plain = tokens
              .map((t) => {
                if (t.type === 'text') return t.value;
                if (t.type === 'bold') {
                  return `**${t.children.map((c) => (c.type === 'text' ? c.value : '')).join('')}**`;
                }
                if (t.type === 'italic') {
                  return t.children.map((c) => (c.type === 'text' ? c.value : '')).join('');
                }
                return ' ';
              })
              .join('');
            return `<li>${renderInlineMarkdownToHtml(plain)}</li>`;
          })
          .join('');
        return `<${tag}>${itemsHtml}</${tag}>`;
      }
      const plain = block.content
        .map((t) => {
          if (t.type === 'text') return t.value;
          if (t.type === 'bold') {
            return `**${t.children.map((c) => (c.type === 'text' ? c.value : '')).join('')}**`;
          }
          if (t.type === 'italic') {
            return t.children.map((c) => (c.type === 'text' ? c.value : '')).join('');
          }
          return ' ';
        })
        .join('');
      return plain.trim() ? `<p>${renderInlineMarkdownToHtml(plain)}</p>` : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * 构建完全自包含的单文件离线 HTML 个人简历主页：
 * 零外网 CDN/字体请求、支持明暗模式切换、严格 `escapeHtml` 防 XSS 注入、支持内嵌 Base64 证件照。
 */
export function buildStandaloneResumeHtml(
  doc: ResumeDocument,
  options?: StandaloneHtmlOptions,
): string {
  const labels = getLocaleLabels(doc.globalSettings.locale);
  const accent = /^#[0-9a-fA-F]{6}$/.test(doc.globalSettings.themeColor)
    ? doc.globalSettings.themeColor
    : '#167883';
  const fontStack = resolveFontFamilyStack(doc.globalSettings).replaceAll('"', "'");
  const basicEnabled = doc.menuSections.some(s => s.id === 'basic' && s.enabled);
  const metaItems = basicEnabled ? getBasicMetaItems(doc) : [];
  const sections = getOrderedVisibleSections(doc);
  const photoUrl =
    basicEnabled && doc.basic.photoConfig.visible && options?.embeddedPhotoDataUrl?.startsWith('data:image/')
      ? options.embeddedPhotoDataUrl
      : basicEnabled && doc.basic.photoConfig.visible && doc.basic.photo.trim().startsWith('data:image/')
        ? doc.basic.photo.trim()
        : '';

  const sectionHtmlParts = sections.map((section) => {
    let body = '';
    if (section.id === 'education') {
      body = doc.education
        .filter((e) => e.visible)
        .map((edu) => {
          const degreePart = edu.degree ? `${labels.openParen}${escapeHtml(edu.degree)}${labels.closeParen}` : '';
          const dates = [edu.startDate, edu.endDate].filter(Boolean).join(' - ');
          return `<article class="item">
            <div class="row">
              <h3>${escapeHtml(edu.school)} <span class="sub">${escapeHtml(edu.major)}${degreePart}</span></h3>
              ${dates ? `<span class="date">${escapeHtml(dates)}</span>` : ''}
            </div>
            ${edu.gpa ? `<div class="meta">GPA: ${escapeHtml(edu.gpa)}</div>` : ''}
            ${edu.description ? `<div class="rich">${renderRichTextToHtml(edu.description)}</div>` : ''}
          </article>`;
        })
        .join('\n');
    } else if (section.id === 'experience') {
      body = doc.experience
        .filter((e) => e.visible)
        .map((exp) => {
          const dates = [exp.startDate, exp.endDate].filter(Boolean).join(' - ');
          return `<article class="item">
            <div class="row">
              <h3>${escapeHtml(exp.company)} ${exp.position ? `<span class="sub">${escapeHtml(exp.position)}</span>` : ''} ${exp.location ? `<span class="loc">${escapeHtml(exp.location)}</span>` : ''}</h3>
              ${dates ? `<span class="date">${escapeHtml(dates)}</span>` : ''}
            </div>
            ${exp.description ? `<div class="rich">${renderRichTextToHtml(exp.description)}</div>` : ''}
          </article>`;
        })
        .join('\n');
    } else if (section.id === 'projects') {
      body = doc.projects
        .filter((p) => p.visible)
        .map((proj) => {
          const safeHref = safeExternalUrl(proj.link);
          const linkHtml = safeHref
            ? ` <a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(proj.linkLabel || labels.link)}</a>`
            : '';
          return `<article class="item">
            <div class="row">
              <h3>${escapeHtml(proj.name)} ${proj.role ? `<span class="sub">${escapeHtml(proj.role)}</span>` : ''}${linkHtml}</h3>
              ${proj.date ? `<span class="date">${escapeHtml(proj.date)}</span>` : ''}
            </div>
            ${proj.description ? `<div class="rich">${renderRichTextToHtml(proj.description)}</div>` : ''}
          </article>`;
        })
        .join('\n');
    } else if (section.id === 'skills') {
      body = `<div class="rich">${renderRichTextToHtml(doc.skillContent)}</div>`;
    } else if (section.id === 'selfEvaluation') {
      body = `<div class="rich">${renderRichTextToHtml(doc.selfEvaluationContent)}</div>`;
    } else {
      body = (doc.customData[section.id] ?? [])
        .filter((c) => c.visible)
        .map(
          (item) => `<article class="item">
            <div class="row">
              <h3>${escapeHtml(item.title)} ${item.subtitle ? `<span class="sub">${escapeHtml(item.subtitle)}</span>` : ''}</h3>
              ${item.dateRange ? `<span class="date">${escapeHtml(item.dateRange)}</span>` : ''}
            </div>
            ${item.description ? `<div class="rich">${renderRichTextToHtml(item.description)}</div>` : ''}
          </article>`,
        )
        .join('\n');
    }

    return `<section class="sec">
      <h2>${escapeHtml(section.title)}</h2>
      ${body}
    </section>`;
  });

  const name = visibleBasicValue(doc, 'name').trim() || labels.unnamed;
  const role = visibleBasicValue(doc, 'title').trim();
  const pageTitle = [name, role].filter(Boolean).join(' - ');
  const isEn = doc.globalSettings.locale === 'en-US';

  return `<!doctype html>
<html lang="${isEn ? 'en' : 'zh-CN'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    :root {
      --bg: #f1f5f9;
      --paper: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --border: #e2e8f0;
      --accent: ${accent};
    }
    html[data-theme="dark"] {
      --bg: #0b1120;
      --paper: #111827;
      --text: #f8fafc;
      --muted: #94a3b8;
      --border: #1e293b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px 16px;
      background: var(--bg);
      color: var(--text);
      font-family: ${fontStack};
      font-size: ${doc.globalSettings.baseFontSize}px;
      line-height: ${Math.max(1.4, doc.globalSettings.lineHeight)};
      font-variant-numeric: tabular-nums;
      transition: background 0.2s, color 0.2s;
    }
    .toolbar {
      max-width: 840px;
      margin: 0 auto 14px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .toolbar button {
      border: 1px solid var(--border);
      background: var(--paper);
      color: var(--text);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
    }
    .sheet {
      max-width: 840px;
      margin: 0 auto;
      background: var(--paper);
      border: 1px solid var(--border);
      border-top: 5px solid var(--accent);
      border-radius: 10px;
      padding: 36px 42px;
      box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);
    }
    .hero {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 18px;
      margin-bottom: 22px;
    }
    .hero h1 { margin: 0; font-size: 1.9em; line-height: 1.2; }
    .role { margin-top: 6px; font-weight: 600; color: var(--accent); font-size: 1.08em; }
    .meta-list {
      margin-top: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      color: var(--muted);
      font-size: 0.92em;
    }
    .portrait {
      width: ${Math.min(110, doc.basic.photoConfig.width)}px;
      height: ${Math.min(145, doc.basic.photoConfig.height)}px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid var(--border);
      flex-shrink: 0;
    }
    .sec { margin-bottom: 20px; }
    .sec h2 {
      margin: 0 0 10px;
      font-size: 1.15em;
      color: var(--accent);
      border-left: 4px solid var(--accent);
      padding-left: 10px;
    }
    .item { margin-bottom: 12px; }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 6px 14px;
    }
    .row h3 { margin: 0; font-size: 1.02em; }
    .sub { font-weight: 500; color: var(--muted); margin-left: 6px; }
    .loc, .date, .meta { font-size: 0.9em; color: var(--muted); }
    .rich ul, .rich ol { margin: 5px 0 0; padding-left: 18px; }
    .rich p { margin: 5px 0 0; }
    a { color: var(--accent); }
    @media print {
      body { padding: 0; background: #fff; }
      .toolbar { display: none !important; }
      .sheet { box-shadow: none; border: none; padding: 20px 26px; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'">
      ${isEn ? 'Toggle Theme' : '切换明暗主题'}
    </button>
    <button type="button" onclick="window.print()">${isEn ? 'Print / PDF' : '打印 / 存为 PDF'}</button>
  </div>
  <main class="sheet">
    <header class="hero">
      <div>
        <h1>${escapeHtml(name)}</h1>
        ${role ? `<div class="role">${escapeHtml(labels.targetRole)}${escapeHtml(role)}</div>` : ''}
        ${
          metaItems.length > 0
            ? `<div class="meta-list">${metaItems
                .map((m) => `<span>${escapeHtml(m.label)}${escapeHtml(labels.colon)}${escapeHtml(m.value)}</span>`)
                .join('')}</div>`
            : ''
        }
      </div>
      ${photoUrl ? `<img class="portrait" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}" />` : ''}
    </header>
    ${sectionHtmlParts.join('\n')}
  </main>
</body>
</html>
`;
}
