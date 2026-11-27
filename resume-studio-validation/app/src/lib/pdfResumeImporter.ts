import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  type EducationItem,
  type ExperienceItem,
  type MenuSection,
  type ProjectItem,
  type ResumeDocument,
  ResumeDocumentSchema,
} from '../schema/resumeSchema';
import {
  type ExtractedPdfPageTokens,
  type PdfTextToken,
  reconstructLinesFromTextItems,
  reconstructLinesWithColumnAwareness,
  reconstructLinesWithHeights,
} from './pdfTextLayout';

export type { ExtractedPdfPageTokens, PdfTextToken };
export {
  reconstructLinesFromTextItems,
  reconstructLinesWithColumnAwareness,
  reconstructLinesWithHeights,
};

let workerConfigured = false;
function ensurePdfWorkerConfigured(): void {
  if (workerConfigured) return;
  // Bundle local pdf.worker.min.mjs cleanly without any external CDN dependency
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  workerConfigured = true;
}

export interface PdfImportDraft {
  title: string;
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
  location: string;
  birthDate: string;
  educationText: string;
  experienceText: string;
  projectsText: string;
  skillsText: string;
  selfEvaluationText: string;
  honorsText: string;
  rawText: string;
  sourceKind?: 'pdf' | 'text';
  unclassifiedText?: string;
  keepUnclassified?: boolean;
}

/** 姓名候选排除词：这些 2–4 字词块不可能是姓名 */
const NON_NAME_TERMS = new Set([
  '个人简历',
  '求职简历',
  '简历',
  '个人信息',
  '基本信息',
  '联系方式',
  '求职意向',
  '教育经历',
  '教育背景',
  '工作经历',
  '实习经历',
  '项目经历',
  '项目经验',
  '专业技能',
  '自我评价',
  '荣誉奖项',
  '获奖情况',
  '个人评价',
  '个人总结',
]);

/** 机构/单位结尾词：命中则降权，避免把学校名当姓名 */
const ORG_SUFFIX_PATTERN = /(大学|学院|学校|中学|小学|高中|初中|公司|集团|研究院|研究所|实验室|中心|医院)$/;

const CJK_NAME_PATTERN = /^[\u4e00-\u9fff]{2,4}$/;
const LATIN_NAME_PATTERN = /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){1,2}$/;
const NAME_NOISE_PATTERN = /[@\d，。、|｜/\\:：()（）[\]【】<>《》]/;

export interface NameScoringOptions {
  /**
   * 归一化行文本（去掉所有空白）-> 该行最大字形高度（pt）。
   * 由 PDF token 抽取阶段提供；无字号信息时省略即可跳过字号加权。
   */
  lineHeights?: Record<string, number>;
}

function normalizeLineKey(line: string): string {
  return line.replace(/\s+/g, '');
}

/**
 * 姓名候选加权打分：
 * +4 形似姓名（2–4 字中文 / 常见英文名）、+3 位于前 6 行、
 * +2 无邮箱/电话/时间/标点、+5 为全页最大字号、-3 形似机构名。
 */
export function scoreNameCandidate(
  line: string,
  index: number,
  options?: { lineHeight?: number; maxLineHeight?: number },
): number {
  const trimmed = line.trim();
  if (!trimmed) return 0;
  if (NON_NAME_TERMS.has(trimmed)) return 0;

  const isCjk = CJK_NAME_PATTERN.test(trimmed);
  const isLatin = LATIN_NAME_PATTERN.test(trimmed);
  if (!isCjk && !isLatin) return 0;

  let score = 0;
  score += 4; // 形似姓名
  if (index < 6) score += 3;
  if (!NAME_NOISE_PATTERN.test(trimmed)) score += 2;

  const { lineHeight, maxLineHeight } = options ?? {};
  if (
    typeof lineHeight === 'number' &&
    typeof maxLineHeight === 'number' &&
    maxLineHeight > 0 &&
    lineHeight >= maxLineHeight - 0.5
  ) {
    score += 5;
  }

  if (ORG_SUFFIX_PATTERN.test(trimmed)) score -= 3;

  return score;
}

function guessResumeName(
  lines: readonly string[],
  options?: NameScoringOptions,
): string {
  // 1. 显式「姓名：」标签优先级最高
  for (const candidate of lines.slice(0, 8)) {
    const labelName = /(?:姓\s*名)[:：]\s*([\u4e00-\u9fffA-Za-z·\s]{2,16})/.exec(candidate);
    if (labelName?.[1]) {
      return labelName[1].trim();
    }
  }

  const heights = options?.lineHeights;
  const heightValues = heights ? Object.values(heights).filter((h) => Number.isFinite(h) && h > 0) : [];
  const maxLineHeight = heightValues.length > 0 ? Math.max(...heightValues) : undefined;

  // 2. 加权打分（扫描前 12 行，兼顾页眉换行或“姓名 + 求职意向”同行排版）
  let bestName = '';
  let bestScore = 0;
  const scanLimit = Math.min(lines.length, 12);
  for (let index = 0; index < scanLimit; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (matchHeadingLine(line)) continue;
    const lineHeight = heights?.[normalizeLineKey(line)];
    const score = scoreNameCandidate(line, index, { lineHeight, maxLineHeight });
    if (score > bestScore) {
      bestScore = score;
      bestName = line.trim();
    }

    // 若顶部行把姓名与求职意向/联系方式排在同一水平线上（如 modern-deedy: "林清风 求职意向：..."），额外评估首段姓名候选
    if (index < 6 && (line.includes('求职意向') || /Target Role|@|\d{7}/.test(line) || line.length <= 36)) {
      const firstSeg = line.split(/[\s|｜/]+/).find(Boolean)?.trim() ?? '';
      if (firstSeg && firstSeg !== line.trim() && !ORG_SUFFIX_PATTERN.test(firstSeg)) {
        const segHeight = heights?.[normalizeLineKey(firstSeg)] ?? lineHeight;
        const segScore = scoreNameCandidate(firstSeg, index, { lineHeight: segHeight, maxLineHeight });
        if (segScore > bestScore) {
          bestScore = segScore;
          bestName = firstSeg;
        }
      }
    }
  }

  return bestScore >= 4 ? bestName : '';
}

const SECTION_HEADER_RULES: Array<{
  key: 'education' | 'experience' | 'projects' | 'skills' | 'selfEvaluation' | 'honors' | 'ignore';
  pattern: RegExp;
}> = [
    { key: 'ignore', pattern: /^(个人简历|基本信息|个人信息|联系方式|求职意向)$/ },
    { key: 'education', pattern: /^(教育经历|教育背景|学历背景|学习经历|Education)$/i },
    {
      key: 'experience',
      pattern: /^(工作经历|实习经历|教学经历|工作与实习经历|工作背景|Experience|Work Experience)$/i,
    },
    {
      key: 'projects',
      pattern: /^(项目经历|项目经验|科研经历|科研项目|教研与项目经历|Projects|Research)$/i,
    },
    {
      key: 'skills',
      pattern: /^(专业技能|技能证书|个人技能|核心技能|技能与证书|资质证书|Skills|Certificates)$/i,
    },
    {
      key: 'honors',
      pattern: /^(荣誉奖项|获奖情况|奖项荣誉|荣誉奖励|Honors|Awards)$/i,
    },
    {
      key: 'selfEvaluation',
      pattern: /^(自我评价|个人总结|个人评价|自我介绍|Summary|About Me)$/i,
    },
  ];

function matchHeadingLine(
  line: string,
): 'education' | 'experience' | 'projects' | 'skills' | 'selfEvaluation' | 'honors' | 'ignore' | null {
  const clean = line.replace(/[:：\-\s|•·]+$/g, '').replace(/^[#*\-\s•·]+/g, '').trim();
  if (!clean || clean.length > 24) return null;
  for (const rule of SECTION_HEADER_RULES) {
    if (rule.pattern.test(clean)) {
      return rule.key;
    }
  }
  return null;
}

export function parseExtractedResumeText(
  rawText: string,
  fileTitle = 'PDF 导入简历',
  nameOptions?: NameScoringOptions,
): PdfImportDraft {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const emailMatch = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(rawText);
  const textWithoutEmails = rawText.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ');
  const phoneMatch = /(?:(?:\+?86[-\s]?)?1[3-9]\d{9}|1[3-9]\d[-\s]\d{4}[-\s]\d{4})/.exec(textWithoutEmails);
  const roleMatch = /(?:求职意向|意向岗位|应聘岗位|求职岗位)[:：]?\s*([^\n|｜/]{2,26})/.exec(rawText);
  const birthMatch = /(?:生日|出生年月|出生日期)[:：]?\s*((?:19|20)\d{2}[.\-/年]\d{1,2}月?)/.exec(rawText);
  const locMatch = /(?:所在地|现居|城市|籍贯)[:：]\s*([\u4e00-\u9fffA-Za-z]{2,12})/.exec(rawText);

  const guessedName = guessResumeName(lines, nameOptions);

  const buckets: Record<
    'education' | 'experience' | 'projects' | 'skills' | 'selfEvaluation' | 'honors',
    string[]
  > = {
    education: [],
    experience: [],
    projects: [],
    skills: [],
    selfEvaluation: [],
    honors: [],
  };

  const unclassified: string[] = [];
  let activeBucket: keyof typeof buckets | null = null;
  for (const line of lines) {
    const heading = matchHeadingLine(line);
    if (heading === 'ignore') {
      activeBucket = null;
      continue;
    }
    if (heading) {
      activeBucket = heading;
      continue;
    }
    if (activeBucket) {
      buckets[activeBucket].push(line);
    } else {
      unclassified.push(line);
    }
  }

  // Fallback: if no standard heading matched at all, place body into selfEvaluation/notes so nothing is lost
  const allBucketCount = Object.values(buckets).reduce((s, arr) => s + arr.length, 0);
  if (allBucketCount === 0 && lines.length > 0) {
    buckets.selfEvaluation.push(...lines);
  }

  return {
    title: fileTitle.replace(/\.pdf$/i, '').trim() || 'PDF 导入简历',
    name: guessedName,
    jobTitle: roleMatch?.[1]?.trim() ?? '',
    email: emailMatch?.[0] ?? '',
    phone: phoneMatch?.[0] ?? '',
    location: locMatch?.[1]?.trim() ?? '',
    birthDate: birthMatch?.[1]?.trim() ?? '',
    educationText: buckets.education.join('\n'),
    experienceText: buckets.experience.join('\n'),
    projectsText: buckets.projects.join('\n'),
    skillsText: buckets.skills.join('\n'),
    selfEvaluationText: buckets.selfEvaluation.join('\n'),
    honorsText: buckets.honors.join('\n'),
    rawText,
    unclassifiedText: unclassified.join('\n'),
  };
}

function splitParagraphBlocks(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function buildResumeDocumentFromPdfDraft(draft: PdfImportDraft): ResumeDocument {
  const nowIso = new Date().toISOString();
  const eduLines = splitParagraphBlocks(draft.educationText);
  const expLines = splitParagraphBlocks(draft.experienceText);
  const projLines = splitParagraphBlocks(draft.projectsText);
  const honorsLines = splitParagraphBlocks(draft.honorsText);

  const education: EducationItem[] =
    eduLines.length > 0
      ? [
        {
          id: crypto.randomUUID(),
          school: eduLines[0] ?? '',
          major: '',
          degree: '',
          startDate: '',
          endDate: '',
          gpa: '',
          description: eduLines.slice(1).map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n'),
          visible: true,
          logo: '',
        },
      ]
      : [];

  const experience: ExperienceItem[] =
    expLines.length > 0
      ? [
        {
          id: crypto.randomUUID(),
          company: expLines[0] ?? '',
          position: '',
          startDate: '',
          endDate: '',
          location: '',
          description: expLines.slice(1).map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n'),
          visible: true,
          logo: '',
        },
      ]
      : [];

  const projects: ProjectItem[] =
    projLines.length > 0
      ? [
        {
          id: crypto.randomUUID(),
          name: projLines[0] ?? '',
          role: '',
          date: '',
          description: projLines.slice(1).map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n'),
          link: '',
          linkLabel: '',
          visible: true,
        },
      ]
      : [];

  const menuSections: MenuSection[] = [
    { id: 'basic', title: '基本信息', icon: 'User', enabled: true, order: 0, pageBreakBefore: false },
    { id: 'education', title: '教育经历', icon: 'GraduationCap', enabled: true, order: 1, pageBreakBefore: false },
    { id: 'experience', title: '工作经历', icon: 'Briefcase', enabled: expLines.length > 0, order: 2, pageBreakBefore: false },
    { id: 'projects', title: '项目经历', icon: 'Rocket', enabled: projLines.length > 0, order: 3, pageBreakBefore: false },
    { id: 'skills', title: '专业技能', icon: 'Award', enabled: Boolean(draft.skillsText.trim()), order: 4, pageBreakBefore: false },
    { id: 'selfEvaluation', title: '自我评价', icon: 'User', enabled: Boolean(draft.selfEvaluationText.trim()), order: 5, pageBreakBefore: false },
  ];

  const customData: ResumeDocument['customData'] = {};
  if (honorsLines.length > 0) {
    menuSections.push({
      id: 'custom-honors',
      title: '荣誉奖项',
      icon: 'Trophy',
      enabled: true,
      order: menuSections.length,
      pageBreakBefore: false,
    });
    customData['custom-honors'] = honorsLines.map((line) => ({
      id: crypto.randomUUID(),
      title: line,
      subtitle: '',
      dateRange: '',
      description: '',
      visible: true,
    }));
  }

  if (draft.keepUnclassified && draft.unclassifiedText?.trim()) {
    menuSections.push({ id: 'custom-import-unclassified', title: '未分类导入原文（待核对）', icon: 'FileText', enabled: false, order: menuSections.length, pageBreakBefore: false });
    customData['custom-import-unclassified'] = [{ id: crypto.randomUUID(), title: '未分类原文', subtitle: '', dateRange: '', description: draft.unclassifiedText, visible: true }];
  }

  return ResumeDocumentSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: draft.title.trim() || 'PDF 导入简历',
    templateId: 'wondercv-clean-pro',
    createdAt: nowIso,
    updatedAt: nowIso,
    activeSection: 'basic',
    basic: {
      name: draft.name.trim(),
      title: draft.jobTitle.trim(),
      employmentStatus: '',
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      location: draft.location.trim(),
      birthDate: draft.birthDate.trim(),
      photo: '',
    },
    menuSections,
    education,
    experience,
    projects,
    skillContent: draft.skillsText.trim(),
    selfEvaluationContent: draft.selfEvaluationText.trim(),
    customData,
    globalSettings: {
      themeColor: '#167883',
    },
  });
}

/**
 * 按页抽取带坐标与字号的文本 token。
 * 返回结构可直接喂给纯布局引擎（`pdfTextLayout`），用于双栏感知重建与 ATS 逆向体检。
 */
export async function extractTokensFromPdfArrayBuffer(
  buffer: ArrayBuffer | Uint8Array,
  maxPages=Infinity,
  signal?:AbortSignal,
  limits?:{maxPageTokens:number;maxTotalTokens:number;maxTotalChars:number},
): Promise<ExtractedPdfPageTokens[]> {
  ensurePdfWorkerConfigured();
  // pdfjs 会接管并可能 detach 传入的 buffer，必须复制一份再交给它
  const source = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const loadingTask = getDocument({ data: new Uint8Array(source) });
  const abort=()=>{void loadingTask.destroy().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    if(signal?.aborted)throw new Error('PDF 抽取已取消。');
    const pdf=await loadingTask.promise;
    if(pdf.numPages>maxPages)throw new Error('PDF 页数超出对照上限。');
    const pages: ExtractedPdfPageTokens[] = [];
    let totalChars=0,totalTokens=0;
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      if(signal?.aborted)throw new Error('PDF 抽取已取消。');
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1 });
      if(limits&&(!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||viewport.width<=0||viewport.height<=0||viewport.width>4000||viewport.height>4000))throw new Error('PDF 页面尺寸超出本地公告处理上限。');
      const content = await page.getTextContent();
      const tokens: PdfTextToken[] = [];
      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string') continue;
        if(limits){totalChars+=item.str.length;totalTokens++;if(tokens.length>=limits.maxPageTokens||totalTokens>limits.maxTotalTokens||totalChars>limits.maxTotalChars)throw new Error('PDF 文本层超过本地安全上限；没有截断。');}
        const transform = Array.isArray(item.transform) ? item.transform : [];
        const rawHeight =
          typeof item.height === 'number' && Number.isFinite(item.height)
            ? item.height
            : typeof transform[3] === 'number'
              ? transform[3]
              : 0;
        tokens.push({
          str: item.str,
          x: typeof transform[4] === 'number' ? transform[4] : 0,
          y: typeof transform[5] === 'number' ? transform[5] : 0,
          width: typeof item.width === 'number' ? item.width : 0,
          height: Math.abs(rawHeight),
          fontName: typeof item.fontName === 'string' ? item.fontName : undefined,
          pageIndex: pageNo - 1,
        });
      }
      pages.push({
        pageIndex: pageNo - 1,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        tokens,
      });
      page.cleanup();
    }
    return pages;
  } finally {
    signal?.removeEventListener('abort',abort);
    await loadingTask.destroy().catch(()=>{});
  }
}

export async function extractTextFromPdfArrayBuffer(data: ArrayBuffer): Promise<string> {
  const pages = await extractTokensFromPdfArrayBuffer(data);
  return reconstructLinesWithColumnAwareness(pages).filter(Boolean).join('\n');
}

export const RESUME_IMPORT_PDF_MAX_BYTES = 20 * 1024 * 1024;
export const RESUME_IMPORT_TEXT_MAX_BYTES = 1024 * 1024;
export const RESUME_IMPORT_TEXT_MAX_CHARS = 120_000;

/** UTF-8 only; Markdown is treated as text, never rendered or fetched during import. */
export function parseResumeTextFile(bytes: ArrayBuffer | Uint8Array, fileName: string): PdfImportDraft {
  if (!/\.(txt|md|markdown)$/i.test(fileName)) throw new Error('请选择 TXT 或 Markdown 文件。');
  if (bytes.byteLength > RESUME_IMPORT_TEXT_MAX_BYTES) throw new Error('文本文件超过 1 MiB 上限，没有截断。');
  let raw: string;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('文本不是有效 UTF-8；请在本地转换编码后重试。'); }
  if (!raw.trim()) throw new Error('文本文件为空。');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(raw)) throw new Error('文本包含不支持的控制字符。');
  if (raw.length > RESUME_IMPORT_TEXT_MAX_CHARS) throw new Error('文本超过 120000 字符上限，没有截断。');
  return { ...parseExtractedResumeText(raw, fileName.replace(/\.(txt|md|markdown)$/i, '') || '文本导入简历'), sourceKind: 'text' };
}

export async function extractAndParsePdfResume(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string,
): Promise<PdfImportDraft> {
  if (buffer.byteLength > RESUME_IMPORT_PDF_MAX_BYTES) throw new Error('PDF 文件超过 20 MiB 上限，没有截断。');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pages = await Promise.race([
      extractTokensFromPdfArrayBuffer(buffer, 30, controller.signal, { maxPageTokens: 10_000, maxTotalTokens: 30_000, maxTotalChars: RESUME_IMPORT_TEXT_MAX_CHARS }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('PDF 本地解析超过 30 秒，已请求停止。')); }, 30_000); }),
    ]);
    const { lines, lineHeights } = reconstructLinesWithHeights(pages);
    const text = lines.join('\n');
    if (!text.trim()) throw new Error('PDF 无可提取文本；扫描件需要先在本地 OCR，不会创建空白简历。');
    if (text.length > RESUME_IMPORT_TEXT_MAX_CHARS) throw new Error('PDF 重建文本超出字符上限，没有截断。');
    return { ...parseExtractedResumeText(text, fileName, { lineHeights }), sourceKind: 'pdf' };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Rasterize the actual native PDF locally, not a second approximation of the HTML canvas. */
export async function renderPdfPageImages(buffer:Uint8Array,maxPages:number,signal:AbortSignal):Promise<string[]>{
  ensurePdfWorkerConfigured();
  const loadingTask=getDocument({data:new Uint8Array(buffer)});
  const abort=()=>{void loadingTask.destroy().catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try{
    if(signal.aborted)throw new Error('已取消 PDF 图像渲染。');
    const pdf=await loadingTask.promise;
    if(pdf.numPages>maxPages)throw new Error('PDF 页数超出图像预览上限。');
    const images:string[]=[];
    for(let n=1;n<=pdf.numPages;n++){
      if(signal.aborted)throw new Error('已取消 PDF 图像渲染。');
      const page=await pdf.getPage(n),viewport=page.getViewport({scale:1.25});
      const canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const context=canvas.getContext('2d');
      if(!context)throw new Error('无法创建 PDF 预览画布。');
      await page.render({canvas,canvasContext:context,viewport}).promise;
      images.push(canvas.toDataURL('image/png'));canvas.width=0;canvas.height=0;page.cleanup();
    }
    return images;
  }finally{signal.removeEventListener('abort',abort);await loadingTask.destroy().catch(()=>{});}
}

/** Render one original notice page, bounded by pixel dimensions and cancellable. */
export async function renderJobNoticePdfPage(bytes:Uint8Array,pageNo:number,maxPages:number,signal:AbortSignal):Promise<string>{
  ensurePdfWorkerConfigured();
  const loadingTask=getDocument({data:new Uint8Array(bytes)});
  const abort=()=>{void loadingTask.destroy().catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  let canvas:HTMLCanvasElement|undefined;
  try{
    if(signal.aborted)throw new Error('已取消公告预览。');
    const pdf=await loadingTask.promise;
    if(pdf.numPages>maxPages||!Number.isInteger(pageNo)||pageNo<1||pageNo>pdf.numPages)throw new Error('公告预览页码无效。');
    const page=await pdf.getPage(pageNo),v=page.getViewport({scale:1});
    if(!Number.isFinite(v.width)||!Number.isFinite(v.height)||v.width<=0||v.height<=0||v.width>4000||v.height>4000)throw new Error('PDF 页面尺寸超出预览上限。');
    const viewport=page.getViewport({scale:Math.min(1.5,1600/Math.max(v.width,v.height))});
    canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const context=canvas.getContext('2d');if(!context)throw new Error('无法建立公告预览画布。');
    const task=page.render({canvas,canvasContext:context,viewport});
    const cancel=()=>task.cancel();signal.addEventListener('abort',cancel,{once:true});
    try{if(signal.aborted)task.cancel();await task.promise;}finally{signal.removeEventListener('abort',cancel);}
    if(signal.aborted)throw new Error('已取消公告预览。');
    return canvas.toDataURL('image/png');
  }finally{if(canvas){canvas.width=0;canvas.height=0;}signal.removeEventListener('abort',abort);await loadingTask.destroy().catch(()=>{});}
}
