import {
  InteractiveSection,
  ResumePortrait,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';

export function RendercvSb2novTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e293b';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = Math.max(14, Math.round(globalSettings.pagePadding * 0.8));

  return (
    <div
      className="min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings, { padding: `${pad}px ${globalSettings.pagePadding}px` })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.max(8, Math.round(globalSettings.sectionSpacing * 0.65))}px` }}
      >
        <header className="flex items-start justify-between gap-4 border-b-2 pb-2" style={{ borderColor: accent }}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              {nameVisible && (
                <h1
                  className="font-bold text-slate-950"
                  style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.48)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleVisible && basic.title && (
                <span className="font-semibold" style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}>
                  {basic.title}
                </span>
              )}
            </div>
            {metaItems.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.86em] text-slate-700">
                {metaItems.map((item) => (
                  <span key={item.key}>
                    <span className="text-slate-500">{item.label}：</span>
                    <span className="font-medium text-slate-900">{item.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          {showPhoto && <ResumePortrait doc={document} overrideWidth={74} overrideHeight={96} />}
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
              marginBottom:
                idx === sections.length - 1 ? 0 : `${Math.max(8, Math.round(globalSettings.sectionSpacing * 0.72))}px`,
            }}
          >
            {globalSettings.headingStyle === 'auto' ? (
              <h2
                className="resume-section-heading mb-1.5 border-l-[5px] bg-slate-100/90 px-2.5 py-0.5 font-bold"
                style={{
                  borderColor: accent,
                  color: accent,
                  fontSize: `${Math.max(13, globalSettings.headerSize - 1)}px`,
                }}
              >
                {section.title}
              </h2>
            ) : (
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="left-bar"
              />
            )}
            <SectionBody doc={document} section={section} options={{ accentColor: accent, compact: true }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
