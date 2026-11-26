import { describe, expect, it } from 'vitest';
import {
  type PdfTextToken,
  buildResumeDocumentFromPdfDraft,
  parseExtractedResumeText,
  reconstructLinesFromTextItems,
  reconstructLinesWithColumnAwareness,
  reconstructLinesWithHeights,
  scoreNameCandidate,
} from './pdfResumeImporter';

describe('pdfResumeImporter', () => {
  it('reconstructs ordered readable lines from PDF coordinate tokens', () => {
    const lines = reconstructLinesFromTextItems([
      { str: '教育经历', x: 40, y: 700, width: 60 },
      { str: '王乙', x: 40, y: 780, width: 40 },
      { str: '示例大学', x: 40, y: 675, width: 60 },
      { str: '2022.09 - 2025.06', x: 240, y: 675, width: 100 },
    ]);

    expect(lines).toEqual([
      '王乙',
      '教育经历',
      '示例大学 2022.09 - 2025.06',
    ]);
  });

  it('parses extracted resume text into structured ResumeDocument draft safely', () => {
    const rawText = [
      '张甲',
      '求职意向：高中物理教师',
      '邮箱：demo@example.invalid 电话：13800000000 所在地：示例市',
      '教育经历',
      '示例大学 物理学 硕士 2022.09 - 2025.06',
      '主修量子力学与教学法',
      '专业技能',
      '高中物理教师资格证、Python 仿真编程',
      '自我评价',
      '认真踏实，热爱一线物理教学。',
    ].join('\n');

    const draft = parseExtractedResumeText(rawText, '张甲简历.pdf');
    expect(draft.title).toBe('张甲简历');
    expect(draft.name).toBe('张甲');
    expect(draft.jobTitle).toBe('高中物理教师');
    expect(draft.email).toBe('demo@example.invalid');
    expect(draft.phone).toBe('13800000000');

    const doc = buildResumeDocumentFromPdfDraft(draft);
    expect(doc.basic.name).toBe('张甲');
    expect(doc.education[0]?.school).toContain('示例大学');
    expect(doc.skillContent).toContain('高中物理教师资格证');
    expect(doc.selfEvaluationContent).toContain('一线物理教学');
  });

  it('rebuilds two-column pages left column first without interleaving', () => {
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

    const lines = reconstructLinesWithColumnAwareness([
      { pageIndex: 0, pageWidth: 595, pageHeight: 842, tokens },
    ]);

    expect(lines).toEqual([...leftColumn, ...rightColumn]);
    // 绝不能出现左右两栏被拼成同一行
    expect(lines.some((line) => line.includes('教育经历') && line.includes('张甲'))).toBe(false);
  });

  it('keeps sparse left-sidebar staggered baselines ordered left-column then right-column', () => {
    const leftSide = [
      { str: '张甲', x: 20, y: 742, width: 42 },
      { str: '13800000000', x: 20, y: 688, width: 78 },
      { str: 'demo@example.invalid', x: 20, y: 636, width: 112 },
      { str: '求职意向', x: 20, y: 582, width: 54 },
      { str: '高中物理教师', x: 20, y: 530, width: 82 },
      { str: '示例市', x: 20, y: 478, width: 32 },
    ];
    const rightMain = [
      { str: '教育经历', x: 185, y: 726, width: 64 },
      { str: '示例大学 物理学硕士', x: 185, y: 672, width: 180 },
      { str: '工作经历', x: 185, y: 618, width: 64 },
      { str: '示例中学 物理教师与竞赛指导', x: 185, y: 564, width: 215 },
      { str: '专业技能', x: 185, y: 510, width: 64 },
      { str: '高中物理教师资格证与可视化仿真开发', x: 185, y: 456, width: 240 },
    ];
    const lines = reconstructLinesWithColumnAwareness([
      { pageIndex: 0, pageWidth: 595, pageHeight: 842, tokens: [...leftSide, ...rightMain] },
    ]);
    expect(lines.indexOf('张甲')).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf('示例市')).toBeLessThan(lines.indexOf('教育经历'));
  });

  it('weights name candidates by shape, position and font size', () => {
    const best = scoreNameCandidate('张甲', 0, { lineHeight: 20, maxLineHeight: 20 });
    const orgName = scoreNameCandidate('示例大学', 3);
    const contact = scoreNameCandidate('demo@example.invalid', 0);

    expect(best).toBeGreaterThan(orgName);
    expect(orgName).toBeGreaterThan(0);
    expect(contact).toBe(0);
  });

  it('prefers the largest-font candidate over an earlier body line', () => {
    const rawText = ['示例大学', '张甲', 'demo@example.invalid'].join('\n');
    const draft = parseExtractedResumeText(rawText, '简历.pdf', {
      lineHeights: { 示例大学: 11, 张甲: 22 },
    });

    expect(draft.name).toBe('张甲');
  });

  it('outputs full cross-gutter header before left then right columns without splitting header', () => {
    const tokens: PdfTextToken[] = [
      // Top cross-gutter header banner (spans across gutter around x=180..220)
      { str: '李甲乙', x: 40, y: 800, width: 60, height: 22 },
      { str: '求职意向：高中物理教师', x: 140, y: 800, width: 160, height: 11 },
      { str: '邮箱：demo@example.invalid | 电话：13800000000 | 示例市', x: 40, y: 780, width: 320, height: 10 },
      // Left column (x=40..170)
      { str: '教育经历', x: 40, y: 730, width: 60, height: 13 },
      { str: '示例大学', x: 40, y: 700, width: 60, height: 11 },
      { str: '物理学硕士', x: 40, y: 670, width: 70, height: 11 },
      { str: 'GPA 3.29', x: 40, y: 640, width: 60, height: 11 },
      { str: '专业技能', x: 40, y: 590, width: 60, height: 13 },
      { str: '高中物理教资', x: 40, y: 560, width: 85, height: 11 },
      // Right column (x=240..520, aligned starts with varied line endings)
      { str: '项目经历', x: 240, y: 730, width: 64, height: 13 },
      { str: '高中物理交互式仿真实验平台', x: 240, y: 700, width: 220, height: 11 },
      { str: '独立完成电磁场与机械波可视化教学模块', x: 240, y: 670, width: 260, height: 11 },
      { str: '示例计算模型研究', x: 240, y: 620, width: 160, height: 11 },
      { str: '完成示例报告并推导计算模型公式', x: 240, y: 590, width: 240, height: 11 },
      { str: '自我评价', x: 240, y: 540, width: 64, height: 13 },
    ];

    const lines = reconstructLinesWithColumnAwareness([
      { pageIndex: 0, pageWidth: 595, pageHeight: 842, tokens },
    ]);

    expect(lines[0]).toBe('李甲乙 求职意向：高中物理教师');
    expect(lines[1]).toBe('邮箱：demo@example.invalid | 电话：13800000000 | 示例市');
    expect(lines.indexOf('自我评价')).toBeGreaterThan(lines.indexOf('高中物理教资'));
    expect(lines.some((line) => line.includes('教育经历') && line.includes('项目经历'))).toBe(false);
  });

  it('extracts per-line font heights via reconstructLinesWithHeights and picks large-font name over small first line', () => {
    const pages = [
      {
        pageIndex: 0,
        pageWidth: 595,
        pageHeight: 842,
        tokens: [
          { str: '个人简历', x: 40, y: 800, width: 44, height: 11 },
          { str: '李甲乙', x: 40, y: 775, width: 66, height: 22 },
          { str: 'demo@example.invalid', x: 40, y: 750, width: 110, height: 10 },
        ],
      },
    ];

    const { lines, lineHeights } = reconstructLinesWithHeights(pages);
    expect(lineHeights['李甲乙']).toBe(22);
    expect(lineHeights['个人简历']).toBe(11);

    const draft = parseExtractedResumeText(lines.join('\n'), '物理教师.pdf', { lineHeights });
    expect(draft.name).toBe('李甲乙');
  });

  it('extracts name from same-row header with target role and ignores 11-digit QQ email numbers as phone', () => {
    const rawText = [
      '李甲乙 求职意向：高中物理教师（示例地区）',
      '邮箱：00000000000@qq.com 电话：13800000000 所在地：示例市',
    ].join('\n');

    const draft = parseExtractedResumeText(rawText, 'deedy.pdf', {
      lineHeights: { '李甲乙求职意向：高中物理教师（示例地区）': 24 },
    });
    expect(draft.name).toBe('李甲乙');
    expect(draft.email).toBe('00000000000@qq.com');
    expect(draft.phone).toBe('13800000000');
  });
});
