import { describe, expect, it } from 'vitest';
import {
  collectExpectedEntities,
  countCompatChars,
  countGarbledChars,
  inspectAtsFromExtractedPages,
  normalizeForMatch,
} from './atsInspector';
import type { ExtractedPdfPageTokens, PdfTextToken } from './pdfTextLayout';
import { ResumeDocumentSchema } from '../schema/resumeSchema';

function buildDoc(options: { skillContent?: string } = {}) {
  return ResumeDocumentSchema.parse({
    id: 'doc-ats',
    title: '张甲简历',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    templateId: 'minimal-ats',
    basic: {
      name: '张甲',
      title: '高中物理教师',
      email: 'demo@example.invalid',
      phone: '13800000000',
      location: '示例市',
    },
    menuSections: [
      { id: 'basic', title: '基本信息', order: 0 },
      { id: 'education', title: '教育经历', order: 1 },
      { id: 'experience', title: '工作经历', order: 2 },
      { id: 'skills', title: '专业技能', order: 3 },
      { id: 'selfEvaluation', title: '自我评价', order: 4 },
    ],
    education: [{ id: 'edu-1', school: '示例大学', major: '物理学', degree: '硕士' }],
    experience: [{ id: 'exp-1', company: '示例中学', position: '物理教师' }],
    skillContent: options.skillContent ?? '高中物理教师资格证、Python 仿真编程',
    selfEvaluationContent: '认真踏实，热爱一线物理教学。',
    globalSettings: { themeColor: '#167883' },
  });
}

function buildSingleColumnPage(): ExtractedPdfPageTokens {
  const rows: Array<{ str: string; y: number }> = [
    { str: '张甲', y: 790 },
    { str: '高中物理教师', y: 770 },
    { str: 'demo@example.invalid', y: 750 },
    { str: '13800000000', y: 732 },
    { str: '教育经历', y: 700 },
    { str: '示例大学 物理学 硕士', y: 682 },
    { str: '工作经历', y: 650 },
    { str: '示例中学 物理教师', y: 632 },
    { str: '专业技能', y: 600 },
    { str: '高中物理教师资格证、Python 仿真编程', y: 582 },
    { str: '自我评价', y: 550 },
    { str: '认真踏实，热爱一线物理教学。', y: 532 },
  ];
  return {
    pageIndex: 0,
    pageWidth: 595,
    pageHeight: 842,
    tokens: rows.map((row) => ({
      str: row.str,
      x: 40,
      y: row.y,
      width: row.str.length * 9,
    })),
  };
}

function buildTwoColumnPage(): ExtractedPdfPageTokens {
  const leftColumn = [
    '教育经历',
    '示例大学 物理学',
    '工作经历',
    '示例中学 物理教师',
    '专业技能',
    '高中物理教师资格证',
  ];
  const rightColumn = [
    '张甲',
    '13800000000',
    'demo@example.invalid',
    '示例市',
    '自我评价',
    '认真踏实热爱一线教学',
  ];
  const tokens: PdfTextToken[] = [];
  leftColumn.forEach((str, index) => {
    tokens.push({ str, x: 40, y: 700 - index * 30, width: 150 });
  });
  rightColumn.forEach((str, index) => {
    tokens.push({ str, x: 330, y: 700 - index * 30, width: 150 });
  });
  return { pageIndex: 0, pageWidth: 595, pageHeight: 842, tokens };
}

/**
 * 单栏「标题 + 右对齐日期」版式：行内有大空白沟，但右侧内容右端对齐、左端浮动。
 * 这是真实 PDF 上最容易把单栏误判成双栏的情形。
 */
function buildSingleColumnWithRightAlignedDates(): ExtractedPdfPageTokens {
  const rows: Array<{ left: string; right: string; rightWidth: number }> = [
    { left: '示例大学 示例理科方向（硕士）', right: '2022年09月- 2025年06月', rightWidth: 118 },
    { left: '示例师范大学 物理学（本科）', right: '2018年09月- 2022年06月', rightWidth: 96 },
    { left: '示例中学 物理教师', right: '2025年09月- 至今', rightWidth: 78 },
    { left: '某中学 实习教师', right: '2021年09月- 2021年12月', rightWidth: 104 },
    { left: '物理竞赛辅导', right: '2020年03月- 2020年06月', rightWidth: 88 },
    { left: '教学技能大赛', right: '2019年11月- 2019年12月', rightWidth: 100 },
  ];
  const tokens: PdfTextToken[] = [];
  rows.forEach((row, index) => {
    const y = 700 - index * 30;
    tokens.push({ str: row.left, x: 40, y, width: 240 });
    tokens.push({ str: row.right, x: 520 - row.rightWidth, y, width: row.rightWidth });
  });
  return { pageIndex: 0, pageWidth: 595, pageHeight: 842, tokens };
}

describe('atsInspector', () => {
  it('scores a clean single-column PDF as fully machine-readable', () => {
    const result = inspectAtsFromExtractedPages(buildDoc(), [buildSingleColumnPage()]);

    expect(result.columnsDetected).toBe(false);
    expect(result.interleavedLineCount).toBe(0);
    expect(result.garbledCharCount).toBe(0);
    expect(result.coverageRatio).toBe(1);
    expect(result.score).toBe(100);
    expect(result.checks.every((check) => check.severity === 'pass')).toBe(true);
  });

  it('detects two-column interleaving and rebuilds reading order column by column', () => {
    const result = inspectAtsFromExtractedPages(buildDoc(), [buildTwoColumnPage()]);

    expect(result.columnsDetected).toBe(true);
    expect(result.columnPageCount).toBe(1);
    expect(result.interleavedLineCount).toBeGreaterThanOrEqual(4);

    const interleaveCheck = result.checks.find((check) => check.id === 'column-interleave');
    expect(interleaveCheck?.severity).toBe('warn');

    // 双栏感知重建：左栏内容必须整体出现在右栏内容之前
    const leftIndex = result.columnAwareText.indexOf('示例大学');
    const rightIndex = result.columnAwareText.indexOf('demo@example.invalid');
    expect(leftIndex).toBeGreaterThanOrEqual(0);
    expect(rightIndex).toBeGreaterThan(leftIndex);

    // 朴素流里则出现左右首尾拼接
    expect(result.rawExtractedText).toContain('教育经历 张甲');
    expect(result.score).toBeLessThan(100);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('flags missing email and garbled glyphs as hard errors', () => {
    const page = buildSingleColumnPage();
    const tokens: PdfTextToken[] = [
      ...page.tokens.filter((token) => !token.str.includes('@')),
      { str: '\ufffd', x: 40, y: 500, width: 8 },
    ];
    const result = inspectAtsFromExtractedPages(buildDoc(), [{ ...page, tokens }]);

    const emailCheck = result.checks.find((check) => check.id === 'contact-email');
    expect(emailCheck?.severity).toBe('error');

    const garbledCheck = result.checks.find((check) => check.id === 'garbled-glyphs');
    expect(garbledCheck?.severity).toBe('error');

    expect(result.garbledCharCount).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(78);
  });

  it('separates JD keywords that exist in the resume but cannot be read from the PDF', () => {
    const doc = buildDoc({ skillContent: '熟悉新高考课程标准，具备物理竞赛辅导能力' });
    const jdText =
      '招聘高中物理教师，要求硕士及以上学历，熟悉新高考课程标准与实验教学，具备物理竞赛辅导能力，有班主任经验优先。';

    // PDF 只渲染了证书行，正文里的新高考/物理竞赛并未出现在文本流中
    const page = buildSingleColumnPage();
    const tokens = page.tokens.map((token) =>
      token.str.includes('高中物理教师资格证') ? { ...token, str: '高中物理教师资格证' } : token,
    );
    const result = inspectAtsFromExtractedPages(doc, [{ ...page, tokens }], jdText);

    expect(result.jdPdfHitRate).not.toBeNull();
    expect(result.jdPdfHitRate ?? -1).toBeLessThan(50);
    expect(result.jdMissedInPdfOnly).toContain('新高考');

    const jdCheck = result.checks.find((check) => check.id === 'jd-pdf-match');
    expect(jdCheck?.severity).toBe('warn');
  });

  it('normalizes full-width characters and counts garbled chars', () => {
    expect(normalizeForMatch('ＡＢＣ １２３')).toBe('abc123');
    expect(countGarbledChars('正常文本')).toBe(0);
    expect(countGarbledChars('异\ufffd常\u0007')).toBe(2);
  });

  it('does not mistake a single-column right-aligned date layout for two columns', () => {
    const result = inspectAtsFromExtractedPages(buildDoc(), [
      buildSingleColumnWithRightAlignedDates(),
    ]);

    expect(result.columnsDetected).toBe(false);
    expect(result.interleavedLineCount).toBe(0);
    const interleaveCheck = result.checks.find((check) => check.id === 'column-interleave');
    expect(interleaveCheck?.severity).toBe('pass');
  });

  it('normalizes Kangxi radicals so keyword matching survives glyph substitution', () => {
    expect(normalizeForMatch('示例⼤学')).toBe('示例大学');
    expect(countCompatChars('示例⼤学 ⾼中')).toBe(2);
  });

  it('reports Kangxi radical substitution as a blocking error but keeps coverage intact', () => {
    const page = buildSingleColumnPage();
    const tokens = page.tokens.map((token) => ({
      ...token,
      str: token.str.replaceAll('大', '⼤'),
    }));
    const result = inspectAtsFromExtractedPages(buildDoc(), [{ ...page, tokens }]);

    const compatCheck = result.checks.find((check) => check.id === 'compat-glyphs');
    expect(compatCheck?.severity).toBe('error');
    expect(result.compatCharCount).toBeGreaterThan(0);
    // NFKC 归一化后，实体覆盖率不应因字形降级而坍塌
    expect(result.coverageRatio).toBe(1);
  });

  it('detects right-sidebar layout with sparse short left lines and warns on staggered two-column layouts', () => {
    // 模拟 sidebar-right：左栏含 "项目经历" / "GPA" 等短行导致行内最大空白中点左偏，但 X=397pt 处存在干净竖直栏沟
    const sparseRightSidebar: ExtractedPdfPageTokens = {
      pageIndex: 0,
      pageWidth: 595,
      pageHeight: 842,
      tokens: [
        { str: '教育经历', x: 32, y: 740, width: 58 },
        { str: 'GPA: 3.29/4.0', x: 32, y: 710, width: 72 },
        { str: '项目经历', x: 32, y: 660, width: 58 },
        { str: '基于示例计算模型的仿真分析与物理可视化课件开发', x: 32, y: 632, width: 310 },
        { str: '工作经历', x: 32, y: 560, width: 58 },
        { str: '示例中学 物理教研组核心教师', x: 32, y: 530, width: 220 },
        { str: '荣誉奖项', x: 32, y: 470, width: 58 },
        { str: '基本信息', x: 420, y: 740, width: 52 },
        { str: '电话：13800000000', x: 420, y: 712, width: 112 },
        { str: '邮箱：demo@example.invalid', x: 420, y: 688, width: 145 },
        { str: '专业技能', x: 420, y: 634, width: 52 },
        { str: 'Python 仿真编程', x: 420, y: 604, width: 96 },
        { str: '高中物理教师资格证', x: 420, y: 576, width: 115 },
        { str: '自我评价', x: 420, y: 520, width: 52 },
        { str: '认真踏实热爱一线教学', x: 420, y: 492, width: 132 },
      ],
    };
    const rightSidebarResult = inspectAtsFromExtractedPages(buildDoc(), [sparseRightSidebar]);
    expect(rightSidebarResult.columnsDetected).toBe(true);
    expect(rightSidebarResult.checks.find((c) => c.id === 'column-interleave')?.severity).toBe('warn');

    // 模拟 wondercv-teal-sidebar：左右栏行高完全错开（0 行在 y±3.5pt 对齐），仍须检出双栏并给串读提醒
    const staggeredLeftSidebar: ExtractedPdfPageTokens = {
      pageIndex: 0,
      pageWidth: 595,
      pageHeight: 842,
      tokens: [
        { str: '张甲', x: 24, y: 742, width: 42 },
        { str: '13800000000', x: 24, y: 690, width: 78 },
        { str: 'demo@example.invalid', x: 24, y: 642, width: 110 },
        { str: '求职意向', x: 24, y: 588, width: 52 },
        { str: '高中物理教师', x: 24, y: 542, width: 78 },
        { str: '示例市', x: 24, y: 492, width: 32 },
        { str: '教育经历', x: 185, y: 728, width: 64 },
        { str: '示例大学 示例理科方向（硕士）', x: 185, y: 702, width: 240 },
        { str: '项目经历与自动化教研工作流实战总结', x: 185, y: 660, width: 255 },
        { str: '工作经历', x: 185, y: 616, width: 64 },
        { str: '示例中学 高中物理一线教学与竞赛辅导', x: 185, y: 570, width: 260 },
        { str: '专业技能与教师资格证认证记录', x: 185, y: 518, width: 210 },
      ],
    };
    const tealResult = inspectAtsFromExtractedPages(buildDoc(), [staggeredLeftSidebar]);
    expect(tealResult.columnsDetected).toBe(true);
    expect(tealResult.score).toBeLessThan(100);
    expect(tealResult.checks.find((c) => c.id === 'column-interleave')?.severity).toBe('warn');
  });

  it('collects expected entities for coverage comparison', () => {
    const entities = collectExpectedEntities(buildDoc());
    expect(entities).toContain('张甲');
    expect(entities).toContain('示例大学');
    expect(entities).toContain('示例中学');
  });
});
