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

export function ChicvMinimalTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#334155';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

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
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              {nameVisible && (
                <h1
                  className="font-bold tracking-tight text-slate-950"
                  style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.5)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleVisible && basic.title && (
                <span className="font-medium text-slate-600" style={{ fontSize: `${globalSettings.subheaderSize}px` }}>
                  / {basic.title}
                </span>
              )}
            </div>

            {metaItems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.87em] text-slate-600">
                {metaItems.map((item, idx) => (
                  <span key={item.key}>
                    {idx > 0 && <span className="mr-3 text-slate-300">/</span>}
                    {item.label}：{item.value}
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
                className="resume-section-heading mb-2 flex items-center gap-2 font-bold tracking-tight"
                style={{ color: accent, fontSize: `${globalSettings.headerSize}px` }}
              >
                <span className="inline-block h-[2px] w-4 shrink-0" style={{ backgroundColor: accent }} />
                <span>{section.title}</span>
              </h2>
            ) : (
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="clean"
              />
            )}
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
