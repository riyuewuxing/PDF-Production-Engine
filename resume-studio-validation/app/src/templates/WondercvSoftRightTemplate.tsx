import { getLocaleLabels } from '../lib/resumeLocale';
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

export function WondercvSoftRightTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#167883';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle, true);
  const metaItems = getBasicMetaItems(document);
  const allSections = getOrderedVisibleSections(document);
  const sideSectionIds = new Set(['skills', 'selfEvaluation']);
  const sideSections = allSections.filter(
    (s) => sideSectionIds.has(s.id) || (s.id.startsWith('custom-') && (document.customData[s.id]?.length ?? 0) <= 5),
  );
  const mainSections = allSections.filter((s) => !sideSections.some((side) => side.id === s.id));
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const labels = getLocaleLabels(globalSettings.locale);

  return (
    <div
      className="relative flex min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-0 w-[32%] print:hidden"
        style={{ ...fill.style, borderLeft: `1px solid ${fill.borderColor}` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-y-0 right-0 z-0 hidden w-[32%] print:block"
        style={{ ...fill.style, borderLeft: `1px solid ${fill.borderColor}` }}
      />

      {/* Left 68% Main Column */}
      <main
        className="relative z-10 min-w-0 w-[68%]"
        style={{ padding: `${pad}px ${Math.max(16, Math.round(pad * 0.85))}px ${pad}px ${pad}px` }}
      >
        <InteractiveSection
          sectionId="basic"
          title="基本信息"
          style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
        >
          <header className="border-b-2 pb-3" style={{ borderColor: accent }}>
            {nameVisible && (
              <h1
                className="font-bold tracking-tight text-slate-950"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.5)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleVisible && basic.title && (
              <div className="mt-1 font-semibold" style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}>
                {labels.targetRole}{basic.title}
              </div>
            )}
          </header>
        </InteractiveSection>

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
              nativeStyle="circle-icon"
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </main>

      {/* Right 32% Soft Tinted Sidebar */}
      <aside
        className="relative z-10 w-[32%] shrink-0 break-words"
        style={{
          color: fill.textColor,
          padding: `${pad}px ${Math.max(14, Math.round(pad * 0.7))}px`,
        }}
      >
        <InteractiveSection sectionId="basic" title="基本信息">
          {showPhoto && (
            <div className="mb-4 flex justify-center">
              <ResumePortrait doc={document} />
            </div>
          )}

          {metaItems.length > 0 && (
            <div className="mb-5">
              <h2
                className="resume-section-heading mb-2 border-b pb-1 font-bold"
                style={{
                  borderColor: fill.borderColor,
                  color: fill.isLight ? accent : fill.textColor,
                  fontSize: `${Math.max(13, globalSettings.headerSize - 2)}px`,
                }}
              >
                {labels.profileSection}
              </h2>
              <div className="space-y-1.5 text-[0.87em]" style={{ color: fill.mutedColor }}>
                {metaItems.map((item) => (
                  <div key={item.key} className="flex items-start gap-1.5">
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={12} className="mt-0.5 shrink-0" />
                    )}
                    <div className="[overflow-wrap:anywhere] min-w-0">
                      <span>{item.label}{labels.colon}</span>
                      <span style={{ color: fill.textColor }}>{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </InteractiveSection>

        {sideSections.map((section, idx) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            style={{
              marginBottom: idx === sideSections.length - 1 ? 0 : `${Math.round(globalSettings.sectionSpacing * 0.85)}px`,
            }}
          >
            <h2
              className="resume-section-heading mb-2 border-b pb-1 font-bold"
              style={{
                borderColor: fill.borderColor,
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
    </div>
  );
}
