import {
  InteractiveSection,
  LucideIconByName,
  ResumePortrait,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';

export function TimelineFocusTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e293b';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameFieldVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleFieldVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const timelineSections = new Set(['education', 'experience', 'projects']);

  return (
    <div
      className="min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings, { padding: `${globalSettings.pagePadding}px` })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.8)}px` }}
      >
        <header
          className="flex items-start justify-between gap-6 border-b pb-3"
          style={{ borderColor: `${accent}25` }}
        >
          <div className="min-w-0 flex-1">
            {nameFieldVisible && (
              <h1
                className="font-bold tracking-tight text-slate-950"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.45)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleFieldVisible && basic.title && (
              <div className="mt-0.5 font-semibold" style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}>
                {basic.title}
              </div>
            )}
            {metaItems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[0.9em] text-slate-700">
                {metaItems.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1">
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={12} className="text-slate-500" />
                    )}
                    <span className="text-slate-500">{item.label}：</span>
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
            <SectionHeading
              section={section}
              globalSettings={globalSettings}
              accent={accent}
              nativeStyle="pill"
            />
            <SectionBody
              doc={document}
              section={section}
              options={{
                accentColor: accent,
                timelineRail: timelineSections.has(section.id),
              }}
            />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
