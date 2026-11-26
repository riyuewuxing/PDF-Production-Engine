import { z } from 'zod';

export const TEMPLATE_IDS = [
  // 19 套 VIP 商业旗舰（V4 晴蓝突出页眉 + V3 18 套 1:1 复刻，默认画廊置顶）
  'vip-sky-notch-hero',
  'vip-emerald-wave-arc',
  'vip-royal-double-wave',
  'vip-cyber-dark',
  'vip-teal-right-flag',
  'vip-burgundy-center-hero',
  'vip-crimson-double-arc',
  'vip-burgundy-left-sidebar',
  'vip-obsidian-gold-hero',
  'vip-cyan-arc-trapezoid',
  'vip-corner-navy-split',
  'vip-amber-left-sidebar',
  'vip-crimson-ribbon-banner',
  'vip-classic-top-photo-pro',
  'vip-lavender-slant-tag',
  'vip-crimson-card',
  'vip-rose-banner-split',
  'vip-crimson-dot-minimal',
  'vip-teal-top-pill',
  // 2 套 WonderCV 经典旗舰
  'wondercv-teal-sidebar',
  'wondercv-royal-banner',
  'wondercv-clean-pro',
  'wondercv-diagonal-hero',
  'wondercv-soft-right',
  'wondercv-mint-card',
  'left-right',
  'teacher-table-classic',
  'edu-navy-ribbon',
  'red-header-formal',
  'double-line-scholar',
  'compact-badge',
  'minimal-ats',
  'lapis-clean',
  'jakes-resume-cn',
  'rendercv-classic',
  'rendercv-sb2nov',
  'chicv-minimal',
  'json-paper-clean',
  'sidebar-left',
  'sidebar-right',
  'rx-azurill',
  'rx-chikorita',
  'rx-ditto-card',
  'json-macchiato',
  'classic-serif',
  'timeline-focus',
  'editorial-accent',
  'grid-card',
  'awesome-cv-modern',
  'harvard-academic',
  'modern-deedy',
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const TemplateIdSchema = z.enum(TEMPLATE_IDS);

export const BasicFieldSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.string().default('text'),
  visible: z.boolean().default(true),
});

export type BasicField = z.infer<typeof BasicFieldSchema>;

export const CustomFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().default(''),
  value: z.string().default(''),
  visible: z.boolean().default(true),
});

export type CustomField = z.infer<typeof CustomFieldSchema>;

export const PhotoConfigSchema = z.object({
  width: z.number().min(40).max(240).default(90),
  height: z.number().min(40).max(300).default(120),
  aspectRatio: z.string().default('3:4'),
  borderRadius: z.enum(['none', 'sm', 'md', 'full', 'custom']).default('none'),
  customBorderRadius: z.number().min(0).max(999).default(0),
  visible: z.boolean().default(true),
  frameStyle: z.enum(['none', 'white-ring', 'card-border']).default('none'),
  bgBackdrop: z.string().default(''),
});

export type PhotoConfig = z.infer<typeof PhotoConfigSchema>;

export const BasicInfoSchema = z.object({
  name: z.string().default(''),
  title: z.string().default(''),
  employmentStatus: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  location: z.string().default(''),
  birthDate: z.string().default(''),
  photo: z.string().default(''),
  photoConfig: PhotoConfigSchema.default({
    width: 90,
    height: 120,
    aspectRatio: '3:4',
    borderRadius: 'none',
    customBorderRadius: 0,
    visible: true,
    frameStyle: 'none',
    bgBackdrop: '',
  }),
  fieldOrder: z.array(BasicFieldSchema).default([
    { id: '1', key: 'name', label: '姓名', type: 'text', visible: true },
    { id: '2', key: 'title', label: '职位', type: 'text', visible: true },
    { id: '3', key: 'employmentStatus', label: '状态', type: 'text', visible: true },
    { id: '4', key: 'birthDate', label: '生日', type: 'date', visible: true },
    { id: '5', key: 'email', label: '邮箱', type: 'text', visible: true },
    { id: '6', key: 'phone', label: '电话', type: 'text', visible: true },
    { id: '7', key: 'location', label: '所在地', type: 'text', visible: true },
  ]),
  icons: z.record(z.string(), z.string()).default({
    email: 'Mail',
    phone: 'Phone',
    birthDate: 'CalendarRange',
    employmentStatus: 'Briefcase',
    location: 'MapPin',
  }),
  customFields: z.array(CustomFieldSchema).default([]),
  layout: z.enum(['left', 'center', 'right']).default('left'),
});

export type BasicInfo = z.infer<typeof BasicInfoSchema>;

export const EducationItemSchema = z.object({
  id: z.string().min(1),
  school: z.string().default(''),
  major: z.string().default(''),
  degree: z.string().default(''),
  startDate: z.string().default(''),
  endDate: z.string().default(''),
  gpa: z.string().default(''),
  description: z.string().default(''),
  visible: z.boolean().default(true),
  logo: z.string().default(''),
});

export type EducationItem = z.infer<typeof EducationItemSchema>;

export const ExperienceItemSchema = z.object({
  id: z.string().min(1),
  company: z.string().default(''),
  position: z.string().default(''),
  startDate: z.string().default(''),
  endDate: z.string().default(''),
  location: z.string().default(''),
  description: z.string().default(''),
  visible: z.boolean().default(true),
  logo: z.string().default(''),
});

export type ExperienceItem = z.infer<typeof ExperienceItemSchema>;

export const ProjectItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  role: z.string().default(''),
  date: z.string().default(''),
  description: z.string().default(''),
  link: z.string().default(''),
  linkLabel: z.string().default(''),
  visible: z.boolean().default(true),
});

export type ProjectItem = z.infer<typeof ProjectItemSchema>;

export const CustomItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  subtitle: z.string().default(''),
  dateRange: z.string().default(''),
  description: z.string().default(''),
  visible: z.boolean().default(true),
});

export type CustomItem = z.infer<typeof CustomItemSchema>;

export const MenuSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().default('FileText'),
  enabled: z.boolean().default(true),
  order: z.number().int().min(0),
  pageBreakBefore: z.boolean().default(false),
});

export type MenuSection = z.infer<typeof MenuSectionSchema>;

export const GlobalSettingsSchema = z.object({
  baseFontSize: z.number().min(10).max(20).default(15),
  pagePadding: z.number().min(12).max(56).default(32),
  paragraphSpacing: z.number().min(0).max(32).default(16),
  lineHeight: z.number().min(1.0).max(2.2).default(1.2),
  sectionSpacing: z.number().min(6).max(40).default(24),
  headerSize: z.number().min(13).max(28).default(18),
  subheaderSize: z.number().min(12).max(24).default(16),
  useIconMode: z.boolean().default(true),
  themeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'themeColor 必须是 6 位十六进制颜色，如 #000000')
    .default('#000000'),
  paperBackground: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'paperBackground 必须是 6 位十六进制颜色')
    .default('#ffffff'),
  surfaceStyle: z.enum(['solid', 'gradient', 'tint', 'outline']).default('solid'),
  headingStyle: z
    .enum([
      'auto',
      'circle-icon',
      'left-bar',
      'double-line',
      'pill',
      'clean',
      'trapezoid-flag',
      'ribbon-fold',
      'dot-accent',
      'block-tag',
    ])
    .default('auto'),
  fontFamily: z
    .enum(['sans', 'serif', 'misans', 'yahei', 'kaiti', 'fangsong', 'hei', 'tech'])
    .default('sans'),
  customFontFamily: z.string().default(''),
  letterSpacing: z.number().min(-0.5).max(2).default(0),
  headingWeight: z.enum(['normal', 'semibold', 'bold']).default('bold'),
  tabularNums: z.boolean().default(true),
  showPageGuide: z.boolean().default(true),
  avoidItemSplit: z.boolean().default(true),
  autoCjkSpacing: z.boolean().default(false),
  centerSubtitle: z.boolean().default(true),
  locale: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
});

export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>;

export const ResumeDocumentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  title: z.string().min(1),
  templateId: TemplateIdSchema.default('left-right'),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  activeSection: z.string().default('basic'),
  basic: BasicInfoSchema,
  menuSections: z.array(MenuSectionSchema).min(1),
  education: z.array(EducationItemSchema).default([]),
  experience: z.array(ExperienceItemSchema).default([]),
  projects: z.array(ProjectItemSchema).default([]),
  skillContent: z.string().default(''),
  selfEvaluationContent: z.string().default(''),
  customData: z.record(z.string(), z.array(CustomItemSchema)).default({}),
  globalSettings: GlobalSettingsSchema,
});

export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;

/** Existing documents already carry these fields. No on-disk schema migration required. */
export function resumeRevision(doc: Pick<ResumeDocument, 'id' | 'updatedAt'>): string {
  return JSON.stringify([doc.id, doc.updatedAt]);
}

export interface ResumeSummary {
  slug: string;
  id: string;
  title: string;
  templateId: TemplateId;
  updatedAt: string;
  isMaster: boolean;
}

/** Listing isolates damaged entries without changing their on-disk bytes. */
export interface ResumeListIssue {
  slug:string;
  reason:'CORRUPTED_JSON'|'SCHEMA_INVALID'|'UNSAFE_ENTRY'|'UNREADABLE';
}
export interface ResumeListResult {
  master:ResumeSummary|null;
  resumes:ResumeSummary[];
  issues?:ResumeListIssue[];
}

export type MenuSectionInput = Omit<MenuSection, 'pageBreakBefore'> & {
  pageBreakBefore?: boolean;
};

export function normalizeSectionsOrder(sections: MenuSectionInput[]): MenuSection[] {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((section, index) => ({
      ...section,
      pageBreakBefore: Boolean(section.pageBreakBefore),
      order: index,
    }));
}
