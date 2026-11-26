import { getLocaleLabels } from '../lib/resumeLocale';
import {
  InteractiveSection,
  LucideIconByName,
  SectionBody,
  SectionHeading,
  type ResolvedHeadingStyle,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  getSurfaceFill,
  hasVisiblePhoto,
} from './shared';
import type { ResumeDocument } from '../schema/resumeSchema';
import { FloatingAvatar, SvgWaveBanner, type SvgBannerVariant } from './visualPrimitives';

export function CenteredWaveResumeLayout({
  document,
  defaultColor,
  bannerVariant,
  nativeHeadingStyle,
  waveHeight = 86,
  overlapPx = 44,
}: {
  document: ResumeDocument;
  defaultColor: string;
  bannerVariant: SvgBannerVariant;
  nativeHeadingStyle: ResolvedHeadingStyle;
  waveHeight?: number;
  overlapPx?: number;
}) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || defaultColor;
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const labels = getLocaleLabels(globalSettings.locale);

  return (
    <div className="min-h-[296mm] text-slate-900" style={getSheetRootStyle(globalSettings)}>
      <InteractiveSection sectionId="basic" title={labels.basicSection}>
        <header>
          <SvgWaveBanner
            variant={bannerVariant}
            themeColor={accent}
            surfaceStyle={globalSettings.surfaceStyle}
            minHeight={waveHeight}
          />
          <div style={{ paddingLeft: `${pad}px`, paddingRight: `${pad}px` }}>
            {showPhoto && (
              <div className="flex justify-center">
                <FloatingAvatar
                  doc={document}
                  shape="circle"
                  size={88}
                  overlapTopPx={overlapPx}
                  frame="white-ring"
                />
              </div>
            )}
            <div className={`${showPhoto ? 'mt-2' : '-mt-2'} text-center`}>
              {nameVisible && (
                <h1
                  className="font-bold tracking-tight text-slate-950"
                  style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.52)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleVisible && basic.title && (
                <div
                  className="mt-0.5 font-semibold"
                  style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}
                >
                  {labels.targetRole}{basic.title}
                </div>
              )}
              {metaItems.length > 0 && (
                <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.87em] text-slate-700">
                  {metaItems.map((item, idx) => (
                    <span key={item.key} className="inline-flex items-center gap-1">
                      {idx > 0 && <span className="text-slate-300">|</span>}
                      {globalSettings.useIconMode && item.iconName && (
                        <LucideIconByName name={item.iconName} size={12} className="text-slate-400" />
                      )}
                      <span>
                        {item.label}{labels.colon}{item.value}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
      </InteractiveSection>

      <div style={{ padding: `${Math.max(16, Math.round(pad * 0.72))}px ${pad}px ${pad}px` }}>
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
              nativeStyle={nativeHeadingStyle}
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}

export function SolidCenterHeroResumeLayout({
  document,
  defaultColor,
  nativeHeadingStyle,
  bottomTrimColor,
}: {
  document: ResumeDocument;
  defaultColor: string;
  nativeHeadingStyle: ResolvedHeadingStyle;
  bottomTrimColor?: string;
}) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || defaultColor;
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle);
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const labels = getLocaleLabels(globalSettings.locale);

  return (
    <div className="min-h-[296mm] text-slate-900" style={getSheetRootStyle(globalSettings)}>
      <InteractiveSection sectionId="basic" title={labels.basicSection}>
        <header
          className="text-center"
          style={{
            ...fill.style,
            color: fill.textColor,
            padding: `${Math.max(18, Math.round(pad * 0.75))}px ${pad}px`,
            borderBottom: bottomTrimColor ? `3px solid ${bottomTrimColor}` : undefined,
          }}
        >
          {showPhoto && (
            <div className="mb-2.5 flex justify-center">
              <FloatingAvatar doc={document} shape="circle" size={82} frame="white-ring" />
            </div>
          )}
          {nameVisible && (
            <h1
              className="font-bold tracking-tight"
              style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.54)}px` }}
            >
              {basic.name || '[姓名]'}
            </h1>
          )}
          {titleVisible && basic.title && (
            <div
              className="mt-0.5 font-medium"
              style={{
                color: bottomTrimColor && !fill.isLight ? bottomTrimColor : fill.mutedColor,
                fontSize: `${globalSettings.subheaderSize}px`,
              }}
            >
              {labels.targetRole}{basic.title}
            </div>
          )}
          {metaItems.length > 0 && (
            <div
              className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.86em]"
              style={{ color: fill.mutedColor }}
            >
              {metaItems.map((item, idx) => (
                <span key={item.key} className="inline-flex items-center gap-1">
                  {idx > 0 && <span className="opacity-45">|</span>}
                  {globalSettings.useIconMode && item.iconName && (
                    <LucideIconByName name={item.iconName} size={12} />
                  )}
                  <span>
                    {item.label}{labels.colon}{item.value}
                  </span>
                </span>
              ))}
            </div>
          )}
        </header>
      </InteractiveSection>

      <div style={{ padding: `${Math.max(16, Math.round(pad * 0.75))}px ${pad}px ${pad}px` }}>
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
              nativeStyle={nativeHeadingStyle}
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
