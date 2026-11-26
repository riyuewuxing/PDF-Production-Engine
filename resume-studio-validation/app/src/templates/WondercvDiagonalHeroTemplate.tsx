import { getLocaleLabels } from '../lib/resumeLocale';
import {
  InteractiveSection,
  LucideIconByName,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  getSurfaceFill,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';
import { FloatingAvatar, SvgWaveBanner } from './visualPrimitives';

export function WondercvDiagonalHeroTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#0f4c81';
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
      <InteractiveSection sectionId="basic" title="基本信息">
        <header className="relative">
          <SvgWaveBanner
            variant="slant-polygon"
            themeColor={accent}
            surfaceStyle={globalSettings.surfaceStyle}
            minHeight={128}
            style={{
              padding: `${Math.round(pad * 0.8)}px ${pad}px ${Math.round(pad * 1.15)}px`,
            }}
          >
            <div className="flex items-center justify-between gap-6">
              <div className="min-w-0 flex-1">
                {nameVisible && (
                  <h1
                    className="font-bold tracking-tight"
                    style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.55)}px` }}
                  >
                    {basic.name || '[姓名]'}
                  </h1>
                )}
                {titleVisible && basic.title && (
                  <div
                    className="mt-1 font-medium"
                    style={{ color: fill.mutedColor, fontSize: `${globalSettings.subheaderSize}px` }}
                  >
                    {labels.targetRole}{basic.title}
                  </div>
                )}
              </div>
              {showPhoto && <FloatingAvatar doc={document} shape="rect" frame="card-border" />}
            </div>
          </SvgWaveBanner>

          {metaItems.length > 0 && (
            <div
              className="relative z-10 -mt-5 rounded-md border border-slate-200 bg-white px-4 py-2.5 shadow-xs"
              style={{ marginLeft: `${pad}px`, marginRight: `${pad}px` }}
            >
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.87em] text-slate-700">
                {metaItems.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1">
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={12} className="text-slate-400" />
                    )}
                    <span className="text-slate-500">{item.label}{labels.colon}</span>
                    <span className="font-medium text-slate-900">{item.value}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </header>
      </InteractiveSection>

      <div style={{ padding: `${Math.max(14, Math.round(pad * 0.65))}px ${pad}px ${pad}px` }}>
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
              nativeStyle="circle-icon"
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
