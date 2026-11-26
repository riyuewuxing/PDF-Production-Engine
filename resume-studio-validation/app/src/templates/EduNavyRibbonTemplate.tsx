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

export function EduNavyRibbonTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e3a5f';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle);
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const labels = getLocaleLabels(globalSettings.locale);

  return (
    <div
      className="min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings, { padding: `${pad}px` })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
      >
        <header
          className="flex items-center justify-between gap-6 border-b-2 pb-3.5"
          style={{ borderColor: accent }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              {nameVisible && (
                <h1
                  className="font-bold tracking-tight"
                  style={{ color: accent, fontSize: `${Math.round(globalSettings.headerSize * 1.5)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleVisible && basic.title && (
                <span className="font-semibold text-slate-700" style={{ fontSize: `${globalSettings.subheaderSize}px` }}>
                  {labels.targetRole}{basic.title}
                </span>
              )}
            </div>
            {metaItems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[0.89em] text-slate-700">
                {metaItems.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1">
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={12} className="text-slate-500" />
                    )}
                    <span className="text-slate-500">{item.label}{labels.colon}</span>
                    <span>{item.value}</span>
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
              <h2 className="resume-section-heading mb-2 flex items-center border-b-2" style={{ borderColor: accent }}>
                <span
                  className="inline-block px-3.5 py-0.5 font-bold"
                  style={{
                    ...fill.style,
                    color: fill.textColor,
                    fontSize: `${Math.max(13, globalSettings.headerSize - 1)}px`,
                    clipPath: 'polygon(0 0, 92% 0, 100% 100%, 0 100%)',
                    paddingRight: '22px',
                  }}
                >
                  {section.title}
                </span>
              </h2>
            ) : (
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="pill"
              />
            )}
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
