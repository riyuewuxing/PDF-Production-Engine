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

export function CompactBadgeTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e293b';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle, true);
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
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.8)}px` }}
      >
        <header
          className="flex items-center justify-between gap-5 rounded-md border-l-4 px-4 py-3"
          style={{
            ...fill.style,
            color: fill.textColor,
            borderLeftColor: accent,
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              {nameFieldVisible && (
                <h1
                  className="font-bold"
                  style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.4)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleFieldVisible && basic.title && (
                <span
                  className="rounded-full px-2.5 py-0.5 text-[0.82em] font-semibold"
                  style={{
                    backgroundColor: fill.isLight ? `${accent}15` : 'rgba(255,255,255,0.2)',
                    color: fill.isLight ? accent : '#ffffff',
                  }}
                >
                  {basic.title}
                </span>
              )}
            </div>

            {metaItems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[0.84em]">
                {metaItems.map((item) => (
                  <span
                    key={item.key}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-slate-700"
                  >
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={11} className="text-slate-500" />
                    )}
                    <span className="text-slate-500">{item.label}</span>
                    <span className="font-medium text-slate-900">{item.value}</span>
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
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
