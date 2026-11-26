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

export function MinimalAtsTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#111827';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameFieldVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleFieldVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;

  return (
    <div
      className="min-h-[296mm] text-black"
      style={getSheetRootStyle(globalSettings, {
        padding: `${Math.max(14, Math.round(globalSettings.pagePadding * 0.85))}px ${globalSettings.pagePadding}px`,
      })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.max(8, Math.round(globalSettings.sectionSpacing * 0.65))}px` }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-black pb-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              {nameFieldVisible && (
                <h1
                  className="font-bold tracking-tight text-black"
                  style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.38)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleFieldVisible && basic.title && (
                <span className="font-medium text-neutral-800" style={{ fontSize: `${globalSettings.subheaderSize}px` }}>
                  {basic.title}
                </span>
              )}
            </div>
            {metaItems.length > 0 && (
              <p className="mt-1 text-[0.88em] text-neutral-800">
                {metaItems.map((item) => `${item.label}:${item.value}`).join(' · ')}
              </p>
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
              marginBottom:
                idx === sections.length - 1 ? 0 : `${Math.max(8, Math.round(globalSettings.sectionSpacing * 0.78))}px`,
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
              options={{ accentColor: accent, mutedTextColor: '#374151', compact: true }}
            />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
