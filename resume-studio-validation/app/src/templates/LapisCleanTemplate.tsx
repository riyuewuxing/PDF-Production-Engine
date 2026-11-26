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

export function LapisCleanTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#2b547e';
  const labels = getLocaleLabels(globalSettings.locale);
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
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
        <header
          className="flex items-start justify-between gap-5 border-b-2 pb-3.5"
          style={{ borderColor: accent }}
        >
          <div className="min-w-0 flex-1">
            {nameVisible && (
              <h1
                className="tracking-tight text-slate-950"
                style={{
                  fontWeight: headingWeight,
                  fontSize: `${Math.round(globalSettings.headerSize * 1.54)}px`,
                }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleVisible && basic.title && (
              <div
                className="mt-0.5 font-medium"
                style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}
              >
                {labels.targetRole}
                {basic.title}
              </div>
            )}
            {metaItems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[0.89em] text-slate-600">
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

      <div>
        {sections.map((section, idx) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            style={{
              marginBottom: idx === sections.length - 1 ? 0 : `${globalSettings.sectionSpacing}px`,
            }}
          >
            {globalSettings.headingStyle === 'auto' ? (
              <h2
                className="resume-section-heading mb-2 flex items-center gap-2 border-b pb-1"
                style={{
                  borderColor: `${accent}35`,
                  fontSize: `${globalSettings.headerSize}px`,
                  fontWeight: headingWeight,
                  color: accent,
                }}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-3.5 w-1.5 shrink-0 rounded-[1px]"
                  style={{ backgroundColor: accent }}
                />
                <span>{section.title}</span>
              </h2>
            ) : (
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="left-bar"
              />
            )}
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
