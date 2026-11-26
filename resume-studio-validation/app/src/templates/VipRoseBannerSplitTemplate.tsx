import {
  InteractiveSection,
  LucideIconByName,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  getSurfaceFill,
  hasVisiblePhoto,
  mixWithWhite,
} from './shared';
import type { ResumeTemplateProps } from './types';
import { FloatingAvatar } from './visualPrimitives';

export function VipRoseBannerSplitTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const isEnglish = globalSettings.locale === 'en-US';
  const accent = globalSettings.themeColor || '#be123c';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle);
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  const sidebarSections = sections.filter(
    (s) => s.id === 'skills' || s.id === 'selfEvaluation' || s.id.includes('interest'),
  );
  const mainSections = sections.filter((s) => !sidebarSections.some((sb) => sb.id === s.id));
  const resolvedMain = mainSections.length > 0 ? mainSections : sections;
  const resolvedSide = mainSections.length > 0 ? sidebarSections : [];

  const sideBg = mixWithWhite(accent, 0.94);

  return (
    <div
      className="relative min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings)}
    >
      {/* Screen & print full-height 28% light gray left column backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-0 w-[28%] border-r border-slate-200 print:hidden"
        style={{ backgroundColor: sideBg }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-y-0 left-0 z-0 hidden w-[28%] border-r border-slate-200 print:block"
        style={{ backgroundColor: sideBg }}
      />

      {/* Opaque top full-width rose banner above fixed sidebar backdrop */}
      <InteractiveSection sectionId="basic" title="基本信息" className="relative z-10">
        <div style={{ backgroundColor: globalSettings.paperBackground || '#ffffff' }}>
          <header
            className="flex items-center gap-5"
            style={{
              ...fill.style,
              color: fill.textColor,
              padding: `${Math.max(16, Math.round(pad * 0.72))}px ${pad}px`,
            }}
          >
            {showPhoto && (
              <FloatingAvatar
                doc={document}
                shape="rect"
                width={Math.min(82, basic.photoConfig.width)}
                height={Math.min(106, basic.photoConfig.height)}
                frame="card-border"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {nameVisible && (
                  <h1
                    className="font-bold tracking-tight"
                    style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.52)}px` }}
                  >
                    {basic.name || '[姓名]'}
                  </h1>
                )}
                {titleVisible && basic.title && (
                  <span
                    className="rounded-full border px-2.5 py-0.5 text-[0.88em] font-medium"
                    style={{ borderColor: fill.borderColor, color: fill.textColor }}
                  >
                    {basic.title}
                  </span>
                )}
              </div>
              {metaItems.length > 0 && (
                <div
                  className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.86em]"
                  style={{ color: fill.mutedColor }}
                >
                  {metaItems.map((item) => (
                    <span key={item.key} className="inline-flex items-center gap-1">
                      {globalSettings.useIconMode && item.iconName && (
                        <LucideIconByName name={item.iconName} size={12} />
                      )}
                      <span>
                        {item.label}：{item.value}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </header>
        </div>
      </InteractiveSection>

      {/* Two columns below banner */}
      <div className="relative z-10 flex items-start">
        <aside
          className="w-[28%] shrink-0 break-words"
          style={{ padding: `${Math.max(16, Math.round(pad * 0.72))}px ${Math.max(14, Math.round(pad * 0.65))}px` }}
        >
          <div className="mb-4">
            <div
              className="mb-2 border-b pb-1 text-[0.95em] font-bold"
              style={{ borderColor: `${accent}45`, color: accent }}
            >
              {isEnglish ? 'Profile' : '个人档案'}
            </div>
            <div className="space-y-1.5 text-[0.85em] text-slate-700">
              {metaItems.map((item) => (
                <div key={item.key} className="[overflow-wrap:anywhere]">
                  <span className="text-slate-500">{item.label}：</span>
                  <span className="font-medium text-slate-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {resolvedSide.map((section, idx) => (
            <InteractiveSection
              key={section.id}
              sectionId={section.id}
              title={section.title}
              pageBreakBefore={section.pageBreakBefore}
              style={{
                marginBottom:
                  idx === resolvedSide.length - 1 ? 0 : `${Math.round(globalSettings.sectionSpacing * 0.85)}px`,
              }}
            >
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="left-bar"
              />
              <SectionBody doc={document} section={section} options={{ accentColor: accent, compact: true }} />
            </InteractiveSection>
          ))}
        </aside>

        <main
          className="min-w-0 flex-1"
          style={{ padding: `${Math.max(16, Math.round(pad * 0.72))}px ${pad}px` }}
        >
          {resolvedMain.map((section, idx) => (
            <InteractiveSection
              key={section.id}
              sectionId={section.id}
              title={section.title}
              pageBreakBefore={section.pageBreakBefore}
              style={{
                marginBottom: idx === resolvedMain.length - 1 ? 0 : `${globalSettings.sectionSpacing}px`,
              }}
            >
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="circle-icon"
              />
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </InteractiveSection>
          ))}
        </main>
      </div>
    </div>
  );
}
