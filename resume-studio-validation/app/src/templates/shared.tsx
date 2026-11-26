import {
  Award,
  BookOpen,
  Briefcase,
  CalendarRange,
  Code,
  ExternalLink,
  FileText,
  GraduationCap,
  Heart,
  Layers,
  Lightbulb,
  Mail,
  MapPin,
  Phone,
  Rocket,
  Sparkles,
  Star,
  Target,
  Trophy,
  User,
  Users,
  Zap,
} from 'lucide-react';
import React, { createContext, useContext } from 'react';
import { resolveAssetUrl } from '../lib/apiClient';
import { formatCjkSpacing } from '../lib/cjkSpacing';
import { getLocaleLabels } from '../lib/resumeLocale';
import { RichText } from '../lib/richText';
import type {
  CustomItem,
  EducationItem,
  ExperienceItem,
  GlobalSettings,
  MenuSection,
  ProjectItem,
  ResumeDocument,
} from '../schema/resumeSchema';

export interface PreviewInteractionValue {
  highlightedSectionId?: string | null;
  onSelectSection?: (sectionId: string) => void;
}

export const PreviewInteractionContext = createContext<PreviewInteractionValue | null>(null);

/**
 * 排印字体栈。
 *
 * ⚠️ PDF 嵌入红线（V5 Phase 1 真机实测 + PDF ToUnicode 码点核验得出）：
 * Chromium `printToPDF` 在**嵌入 Noto Sans SC / Noto Serif SC 字体子集**时，会把常用汉字
 * 的 ToUnicode 映射写成康熙部首（U+5927「大」→ U+2F24「⼤」、U+6708「月」→ U+2F49「⽉」）。
 * 这类字符不显示为乱码，但任何 ATS / 招聘系统的关键词匹配都会失效
 * （「示例大学」永远匹配不上「示例⼤学」）。
 *
 * 因此：Windows 系统与本地无衬线/衬线字体必须排在 Noto 之前；Noto 仅保留为 macOS/Linux 的跨平台回退。
 * 同时 `sans` 选用 MiSans/等线前置以与 `yahei`（纯微软雅黑）保持真实视觉及字体子集区分。
 */
export const FONT_STACKS: Record<GlobalSettings['fontFamily'], string> = {
  sans: '"MiSans", "DengXian", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif',
  serif: '"Songti SC", "STSong", "SimSun", "Microsoft YaHei", "Noto Serif SC", Georgia, serif',
  misans: '"MiSans", "DengXian", "PingFang SC", "Microsoft YaHei", sans-serif',
  yahei: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  kaiti: '"KaiTi", "STKaiti", "LXGW WenKai", "Noto Serif SC", serif',
  fangsong: '"FangSong", "STFangsong", "Noto Serif SC", serif',
  hei: '"SimHei", "Heiti SC", "Noto Sans SC", sans-serif',
  tech: '"Segoe UI", "Inter", "Consolas", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
};

export function resolveFontFamilyStack(
  globalSettings: GlobalSettings,
  preferredPreset?: GlobalSettings['fontFamily'],
): string {
  const preset = preferredPreset ?? globalSettings.fontFamily ?? 'sans';
  const baseStack = FONT_STACKS[preset] ?? FONT_STACKS.sans;
  const custom = globalSettings.customFontFamily?.trim();
  if (!custom) return baseStack;
  const safeCustom = custom.replace(/["\\]/g, '').trim();
  return safeCustom ? `"${safeCustom}", ${baseStack}` : baseStack;
}

export function getHeadingFontWeight(globalSettings: GlobalSettings): 400 | 600 | 700 {
  if (globalSettings.headingWeight === 'normal') return 400;
  if (globalSettings.headingWeight === 'semibold') return 600;
  return 700;
}

export function getSheetRootStyle(globalSettings: GlobalSettings, extra?: React.CSSProperties): React.CSSProperties {
  const letterSpacingPx = Number(globalSettings.letterSpacing ?? 0);
  return {
    backgroundColor: globalSettings.paperBackground || '#ffffff',
    fontFamily: resolveFontFamilyStack(globalSettings),
    fontSize: `${globalSettings.baseFontSize}px`,
    lineHeight: globalSettings.lineHeight,
    ...(letterSpacingPx !== 0 ? { letterSpacing: `${letterSpacingPx}px` } : {}),
    fontVariantNumeric: globalSettings.tabularNums !== false ? 'tabular-nums' : 'normal',
    ...extra,
  };
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [30, 41, 59];
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

function toHex(r: number, g: number, b: number): string {
  const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clampByte(r), clampByte(g), clampByte(b)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function mixWithWhite(hex: string, whiteRatio = 0.9): string {
  const [r, g, b] = parseHexRgb(hex);
  return toHex(
    r + (255 - r) * whiteRatio,
    g + (255 - g) * whiteRatio,
    b + (255 - b) * whiteRatio,
  );
}

export function darkenHex(hex: string, ratio = 0.25): string {
  const [r, g, b] = parseHexRgb(hex);
  return toHex(r * (1 - ratio), g * (1 - ratio), b * (1 - ratio));
}

export function getContrastTextColor(hex: string): string {
  const [r, g, b] = parseHexRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0f172a' : '#ffffff';
}

export interface SurfaceFillResult {
  style: React.CSSProperties;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  isLight: boolean;
}

export function getSurfaceFill(
  accent: string,
  surfaceStyle: GlobalSettings['surfaceStyle'] = 'solid',
  forceTint = false,
): SurfaceFillResult {
  const mode = forceTint && surfaceStyle === 'solid' ? 'tint' : surfaceStyle;

  if (mode === 'tint') {
    const bg = mixWithWhite(accent, 0.9);
    return {
      style: { backgroundColor: bg },
      textColor: '#0f172a',
      mutedColor: '#475569',
      borderColor: mixWithWhite(accent, 0.72),
      isLight: true,
    };
  }

  if (mode === 'outline') {
    return {
      style: {
        backgroundColor: '#ffffff',
        border: `1.5px solid ${accent}`,
      },
      textColor: '#0f172a',
      mutedColor: '#475569',
      borderColor: accent,
      isLight: true,
    };
  }

  if (mode === 'gradient') {
    const endColor = darkenHex(accent, 0.26);
    const textColor = getContrastTextColor(accent);
    const isLight = textColor !== '#ffffff';
    return {
      style: {
        backgroundColor: accent,
        backgroundImage: `linear-gradient(135deg, ${accent} 0%, ${endColor} 100%)`,
      },
      textColor,
      mutedColor: isLight ? '#334155' : 'rgba(255,255,255,0.84)',
      borderColor: isLight ? 'rgba(15,23,42,0.16)' : 'rgba(255,255,255,0.22)',
      isLight,
    };
  }

  // solid
  const textColor = getContrastTextColor(accent);
  const isLight = textColor !== '#ffffff';
  return {
    style: { backgroundColor: accent },
    textColor,
    mutedColor: isLight ? '#334155' : 'rgba(255,255,255,0.84)',
    borderColor: isLight ? 'rgba(15,23,42,0.16)' : 'rgba(255,255,255,0.22)',
    isLight,
  };
}

export function InteractiveSection({
  sectionId,
  title,
  pageBreakBefore = false,
  className = '',
  style,
  children,
}: {
  sectionId: string;
  title: string;
  pageBreakBefore?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ctx = useContext(PreviewInteractionContext);
  const interactive = Boolean(ctx?.onSelectSection);
  const isSelected = interactive && ctx?.highlightedSectionId === sectionId;
  const breakClass = pageBreakBefore ? 'resume-force-page-break' : '';

  const pageBreakGuide = pageBreakBefore ? (
    <div
      aria-hidden="true"
      className="no-print mb-2 flex items-center gap-2 text-[10px] font-medium text-sky-600"
    >
      <span className="h-px flex-1 border-t border-dashed border-sky-400" />
      <span className="rounded bg-sky-50 px-1.5 py-0.5 border border-sky-200">手动分页符 · 从新页起</span>
      <span className="h-px flex-1 border-t border-dashed border-sky-400" />
    </div>
  ) : null;

  if (!interactive) {
    return (
      <section className={`${breakClass} ${className}`.trim()} style={style}>
        {pageBreakGuide}
        {children}
      </section>
    );
  }

  return (
    <section
      data-section-id={sectionId}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        ctx?.onSelectSection?.(sectionId);
      }}
      style={style}
      className={`group/sec relative cursor-pointer transition-shadow ${breakClass} ${
        isSelected
          ? 'ring-2 ring-amber-500/80 ring-offset-2 rounded-xs'
          : 'hover:ring-1 hover:ring-dashed hover:ring-amber-500/75 hover:ring-offset-2 hover:rounded-xs'
      } ${className}`}
    >
      {pageBreakGuide}
      <span
        className={`no-print pointer-events-none absolute -top-2.5 right-0 z-30 rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-xs transition-opacity ${
          isSelected ? 'opacity-100' : 'opacity-0 group-hover/sec:opacity-100'
        }`}
      >
        点击编辑「{title}」
      </span>
      {children}
    </section>
  );
}

export interface MetaDatum {
  key: string;
  label: string;
  value: string;
  iconName?: string;
  isPrimaryContact?: boolean;
}

export function hasVisiblePhoto(doc: ResumeDocument): boolean {
  return Boolean(doc.basic.photo.trim() && doc.basic.photoConfig.visible);
}

export function getPhotoBorderRadiusCss(doc: ResumeDocument): string {
  const { borderRadius, customBorderRadius } = doc.basic.photoConfig;
  if (borderRadius === 'full') return '9999px';
  if (borderRadius === 'md') return '8px';
  if (borderRadius === 'sm') return '4px';
  if (borderRadius === 'custom') return `${customBorderRadius}px`;
  return '0px';
}

export function getBasicMetaItems(doc: ResumeDocument): MetaDatum[] {
  const { basic } = doc;
  const items: MetaDatum[] = [];

  for (const field of basic.fieldOrder) {
    if (!field.visible) continue;
    if (field.key === 'name' || field.key === 'title') continue;

    let value = '';
    if (field.key === 'employmentStatus') value = basic.employmentStatus;
    else if (field.key === 'birthDate') value = basic.birthDate;
    else if (field.key === 'email') value = basic.email;
    else if (field.key === 'phone') value = basic.phone;
    else if (field.key === 'location') value = basic.location;

    if (!value.trim()) continue;
    items.push({
      key: field.key,
      label: field.label,
      value,
      iconName: basic.icons[field.key],
      isPrimaryContact: field.key === 'email' || field.key === 'phone' || field.key === 'location',
    });
  }

  for (const cf of basic.customFields) {
    if (!cf.visible || !cf.value.trim()) continue;
    items.push({
      key: `custom-${cf.id}`,
      label: cf.label,
      value: cf.value,
      isPrimaryContact: false,
    });
  }

  return items;
}

export function isSectionRenderable(doc: ResumeDocument, section: MenuSection): boolean {
  if (!section.enabled || section.id === 'basic') return false;
  if (section.id === 'education') return doc.education.some((e) => e.visible);
  if (section.id === 'experience') return doc.experience.some((e) => e.visible);
  if (section.id === 'projects') return doc.projects.some((p) => p.visible);
  if (section.id === 'skills') return doc.skillContent.trim().length > 0;
  if (section.id === 'selfEvaluation') return doc.selfEvaluationContent.trim().length > 0;
  const customList = doc.customData[section.id];
  return Array.isArray(customList) && customList.some((c) => c.visible);
}

export function getOrderedVisibleSections(doc: ResumeDocument): MenuSection[] {
  return [...doc.menuSections]
    .sort((a, b) => a.order - b.order)
    .filter((section) => isSectionRenderable(doc, section));
}

export const SECTION_ICON_OPTIONS: Array<{ name: string; label: string }> = [
  { name: 'GraduationCap', label: '教育学历' },
  { name: 'Briefcase', label: '工作经历' },
  { name: 'Rocket', label: '项目科研' },
  { name: 'Award', label: '资质证书' },
  { name: 'Trophy', label: '荣誉奖项' },
  { name: 'BookOpen', label: '学术论文' },
  { name: 'FileText', label: '自定义文档' },
  { name: 'Users', label: '社团组织' },
  { name: 'Heart', label: '兴趣爱好' },
  { name: 'Zap', label: '核心技能' },
  { name: 'User', label: '个人总结' },
  { name: 'Sparkles', label: '特长亮点' },
  { name: 'Code', label: '技术工具' },
  { name: 'Target', label: '目标方向' },
  { name: 'Lightbulb', label: '教学创新' },
  { name: 'Star', label: '精选推荐' },
];

export function LucideIconByName({
  name,
  size = 13,
  className = '',
}: {
  name?: string;
  size?: number;
  className?: string;
}) {
  if (!name) return null;
  switch (name) {
    case 'Mail':
      return <Mail size={size} className={className} />;
    case 'Phone':
      return <Phone size={size} className={className} />;
    case 'CalendarRange':
      return <CalendarRange size={size} className={className} />;
    case 'Briefcase':
      return <Briefcase size={size} className={className} />;
    case 'MapPin':
      return <MapPin size={size} className={className} />;
    case 'User':
      return <User size={size} className={className} />;
    case 'GraduationCap':
      return <GraduationCap size={size} className={className} />;
    case 'Rocket':
      return <Rocket size={size} className={className} />;
    case 'Zap':
      return <Zap size={size} className={className} />;
    case 'BookOpen':
      return <BookOpen size={size} className={className} />;
    case 'Award':
      return <Award size={size} className={className} />;
    case 'Trophy':
      return <Trophy size={size} className={className} />;
    case 'Users':
      return <Users size={size} className={className} />;
    case 'Heart':
      return <Heart size={size} className={className} />;
    case 'Sparkles':
      return <Sparkles size={size} className={className} />;
    case 'Code':
      return <Code size={size} className={className} />;
    case 'Target':
      return <Target size={size} className={className} />;
    case 'Lightbulb':
      return <Lightbulb size={size} className={className} />;
    case 'Star':
      return <Star size={size} className={className} />;
    case 'Layers':
      return <Layers size={size} className={className} />;
    case 'FileText':
      return <FileText size={size} className={className} />;
    default:
      if (/^[\p{Emoji}\u200d]+$/u.test(name)) {
        return <span className={className}>{name}</span>;
      }
      return <FileText size={size} className={className} />;
  }
}

const DEFAULT_BUILT_IN_ICONS: Record<string, string> = {
  education: 'GraduationCap',
  experience: 'Briefcase',
  projects: 'Rocket',
  skills: 'Award',
  selfEvaluation: 'User',
};

export function resolveSectionIconName(section: MenuSection): string {
  const builtIn = DEFAULT_BUILT_IN_ICONS[section.id];
  if (builtIn) {
    // Allow explicit icon overrides on built-in sections too, while preserving legacy 'Zap' on skills -> 'Award'
    if (
      section.icon &&
      section.icon !== builtIn &&
      section.icon !== 'FileText' &&
      !(section.id === 'skills' && section.icon === 'Zap')
    ) {
      return section.icon;
    }
    return builtIn;
  }
  if (section.icon && section.icon !== 'FileText') {
    return section.icon;
  }
  if (/荣誉|奖|竞赛/.test(section.title)) return 'Trophy';
  if (/社团|组织|活动|校内/.test(section.title)) return 'Users';
  if (/兴趣|爱好/.test(section.title)) return 'Heart';
  if (/论文|发表|科研|学术/.test(section.title)) return 'BookOpen';
  return section.icon || 'FileText';
}

export type ResolvedHeadingStyle = Exclude<GlobalSettings['headingStyle'], 'auto'>;

export function SectionHeading({
  section,
  globalSettings,
  accent,
  nativeStyle = 'left-bar',
  darkMode = false,
  className = '',
}: {
  section: MenuSection;
  globalSettings: GlobalSettings;
  accent: string;
  nativeStyle?: ResolvedHeadingStyle;
  darkMode?: boolean;
  className?: string;
}) {
  const effectiveStyle: ResolvedHeadingStyle =
    globalSettings.headingStyle && globalSettings.headingStyle !== 'auto'
      ? globalSettings.headingStyle
      : nativeStyle;
  const headingSize = `${globalSettings.headerSize}px`;
  const fontWeight = getHeadingFontWeight(globalSettings);
  const iconName = resolveSectionIconName(section);
  const textHeadingColor = darkMode ? '#38bdf8' : accent;

  if (effectiveStyle === 'trapezoid-flag') {
    const flagHeight = Math.max(22, globalSettings.headerSize + 6);
    return (
      <h2
        className={`resume-section-heading mb-2 flex items-end border-b pb-0 ${className}`}
        style={{ borderColor: accent }}
      >
        <span
          className="inline-flex items-center gap-1.5 pl-2.5 pr-2 text-white"
          style={{
            backgroundColor: accent,
            height: `${flagHeight}px`,
            fontSize: `${Math.max(13, globalSettings.headerSize - 1)}px`,
            fontWeight,
          }}
        >
          <LucideIconByName name={iconName} size={12} className="text-white/90" />
          <span>{section.title}</span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 24"
          preserveAspectRatio="none"
          style={{ width: '14px', height: `${flagHeight}px` }}
          className="shrink-0"
        >
          <polygon points="0,0 16,24 0,24" fill={accent} />
        </svg>
      </h2>
    );
  }

  if (effectiveStyle === 'ribbon-fold') {
    const foldColor = darkenHex(accent, 0.35);
    return (
      <h2
        className={`resume-section-heading relative mb-2.5 flex items-center border-b pb-1 ${className}`}
        style={{ borderColor: `${accent}45` }}
      >
        <span className="relative inline-flex items-center">
          <span
            className="inline-flex items-center gap-1.5 rounded-r-sm px-3 py-0.5 text-white shadow-xs"
            style={{
              backgroundColor: accent,
              fontSize: `${Math.max(13, globalSettings.headerSize - 1)}px`,
              fontWeight,
            }}
          >
            <LucideIconByName name={iconName} size={12} className="text-white/90" />
            <span>{section.title}</span>
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 8 6"
            preserveAspectRatio="none"
            className="absolute -bottom-1.5 left-0 h-1.5 w-2"
          >
            <polygon points="0,0 8,0 8,6" fill={foldColor} />
          </svg>
        </span>
      </h2>
    );
  }

  if (effectiveStyle === 'dot-accent') {
    return (
      <h2
        className={`resume-section-heading mb-2 flex items-center gap-2 border-b pb-1 ${className}`}
        style={{
          borderColor: darkMode ? 'rgba(148,163,184,0.28)' : '#e2e8f0',
          color: darkMode ? '#f1f5f9' : '#0f172a',
          fontSize: headingSize,
          fontWeight,
        }}
      >
        <span
          className="inline-block h-2 w-2 shrink-0 rotate-45 rounded-[1px]"
          style={{ backgroundColor: textHeadingColor }}
        />
        <span>{section.title}</span>
      </h2>
    );
  }

  if (effectiveStyle === 'block-tag') {
    return (
      <h2
        className={`resume-section-heading mb-2 flex items-center gap-2 rounded-r px-2.5 py-1 ${className}`}
        style={{
          backgroundColor: darkMode ? 'rgba(56,189,248,0.12)' : mixWithWhite(accent, 0.91),
          borderLeft: `4px solid ${textHeadingColor}`,
          color: darkMode ? '#f8fafc' : textHeadingColor,
          fontSize: `${Math.max(13, globalSettings.headerSize - 1)}px`,
          fontWeight,
        }}
      >
        <span>{section.title}</span>
      </h2>
    );
  }

  if (effectiveStyle === 'circle-icon') {
    return (
      <h2
        className={`resume-section-heading mb-2 flex items-center gap-2 border-b pb-1 ${className}`}
        style={{
          borderColor: `${textHeadingColor}38`,
          color: textHeadingColor,
          fontSize: headingSize,
          fontWeight,
        }}
      >
        <span
          className="inline-flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: accent }}
        >
          <LucideIconByName name={iconName} size={11} className="text-white" />
        </span>
        <span>{section.title}</span>
      </h2>
    );
  }

  if (effectiveStyle === 'double-line') {
    return (
      <h2
        className={`resume-section-heading mb-2 border-y-2 py-0.5 tracking-wide ${className}`}
        style={{
          borderColor: textHeadingColor,
          color: textHeadingColor,
          fontSize: headingSize,
          fontWeight,
        }}
      >
        {section.title}
      </h2>
    );
  }

  if (effectiveStyle === 'pill') {
    return (
      <h2 className={`resume-section-heading mb-2 flex items-center gap-2 ${className}`}>
        <span
          className="rounded px-2 py-0.5 text-white"
          style={{
            backgroundColor: accent,
            fontSize: `${Math.max(13, globalSettings.headerSize - 2)}px`,
            fontWeight,
          }}
        >
          {section.title}
        </span>
        <span className="h-px flex-1" style={{ backgroundColor: `${textHeadingColor}35` }} />
      </h2>
    );
  }

  if (effectiveStyle === 'clean') {
    return (
      <h2
        className={`resume-section-heading mb-2 border-b pb-0.5 tracking-tight ${className}`}
        style={{
          borderColor: `${textHeadingColor}45`,
          color: textHeadingColor,
          fontSize: headingSize,
          fontWeight,
        }}
      >
        {section.title}
      </h2>
    );
  }

  // left-bar
  return (
    <h2
      className={`resume-section-heading mb-2 flex items-center gap-2 border-l-4 pl-2.5 ${
        darkMode ? 'text-slate-100' : 'text-slate-950'
      } ${className}`}
      style={{
        borderColor: textHeadingColor,
        fontSize: headingSize,
        fontWeight,
      }}
    >
      <span>{section.title}</span>
    </h2>
  );
}

export function ResumePortrait({
  doc,
  className = '',
  overrideRadius,
  overrideWidth,
  overrideHeight,
}: {
  doc: ResumeDocument;
  className?: string;
  overrideRadius?: string;
  overrideWidth?: number;
  overrideHeight?: number;
}) {
  if (!hasVisiblePhoto(doc)) return null;
  const width = overrideWidth ?? doc.basic.photoConfig.width;
  const height = overrideHeight ?? doc.basic.photoConfig.height;
  const borderRadius = overrideRadius ?? getPhotoBorderRadiusCss(doc);
  const frameStyle = doc.basic.photoConfig.frameStyle ?? 'none';
  const bgBackdrop = doc.basic.photoConfig.bgBackdrop?.trim() || '#f8fafc';

  const frameClass =
    frameStyle === 'white-ring'
      ? 'ring-4 ring-white shadow-md'
      : frameStyle === 'card-border'
        ? 'border-2 border-white p-0.5 shadow-sm'
        : 'border border-slate-200';

  return (
    <img
      src={resolveAssetUrl(doc.basic.photo)}
      alt={doc.basic.name || '证件照'}
      className={`shrink-0 object-cover ${frameClass} ${className}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        borderRadius,
        backgroundColor: bgBackdrop,
      }}
    />
  );
}

export interface SectionRenderOptions {
  timelineRail?: boolean;
  mutedTextColor?: string;
  accentColor: string;
  compact?: boolean;
  italicSubtitle?: boolean;
  darkMode?: boolean;
}

export function SectionBody({
  doc,
  section,
  options,
}: {
  doc: ResumeDocument;
  section: MenuSection;
  options: SectionRenderOptions;
}) {
  const { globalSettings } = doc;
  const itemGap = Math.max(4, Math.round(globalSettings.paragraphSpacing * (options.compact ? 0.5 : 0.72)));
  const subSize = `${globalSettings.subheaderSize}px`;
  const dark = Boolean(options.darkMode);
  const muted = options.mutedTextColor ?? (dark ? '#94a3b8' : '#475569');
  const titleClass = dark ? 'text-slate-100' : 'text-slate-900';
  const subClass = dark ? 'text-slate-300' : 'text-slate-800';
  const bodyClass = dark ? 'text-slate-300' : 'text-slate-800';
  const avoidSplitClass = globalSettings.avoidItemSplit !== false ? 'resume-item-block' : '';
  const cjkSpace = Boolean(globalSettings.autoCjkSpacing);
  const labels = getLocaleLabels(globalSettings.locale);
  const fmt = (text: string) => (cjkSpace ? formatCjkSpacing(text) : text);

  const wrapItem = (id: string, node: React.ReactNode) => {
    if (!options.timelineRail) {
      return (
        <article key={id} className={avoidSplitClass} style={{ marginBottom: `${itemGap}px` }}>
          {node}
        </article>
      );
    }
    return (
      <article
        key={id}
        className={`${avoidSplitClass} relative pl-4 border-l-2`.trim()}
        style={{ borderColor: `${options.accentColor}45`, marginBottom: `${itemGap}px` }}
      >
        <span
          className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full"
          style={{ backgroundColor: options.accentColor }}
        />
        {node}
      </article>
    );
  };

  if (section.id === 'education') {
    const visible = doc.education.filter((e) => e.visible);
    return (
      <div>
        {visible.map((edu: EducationItem) =>
          wrapItem(
            edu.id,
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <div className={`font-semibold ${titleClass}`} style={{ fontSize: subSize }}>
                  <span>{fmt(edu.school)}</span>
                  {(edu.major || edu.degree) && (
                    <span className={`ml-2 font-medium ${subClass} ${options.italicSubtitle ? 'italic' : ''}`}>
                      {fmt(edu.major)}
                      {edu.degree ? `${labels.openParen}${fmt(edu.degree)}${labels.closeParen}` : ''}
                    </span>
                  )}
                </div>
                {(edu.startDate || edu.endDate) && (
                  <span className="shrink-0 text-[0.9em]" style={{ color: muted }}>
                    {[edu.startDate, edu.endDate].filter(Boolean).join(' - ')}
                  </span>
                )}
              </div>
              {edu.gpa && (
                <div className="mt-0.5 text-[0.92em]" style={{ color: muted }}>
                  GPA: {fmt(edu.gpa)}
                </div>
              )}
              {edu.description && (
                <RichText
                  content={edu.description}
                  className={`mt-1 ${bodyClass}`}
                  paragraphSpacing={globalSettings.paragraphSpacing}
                  lineHeight={globalSettings.lineHeight}
                  autoCjkSpacing={cjkSpace}
                />
              )}
            </>,
          ),
        )}
      </div>
    );
  }

  if (section.id === 'experience') {
    const visible = doc.experience.filter((e) => e.visible);
    return (
      <div>
        {visible.map((exp: ExperienceItem) =>
          wrapItem(
            exp.id,
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <div className={`font-semibold ${titleClass}`} style={{ fontSize: subSize }}>
                  <span>{fmt(exp.company)}</span>
                  {exp.position && (
                    <span className={`ml-2 font-medium ${subClass} ${options.italicSubtitle ? 'italic' : ''}`}>
                      {fmt(exp.position)}
                    </span>
                  )}
                  {exp.location && (
                    <span className="ml-2 text-[0.88em] font-normal" style={{ color: muted }}>
                      {fmt(exp.location)}
                    </span>
                  )}
                </div>
                {(exp.startDate || exp.endDate) && (
                  <span className="shrink-0 text-[0.9em]" style={{ color: muted }}>
                    {[exp.startDate, exp.endDate].filter(Boolean).join(' - ')}
                  </span>
                )}
              </div>
              {exp.description && (
                <RichText
                  content={exp.description}
                  className={`mt-1 ${bodyClass}`}
                  paragraphSpacing={globalSettings.paragraphSpacing}
                  lineHeight={globalSettings.lineHeight}
                  autoCjkSpacing={cjkSpace}
                />
              )}
            </>,
          ),
        )}
      </div>
    );
  }

  if (section.id === 'projects') {
    const visible = doc.projects.filter((p) => p.visible);
    return (
      <div>
        {visible.map((proj: ProjectItem) =>
          wrapItem(
            proj.id,
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <div className={`font-semibold ${titleClass}`} style={{ fontSize: subSize }}>
                  <span>{fmt(proj.name)}</span>
                  {proj.role && (
                    <span className={`ml-2 font-medium ${dark ? 'text-slate-300' : 'text-slate-700'} ${options.italicSubtitle ? 'italic' : ''}`}>
                      {fmt(proj.role)}
                    </span>
                  )}
                  {proj.link && (
                    <a
                      href={proj.link}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center gap-0.5 text-[0.85em] font-normal underline"
                      style={{ color: dark ? '#38bdf8' : options.accentColor }}
                    >
                      <ExternalLink size={11} />
                      {fmt(proj.linkLabel || labels.link)}
                    </a>
                  )}
                </div>
                {proj.date && (
                  <span className="shrink-0 text-[0.9em]" style={{ color: muted }}>
                    {proj.date}
                  </span>
                )}
              </div>
              {proj.description && (
                <RichText
                  content={proj.description}
                  className={`mt-1 ${bodyClass}`}
                  paragraphSpacing={globalSettings.paragraphSpacing}
                  lineHeight={globalSettings.lineHeight}
                  autoCjkSpacing={cjkSpace}
                />
              )}
            </>,
          ),
        )}
      </div>
    );
  }

  if (section.id === 'skills') {
    return (
      <RichText
        content={doc.skillContent}
        className={bodyClass}
        paragraphSpacing={globalSettings.paragraphSpacing}
        lineHeight={globalSettings.lineHeight}
        autoCjkSpacing={cjkSpace}
      />
    );
  }

  if (section.id === 'selfEvaluation') {
    return (
      <RichText
        content={doc.selfEvaluationContent}
        className={bodyClass}
        paragraphSpacing={globalSettings.paragraphSpacing}
        lineHeight={globalSettings.lineHeight}
        autoCjkSpacing={cjkSpace}
      />
    );
  }

  const customItems = (doc.customData[section.id] ?? []).filter((c) => c.visible);
  return (
    <div>
      {customItems.map((item: CustomItem) =>
        wrapItem(
          item.id,
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <div className={`font-medium ${titleClass}`}>
                <span>{fmt(item.title)}</span>
                {item.subtitle && (
                  <span className="ml-2 text-[0.92em]" style={{ color: muted }}>
                    {fmt(item.subtitle)}
                  </span>
                )}
              </div>
              {item.dateRange && (
                <span className="shrink-0 text-[0.9em]" style={{ color: muted }}>
                  {item.dateRange}
                </span>
              )}
            </div>
            {item.description && (
              <RichText
                content={item.description}
                className={`mt-0.5 ${bodyClass}`}
                paragraphSpacing={globalSettings.paragraphSpacing}
                lineHeight={globalSettings.lineHeight}
                autoCjkSpacing={cjkSpace}
              />
            )}
          </>,
        ),
      )}
    </div>
  );
}
