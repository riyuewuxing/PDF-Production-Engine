import {
  InteractiveSection,
  LucideIconByName,
  ResumePortrait,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  getSurfaceFill,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';

export function RxAzurillTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#0f4c81';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle, true);
  const metaItems = getBasicMetaItems(document);
  const allSections = getOrderedVisibleSections(document);
  const sideIds = new Set(['skills']);
  const sideSections = allSections.filter((s) => sideIds.has(s.id));
  const mainSections = allSections.filter((s) => !sideIds.has(s.id));
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  return (
    <div
      className="relative flex min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-0 w-[30%] print:hidden"
        style={{ ...fill.style, borderRight: `1px solid ${fill.borderColor}` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-y-0 left-0 z-0 hidden w-[30%] print:block"
        style={{ ...fill.style, borderRight: `1px solid ${fill.borderColor}` }}
      />

      {/* Left 30% Light Sidebar */}
      <aside
        className="relative z-10 w-[30%] shrink-0 break-words"
        style={{
          color: fill.textColor,
          padding: `${pad}px ${Math.max(14, Math.round(pad * 0.68))}px`,
        }}
      >
        <InteractiveSection sectionId="basic" title="基本信息">
          {showPhoto && (
            <div className="mb-4 flex justify-center">
              <ResumePortrait
                doc={document}
                overrideWidth={98}
                overrideHeight={98}
                overrideRadius="9999px"
                className="border-2 border-white shadow-sm"
              />
            </div>
          )}

          <div className={showPhoto ? 'text-center' : ''}>
            {nameVisible && (
              <h1
                className="font-bold tracking-tight"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.38)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleVisible && basic.title && (
              <div
                className="mt-1 font-semibold"
                style={{
                  color: fill.isLight ? accent : fill.mutedColor,
                  fontSize: `${Math.max(12, globalSettings.subheaderSize - 1)}px`,
                }}
              >
                {basic.title}
              </div>
            )}
          </div>

          {metaItems.length > 0 && (
            <div
              className="mt-4 space-y-1.5 border-t pt-3.5 text-[0.86em]"
              style={{ borderColor: fill.borderColor, color: fill.mutedColor }}
            >
              {metaItems.map((item) => (
                <div key={item.key} className="flex items-start gap-1.5">
                  {globalSettings.useIconMode && item.iconName && (
                    <LucideIconByName name={item.iconName} size={12} className="mt-0.5 shrink-0" />
                  )}
                  <div className="[overflow-wrap:anywhere] min-w-0">
                    <span>{item.label}：</span>
                    <span style={{ color: fill.textColor }}>{item.value}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </InteractiveSection>

        {sideSections.map((section) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            className="mt-5 border-t pt-3.5"
            style={{ borderColor: fill.borderColor }}
          >
            <h2
              className="resume-section-heading mb-2 font-bold"
              style={{
                color: fill.isLight ? accent : fill.textColor,
                fontSize: `${Math.max(13, globalSettings.headerSize - 2)}px`,
              }}
            >
              {section.title}
            </h2>
            <div className={fill.isLight ? '' : '[&_*]:!text-white/95'}>
              <SectionBody
                doc={document}
                section={section}
                options={{
                  accentColor: fill.isLight ? accent : fill.textColor,
                  mutedTextColor: fill.mutedColor,
                  compact: true,
                }}
              />
            </div>
          </InteractiveSection>
        ))}
      </aside>

      {/* Right 70% Timeline Body */}
      <main className="relative z-10 min-w-0 flex-1" style={{ padding: `${pad}px` }}>
        {mainSections.map((section, idx) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            style={{
              marginBottom: idx === mainSections.length - 1 ? 0 : `${globalSettings.sectionSpacing}px`,
            }}
          >
            <SectionHeading
              section={section}
              globalSettings={globalSettings}
              accent={accent}
              nativeStyle="left-bar"
            />
            <SectionBody
              doc={document}
              section={section}
              options={{
                accentColor: accent,
                timelineRail: ['education', 'experience', 'projects'].includes(section.id),
              }}
            />
          </InteractiveSection>
        ))}
      </main>
    </div>
  );
}
