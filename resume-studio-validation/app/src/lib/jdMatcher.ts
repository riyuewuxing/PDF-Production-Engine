import type { ResumeDocument } from '../schema/resumeSchema';
import {visibleBasicValue} from './aiContext';

export interface JdMatchResult {
  totalKeywords: number;
  matchedCount: number;
  coveragePercent: number;
  matchedKeywords: string[];
  missingKeywords: string[];
}

const DOMAIN_ZH_LEXICON = [
  '高中物理',
  '初中物理',
  '物理教学',
  '一线教学',
  '课堂教学',
  '实验教学',
  '新高考',
  '新课标',
  '课程标准',
  '核心素养',
  '班级管理',
  '班主任',
  '德育',
  '备课',
  '教研',
  '磨课',
  '公开课',
  '示范课',
  '试题命制',
  '命题',
  '高考真题',
  '分层作业',
  '个性化辅导',
  '学情分析',
  '教学反思',
  '竞赛辅导',
  '物理竞赛',
  '教师资格证',
  '普通话',
  '板书',
  '多媒体',
  '希沃白板',
  '智慧课堂',
  '数字化教学',
  '可视化课件',
  '仿真实验',
  '人工智能',
  '教育技术',
  '教学科研',
  '课题研究',
  '家校沟通',
  '身心健康',
  '本科',
  '硕士',
  '研究生',
  '中共党员',
  '共青团员',
  '团队协作',
  '沟通表达',
  '数据分析',
  '自动化',
  '工作流',
  '全栈开发',
  '前端开发',
  '系统架构',
  '性能优化',
  '单元测试',
  '需求分析',
];

const ASCII_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'have',
  'will',
  'you',
  'are',
  'not',
  'can',
  'our',
  'your',
  'etc',
  'com',
  'http',
  'https',
  'www',
  'jd',
]);

export function collectResumePlainText(doc: ResumeDocument): string {
  const enabled=new Set(doc.menuSections.filter(s=>s.enabled).map(s=>s.id));
  const parts:string[]=[
    visibleBasicValue(doc,'name'),visibleBasicValue(doc,'title'),visibleBasicValue(doc,'employmentStatus'),visibleBasicValue(doc,'location'),
    ...(enabled.has('basic')?doc.basic.customFields.filter(f=>f.visible).map(f=>f.label+' '+f.value):[]),
    ...(enabled.has('education')?doc.education.filter(e=>e.visible).map(e=>[e.school,e.major,e.degree,e.gpa,e.description].join(' ')):[]),
    ...(enabled.has('experience')?doc.experience.filter(e=>e.visible).map(e=>[e.company,e.position,e.location,e.description].join(' ')):[]),
    ...(enabled.has('projects')?doc.projects.filter(p=>p.visible).map(p=>[p.name,p.role,p.description].join(' ')):[]),
    enabled.has('skills')?doc.skillContent:'',enabled.has('selfEvaluation')?doc.selfEvaluationContent:'',
  ];
  for(const [id,list] of Object.entries(doc.customData))if(enabled.has(id))for(const item of list.filter(i=>i.visible))parts.push([item.title,item.subtitle,item.description].join(' '));
  return parts.join('\n').toLowerCase();
}

export function extractJdKeywords(jdText: string): string[] {
  const normalized = jdText.trim();
  if (!normalized) return [];

  const lower = normalized.toLowerCase();
  const seen = new Map<string, string>(); // lowercase key -> display token

  // 1. Domain lexicon hits (highest precision)
  for (const term of DOMAIN_ZH_LEXICON) {
    if (lower.includes(term.toLowerCase())) {
      seen.set(term.toLowerCase(), term);
    }
  }

  // 2. English / Technical / Acronym tokens (e.g., AI, Python, React, CET-4, STEM, PPT)
  const asciiMatches = normalized.match(/[A-Za-z][A-Za-z0-9.+#/-]{1,20}/g) ?? [];
  for (const raw of asciiMatches) {
    const trimmed = raw.replace(/^[./-]+|[./-]+$/g, '');
    if (trimmed.length < 2) continue;
    const key = trimmed.toLowerCase();
    if (ASCII_STOPWORDS.has(key)) continue;
    if (!seen.has(key)) {
      seen.set(key, trimmed);
    }
  }

  // 3. Quoted / bracketed Chinese terms in JD (e.g., “双师教学”, 【物理实验】)
  const quotedZh = normalized.match(/[“"《【\[]([\u4e00-\u9fff]{2,10})[”"》】\]]/g) ?? [];
  for (const q of quotedZh) {
    const inner = q.slice(1, -1);
    const key = inner.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, inner);
    }
  }

  // 4. Frequent 2-4 char Chinese segments split by punctuation (for custom roles outside lexicon)
  if (seen.size < 8) {
    const segments = normalized.split(/[^\u4e00-\u9fff]+/).filter((s) => s.length >= 2 && s.length <= 6);
    const freq = new Map<string, number>();
    for (const seg of segments) {
      freq.set(seg, (freq.get(seg) ?? 0) + 1);
    }
    const sortedExtra = [...freq.entries()]
      .filter(([w, count]) => count >= 2 || (w.length <= 4 && !/岗位|职责|要求|优先|学历|能力|工作|以上/.test(w)))
      .sort((a, b) => b[1] - a[1]);
    for (const [w] of sortedExtra) {
      if (seen.size >= 18) break;
      if (!seen.has(w.toLowerCase())) {
        seen.set(w.toLowerCase(), w);
      }
    }
  }

  return [...seen.values()].slice(0, 24);
}

export function matchResumeWithJd(doc: ResumeDocument, jdText: string): JdMatchResult {
  const keywords = extractJdKeywords(jdText);
  if (keywords.length === 0) {
    return {
      totalKeywords: 0,
      matchedCount: 0,
      coveragePercent: 0,
      matchedKeywords: [],
      missingKeywords: [],
    };
  }

  const corpus = collectResumePlainText(doc);
  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  for (const kw of keywords) {
    if (corpus.includes(kw.toLowerCase())) {
      matchedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  }

  const matchedCount = matchedKeywords.length;
  const coveragePercent = Math.round((matchedCount / keywords.length) * 100);

  return {
    totalKeywords: keywords.length,
    matchedCount,
    coveragePercent,
    matchedKeywords,
    missingKeywords,
  };
}
