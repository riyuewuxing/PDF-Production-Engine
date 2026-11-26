import type { ResumeDocument } from '../schema/resumeSchema';

export type ResumeLocale = 'zh-CN' | 'en-US';

export interface LocaleLabels {
  locale: ResumeLocale;
  targetRole: string;
  intentRole: string;
  contactSection: string;
  profileSection: string;
  basicSection: string;
  present: string;
  link: string;
  location: string;
  gpa: string;
  unnamed: string;
  openParen: string;
  closeParen: string;
  colon: string;
}

const LABELS_ZH: LocaleLabels = {
  locale: 'zh-CN',
  targetRole: '求职意向：',
  intentRole: '意向岗位：',
  contactSection: '联系方式',
  profileSection: '个人资料',
  basicSection: '基本信息',
  present: '至今',
  link: '链接',
  location: '地点：',
  gpa: 'GPA: ',
  unnamed: '未命名简历',
  openParen: '（',
  closeParen: '）',
  colon: '：',
};

const LABELS_EN: LocaleLabels = {
  locale: 'en-US',
  targetRole: 'Target Role: ',
  intentRole: 'Role: ',
  contactSection: 'Contact',
  profileSection: 'Profile',
  basicSection: 'Basic Info',
  present: 'Present',
  link: 'Link',
  location: 'Location: ',
  gpa: 'GPA: ',
  unnamed: 'Untitled Resume',
  openParen: ' (',
  closeParen: ')',
  colon: ': ',
};

export function getLocaleLabels(locale?: ResumeLocale): LocaleLabels {
  return locale === 'en-US' ? LABELS_EN : LABELS_ZH;
}

const SECTION_TITLE_ZH_TO_EN: Record<string, string> = {
  基本信息: 'Basic Info',
  个人资料: 'Basic Info',
  教育经历: 'Education',
  教育背景: 'Education',
  工作经历: 'Experience',
  实习经历: 'Experience',
  项目经历: 'Projects',
  科研项目: 'Projects',
  专业技能: 'Skills',
  技能特长: 'Skills',
  自我评价: 'Summary',
  个人总结: 'Summary',
  荣誉奖项: 'Honors & Awards',
  获奖情况: 'Honors & Awards',
  学术论文: 'Publications',
  科研成果: 'Publications',
  资质证书: 'Certifications',
  资格证书: 'Certifications',
  社团与组织经历: 'Leadership & Activities',
  校内经历: 'Campus Activities',
  兴趣爱好: 'Interests',
};

const SECTION_TITLE_EN_TO_ZH: Record<string, string> = {
  'basic info': '基本信息',
  education: '教育经历',
  experience: '工作经历',
  'work experience': '工作经历',
  projects: '项目经历',
  skills: '专业技能',
  summary: '自我评价',
  'self evaluation': '自我评价',
  'honors & awards': '荣誉奖项',
  awards: '荣誉奖项',
  publications: '学术论文',
  certifications: '资质证书',
  'leadership & activities': '社团与组织经历',
  'campus activities': '校内经历',
  interests: '兴趣爱好',
};

const FIELD_LABEL_PAIRS: Record<string, { zh: string; en: string }> = {
  name: { zh: '姓名', en: 'Name' },
  title: { zh: '职位', en: 'Role' },
  employmentStatus: { zh: '状态', en: 'Status' },
  birthDate: { zh: '生日', en: 'Birth' },
  email: { zh: '邮箱', en: 'Email' },
  phone: { zh: '电话', en: 'Phone' },
  location: { zh: '所在地', en: 'Location' },
};

function translateSectionTitle(title: string, targetLocale: ResumeLocale): string {
  const trimmed = title.trim();
  if (targetLocale === 'en-US') {
    return SECTION_TITLE_ZH_TO_EN[trimmed] ?? title;
  }
  return SECTION_TITLE_EN_TO_ZH[trimmed.toLowerCase()] ?? title;
}

function translateFieldLabel(
  key: string,
  label: string,
  targetLocale: ResumeLocale,
): string {
  const pair = FIELD_LABEL_PAIRS[key];
  if (!pair) return label;
  const trimmed = label.trim();
  if (targetLocale === 'en-US') {
    return trimmed === pair.zh || trimmed === '求职状态' ? pair.en : label;
  }
  return trimmed.toLowerCase() === pair.en.toLowerCase() ? pair.zh : label;
}

/**
 * 切换简历排印语言（`zh-CN` ↔ `en-US`）：
 * 同步更新 `globalSettings.locale`（切英文关闭中文混排空格）及标准章节/字段标签，保留用户自定义非标标题。
 */
export function switchDocumentLocale(
  doc: ResumeDocument,
  targetLocale: ResumeLocale,
): ResumeDocument {
  return {
    ...doc,
    basic: {
      ...doc.basic,
      fieldOrder: doc.basic.fieldOrder.map((f) => ({
        ...f,
        label: translateFieldLabel(f.key, f.label, targetLocale),
      })),
    },
    menuSections: doc.menuSections.map((sec) => ({
      ...sec,
      title: translateSectionTitle(sec.title, targetLocale),
    })),
    globalSettings: {
      ...doc.globalSettings,
      locale: targetLocale,
      ...(targetLocale === 'en-US' ? { autoCjkSpacing: false } : {}),
    },
  };
}
