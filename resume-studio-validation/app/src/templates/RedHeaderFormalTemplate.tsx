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

export function RedHeaderFormalTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#881337';
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
        <header>
          <div className="mb-3 border-t-[3px] pt-1" style={{ borderColor: accent }}>
            <div className="border-t border-slate-400" />
          </div>
          <div className="flex items-start justify-between gap-6 border-b pb-3" style={{ borderColor: `${accent}45` }}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                {nameVisible && (
                  <h1
                    className="font-bold tracking-wide"
                    style={{ color: accent, fontSize: `${Math.round(globalSettings.headerSize * 1.48)}px` }}
                  >
                    {basic.name || '[姓名]'}
                  </h1>
                )}
                {titleVisible && basic.title && (
                  <span className="font-semibold text-slate-800" style={{ fontSize: `${globalSettings.subheaderSize}px` }}>
                    求职岗位：{basic.title}
                  </span>
                )}
              </div>

              {metaItems.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[0.89em] text-slate-700 sm:grid-cols-3">
                  {metaItems.map((item) => (
                    <span key={item.key} className={`min-w-0 [overflow-wrap:anywhere] ${item.key === 'email' ? 'col-span-2' : ''}`}>
                      <span className="font-medium text-slate-600">{item.label}：</span>
                      <span className="text-slate-900">{item.value}</span>
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
            <SectionHeading
              section={section}
              globalSettings={globalSettings}
              accent={accent}
              nativeStyle="double-line"
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
