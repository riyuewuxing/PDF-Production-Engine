import {
  InteractiveSection,
  LucideIconByName,
  SectionBody,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  getSurfaceFill,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';
import { FloatingAvatar, SvgWaveBanner } from './visualPrimitives';

export function VipLavenderSlantTagTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#7c3aed';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle);
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  return (
    <div className="min-h-[296mm] text-slate-900" style={getSheetRootStyle(globalSettings)}>
      <InteractiveSection sectionId="basic" title="基本信息">
        <header>
          <SvgWaveBanner
            variant="slant-polygon"
            themeColor={accent}
            surfaceStyle={globalSettings.surfaceStyle}
            minHeight={132}
            style={{ padding: `${Math.round(pad * 0.72)}px ${pad}px ${Math.round(pad * 0.95)}px` }}
          >
            <div className="flex items-center gap-5">
              {showPhoto && (
                <FloatingAvatar
                  doc={document}
                  shape="rect"
                  width={Math.min(82, basic.photoConfig.width)}
                  height={Math.min(106, basic.photoConfig.height)}
                  frame="card-border"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {nameVisible && (
                    <h1
                      className="font-bold tracking-tight"
                      style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.54)}px` }}
                    >
                      {basic.name || '[姓名]'}
                    </h1>
                  )}
                  {titleVisible && basic.title && (
                    <span
                      className="rounded-full border px-2.5 py-0.5 text-[0.88em] font-medium"
                      style={{ borderColor: fill.borderColor }}
                    >
                      {basic.title}
                    </span>
                  )}
                </div>
                {metaItems.length > 0 && (
                  <div
                    className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.86em]"
                    style={{ color: fill.mutedColor }}
                  >
                    {metaItems.map((item) => (
                      <span key={item.key} className="inline-flex items-center gap-1">
                        {globalSettings.useIconMode && item.iconName && (
                          <LucideIconByName name={item.iconName} size={12} />
                        )}
                        <span>
                          {item.label}：{item.value}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SvgWaveBanner>
        </header>
      </InteractiveSection>

      {/* Left 20% rounded purple capsule column + Right 78% body */}
      <div style={{ padding: `${Math.max(12, Math.round(pad * 0.5))}px ${pad}px ${pad}px` }}>
        {sections.map((section, idx) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0"
            style={{
              marginBottom:
                idx === sections.length - 1 ? 0 : `${Math.round(globalSettings.sectionSpacing * 0.85)}px`,
            }}
          >
            <div className="float-left w-[20%] pr-3">
              <h2
                className="inline-block w-full rounded-full px-2.5 py-[2px] text-center font-bold leading-tight text-white"
                style={{
                  backgroundColor: accent,
                  fontSize: `${Math.max(11, globalSettings.headerSize - 4)}px`,
                }}
              >
                {section.title}
              </h2>
            </div>
            <div className="ml-[23%] min-w-0 pt-[2px]">
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </div>
            <div className="clear-both" />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
