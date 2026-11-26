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

export function DoubleLineScholarTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#111827';
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
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.8)}px` }}
      >
        <header className="flex items-center justify-between gap-6 pb-2">
          <div className="min-w-0 flex-1">
            {nameVisible && (
              <h1
                className="font-bold tracking-tight text-slate-950"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.5)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleVisible && basic.title && (
              <div className="mt-0.5 font-medium" style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}>
                {basic.title}
              </div>
            )}
            {metaItems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.88em] text-slate-700">
                {metaItems.map((item, idx) => (
                  <span key={item.key} className="inline-flex items-center gap-1">
                    {idx > 0 && <span className="text-slate-300">·</span>}
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={12} className="text-slate-500" />
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
