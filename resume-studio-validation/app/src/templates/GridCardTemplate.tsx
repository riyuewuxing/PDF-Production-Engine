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

export function GridCardTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#0f4c81';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle, true);
  const metaItems = getBasicMetaItems(document);
  const allSections = getOrderedVisibleSections(document);
  const primaryIds = new Set(['education', 'experience', 'projects']);
  const primarySections = allSections.filter((s) => primaryIds.has(s.id));
  const secondarySections = allSections.filter((s) => !primaryIds.has(s.id));
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
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
      >
        <header
          className="flex items-center justify-between gap-5 rounded-lg border p-4"
          style={{
            ...fill.style,
            color: fill.textColor,
            borderColor: fill.borderColor,
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
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
                  className="font-semibold"
                  style={{ color: fill.isLight ? accent : fill.mutedColor, fontSize: `${globalSettings.subheaderSize}px` }}
                >
                  {basic.title}
                </span>
              )}
            </div>
            {metaItems.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[0.88em] sm:grid-cols-3" style={{ color: fill.mutedColor }}>
                {metaItems.map((item) => (
                  <div key={item.key} className={`flex min-w-0 items-start gap-1 ${item.key === 'email' ? 'col-span-2' : ''}`}>
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={12} className="mt-0.5 shrink-0" />
                    )}
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span>{item.label}：</span>
                      <span style={{ color: fill.textColor }}>{item.value}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {showPhoto && <ResumePortrait doc={document} />}
        </header>
      </InteractiveSection>

      <div className="space-y-0">
        {primarySections.map((section) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            style={{ marginBottom: `${globalSettings.sectionSpacing}px` }}
          >
            <SectionHeading
              section={section}
              globalSettings={globalSettings}
              accent={accent}
              nativeStyle="left-bar"
            />
            <div className="rounded-md border border-slate-200/80 bg-white/80 px-3.5 py-2.5">
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </div>
          </InteractiveSection>
        ))}

        {secondarySections.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {secondarySections.map((section) => {
              const spanFull = section.id === 'selfEvaluation';
              return (
                <InteractiveSection
                  key={section.id}
                  sectionId={section.id}
                  title={section.title}
                  pageBreakBefore={section.pageBreakBefore}
                  className={`resume-item-block rounded-md border border-slate-200 bg-slate-50/60 p-3 ${
                    spanFull ? 'col-span-2' : ''
                  }`}
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
                    options={{ accentColor: accent, compact: true }}
                  />
                </InteractiveSection>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
