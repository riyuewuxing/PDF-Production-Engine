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

export function WondercvMintCardTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#0d9488';
  const cardFill = getSurfaceFill(accent, globalSettings.surfaceStyle, true);
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
        <header
          className="flex items-center justify-between gap-5 rounded-xl border p-4"
          style={{
            ...cardFill.style,
            color: cardFill.textColor,
            borderColor: cardFill.borderColor,
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              {nameVisible && (
                <h1
                  className="font-bold tracking-tight"
                  style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.45)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleVisible && basic.title && (
                <span
                  className="rounded-full px-2.5 py-0.5 text-[0.85em] font-semibold"
                  style={{
                    backgroundColor: cardFill.isLight ? `${accent}18` : 'rgba(255,255,255,0.2)',
                    color: cardFill.isLight ? accent : '#ffffff',
                  }}
                >
                  {basic.title}
                </span>
              )}
            </div>

            {metaItems.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5 text-[0.84em]">
                {metaItems.map((item) => (
                  <span
                    key={item.key}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5"
                    style={{
                      backgroundColor: cardFill.isLight ? '#ffffff' : 'rgba(255,255,255,0.12)',
                      borderColor: cardFill.borderColor,
                      color: cardFill.textColor,
                    }}
                  >
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={11} />
                    )}
                    <span style={{ color: cardFill.mutedColor }}>{item.label}</span>
                    <span className="font-medium">{item.value}</span>
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
            <div className="pl-1">
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </div>
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
