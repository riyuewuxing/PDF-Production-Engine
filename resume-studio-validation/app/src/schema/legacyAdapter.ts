import { cleanResumeRichText } from '../lib/htmlToMarkdown';
import { importFromJsonResume, isJsonResumeFormat } from '../lib/jsonResumeAdapter';
import {
  CustomItem,
  GlobalSettingsSchema,
  MenuSection,
  ResumeDocument,
  ResumeDocumentSchema,
  TEMPLATE_IDS,
  TemplateId,
  normalizeSectionsOrder,
} from './resumeSchema';

type UnknownRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = true): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeTemplateId(rawTemplateId: unknown): TemplateId {
  if (typeof rawTemplateId !== 'string') {
    return 'left-right';
  }
  if ((TEMPLATE_IDS as readonly string[]).includes(rawTemplateId)) {
    return rawTemplateId as TemplateId;
  }
  const aliasMap: Record<string, TemplateId> = {
    classic: 'classic-serif',
    modern: 'wondercv-royal-banner',
    'modern-banner': 'wondercv-royal-banner',
    minimal: 'minimal-ats',
    timeline: 'timeline-focus',
    sidebar: 'sidebar-left',
    default: 'left-right',
  };
  return aliasMap[rawTemplateId] ?? 'left-right';
}

function normalizeBorderRadius(value: unknown): 'none' | 'sm' | 'md' | 'full' | 'custom' {
  if (value === 'none' || value === 'sm' || value === 'md' || value === 'full' || value === 'custom') {
    return value;
  }
  return 'none';
}

function normalizeLayout(value: unknown): 'left' | 'center' | 'right' {
  if (value === 'left' || value === 'center' || value === 'right') {
    return value;
  }
  return 'left';
}

function normalizeHexColor(value: unknown): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    return value.trim();
  }
  return '#000000';
}

function ensureId(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return crypto.randomUUID();
}

function mapLegacyRecordToCustomItem(item: UnknownRecord): CustomItem {
  const title =
    asString(item.title) ||
    asString(item.name) ||
    asString(item.certificateName) ||
    '未命名条目';
  const subtitle =
    asString(item.subtitle) ||
    asString(item.issuer) ||
    asString(item.journal) ||
    asString(item.authors);
  const dateRange =
    asString(item.dateRange) ||
    asString(item.date) ||
    asString(item.issueDate);
  const description = asString(item.description) || asString(item.summary);
  return {
    id: ensureId(item.id),
    title,
    subtitle,
    dateRange,
    description,
    visible: asBoolean(item.visible, true),
  };
}

export function adaptLegacyMagicResume(raw: unknown): ResumeDocument {
  if (!isPlainObject(raw)) {
    throw new Error('无效的简历 JSON：根节点必须是对象。');
  }

  const hasLegacySignals =
    isPlainObject(raw.basic) ||
    Array.isArray(raw.menuSections) ||
    Array.isArray(raw.education) ||
    Array.isArray(raw.projects) ||
    Array.isArray(raw.experience);

  if (!hasLegacySignals) {
    throw new Error('无法识别的简历 JSON 结构：缺少 basic、menuSections 或经历数组字段。');
  }

  const nowIso = new Date().toISOString();
  const rawBasic = isPlainObject(raw.basic) ? raw.basic : {};
  const rawPhotoConfig = isPlainObject(rawBasic.photoConfig) ? rawBasic.photoConfig : {};
  const rawGlobal = isPlainObject(raw.globalSettings) ? raw.globalSettings : {};

  const rawFieldOrder = Array.isArray(rawBasic.fieldOrder) ? rawBasic.fieldOrder : [];
  const fieldOrder =
    rawFieldOrder.length > 0
      ? rawFieldOrder
          .filter(isPlainObject)
          .map((field, index) => {
            const rawKey = asString(field.key, `field_${index + 1}`);
            const normalizedKey = rawKey === 'employementStatus' ? 'employmentStatus' : rawKey;
            return {
              id: ensureId(field.id ?? String(index + 1)),
              key: normalizedKey,
              label: asString(field.label, normalizedKey),
              type: asString(field.type, 'text'),
              visible: asBoolean(field.visible, true),
            };
          })
      : undefined;

  const rawIcons = isPlainObject(rawBasic.icons) ? rawBasic.icons : {};
  const icons: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawIcons)) {
    if (typeof v === 'string') {
      const normalizedKey = k === 'employementStatus' ? 'employmentStatus' : k;
      icons[normalizedKey] = v;
    }
  }

  const customFields = Array.isArray(rawBasic.customFields)
    ? rawBasic.customFields.filter(isPlainObject).map((field) => ({
        id: ensureId(field.id),
        label: asString(field.label),
        value: asString(field.value),
        visible: asBoolean(field.visible, true),
      }))
    : [];

  const rawMenuSections = Array.isArray(raw.menuSections) ? raw.menuSections : [];
  const menuSections: MenuSection[] =
    rawMenuSections.length > 0
      ? rawMenuSections.filter(isPlainObject).map((sec, index) => ({
          id: ensureId(sec.id ?? `section-${index}`),
          title: asString(sec.title, '未命名模块'),
          icon: asString(sec.icon, 'FileText'),
          enabled: asBoolean(sec.enabled, true),
          order:
            typeof sec.order === 'number' && Number.isFinite(sec.order)
              ? Math.max(0, Math.round(sec.order))
              : index,
          pageBreakBefore: asBoolean(sec.pageBreakBefore, false),
        }))
      : [
          { id: 'basic', title: '基本信息', icon: 'User', enabled: true, order: 0, pageBreakBefore: false },
          { id: 'education', title: '教育经历', icon: 'GraduationCap', enabled: true, order: 1, pageBreakBefore: false },
          { id: 'experience', title: '工作经历', icon: 'Briefcase', enabled: true, order: 2, pageBreakBefore: false },
          { id: 'projects', title: '项目经历', icon: 'Rocket', enabled: true, order: 3, pageBreakBefore: false },
          { id: 'skills', title: '专业技能', icon: 'Zap', enabled: true, order: 4, pageBreakBefore: false },
          { id: 'selfEvaluation', title: '自我评价', icon: 'User', enabled: true, order: 5, pageBreakBefore: false },
        ];

  const customData: Record<string, CustomItem[]> = {};
  if (isPlainObject(raw.customData)) {
    for (const [sectionId, items] of Object.entries(raw.customData)) {
      if (Array.isArray(items)) {
        customData[sectionId] = items.filter(isPlainObject).map(mapLegacyRecordToCustomItem);
      }
    }
  }

  const extraCollections: Array<{ key: 'publications' | 'certificates'; title: string; icon: string }> = [
    { key: 'publications', title: '学术成果', icon: 'BookOpen' },
    { key: 'certificates', title: '资格证书', icon: 'Award' },
  ];

  for (const extra of extraCollections) {
    const rawItems = raw[extra.key];
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      customData[extra.key] = rawItems.filter(isPlainObject).map(mapLegacyRecordToCustomItem);
      if (!menuSections.some((sec) => sec.id === extra.key)) {
        menuSections.push({
          id: extra.key,
          title: extra.title,
          icon: extra.icon,
          enabled: true,
          order: menuSections.length,
          pageBreakBefore: false,
        });
      }
    }
  }

  const education = Array.isArray(raw.education)
    ? raw.education.filter(isPlainObject).map((edu) => ({
        id: ensureId(edu.id),
        school: asString(edu.school),
        major: asString(edu.major),
        degree: asString(edu.degree),
        startDate: asString(edu.startDate),
        endDate: asString(edu.endDate),
        gpa: asString(edu.gpa),
        description: asString(edu.description),
        visible: asBoolean(edu.visible, true),
        logo: asString(edu.logo),
      }))
    : [];

  const experience = Array.isArray(raw.experience)
    ? raw.experience.filter(isPlainObject).map((exp) => ({
        id: ensureId(exp.id),
        company: asString(exp.company),
        position: asString(exp.position),
        startDate: asString(exp.startDate),
        endDate: asString(exp.endDate),
        location: asString(exp.location),
        description: asString(exp.description),
        visible: asBoolean(exp.visible, true),
        logo: asString(exp.logo),
      }))
    : [];

  const projects = Array.isArray(raw.projects)
    ? raw.projects.filter(isPlainObject).map((proj) => ({
        id: ensureId(proj.id),
        name: asString(proj.name),
        role: asString(proj.role),
        date:
          asString(proj.date) ||
          [asString(proj.startDate), asString(proj.endDate)].filter(Boolean).join(' - '),
        description: asString(proj.description),
        link: asString(proj.link),
        linkLabel: asString(proj.linkLabel),
        visible: asBoolean(proj.visible, true),
      }))
    : [];

  const globalSettings = GlobalSettingsSchema.parse({
    baseFontSize: clamp(asNumber(rawGlobal.baseFontSize, 15), 10, 20),
    pagePadding: clamp(asNumber(rawGlobal.pagePadding, 32), 12, 56),
    paragraphSpacing: clamp(asNumber(rawGlobal.paragraphSpacing, 16), 0, 32),
    lineHeight: clamp(asNumber(rawGlobal.lineHeight, 1.2), 1.0, 2.2),
    sectionSpacing: clamp(asNumber(rawGlobal.sectionSpacing, 24), 6, 40),
    headerSize: clamp(asNumber(rawGlobal.headerSize, 18), 13, 28),
    subheaderSize: clamp(asNumber(rawGlobal.subheaderSize, 16), 12, 24),
    useIconMode: asBoolean(rawGlobal.useIconMode, true),
    themeColor: normalizeHexColor(rawGlobal.themeColor),
    centerSubtitle: asBoolean(rawGlobal.centerSubtitle, true),
  });

  const title = asString(raw.title) || asString(rawBasic.title) || '未命名简历';

  const documentInput = {
    schemaVersion: 1 as const,
    id: ensureId(raw.id),
    title,
    templateId: normalizeTemplateId(raw.templateId),
    createdAt: asString(raw.createdAt, nowIso),
    updatedAt: asString(raw.updatedAt, nowIso),
    activeSection: asString(raw.activeSection, 'basic'),
    basic: {
      name: asString(rawBasic.name),
      title: asString(rawBasic.title),
      employmentStatus: asString(rawBasic.employmentStatus) || asString(rawBasic.employementStatus),
      email: asString(rawBasic.email),
      phone: asString(rawBasic.phone),
      location: asString(rawBasic.location),
      birthDate: asString(rawBasic.birthDate),
      photo: asString(rawBasic.photo),
      photoConfig: {
        width: clamp(asNumber(rawPhotoConfig.width, 90), 40, 240),
        height: clamp(asNumber(rawPhotoConfig.height, 120), 40, 300),
        aspectRatio: asString(rawPhotoConfig.aspectRatio, '3:4'),
        borderRadius: normalizeBorderRadius(rawPhotoConfig.borderRadius),
        customBorderRadius: clamp(asNumber(rawPhotoConfig.customBorderRadius, 0), 0, 999),
        visible: asBoolean(rawPhotoConfig.visible, true),
      },
      ...(fieldOrder ? { fieldOrder } : {}),
      icons,
      customFields,
      layout: normalizeLayout(rawBasic.layout),
    },
    menuSections: normalizeSectionsOrder(menuSections),
    education,
    experience,
    projects,
    skillContent: asString(raw.skillContent),
    selfEvaluationContent: asString(raw.selfEvaluationContent),
    customData,
    globalSettings,
  };

  return cleanResumeRichText(ResumeDocumentSchema.parse(documentInput));
}

export function adaptResumeOrLegacy(raw: unknown): ResumeDocument {
  if (isPlainObject(raw) && raw.schemaVersion === 1) {
    return cleanResumeRichText(ResumeDocumentSchema.parse(raw));
  }
  if (isJsonResumeFormat(raw)) {
    return cleanResumeRichText(importFromJsonResume(raw));
  }
  return adaptLegacyMagicResume(raw);
}
