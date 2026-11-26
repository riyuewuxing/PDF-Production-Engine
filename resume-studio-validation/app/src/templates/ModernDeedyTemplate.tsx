import { getLocaleLabels } from '../lib/resumeLocale';
import {
  InteractiveSection,
  LucideIconByName,
  ResumePortrait,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getHeadingFontWeight,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';

export function ModernDeedyTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e3a5f';
  const labels = getLocaleLabels(globalSettings.locale);
  const metaItems = getBasicMetaItems(document);
  const allSections = getOrderedVisibleSections(document);
  const leftSectionIds = new Set(['education', 'skills']);
  const leftSections = allSections.filter(
    (s) => leftSectionIds.has(s.id) || (s.id.startsWith('custom-') && (document.customData[s.id]?.length ?? 0) <= 5),
  );
  const rightSections = allSections.filter((s) => !leftSections.some((l) => l.id === s.id));
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const headingWeight = getHeadingFontWeight(globalSettings);

  return (
    <div
      className="min-h-[296mm] bg-white text-slate-900"
      style={getSheetRootStyle(globalSettings, { padding: `${pad}px` })}
    >
      <InteractiveSection
        sectionId="basic"
        title={labels.basicSection}
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
      >
        <header className="flex items-start justify-between gap-5 border-b border-slate-300 pb-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {nameVisible && (
                <h1
                  className="tracking-tight text-slate-950"
                  style={{
                    fontWeight: headingWeight,
                    fontSize: `${Math.round(globalSettings.headerSize * 1.56)}px`,
                  }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleVisible && basic.title && (
                <span
                  className="font-medium"
                  style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}
                >
                  {labels.targetRole}
                  {basic.title}
                </span>
              )}
            </div>
            {metaItems.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[0.87em] text-slate-600">
                {metaItems.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1">
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={11} className="text-slate-400" />
                    )}
                    <span>
                      {item.label}
                      {labels.colon}
                      {item.value}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
          {showPhoto && <ResumePortrait doc={document} />}
        </header>
      </InteractiveSection>

      {/* Asymmetric 33% / 67% Editorial Two-Column Grid with Subtle Vertical Hairline */}
      <div className="flex items-stretch gap-5">
        <aside className="w-[33%] shrink-0 border-r border-slate-200 pr-4">
          {leftSections.map((section, idx) => (
            <InteractiveSection
              key={section.id}
              sectionId={section.id}
              title={section.title}
              pageBreakBefore={section.pageBreakBefore}
              style={{
                marginBottom: idx === leftSections.length - 1 ? 0 : `${globalSettings.sectionSpacing}px`,
              }}
            >
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="clean"
              />
              <SectionBody
                doc={document}
                section={section}
                options={{ accentColor: accent, compact: true }}
              />
            </InteractiveSection>
          ))}
        </aside>

        <main className="min-w-0 flex-1">
          {rightSections.map((section, idx) => (
            <InteractiveSection
              key={section.id}
              sectionId={section.id}
              title={section.title}
              pageBreakBefore={section.pageBreakBefore}
              style={{
                marginBottom: idx === rightSections.length - 1 ? 0 : `${globalSettings.sectionSpacing}px`,
              }}
            >
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="clean"
              />
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </InteractiveSection>
          ))}
        </main>
      </div>
    </div>
  );
}
