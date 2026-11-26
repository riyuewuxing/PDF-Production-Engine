import { type MenuSection, type ResumeDocument, ResumeDocumentSchema } from '../schema/resumeSchema';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export interface JsonResumePayload {
  $schema: string;
  basics: {
    name: string;
    label: string;
    email: string;
    phone: string;
    summary: string;
    location: { city: string };
    profiles: Array<{ network: string; username: string; url: string }>;
  };
  work: Array<{
    name: string;
    position: string;
    startDate: string;
    endDate: string;
    location?: string;
    summary?: string;
    highlights: string[];
  }>;
  education: Array<{
    institution: string;
    area: string;
    studyType: string;
    startDate: string;
    endDate: string;
    score?: string;
    courses: string[];
  }>;
  projects: Array<{
    name: string;
    description: string;
    highlights: string[];
    roles?: string[];
    startDate?: string;
    url?: string;
  }>;
  skills: Array<{
    name: string;
    keywords: string[];
  }>;
  awards: Array<{
    title: string;
    date?: string;
    awarder?: string;
    summary?: string;
  }>;
  meta: {
    theme?: string;
    locale: 'zh-CN' | 'en-US';
    generator: string;
  };
}

export function isJsonResumeFormat(raw: unknown): boolean {
  if (!isPlainObject(raw)) return false;
  if ('schemaVersion' in raw && 'menuSections' in raw && 'globalSettings' in raw) {
    return false;
  }
  return (
    isPlainObject(raw.basics) &&
    (Array.isArray(raw.work) || Array.isArray(raw.education) || Array.isArray(raw.skills) || typeof raw.$schema === 'string')
  );
}

function splitBullets(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * 导出符合 JSON Resume 国际开放标准的 JSON（可用于海外工具/开源静态主题互通）。
 */
export function exportToJsonResume(doc: ResumeDocument): JsonResumePayload {
  const awards: JsonResumePayload['awards'] = [];
  for (const sec of doc.menuSections) {
    if (!sec.enabled) continue;
    for (const item of doc.customData[sec.id] ?? []) {
      if (!item.visible) continue;
      awards.push({
        title: item.title,
        ...(item.dateRange ? { date: item.dateRange } : {}),
        ...(item.subtitle ? { awarder: item.subtitle } : {}),
        ...(item.description ? { summary: item.description } : {}),
      });
    }
  }

  return {
    $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
    basics: {
      name: doc.basic.name,
      label: doc.basic.title,
      email: doc.basic.email,
      phone: doc.basic.phone,
      summary: doc.selfEvaluationContent,
      location: { city: doc.basic.location },
      profiles: doc.basic.customFields
        .filter((f) => f.visible && f.value.trim())
        .map((f) => ({
          network: f.label || 'Info',
          username: f.value,
          url: /^https?:\/\//i.test(f.value.trim()) ? f.value.trim() : '',
        })),
    },
    work: doc.experience
      .filter((e) => e.visible)
      .map((e) => ({
        name: e.company,
        position: e.position,
        startDate: e.startDate,
        endDate: e.endDate,
        ...(e.location ? { location: e.location } : {}),
        highlights: splitBullets(e.description),
      })),
    education: doc.education
      .filter((e) => e.visible)
      .map((e) => ({
        institution: e.school,
        area: e.major,
        studyType: e.degree,
        startDate: e.startDate,
        endDate: e.endDate,
        ...(e.gpa ? { score: e.gpa } : {}),
        courses: splitBullets(e.description),
      })),
    projects: doc.projects
      .filter((p) => p.visible)
      .map((p) => {
        const trimmed = p.description.trim();
        const bullets = splitBullets(trimmed);
        const hasBulletPrefix = /^\s*[-*•]\s+/m.test(trimmed);
        const useHighlights = bullets.length > 1 || hasBulletPrefix;
        return {
          name: p.name,
          description: useHighlights ? '' : trimmed,
          highlights: useHighlights ? bullets : [],
          ...(p.role ? { roles: [p.role] } : {}),
          ...(p.date ? { startDate: p.date } : {}),
          ...(p.link ? { url: p.link } : {}),
        };
      }),
    skills: doc.skillContent.trim()
      ? [{ name: doc.globalSettings.locale === 'en-US' ? 'Skills' : '专业技能', keywords: splitBullets(doc.skillContent) }]
      : [],
    awards,
    meta: {
      theme: doc.templateId,
      locale: doc.globalSettings.locale ?? 'zh-CN',
      generator: 'Resume Studio',
    },
  };
}

/**
 * 将标准 JSON Resume 转换为本工作室规范的 `ResumeDocument`。
 */
export function importFromJsonResume(raw: unknown): ResumeDocument {
  if (!isPlainObject(raw) || !isPlainObject(raw.basics)) {
    throw new Error('非法的 JSON Resume 文件：缺少 basics 对象。');
  }

  const nowIso = new Date().toISOString();
  const basics = raw.basics;
  const meta = isPlainObject(raw.meta) ? raw.meta : {};
  const locale = meta.locale === 'en-US' ? 'en-US' : 'zh-CN';
  const locObj = isPlainObject(basics.location) ? basics.location : {};
  const locationText = str(locObj.city) || str(locObj.region) || str(locObj.address);

  const education = (Array.isArray(raw.education) ? raw.education : [])
    .filter(isPlainObject)
    .map((e, i) => ({
      id: `jr-edu-${i + 1}`,
      school: str(e.institution),
      major: str(e.area),
      degree: str(e.studyType),
      startDate: str(e.startDate),
      endDate: str(e.endDate),
      gpa: str(e.score),
      description: Array.isArray(e.courses) && e.courses.length > 0 ? `- ${e.courses.map((c) => str(c)).filter(Boolean).join('\n- ')}` : '',
      visible: true,
      logo: '',
    }));

  const experience = (Array.isArray(raw.work) ? raw.work : [])
    .filter(isPlainObject)
    .map((w, i) => {
      const highlights = Array.isArray(w.highlights)
        ? w.highlights.map((h) => `- ${str(h)}`).filter((s) => s.length > 2).join('\n')
        : '';
      const desc = [str(w.summary), highlights].filter(Boolean).join('\n');
      return {
        id: `jr-exp-${i + 1}`,
        company: str(w.name) || str(w.company),
        position: str(w.position),
        startDate: str(w.startDate),
        endDate: str(w.endDate),
        location: str(w.location),
        description: desc,
        visible: true,
        logo: '',
      };
    });

  const projects = (Array.isArray(raw.projects) ? raw.projects : [])
    .filter(isPlainObject)
    .map((p, i) => {
      const roles = Array.isArray(p.roles) ? p.roles.map((r) => str(r)).filter(Boolean).join(' / ') : '';
      const highlights = Array.isArray(p.highlights)
        ? p.highlights.map((h) => `- ${str(h)}`).filter((s) => s.length > 2).join('\n')
        : '';
      return {
        id: `jr-proj-${i + 1}`,
        name: str(p.name),
        role: roles,
        date: [str(p.startDate), str(p.endDate)].filter(Boolean).join(' - '),
        description: str(p.description) || highlights,
        link: str(p.url),
        linkLabel: '',
        visible: true,
      };
    });

  const skillLines: string[] = [];
  for (const s of Array.isArray(raw.skills) ? raw.skills : []) {
    if (!isPlainObject(s)) continue;
    const name = str(s.name);
    const kws = Array.isArray(s.keywords) ? s.keywords.map((k) => str(k)).filter(Boolean) : [];
    if (name && kws.length > 0) skillLines.push(`- **${name}**：${kws.join(' / ')}`);
    else if (kws.length > 0) skillLines.push(`- ${kws.join(' / ')}`);
    else if (name) skillLines.push(`- ${name}`);
  }

  const awardsRaw = Array.isArray(raw.awards) ? raw.awards.filter(isPlainObject) : [];
  const customData: ResumeDocument['customData'] = {};
  const menuSections: MenuSection[] = [
    { id: 'basic', title: locale === 'en-US' ? 'Basic Info' : '基本信息', icon: 'User', enabled: true, order: 0, pageBreakBefore: false },
    { id: 'education', title: locale === 'en-US' ? 'Education' : '教育经历', icon: 'GraduationCap', enabled: true, order: 1, pageBreakBefore: false },
    { id: 'experience', title: locale === 'en-US' ? 'Experience' : '工作经历', icon: 'Briefcase', enabled: true, order: 2, pageBreakBefore: false },
    { id: 'projects', title: locale === 'en-US' ? 'Projects' : '项目经历', icon: 'Rocket', enabled: true, order: 3, pageBreakBefore: false },
    { id: 'skills', title: locale === 'en-US' ? 'Skills' : '专业技能', icon: 'Award', enabled: true, order: 4, pageBreakBefore: false },
  ];

  if (awardsRaw.length > 0) {
    customData['custom-awards'] = awardsRaw.map((a, idx) => ({
      id: `jr-award-${idx + 1}`,
      title: str(a.title),
      subtitle: str(a.awarder),
      dateRange: str(a.date),
      description: str(a.summary),
      visible: true,
    }));
    menuSections.push({
      id: 'custom-awards',
      title: locale === 'en-US' ? 'Honors & Awards' : '荣誉奖项',
      icon: 'Trophy',
      enabled: true,
      order: menuSections.length,
      pageBreakBefore: false,
    });
  }

  menuSections.push({
    id: 'selfEvaluation',
    title: locale === 'en-US' ? 'Summary' : '自我评价',
    icon: 'User',
    enabled: true,
    order: menuSections.length,
    pageBreakBefore: false,
  });

  const profiles = Array.isArray(basics.profiles) ? basics.profiles.filter(isPlainObject) : [];
  const customFields = profiles
    .map((pf, idx) => ({
      id: `jr-pf-${idx + 1}`,
      label: str(pf.network, 'Profile'),
      value: str(pf.url) || str(pf.username),
      visible: true,
    }))
    .filter((f) => f.value.trim().length > 0);

  return ResumeDocumentSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: `${str(basics.name, 'Imported')} - JSON Resume`,
    templateId: 'left-right',
    createdAt: nowIso,
    updatedAt: nowIso,
    activeSection: 'basic',
    basic: {
      name: str(basics.name),
      title: str(basics.label),
      email: str(basics.email),
      phone: str(basics.phone),
      location: locationText,
      employmentStatus: '',
      birthDate: '',
      photo: '',
      customFields,
    },
    menuSections,
    education,
    experience,
    projects,
    skillContent: skillLines.join('\n'),
    selfEvaluationContent: str(basics.summary),
    customData,
    globalSettings: {
      locale,
      themeColor: '#167883',
    },
  });
}
