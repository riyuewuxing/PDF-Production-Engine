import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { GlobalSettings, ResumeDocument } from '../schema/resumeSchema';
import { getBasicMetaItems, getOrderedVisibleSections } from '../templates/shared';
import { formatCjkSpacing } from './cjkSpacing';
import { getLocaleLabels } from './resumeLocale';
import { visibleBasicValue } from './aiContext';
import { parseRichTextBlocks } from './richText';

export interface DocxFontPair {
  eastAsia: string;
  ascii: string;
  hAnsi: string;
  cs: string;
}

export interface DocxExportOptions {
  photoBuffer?: Uint8Array;
  photoType?: 'png' | 'jpg';
}

const DOCX_FONT_PRESETS: Record<GlobalSettings['fontFamily'], DocxFontPair> = {
  sans: {
    eastAsia: 'Noto Sans SC',
    ascii: 'Noto Sans SC',
    hAnsi: 'Noto Sans SC',
    cs: 'Noto Sans SC',
  },
  serif: {
    eastAsia: 'Noto Serif SC',
    ascii: 'Noto Serif SC',
    hAnsi: 'Noto Serif SC',
    cs: 'Noto Serif SC',
  },
  misans: {
    eastAsia: 'MiSans',
    ascii: 'MiSans',
    hAnsi: 'MiSans',
    cs: 'MiSans',
  },
  yahei: {
    eastAsia: 'Microsoft YaHei',
    ascii: 'Microsoft YaHei',
    hAnsi: 'Microsoft YaHei',
    cs: 'Microsoft YaHei',
  },
  kaiti: {
    eastAsia: 'KaiTi',
    ascii: 'KaiTi',
    hAnsi: 'KaiTi',
    cs: 'KaiTi',
  },
  fangsong: {
    eastAsia: 'FangSong',
    ascii: 'FangSong',
    hAnsi: 'FangSong',
    cs: 'FangSong',
  },
  hei: {
    eastAsia: 'SimHei',
    ascii: 'SimHei',
    hAnsi: 'SimHei',
    cs: 'SimHei',
  },
  tech: {
    eastAsia: 'Noto Sans SC',
    ascii: 'Segoe UI',
    hAnsi: 'Segoe UI',
    cs: 'Segoe UI',
  },
};

export function resolveDocxFontPair(globalSettings: GlobalSettings): DocxFontPair {
  const custom = globalSettings.customFontFamily?.trim().replace(/["\\]/g, '');
  if (custom) {
    return {
      eastAsia: custom,
      ascii: custom,
      hAnsi: custom,
      cs: custom,
    };
  }
  return DOCX_FONT_PRESETS[globalSettings.fontFamily ?? 'sans'] ?? DOCX_FONT_PRESETS.sans;
}

function detectImageType(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  return null;
}

function decodeBase64DataUrl(dataUrl: string): { bytes: Uint8Array; type: 'png' | 'jpg' } | null {
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim());
  if (!match || !match[1] || !match[2]) return null;
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  const kind = match[1].toLowerCase() === 'png' ? 'png' : 'jpg';
  return { bytes, type: detectImageType(bytes) ?? kind };
}

function resolveDocxPhoto(
  doc: ResumeDocument,
  options?: DocxExportOptions,
): { bytes: Uint8Array; type: 'png' | 'jpg' } | null {
  if (!doc.basic.photoConfig.visible) return null;
  if (options?.photoBuffer && options.photoBuffer.byteLength > 0) {
    const detected = detectImageType(options.photoBuffer) ?? options.photoType;
    if (!detected) return null;
    return { bytes: options.photoBuffer, type: detected };
  }
  if (doc.basic.photo.trim().startsWith('data:image/')) {
    return decodeBase64DataUrl(doc.basic.photo);
  }
  return null;
}

function toWordColorHex(hex: string, fallback = '1E293B'): string {
  const clean = hex.replace('#', '').trim();
  return /^[0-9a-fA-F]{6}$/.test(clean) ? clean.toUpperCase() : fallback;
}

function parseInlineRuns(
  rawLine: string,
  opts: { basePt: number; color?: string; autoCjkSpacing: boolean; font: DocxFontPair },
): TextRun[] {
  const cleanLine = rawLine.replace(/<[^>]+>/g, '');
  const formatted = opts.autoCjkSpacing ? formatCjkSpacing(cleanLine) : cleanLine;
  const runs: TextRun[] = [];
  const boldRegex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = boldRegex.exec(formatted)) !== null) {
    if (match.index > lastIdx) {
      runs.push(
        new TextRun({
          text: formatted.slice(lastIdx, match.index),
          size: opts.basePt * 2,
          color: opts.color ?? '1E293B',
          font: opts.font,
        }),
      );
    }
    runs.push(
      new TextRun({
        text: match[1] ?? '',
        bold: true,
        size: opts.basePt * 2,
        color: opts.color ?? '0F172A',
        font: opts.font,
      }),
    );
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < formatted.length) {
    runs.push(
      new TextRun({
        text: formatted.slice(lastIdx),
        size: opts.basePt * 2,
        color: opts.color ?? '1E293B',
        font: opts.font,
      }),
    );
  }
  return runs.length > 0
    ? runs
    : [new TextRun({ text: formatted, size: opts.basePt * 2, font: opts.font })];
}

function buildRichParagraphs(
  rawContent: string,
  opts: { basePt: number; autoCjkSpacing: boolean; font: DocxFontPair },
): Paragraph[] {
  const blocks = parseRichTextBlocks(rawContent);
  if (blocks.length === 0) return [];
  const paragraphs: Paragraph[] = [];

  for (const block of blocks) {
    if (block.type === 'ul' || block.type === 'ol') {
      block.items.forEach((tokens, idx) => {
        const plain = tokens
          .map((t) => {
            if (t.type === 'text') return t.value;
            if (t.type === 'bold') {
              const inner = t.children.map((c) => (c.type === 'text' ? c.value : '')).join('');
              return `**${inner}**`;
            }
            if (t.type === 'italic') {
              return t.children.map((c) => (c.type === 'text' ? c.value : '')).join('');
            }
            return ' ';
          })
          .join('');
        const prefix = block.type === 'ol' ? `${idx + 1}. ` : '• ';
        paragraphs.push(
          new Paragraph({
            spacing: { after: 60, line: 276 },
            indent: { left: 260, hanging: 160 },
            children: [
              new TextRun({
                text: prefix,
                bold: true,
                size: opts.basePt * 2,
                color: '334155',
                font: opts.font,
              }),
              ...parseInlineRuns(plain, opts),
            ],
          }),
        );
      });
    } else {
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
      if (plain.trim()) {
        paragraphs.push(
          new Paragraph({
            spacing: { after: 70, line: 276 },
            children: parseInlineRuns(plain, opts),
          }),
        );
      }
    }
  }

  return paragraphs;
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const BORDERLESS_CELL = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
} as const;

export function buildResumeDocxDocument(
  doc: ResumeDocument,
  options?: DocxExportOptions,
): Document {
  const accentHex = toWordColorHex(doc.globalSettings.themeColor, '167883');
  const basePt = Math.max(
    9.5,
    Math.min(12, Math.round(doc.globalSettings.baseFontSize * 0.72 * 2) / 2),
  );
  const autoCjk = Boolean(doc.globalSettings.autoCjkSpacing);
  const labels = getLocaleLabels(doc.globalSettings.locale);
  const font = resolveDocxFontPair(doc.globalSettings);
  const fmt = (txt: string) => (autoCjk ? formatCjkSpacing(txt) : txt);
  const basicEnabled = doc.menuSections.some(s => s.id === 'basic' && s.enabled);
  const resolvedPhoto = basicEnabled ? resolveDocxPhoto(doc, options) : null;
  const metaItems = basicEnabled ? getBasicMetaItems(doc) : [];
  const name = visibleBasicValue(doc, 'name').trim() || labels.unnamed;
  const role = visibleBasicValue(doc, 'title').trim();
  const headingBold = doc.globalSettings.headingWeight !== 'normal';

  const children: Array<Paragraph | Table> = [];

  if (resolvedPhoto) {
    const leftParas: Paragraph[] = [
      new Paragraph({
        spacing: { after: 70 },
        children: [
          new TextRun({
            text: name,
            bold: headingBold,
            size: 36,
            color: '0F172A',
            font,
          }),
        ],
      }),
    ];
    if (role) {
      leftParas.push(
        new Paragraph({
          spacing: { after: 70 },
          children: [
            new TextRun({
              text: `${labels.targetRole}${fmt(role)}`,
              bold: true,
              size: (basePt + 1) * 2,
              color: accentHex,
              font,
            }),
          ],
        }),
      );
    }
    if (metaItems.length > 0) {
      leftParas.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({
              text: metaItems.map((m) => `${m.label}${labels.colon}${m.value}`).join('  |  '),
              size: (basePt - 0.5) * 2,
              color: '475569',
              font,
            }),
          ],
        }),
      );
    }

    const cfgW = Math.max(40, doc.basic.photoConfig.width || 90);
    const cfgH = Math.max(40, doc.basic.photoConfig.height || 120);
    const targetWidth = 74;
    const targetHeight = Math.max(64, Math.min(112, Math.round((targetWidth * cfgH) / cfgW)));

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          ...BORDERLESS_CELL,
          insideHorizontal: NO_BORDER,
          insideVertical: NO_BORDER,
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 78, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.CENTER,
                borders: BORDERLESS_CELL,
                children: leftParas,
              }),
              new TableCell({
                width: { size: 22, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.CENTER,
                borders: BORDERLESS_CELL,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new ImageRun({
                        data: resolvedPhoto.bytes,
                        type: resolvedPhoto.type,
                        transformation: {
                          width: targetWidth,
                          height: targetHeight,
                        },
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    );

    children.push(
      new Paragraph({
        spacing: { before: 40, after: 140 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 8, color: accentHex },
        },
        children: [new TextRun({ text: '', size: 4, font })],
      }),
    );
  } else {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: name,
            bold: headingBold,
            size: 36,
            color: '0F172A',
            font,
          }),
        ],
      }),
    );

    if (role) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: `${labels.targetRole}${fmt(role)}`,
              bold: true,
              size: (basePt + 1) * 2,
              color: accentHex,
              font,
            }),
          ],
        }),
      );
    }

    if (metaItems.length > 0) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 180 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 8, color: accentHex },
          },
          children: [
            new TextRun({
              text: metaItems.map((m) => `${m.label}${labels.colon}${m.value}`).join('  |  '),
              size: (basePt - 0.5) * 2,
              color: '475569',
              font,
            }),
          ],
        }),
      );
    }
  }

  const buildSectionHeading = (title: string, pageBreakBefore: boolean): Paragraph =>
    new Paragraph({
      pageBreakBefore,
      outlineLevel: 0,
      spacing: { before: 180, after: 100 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 12, color: accentHex },
      },
      children: [
        new TextRun({
          text: fmt(title),
          bold: headingBold,
          size: (basePt + 2.5) * 2,
          color: accentHex,
          font,
        }),
      ],
    });

  const buildRowHeader = (leftTitle: string, subTitle: string, rightDate: string): Paragraph =>
    new Paragraph({
      outlineLevel: 1,
      spacing: { before: 80, after: 40 },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({
          text: fmt(leftTitle),
          bold: true,
          size: (basePt + 0.5) * 2,
          color: '0F172A',
          font,
        }),
        ...(subTitle
          ? [new TextRun({ text: `   ${fmt(subTitle)}`, size: basePt * 2, color: '334155', font })]
          : []),
        ...(rightDate
          ? [new TextRun({ text: `\t${rightDate}`, size: (basePt - 0.5) * 2, color: '64748B', font })]
          : []),
      ],
    });

  for (const section of getOrderedVisibleSections(doc)) {
    children.push(buildSectionHeading(section.title, Boolean(section.pageBreakBefore)));

    if (section.id === 'education') {
      for (const edu of doc.education.filter((e) => e.visible)) {
        const sub = [edu.major, edu.degree ? `${labels.openParen}${edu.degree}${labels.closeParen}` : '']
          .filter(Boolean)
          .join('');
        const date = [edu.startDate, edu.endDate].filter(Boolean).join(' - ');
        children.push(buildRowHeader(edu.school, sub, date));
        if (edu.gpa.trim()) {
          children.push(
            new Paragraph({
              spacing: { after: 40 },
              children: [
                new TextRun({
                  text: `GPA: ${fmt(edu.gpa.trim())}`,
                  size: (basePt - 0.5) * 2,
                  color: '475569',
                  font,
                }),
              ],
            }),
          );
        }
        if (edu.description.trim()) {
          children.push(
            ...buildRichParagraphs(edu.description, { basePt, autoCjkSpacing: autoCjk, font }),
          );
        }
      }
      continue;
    }

    if (section.id === 'experience') {
      for (const exp of doc.experience.filter((e) => e.visible)) {
        const date = [exp.startDate, exp.endDate].filter(Boolean).join(' - ');
        const sub = [exp.position, exp.location].filter(Boolean).join(' · ');
        children.push(buildRowHeader(exp.company, sub, date));
        if (exp.description.trim()) {
          children.push(
            ...buildRichParagraphs(exp.description, { basePt, autoCjkSpacing: autoCjk, font }),
          );
        }
      }
      continue;
    }

    if (section.id === 'projects') {
      for (const proj of doc.projects.filter((p) => p.visible)) {
        children.push(buildRowHeader(proj.name, proj.role, proj.date));
        if (proj.description.trim()) {
          children.push(
            ...buildRichParagraphs(proj.description, { basePt, autoCjkSpacing: autoCjk, font }),
          );
        }
      }
      continue;
    }

    if (section.id === 'skills') {
      children.push(
        ...buildRichParagraphs(doc.skillContent, { basePt, autoCjkSpacing: autoCjk, font }),
      );
      continue;
    }

    if (section.id === 'selfEvaluation') {
      children.push(
        ...buildRichParagraphs(doc.selfEvaluationContent, {
          basePt,
          autoCjkSpacing: autoCjk,
          font,
        }),
      );
      continue;
    }

    const customItems = (doc.customData[section.id] ?? []).filter((c) => c.visible);
    for (const item of customItems) {
      children.push(buildRowHeader(item.title, item.subtitle, item.dateRange));
      if (item.description.trim()) {
        children.push(
          ...buildRichParagraphs(item.description, { basePt, autoCjkSpacing: autoCjk, font }),
        );
      }
    }
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: {
            font,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 820, right: 880, bottom: 820, left: 880 },
          },
        },
        children,
      },
    ],
  });
}

export async function exportResumeToDocxBuffer(
  doc: ResumeDocument,
  options?: DocxExportOptions,
): Promise<Buffer> {
  const docxDoc = buildResumeDocxDocument(doc, options);
  return Packer.toBuffer(docxDoc);
}

export async function exportResumeToDocxBlob(
  doc: ResumeDocument,
  options?: DocxExportOptions,
): Promise<Blob> {
  const docxDoc = buildResumeDocxDocument(doc, options);
  return Packer.toBlob(docxDoc);
}
