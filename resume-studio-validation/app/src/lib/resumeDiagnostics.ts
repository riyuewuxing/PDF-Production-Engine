import type { ResumeDocument } from '../schema/resumeSchema';
import { getOrderedVisibleSections } from '../templates/shared';

export type DiagnosticSeverity = 'error' | 'warn' | 'good';

export interface DiagnosticFinding {
  id: string;
  severity: DiagnosticSeverity;
  category: '完整性' | '量化力度' | '篇幅控页' | '排版时间序';
  title: string;
  detail: string;
  sectionId?: string;
}

export interface ResumeDiagnosticReport {
  score: number;
  metrics: {
    totalChars: number;
    quantifiedRate: number;
    totalEntries: number;
    quantifiedEntries: number;
    unspacedCjkHits: number;
  };
  findings: DiagnosticFinding[];
}

const PLACEHOLDER_REGEX = /\[姓名\]|\[待填写\]|example\.(com|edu\.cn)|待补充|xxx+/i;
const QUANTIFIED_METRIC_REGEX = /\d+(?:\.\d+)?\s*(?:%|％|倍|项|篇|名|人|所|次|等奖|个|万|千|元|年|个月|天|小时|学时|分|\/\s*4\.0|\/\s*5\.0)|专业前\s*\d+|排名\s*\d+|提升|增长|减少|覆盖/;
const UNSPACED_CJK_ASCII_REGEX = /[\u4e00-\u9fff][A-Za-z0-9]|[A-Za-z0-9%][\u4e00-\u9fff]/g;

function extractStartYearMonth(raw: string): number | null {
  const match = /(\d{4})\D{0,2}(\d{1,2})?/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Math.min(12, Math.max(1, Number(match[2]))) : 1;
  return year * 100 + month;
}

function detectDateFormatKind(raw: string): 'dot' | 'cn' | 'slash' | 'dash' | null {
  if (!raw.trim()) return null;
  if (/\d{4}年/.test(raw)) return 'cn';
  if (/\d{4}\.\d{1,2}/.test(raw)) return 'dot';
  if (/\d{4}\/\d{1,2}/.test(raw)) return 'slash';
  if (/\d{4}-\d{1,2}/.test(raw)) return 'dash';
  return null;
}

export function analyzeResumeDiagnostics(
  doc: ResumeDocument,
  options?: { overflowPx?: number },
): ResumeDiagnosticReport {
  const findings: DiagnosticFinding[] = [];
  let penalty = 0;

  // 1. Placeholders & Core Required Fields
  const { basic } = doc;
  const coreText = [basic.name, basic.title, basic.email, basic.phone, basic.location].join(' ');
  if (PLACEHOLDER_REGEX.test(coreText) || !basic.name.trim()) {
    penalty += 18;
    findings.push({
      id: 'placeholder-basic',
      severity: 'error',
      category: '完整性',
      title: '基本信息含未替换占位符或缺失姓名',
      detail: '检测到 [姓名] / [待填写] 或示例邮箱等占位内容，投递前请务必填写真实信息。',
      sectionId: 'basic',
    });
  }

  const missingContacts: string[] = [];
  if (!basic.email.trim()) missingContacts.push('邮箱');
  if (!basic.phone.trim() || PLACEHOLDER_REGEX.test(basic.phone)) missingContacts.push('联系电话');
  if (!basic.title.trim()) missingContacts.push('求职意向');
  if (missingContacts.length > 0) {
    penalty += 10;
    findings.push({
      id: 'missing-contacts',
      severity: 'warn',
      category: '完整性',
      title: `缺少关键联系与定位字段（${missingContacts.join('、')}）`,
      detail: 'HR 筛简历首眼会核对意向岗位与联系方式，建议补全手机、邮箱和明确岗位名称。',
      sectionId: 'basic',
    });
  }

  // 2. Quantification / STAR Metrics across experience, projects & education
  const visibleSections = getOrderedVisibleSections(doc);
  const measurableItems: Array<{ label: string; text: string; sectionId: string }> = [];

  for (const exp of doc.experience.filter((e) => e.visible)) {
    measurableItems.push({
      label: exp.company || '工作经历',
      text: exp.description,
      sectionId: 'experience',
    });
  }
  for (const proj of doc.projects.filter((p) => p.visible)) {
    measurableItems.push({
      label: proj.name || '项目经历',
      text: proj.description,
      sectionId: 'projects',
    });
  }

  let quantifiedEntries = 0;
  const unquantifiedLabels: Array<{ label: string; sectionId: string }> = [];
  for (const item of measurableItems) {
    if (QUANTIFIED_METRIC_REGEX.test(item.text)) {
      quantifiedEntries += 1;
    } else {
      unquantifiedLabels.push({ label: item.label, sectionId: item.sectionId });
    }
  }

  const totalEntries = measurableItems.length;
  const quantifiedRate = totalEntries > 0 ? Math.round((quantifiedEntries / totalEntries) * 100) : 100;

  if (totalEntries === 0) {
    penalty += 15;
    findings.push({
      id: 'no-exp-or-proj',
      severity: 'warn',
      category: '量化力度',
      title: '尚无可见的工作或项目经历',
      detail: '建议至少补充 2 段核心教学/科研/项目经历以支撑岗位胜任力。',
      sectionId: 'projects',
    });
  } else if (unquantifiedLabels.length > 0) {
    penalty += Math.min(18, unquantifiedLabels.length * 6);
    findings.push({
      id: 'low-quantification',
      severity: 'warn',
      category: '量化力度',
      title: `${unquantifiedLabels.length} 段核心经历缺少量化指标（量化率 ${quantifiedRate}%）`,
      detail: `“${unquantifiedLabels.map((x) => x.label).join('、')}”建议用数字/百分比/产出成果体现 STAR 结果（如覆盖学生人数、提分幅度、论文/专利/课件数量）。`,
      sectionId: unquantifiedLabels[0]?.sectionId,
    });
  } else {
    findings.push({
      id: 'good-quantification',
      severity: 'good',
      category: '量化力度',
      title: `项目/经历量化表现优秀（${quantifiedEntries}/${totalEntries} 段含明确指标）`,
      detail: '关键经历均包含具体数量、规模或结果描述，HR 扫读信任度较高。',
    });
  }

  // 3. Length & Page Fit Suggestions
  const allTexts: Array<{ sectionId: string; text: string }> = [
    ...doc.education.filter((e) => e.visible).map((e) => ({ sectionId: 'education', text: e.description })),
    ...doc.experience.filter((e) => e.visible).map((e) => ({ sectionId: 'experience', text: e.description })),
    ...doc.projects.filter((p) => p.visible).map((p) => ({ sectionId: 'projects', text: p.description })),
    { sectionId: 'skills', text: doc.skillContent },
    { sectionId: 'selfEvaluation', text: doc.selfEvaluationContent },
  ];
  for (const sec of visibleSections) {
    const custom = doc.customData[sec.id];
    if (Array.isArray(custom)) {
      for (const item of custom.filter((c) => c.visible)) {
        allTexts.push({ sectionId: sec.id, text: [item.title, item.description].join(' ') });
      }
    }
  }

  const totalChars = allTexts.reduce((sum, block) => sum + block.text.replace(/\s+/g, '').length, 0);
  const verboseBlocks = allTexts.filter((b) =>
    b.text.split(/\r?\n/).some((line) => line.trim().length > 165),
  );
  if (verboseBlocks.length > 0) {
    penalty += 6;
    findings.push({
      id: 'verbose-paragraph',
      severity: 'warn',
      category: '篇幅控页',
      title: `发现 ${verboseBlocks.length} 处超长单段描述（超 4 行约 165 字）`,
      detail: '大段密字容易降低阅读效率，建议拆成以“- **关键词**：...”开头的短要点列表。',
      sectionId: verboseBlocks[0]?.sectionId,
    });
  }

  const overflowPx = options?.overflowPx ?? 0;
  if (overflowPx > 2 && overflowPx <= 120) {
    penalty += 6;
    findings.push({
      id: 'slight-overflow',
      severity: 'warn',
      category: '篇幅控页',
      title: `当前仅轻微超出单页 +${overflowPx}px，非常适合压回一页`,
      detail: '点击顶部“一键压回一页”即可无损收敛字号与间距，避免第 2 页只剩几行尾巴。',
    });
  } else if (totalChars < 180) {
    penalty += 10;
    findings.push({
      id: 'too-short',
      severity: 'warn',
      category: '篇幅控页',
      title: `正文有效字数偏少（约 ${totalChars} 字）`,
      detail: '建议适当充实核心课程、项目举措与技能证书细节，通常 500~1100 字最饱满。',
    });
  }

  // 4. Typography CJK spacing & Date format / Reverse chronology checks
  const combinedBody = allTexts.map((t) => t.text).join('\n');
  const withoutUrlsAndDates = combinedBody
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ')
    .replace(/\d{2,4}年(?:\d{1,2}月(?:\d{1,2}[日号])?)?/g, ' ');
  const unspacedMatches = withoutUrlsAndDates.match(UNSPACED_CJK_ASCII_REGEX) ?? [];
  if (unspacedMatches.length >= 3 && !doc.globalSettings.autoCjkSpacing) {
    penalty += 5;
    findings.push({
      id: 'cjk-spacing',
      severity: 'warn',
      category: '排版时间序',
      title: `检测到 ${unspacedMatches.length} 处中英文/数字紧贴未留空`,
      detail: '点击左侧“一键中英排版”或开启样式面板“中英混排自动加空格”可显著提升印刷精致度。',
      sectionId: 'projects',
    });
  }

  const dateSamples = [
    ...doc.education.filter((e) => e.visible).flatMap((e) => [e.startDate, e.endDate]),
    ...doc.experience.filter((e) => e.visible).flatMap((e) => [e.startDate, e.endDate]),
    ...doc.projects.filter((p) => p.visible).map((p) => p.date),
  ].filter((d) => d.trim().length > 0);
  const dateKinds = new Set(dateSamples.map(detectDateFormatKind).filter(Boolean));
  if (dateKinds.size > 1) {
    penalty += 5;
    findings.push({
      id: 'mixed-date-format',
      severity: 'warn',
      category: '排版时间序',
      title: '经历日期格式不统一（混用“2022年09月”与“2022.09”等）',
      detail: '建议全篇统一为 YYYY.MM 或 YYYY年MM月 风格，增强审阅秩序感。',
      sectionId: 'education',
    });
  }

  // Reverse chronology check for education & experience
  const checkChronology = (items: Array<{ raw: string }>, sectionId: string, label: string) => {
    for (let i = 1; i < items.length; i++) {
      const prevYm = extractStartYearMonth(items[i - 1]?.raw ?? '');
      const currYm = extractStartYearMonth(items[i]?.raw ?? '');
      if (prevYm !== null && currYm !== null && currYm > prevYm) {
        penalty += 6;
        findings.push({
          id: `chronology-${sectionId}`,
          severity: 'warn',
          category: '排版时间序',
          title: `${label}未按时间倒序排列`,
          detail: '常规简历要求最近经历排在最前（时间倒序），可用拖拽抓手一键调换顺序。',
          sectionId,
        });
        break;
      }
    }
  };
  checkChronology(
    doc.education.filter((e) => e.visible).map((e) => ({ raw: e.endDate || e.startDate })),
    'education',
    '教育经历',
  );
  checkChronology(
    doc.experience.filter((e) => e.visible).map((e) => ({ raw: e.endDate || e.startDate })),
    'experience',
    '工作经历',
  );

  if (findings.every((f) => f.severity === 'good')) {
    findings.push({
      id: 'ready-to-submit',
      severity: 'good',
      category: '完整性',
      title: '整体简历结构完整、可直接用于投递或导出',
      detail: '未检出明显缺失、占位符或排版异常，推荐导出 PDF 或 Word 版本备用。',
    });
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  return {
    score,
    metrics: {
      totalChars,
      quantifiedRate,
      totalEntries,
      quantifiedEntries,
      unspacedCjkHits: unspacedMatches.length,
    },
    findings,
  };
}
