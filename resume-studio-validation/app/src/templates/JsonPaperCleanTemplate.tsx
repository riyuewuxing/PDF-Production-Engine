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

export function JsonPaperCleanTemplate({ document }: ResumeTemplateProps) {
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
        <header className="border-y-2 border-slate-800 py-3">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0 flex-1">
              {nameVisible && (
                <h1
                  className="font-bold tracking-wide text-slate-950"
                  style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.48)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleVisible && basic.title && (
                <div className="mt-0.5 text-[0.95em] font-medium text-slate-600">
                  {basic.title}
                </div>
              )}
              {metaItems.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.86em] text-slate-700">
                  {metaItems.map((item) => (
                    <span key={item.key}>
                      <span className="font-medium text-slate-500">{item.label}：</span>
                      <span>{item.value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {showPhoto && <ResumePortrait doc={document} />}
          </div>
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
                className="resume-section-heading mb-2 border-b border-slate-300 pb-1 text-[0.95em] font-bold uppercase tracking-widest"
                style={{ color: accent, fontSize: `${Math.max(13, globalSettings.headerSize - 1)}px` }}
              >
                {section.title}
              </h2>
            ) : (
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="clean"
              />
            )}
            <div className="border-l border-slate-200 pl-3">
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </div>
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
