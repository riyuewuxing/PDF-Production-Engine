import { z } from 'zod';
import { type ByokAiSettings, requestByokCompletion } from './byokAiClient';
import { matchResumeWithJd } from './jdMatcher';
import { type EditableBlockOption, collectEditableBlocks } from './resumeBlocks';
import type { ResumeDocument } from '../schema/resumeSchema';

export interface FactGuardWarning {
  type: 'new-number' | 'new-metric' | 'new-credential';
  token: string;
  message: string;
}

export interface TailorBlockProposal {
  id: string;
  blockKey: string;
  sectionId: string;
  label: string;
  originalText: string;
  suggestedText: string;
  reason: string;
  matchedJdKeywords: string[];
  factWarnings: FactGuardWarning[];
  accepted: boolean;
}

const RawProposalSchema = z.array(
  z.object({
    blockKey: z.string().min(1),
    reason: z.string().optional().default('对齐 JD 关键词与岗位表达'),
    suggestedText: z.string(),
  }),
);

const HIGH_RISK_CREDENTIALS = [
  '特等奖',
  '一等奖',
  '二等奖',
  '三等奖',
  '国家级',
  '省级',
  '市级',
  'SCI',
  'EI',
  '核心期刊',
  '发明专利',
  '实用新型',
  '特级教师',
  '高级教师',
  '一级教师',
  '骨干教师',
  '学科带头人',
  '985',
  '211',
  '双一流',
  '博士后',
  'CET-6',
  '六级',
  '雅思',
  '托福',
  'PMP',
] as const;

function normalizeFactText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/(?<=\d),(?=\d{3})/g, '')
    .toLowerCase();
}

/**
 * 汇总可信事实语料边界（仅来自当前简历与可选母库 `master.json`，**绝不**拼入招聘 `jdText`）。
 */
export function buildTrustedFactCorpus(
  doc: ResumeDocument,
  masterDoc?: ResumeDocument | null,
): string {
  const chunks: string[] = [];
  const collectDoc = (d: ResumeDocument) => {
    chunks.push(
      d.basic.name,
      d.basic.title,
      d.basic.employmentStatus,
      d.basic.birthDate,
      d.basic.location,
      d.skillContent,
      d.selfEvaluationContent,
    );
    for (const cf of d.basic.customFields) {
      chunks.push(cf.label, cf.value);
    }
    for (const edu of d.education) {
      chunks.push(edu.school, edu.major, edu.degree, edu.gpa, edu.startDate, edu.endDate, edu.description);
    }
    for (const exp of d.experience) {
      chunks.push(exp.company, exp.position, exp.startDate, exp.endDate, exp.location, exp.description);
    }
    for (const proj of d.projects) {
      chunks.push(proj.name, proj.role, proj.date, proj.description);
    }
    for (const list of Object.values(d.customData)) {
      for (const item of list) {
        chunks.push(item.title, item.subtitle, item.dateRange, item.description);
      }
    }
  };

  collectDoc(doc);
  if (masterDoc) {
    collectDoc(masterDoc);
  }
  return chunks.filter(Boolean).join('\n');
}

/**
 * Fact Guard 防编造检测：核查建议改写稿中新增的量化指标、数字/年份及高危荣誉资质词。
 */
export function scanFactGuardWarnings(
  suggestedText: string,
  trustedCorpus: string,
): FactGuardWarning[] {
  const normSuggested = normalizeFactText(suggestedText);
  const normCorpus = normalizeFactText(trustedCorpus);
  const warnings: FactGuardWarning[] = [];
  const seenTokens = new Set<string>();

  const metricRegex =
    /\d+(?:\.\d+)?\s*(?:%|倍|万|亿|人次|课时|学时|届|名|篇|项|个|套|所|分|小时|天|周|个月|年)/gu;
  const metricKey = (text: string) => text.replace(/\s+/g, '');
  const trustedMetrics = new Set(Array.from(normCorpus.matchAll(metricRegex), (m) => metricKey(m[0])));
  for (const match of normSuggested.matchAll(metricRegex)) {
    const token = match[0].trim();
    if (!token || seenTokens.has(token)) continue;
    // A number elsewhere (e.g. a year or another unit) is not evidence of this metric.
    if (!trustedMetrics.has(metricKey(token))) {
      seenTokens.add(token);
      warnings.push({
        type: 'new-metric',
        token,
        message: `检测到原简历与母库未出现的新量化指标「${token}」，请确认属实后再勾选。`,
      });
    }
  }

  const numberRegex = /(?<![a-z0-9.])(\d+\.\d+|\d{2,})(?![a-z0-9.])/giu;
  const trustedNumbers = new Set(Array.from(normCorpus.matchAll(numberRegex), (m) => m[1]));
  for (const match of normSuggested.matchAll(numberRegex)) {
    const numToken = match[1] ?? '';
    if (!numToken || seenTokens.has(numToken)) continue;
    // If already covered as leading number inside a metric warning above, skip duplicate number alert
    const alreadyWarnedInMetric = Array.from(seenTokens).some(
      (t) => /\d+(?:\.\d+)?/.exec(t)?.[0] === numToken,
    );
    if (alreadyWarnedInMetric) continue;
    if (!trustedNumbers.has(numToken)) {
      seenTokens.add(numToken);
      warnings.push({
        type: 'new-number',
        token: numToken,
        message: `检测到原简历未出现的数字「${numToken}」，请核对是否为真实数据。`,
      });
    }
  }

  for (const cred of HIGH_RISK_CREDENTIALS) {
    const normCred = cred.toLowerCase();
    if (normSuggested.includes(normCred) && !normCorpus.includes(normCred)) {
      warnings.push({
        type: 'new-credential',
        token: cred,
        message: `检测到原简历未提及的资质/荣誉词「${cred}」，请谨防大模型幻觉。`,
      });
    }
  }

  return warnings;
}

export function parseTailorProposalsResponse(
  rawText: string,
  blocks: readonly EditableBlockOption[],
  trustedCorpus: string,
  jdMissingKeywords: readonly string[],
): TailorBlockProposal[] {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) {
    throw new Error('模型返回格式异常，未找到 JSON 数组。');
  }

  let jsonParsed: unknown;
  try {
    jsonParsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('模型返回的提案 JSON 解析失败，请重试。');
  }

  const items = RawProposalSchema.parse(jsonParsed);
  const blockMap = new Map(blocks.map((b) => [b.key, b]));
  const seenKeys = new Set<string>();
  const proposals: TailorBlockProposal[] = [];

  for (const item of items) {
    const block = blockMap.get(item.blockKey);
    if (!block || seenKeys.has(item.blockKey)) continue;
    const suggestedTrimmed = item.suggestedText.trim();
    if (!suggestedTrimmed || suggestedTrimmed === block.text.trim()) continue;
    if (suggestedTrimmed.length > block.maxCharsHint) {
      throw new Error(`改写提案超出段落「${block.label}」的字数上限，请重试或缩短目标内容。`);
    }
    seenKeys.add(item.blockKey);

    const normSuggested = normalizeFactText(suggestedTrimmed);
    const matchedJdKeywords = jdMissingKeywords.filter((kw) =>
      normSuggested.includes(normalizeFactText(kw)),
    );
    const factWarnings = scanFactGuardWarnings(suggestedTrimmed, trustedCorpus);

    proposals.push({
      id: `tailor-${item.blockKey}`,
      blockKey: block.key,
      sectionId: block.sectionId,
      label: block.label,
      originalText: block.text,
      suggestedText: suggestedTrimmed,
      reason: item.reason.trim() || '针对 JD 要求优化关键词与动词表达',
      matchedJdKeywords,
      factWarnings,
      accepted: factWarnings.length === 0,
    });

    if (proposals.length >= 8) break;
  }

  return proposals;
}

export async function generateTailorProposals(input: {
  settings: ByokAiSettings;
  document: ResumeDocument;
  masterDocument?: ResumeDocument | null;
  jdText: string;
  signal?: AbortSignal;
}): Promise<{ proposals: TailorBlockProposal[]; trustedCorpus: string }> {
  const jdTrimmed = input.jdText.trim();
  if (!jdTrimmed) {
    throw new Error('请先粘贴目标岗位招聘 JD，再发起整卷定向改写。');
  }

  const blocks = collectEditableBlocks(input.document);
  if (blocks.length === 0) {
    throw new Error('当前简历暂无可改写的可见段落。');
  }

  const jdMatch = matchResumeWithJd(input.document, jdTrimmed);
  const trustedCorpus = buildTrustedFactCorpus(input.document, input.masterDocument);

  const systemPrompt = [
    '你是严谨的中文简历定向调优专家。请结合目标岗位 JD 与候选人现有真实经历，给出最值得微调的段落提案（最多 8 段）。',
    '【绝对红线】严禁捏造原简历与补充母库中不存在的学历、学校、公司、奖项、资质证书、科研成果或量化数字；如缺少数据仅用动词与结构提炼，禁止臆测数字。',
    '输出格式：严格只返回一个 JSON 数组，每项包含 {"blockKey": string, "reason": string, "suggestedText": string}。',
    'suggestedText 保持 `- ` Markdown 列表或纯段落格式，不得超出现有 maxCharsHint 字数上限，不要附加任何解释或代码块标记外文字。',
  ].join('\n');

  const compactBlocks = blocks.map((b) => ({
    blockKey: b.key,
    label: b.label,
    maxCharsHint: b.maxCharsHint,
    text: b.text,
  }));

  const userPrompt = JSON.stringify(
    {
      targetJob: input.document.basic.title,
      jdText: jdTrimmed.slice(0, 2200),
      jdMissingKeywords: jdMatch.missingKeywords.slice(0, 20),
      blocks: compactBlocks,
      ...(input.masterDocument
        ? {
            // Only explicitly enabled, visible experience blocks; never serialize basic identity fields.
            masterReferenceExcerpt: collectEditableBlocks(input.masterDocument)
              .map((b) => `${b.label}: ${b.text}`)
              .join('\n')
              .slice(0, 2500),
          }
        : {}),
    },
    null,
    2,
  );

  const rawText = await requestByokCompletion({
    settings: input.settings,
    systemPrompt,
    userPrompt,
    temperature: 0.25,
    maxTokens: 3200,
    timeoutMs: 55000,
    signal: input.signal,
  });

  const proposals = parseTailorProposalsResponse(
    rawText,
    blocks,
    trustedCorpus,
    jdMatch.missingKeywords,
  );
  return { proposals, trustedCorpus };
}
