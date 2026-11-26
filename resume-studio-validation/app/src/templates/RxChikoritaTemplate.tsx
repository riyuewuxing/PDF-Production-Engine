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

export function RxChikoritaTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#166534';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle);
  const metaItems = getBasicMetaItems(document);
  const allSections = getOrderedVisibleSections(document);
  const sideIds = new Set(['skills']);
  const sideSections = allSections.filter((s) => sideIds.has(s.id));
  const mainSections = allSections.filter((s) => !sideIds.has(s.id));
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  return (
    <div
      className="relative flex min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-0 w-[30%] print:hidden"
        style={fill.style}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-y-0 right-0 z-0 hidden w-[30%] print:block"
        style={fill.style}
      />

      {/* Left 70% Main Column */}
      <main
        className="relative z-10 min-w-0 w-[70%]"
        style={{ padding: `${pad}px ${Math.max(16, Math.round(pad * 0.85))}px ${pad}px ${pad}px` }}
      >
        <InteractiveSection
          sectionId="basic"
          title="基本信息"
          style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
        >
          <header className="border-b-2 pb-3" style={{ borderColor: accent }}>
            {nameVisible && (
              <h1
                className="font-extrabold tracking-tight text-slate-950"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.55)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleVisible && basic.title && (
              <div className="mt-1 font-semibold" style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}>
                {basic.title}
              </div>
            )}
          </header>
        </InteractiveSection>

        {mainSections.map((section, idx) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            style={{
              marginBottom: idx === mainSections.length - 1 ? 0 : `${globalSettings.sectionSpacing}px`,
            }}
          >
            <SectionHeading
              section={section}
              globalSettings={globalSettings}
              accent={accent}
              nativeStyle="clean"
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </main>

      {/* Right 30% Deep Theme Narrow Column */}
      <aside
        className="relative z-10 w-[30%] shrink-0 break-words"
        style={{
          color: fill.textColor,
          padding: `${pad}px ${Math.max(14, Math.round(pad * 0.68))}px`,
        }}
      >
        <InteractiveSection sectionId="basic" title="基本信息">
          {showPhoto && (
            <div className="mb-4 flex justify-center">
              <ResumePortrait doc={document} className="border-white/35" />
            </div>
          )}

          {metaItems.length > 0 && (
            <div className="space-y-2 text-[0.86em]" style={{ color: fill.mutedColor }}>
              <div
                className="border-b pb-1 font-bold"
                style={{ borderColor: fill.borderColor, color: fill.textColor }}
              >
                个人档案
              </div>
              {metaItems.map((item) => (
                <div key={item.key} className="flex items-start gap-1.5">
                  {globalSettings.useIconMode && item.iconName && (
                    <LucideIconByName name={item.iconName} size={12} className="mt-0.5 shrink-0" />
                  )}
                  <div className="[overflow-wrap:anywhere] min-w-0">
                    <div>{item.label}</div>
                    <div className="font-medium" style={{ color: fill.textColor }}>
                      {item.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </InteractiveSection>

        {sideSections.map((section) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            className="mt-5 border-t pt-3.5"
            style={{ borderColor: fill.borderColor }}
          >
            <h2
              className="resume-section-heading mb-2 font-bold"
              style={{ fontSize: `${Math.max(13, globalSettings.headerSize - 2)}px` }}
            >
              {section.title}
            </h2>
            <div className={fill.isLight ? '' : '[&_*]:!text-white/95'}>
              <SectionBody
                doc={document}
                section={section}
                options={{
                  accentColor: fill.textColor,
                  mutedTextColor: fill.mutedColor,
                  compact: true,
                }}
              />
            </div>
          </InteractiveSection>
        ))}
      </aside>
    </div>
  );
}
