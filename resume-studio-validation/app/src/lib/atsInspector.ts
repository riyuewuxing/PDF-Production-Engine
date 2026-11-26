/**
 * 真 ATS 逆向机读体检引擎。
 *
 * 工作方式：把「已渲染的 PDF」再读回来，模拟招聘系统（ATS）真正拿到的文本流，
 * 从而暴露双栏串行、字体缺字、联系方式丢失、章节标题读不出等真实机读问题。
 *
 * 设计约束：
 * - 本文件所有分析函数为**纯 TypeScript**，不 import `pdfjs-dist`、不 import `apiClient`（静态），
 *   保证 `atsInspector.test.ts` 在 Node/jsdom 下毫秒级通过。
 * - 需要真正渲染 PDF 的链路（`runLiveAtsInspection`）通过**动态 import** 延迟加载，
 *   不把浏览器/Electron 依赖污染到纯函数测试路径。
 */

import { extractJdKeywords, matchResumeWithJd } from './jdMatcher';
import {
  type ExtractedPdfPageTokens,
  INTERLEAVE_GAP_THRESHOLD,
  countInterleavedLines,
  reconstructLinesFromTextItems,
  reconstructLinesWithColumnAwareness,
  summarizeColumnLayout,
} from './pdfTextLayout';
import type { ResumeDocument } from '../schema/resumeSchema';
import {visibleBasicValue} from './aiContext';

export type AtsCheckSeverity = 'pass' | 'warn' | 'error';

export interface AtsCheck {
  id: string;
  label: string;
  severity: AtsCheckSeverity;
  detail: string;
  /** 该项命中的扣分（0 表示未扣分） */
  penalty: number;
}

export interface AtsInspectionResult {
  score: number;
  generatedAt: string;
  pageCount: number;
  charCount: number;
  /** 朴素重建：等价于大多数 ATS 看到的原始文本流 */
  rawExtractedText: string;
  /** 双栏感知重建：等价于人类阅读顺序 */
  columnAwareText: string;
  columnsDetected: boolean;
  columnPageCount: number;
  interleavedLineCount: number;
  garbledCharCount: number;
  /** 康熙部首 / CJK 兼容字符数量（字形被错误映射，关键词匹配必失败） */
  compatCharCount: number;
  coverageRatio: number;
  jdPdfHitRate: number | null;
  jdMissedInPdfOnly: string[];
  checks: AtsCheck[];
}

const PENALTY = {
  missingName: 18,
  missingPhone: 12,
  missingEmail: 12,
  interleaveSevere: 15,
  interleaveMild: 8,
  garbled: 10,
  compatGlyphs: 15,
  sectionHeading: 4,
  sectionHeadingCap: 12,
  lowCoverage: 10,
  lowJdHit: 10,
  midJdHit: 5,
} as const;

/**
 * 归一化：NFKC 折叠（康熙部首/兼容汉字/全角字符统一折叠为标准字形）、
 * 去零宽、去空白、转小写，用于抗排版差异的包含判断。
 *
 * 关键：真实导出的 PDF 中「大」常被读成「⼤」(U+2F24)、「高」读成「⾼」(U+2F80)，
 * 不做 NFKC 就会导致所有中文关键词匹配失败。
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/[\s\u00a0]+/g, '')
    .toLowerCase();
}

/** 康熙部首（U+2E80–U+2FDF）、CJK 兼容汉字（U+F900–U+FAFF/FE30–U+FE4F） */
const CJK_COMPAT_PATTERN = /[\u2e80-\u2fdf\uf900-\ufaff\ufe30-\ufe4f]/gu;

/**
 * 统计被映射成康熙部首或兼容汉字的字符数。
 * 这类字符不会显示为乱码，但会让 ATS 的关键词匹配彻底失效。
 */
export function countCompatChars(text: string): number {
  const matches = text.match(CJK_COMPAT_PATTERN);
  return matches ? matches.length : 0;
}

/** 统计替换符与控制字符数量（字体缺字/编码错误的典型症状）。 */
export function countGarbledChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\ufffd') {
      count += 1;
      continue;
    }
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      count += 1;
      continue;
    }
    if (code >= 0x7f && code <= 0x9f) {
      count += 1;
    }
  }
  return count;
}

function joinPages(pages: readonly ExtractedPdfPageTokens[], columnAware: boolean): string {
  if (columnAware) {
    return reconstructLinesWithColumnAwareness(pages).join('\n');
  }
  return pages
    .map((page) => reconstructLinesFromTextItems(page.tokens).join('\n'))
    .filter(Boolean)
    .join('\n');
}

function sectionHasContent(doc: ResumeDocument, sectionId: string): boolean {
  switch (sectionId) {
    case 'education':
      return doc.education.some((item) => item.visible);
    case 'experience':
      return doc.experience.some((item) => item.visible);
    case 'projects':
      return doc.projects.some((item) => item.visible);
    case 'skills':
      return doc.skillContent.trim().length > 0;
    case 'selfEvaluation':
      return doc.selfEvaluationContent.trim().length > 0;
    default:
      return (doc.customData[sectionId] ?? []).some((item) => item.visible);
  }
}

/** 收集应当能在 PDF 文本中读到的实体名（用于内容覆盖率）。 */
export function collectExpectedEntities(doc: ResumeDocument): string[] {
  const entities: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length >= 2) entities.push(trimmed);
  };

  const enabled=new Set(doc.menuSections.filter(s=>s.enabled).map(s=>s.id));
  push(visibleBasicValue(doc,'name'));
  for (const field of doc.basic.customFields) {
    if (enabled.has('basic')&&field.visible) push(field.value);
  }
  for (const edu of doc.education) {
    if (!enabled.has('education')||!edu.visible) continue;
    push(edu.school);
    push(edu.gpa);
  }
  for (const exp of doc.experience) {
    if (!enabled.has('experience')||!exp.visible) continue;
    push(exp.company);
  }
  for (const proj of doc.projects) {
    if (!enabled.has('projects')||!proj.visible) continue;
    push(proj.name);
  }
  for (const section of doc.menuSections) {
    if(!section.enabled)continue;
    for (const item of doc.customData[section.id] ?? []) {
      if (item.visible) push(item.title);
    }
  }
  return Array.from(new Set(entities));
}

/**
 * 核心纯函数：对已抽取的 PDF 页面 token 做机读体检。
 *
 * @param doc 当前简历文档（提供姓名/电话/邮箱与章节期望值作对照组）
 * @param pages 已抽取的逐页 token
 * @param jdText 可选招聘 JD，用于核验「简历命中但 PDF 读不出」的关键词
 */
export function inspectAtsFromExtractedPages(
  doc: ResumeDocument,
  pages: readonly ExtractedPdfPageTokens[],
  jdText?: string,
): AtsInspectionResult {
  const rawExtractedText = joinPages(pages, false);
  const columnAwareText = joinPages(pages, true);
  const normalizedRaw = normalizeForMatch(rawExtractedText);
  const normalizedColumnAware = normalizeForMatch(columnAwareText);

  const layout = summarizeColumnLayout(pages);
  const interleavedLineCount = countInterleavedLines(pages, INTERLEAVE_GAP_THRESHOLD);
  const garbledCharCount = countGarbledChars(rawExtractedText);
  const compatCharCount = countCompatChars(rawExtractedText);

  const checks: AtsCheck[] = [];

  // 1. 联系方式与姓名可读性
  const contactChecks: Array<{
    id: string;
    label: string;
    value: string;
    penalty: number;
    isEmail?: boolean;
    isPhone?: boolean;
  }> = [
    { id: 'contact-name', label: '姓名可机读', value: visibleBasicValue(doc,'name'), penalty: PENALTY.missingName },
    { id: 'contact-phone', label: '手机号可机读', value: visibleBasicValue(doc,'phone'), penalty: PENALTY.missingPhone, isPhone: true },
    { id: 'contact-email', label: '邮箱可机读', value: visibleBasicValue(doc,'email'), penalty: PENALTY.missingEmail, isEmail: true },
  ];

  for (const item of contactChecks) {
    const expected = item.value.trim();
    if (!expected) {
      checks.push({
        id: item.id,
        label: item.label,
        severity: 'pass',
        detail: '该字段未填写或未显示，跳过核验。',
        penalty: 0,
      });
      continue;
    }
    const normalizedExpected = normalizeForMatch(expected);
    const hitRaw = normalizedRaw.includes(normalizedExpected);
    const hitColumnAware = normalizedColumnAware.includes(normalizedExpected);
    if (hitRaw) {
      checks.push({
        id: item.id,
        label: item.label,
        severity: 'pass',
        detail: `ATS 原始文本流中可完整读出「${expected}」。`,
        penalty: 0,
      });
    } else if (hitColumnAware) {
      checks.push({
        id: item.id,
        label: item.label,
        severity: 'warn',
        detail: `「${expected}」在双栏感知顺序里存在，但 ATS 原始文本流中读不出——大概率被栏间串行或换行拆断。`,
        penalty: Math.round(item.penalty / 2),
      });
    } else {
      checks.push({
        id: item.id,
        label: item.label,
        severity: 'error',
        detail: `「${expected}」在 PDF 文本流中完全缺失，招聘系统无法解析。`,
        penalty: item.penalty,
      });
    }
  }

  // 2. 双栏交错串行
  if (interleavedLineCount >= 4) {
    checks.push({
      id: 'column-interleave',
      label: '版式可线性读取',
      severity: 'warn',
      detail: `检测到 ${interleavedLineCount} 行存在跨 ${INTERLEAVE_GAP_THRESHOLD}pt 空白沟的首尾拼接，双栏版式会让 ATS 把左右两栏读成同一句。建议改用单栏模板（minimal-ats / jakes-resume-cn / lapis-clean）。`,
      penalty: PENALTY.interleaveSevere,
    });
  } else if (interleavedLineCount > 0 || layout.hasColumns) {
    checks.push({
      id: 'column-interleave',
      label: '版式可线性读取',
      severity: 'warn',
      detail:
        interleavedLineCount > 0
          ? `检测到双栏版式且存在 ${interleavedLineCount} 行跨栏拼接，ATS 按 Y 坐标逐行抽取会交错打乱左右栏阅读顺序。`
          : `检测到双栏版式（${layout.columnPageCount} 页）：即使行高错开未同行合并，ATS 按自上而下抽取仍会交替穿插左右两栏内容，建议改用单栏模板。`,
      penalty: PENALTY.interleaveMild,
    });
  } else {
    checks.push({
      id: 'column-interleave',
      label: '版式可线性读取',
      severity: 'pass',
      detail: '未发现跨栏首尾拼接，文本流按阅读顺序线性可读。',
      penalty: 0,
    });
  }

  // 3. 字体缺字 / 乱码
  if (garbledCharCount > 0) {
    checks.push({
      id: 'garbled-glyphs',
      label: '字体渲染完整',
      severity: 'error',
      detail: `文本流中检出 ${garbledCharCount} 个乱码/控制字符，请排查自定义字体是否缺字或使用了不可嵌入字体。`,
      penalty: PENALTY.garbled,
    });
  } else {
    checks.push({
      id: 'garbled-glyphs',
      label: '字体渲染完整',
      severity: 'pass',
      detail: '未检出替换符或非法控制字符。',
      penalty: 0,
    });
  }

  // 4. 康熙部首 / 兼容汉字污染
  if (compatCharCount > 0) {
    checks.push({
      id: 'compat-glyphs',
      label: '汉字字形未被降级',
      severity: 'error',
      detail: `检出 ${compatCharCount} 个汉字被映射为康熙部首或 CJK 兼容字符（如「大」→「⼤」、「高」→「⾼」）。这类字符不会显示为乱码，但 ATS 做「示例大学」这类关键词匹配时必然对不上。请更换嵌入字体或修正字体子集的 ToUnicode 映射。`,
      penalty: PENALTY.compatGlyphs,
    });
  } else {
    checks.push({
      id: 'compat-glyphs',
      label: '汉字字形未被降级',
      severity: 'pass',
      detail: '未检出康熙部首/兼容汉字替换。',
      penalty: 0,
    });
  }

  // 5. 章节标题可读性
  const expectedHeadings = doc.menuSections.filter(
    (section) => section.enabled && section.id !== 'basic' && sectionHasContent(doc, section.id),
  );
  const missingHeadings: string[] = [];
  for (const section of expectedHeadings) {
    const normalizedTitle = normalizeForMatch(section.title);
    const hit =
      (normalizedTitle.length > 0 && normalizedRaw.includes(normalizedTitle)) ||
      (normalizedTitle.length >= 2 && normalizedRaw.includes(normalizedTitle.slice(0, 2)));
    if (!hit) missingHeadings.push(section.title);
  }
  if (missingHeadings.length > 0) {
    checks.push({
      id: 'section-headings',
      label: '章节标题可机读',
      severity: 'warn',
      detail: `以下章节标题未能从 PDF 文本流中读出：${missingHeadings.join('、')}。可用图形化标题字或图片标题导致。`,
      penalty: Math.min(PENALTY.sectionHeading * missingHeadings.length, PENALTY.sectionHeadingCap),
    });
  } else {
    checks.push({
      id: 'section-headings',
      label: '章节标题可机读',
      severity: 'pass',
      detail: `${expectedHeadings.length} 个已启用章节的标题均可读出。`,
      penalty: 0,
    });
  }

  // 5. 内容覆盖率
  const entities = collectExpectedEntities(doc);
  const missingEntities = entities.filter(
    (entity) => !normalizedRaw.includes(normalizeForMatch(entity)),
  );
  const coverageRatio =
    entities.length === 0 ? 1 : (entities.length - missingEntities.length) / entities.length;
  if (coverageRatio < 0.85) {
    checks.push({
      id: 'content-coverage',
      label: '关键内容覆盖率',
      severity: 'warn',
      detail: `覆盖率仅 ${Math.round(coverageRatio * 100)}%，${missingEntities.length} 项实体未被读出：${missingEntities
        .slice(0, 6)
        .join('、')}${missingEntities.length > 6 ? ' 等' : ''}。`,
      penalty: PENALTY.lowCoverage,
    });
  } else {
    checks.push({
      id: 'content-coverage',
      label: '关键内容覆盖率',
      severity: 'pass',
      detail: `覆盖率 ${Math.round(coverageRatio * 100)}%，学校/公司/项目等关键实体均可读出。`,
      penalty: 0,
    });
  }

  // 6. JD 关键词在 PDF 中的实际命中
  let jdPdfHitRate: number | null = null;
  const jdMissedInPdfOnly: string[] = [];
  const trimmedJd = jdText?.trim() ?? '';
  if (trimmedJd) {
    const keywords = extractJdKeywords(trimmedJd);
    if (keywords.length > 0) {
      const pdfMatched = keywords.filter((kw) =>
        normalizedRaw.includes(normalizeForMatch(kw)),
      );
      jdPdfHitRate = Math.round((pdfMatched.length / keywords.length) * 100);

      const docMatch = matchResumeWithJd(doc, trimmedJd);
      for (const kw of docMatch.matchedKeywords) {
        if (!pdfMatched.includes(kw)) jdMissedInPdfOnly.push(kw);
      }

      if (jdPdfHitRate < 50) {
        checks.push({
          id: 'jd-pdf-match',
          label: 'JD 关键词在 PDF 中的命中率',
          severity: 'warn',
          detail: `PDF 文本流仅命中 ${pdfMatched.length}/${keywords.length} 个 JD 关键词（${jdPdfHitRate}%）。${
            jdMissedInPdfOnly.length > 0
              ? `其中 ${jdMissedInPdfOnly.length} 个词在简历正文里存在但 PDF 读不出：${jdMissedInPdfOnly
                  .slice(0, 6)
                  .join('、')}。`
              : ''
          }`,
          penalty: PENALTY.lowJdHit,
        });
      } else if (jdPdfHitRate < 80) {
        checks.push({
          id: 'jd-pdf-match',
          label: 'JD 关键词在 PDF 中的命中率',
          severity: 'warn',
          detail: `PDF 文本流命中 ${pdfMatched.length}/${keywords.length} 个 JD 关键词（${jdPdfHitRate}%），仍有关键词未被机读。`,
          penalty: PENALTY.midJdHit,
        });
      } else {
        checks.push({
          id: 'jd-pdf-match',
          label: 'JD 关键词在 PDF 中的命中率',
          severity: 'pass',
          detail: `PDF 文本流命中 ${pdfMatched.length}/${keywords.length} 个 JD 关键词（${jdPdfHitRate}%）。`,
          penalty: 0,
        });
      }
    }
  }

  const totalPenalty = checks.reduce((sum, check) => sum + check.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));

  return {
    score,
    generatedAt: new Date().toISOString(),
    pageCount: pages.length,
    charCount: rawExtractedText.replace(/\s+/g, '').length,
    rawExtractedText,
    columnAwareText,
    columnsDetected: layout.hasColumns,
    columnPageCount: layout.columnPageCount,
    interleavedLineCount,
    garbledCharCount,
    compatCharCount,
    coverageRatio,
    jdPdfHitRate,
    jdMissedInPdfOnly,
    checks,
  };
}

/**
 * 实机链路：把当前文档渲染成 PDF（纯内存、不落盘）→ 抽 token → 跑体检。
 * 仅在 Resume Studio 桌面端可用。
 */
export async function runLiveAtsInspection(
  doc: ResumeDocument,
  jdText?: string,
): Promise<AtsInspectionResult> {
  const [{ apiClient }, { extractTokensFromPdfArrayBuffer }] = await Promise.all([
    import('./apiClient'),
    import('./pdfResumeImporter'),
  ]);
  const bytes = await apiClient.renderPdfBuffer(doc);
  const pages = await extractTokensFromPdfArrayBuffer(bytes);
  return inspectAtsFromExtractedPages(doc, pages, jdText);
}
