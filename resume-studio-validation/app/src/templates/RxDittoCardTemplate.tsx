import {
  InteractiveSection,
  LucideIconByName,
  ResumePortrait,
  SectionBody,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  getSurfaceFill,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';

export function RxDittoCardTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#4c1d95';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle);
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
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.9)}px` }}
      >
        <header
          className="flex items-center justify-between gap-5 rounded-xl p-4 shadow-xs"
          style={{
            ...fill.style,
            color: fill.textColor,
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              {nameVisible && (
                <h1
                  className="font-bold tracking-tight"
                  style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.48)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleVisible && basic.title && (
                <span className="font-medium" style={{ color: fill.mutedColor, fontSize: `${globalSettings.subheaderSize}px` }}>
                  {basic.title}
                </span>
              )}
            </div>
            {metaItems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[0.87em]" style={{ color: fill.mutedColor }}>
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
          {showPhoto && <ResumePortrait doc={document} overrideRadius="12px" className="border-white/40" />}
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
            {/* Safe float-left pill label column (never flex + break-after: avoid) */}
            <div className="float-left w-[22%] pr-3 pt-0.5">
              <span
                className="inline-block rounded-full px-2.5 py-0.5 font-bold"
                style={{
                  backgroundColor: `${accent}16`,
                  color: accent,
                  fontSize: `${Math.max(12, globalSettings.headerSize - 3)}px`,
                }}
              >
                {section.title}
              </span>
            </div>
            <div className="ml-[24%] min-w-0">
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </div>
            <div className="clear-both" />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
