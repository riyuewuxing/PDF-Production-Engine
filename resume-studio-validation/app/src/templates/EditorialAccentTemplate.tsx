import {
  InteractiveSection,
  LucideIconByName,
  ResumePortrait,
  SectionBody,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
  mixWithWhite,
} from './shared';
import type { ResumeTemplateProps } from './types';

export function EditorialAccentTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e293b';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameFieldVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleFieldVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;

  return (
    <div
      className="min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings, { padding: `${globalSettings.pagePadding}px` })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.9)}px` }}
      >
        <header
          className="flex items-start justify-between gap-6 border-b-2 pb-4"
          style={{ borderColor: accent }}
        >
          <div className="min-w-0 flex-1">
            {nameFieldVisible && (
              <h1
                className="font-bold tracking-tight text-slate-950"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.5)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleFieldVisible && basic.title && (
              <div className="mt-1 font-medium tracking-wide text-slate-700" style={{ fontSize: `${globalSettings.subheaderSize}px` }}>
                {basic.title}
              </div>
            )}
            {metaItems.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.88em] text-slate-600">
                {metaItems.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1">
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={12} className="text-slate-400" />
                    )}
                    <span>
                      {item.label}：{item.value}
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
            className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0"
            style={{
              marginBottom: idx === sections.length - 1 ? 0 : `${Math.round(globalSettings.sectionSpacing * 0.85)}px`,
            }}
          >
            <div className="float-left w-[20%] pr-3 pt-0.5">
              <h2
                className="inline-block w-full rounded-r border-l-4 px-2 py-1 font-bold tracking-tight"
                style={{
                  color: accent,
                  borderColor: accent,
                  backgroundColor: mixWithWhite(accent, 0.92),
                  fontSize: `${Math.max(13, globalSettings.headerSize - 2)}px`,
                }}
              >
                {section.title}
              </h2>
            </div>
            <div className="ml-[23%] min-w-0">
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </div>
            <div className="clear-both" />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
