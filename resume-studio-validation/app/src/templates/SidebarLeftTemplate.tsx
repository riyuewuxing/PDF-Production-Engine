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

export function SidebarLeftTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e293b';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle);
  const metaItems = getBasicMetaItems(document);
  const allSections = getOrderedVisibleSections(document);
  const sidebarSkills = allSections.find((s) => s.id === 'skills');
  const mainSections = allSections.filter((s) => s.id !== 'skills');
  const showPhoto = hasVisiblePhoto(document);
  const nameFieldVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleFieldVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  return (
    <div
      className="relative flex min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-0 w-[32%] print:hidden"
        style={fill.style}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-y-0 left-0 z-0 hidden w-[32%] print:block"
        style={fill.style}
      />

      <aside
        className="relative z-10 w-[32%] shrink-0 break-words"
        style={{
          color: fill.textColor,
          padding: `${pad}px ${Math.max(14, Math.round(pad * 0.72))}px`,
        }}
      >
        <InteractiveSection sectionId="basic" title="基本信息">
          {showPhoto && (
            <div className="mb-4 flex justify-center">
              <ResumePortrait doc={document} className="border-white/30" />
            </div>
          )}

          <div className={showPhoto ? 'text-center' : ''}>
            {nameFieldVisible && (
              <h1
                className="font-bold tracking-tight"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.35)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleFieldVisible && basic.title && (
              <div
                className="mt-1 font-medium"
                style={{
                  color: fill.mutedColor,
                  fontSize: `${Math.max(12, globalSettings.subheaderSize - 1)}px`,
                }}
              >
                {basic.title}
              </div>
            )}
          </div>

          {metaItems.length > 0 && (
            <div
              className="mt-5 space-y-2 border-t pt-4 text-[0.88em]"
              style={{ borderColor: fill.borderColor }}
            >
              {metaItems.map((item) => (
                <div key={item.key} className="flex items-start gap-2">
                  {globalSettings.useIconMode && item.iconName && (
                    <LucideIconByName name={item.iconName} size={13} className="mt-0.5 shrink-0 opacity-80" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[0.85em]" style={{ color: fill.mutedColor }}>
                      {item.label}
                    </div>
                    <div className="[overflow-wrap:anywhere] font-medium">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </InteractiveSection>

        {sidebarSkills && (
          <InteractiveSection
            sectionId={sidebarSkills.id}
            title={sidebarSkills.title}
            className="mt-5 border-t pt-4 text-[0.9em]"
            style={{ borderColor: fill.borderColor }}
          >
            <h2
              className="resume-section-heading mb-2 font-bold tracking-wide"
              style={{ fontSize: `${Math.max(13, globalSettings.headerSize - 2)}px` }}
            >
              {sidebarSkills.title}
            </h2>
            <div className={fill.isLight ? 'text-slate-800' : '[&_*]:!text-white/95'}>
              <SectionBody
                doc={document}
                section={sidebarSkills}
                options={{
                  accentColor: fill.textColor,
                  mutedTextColor: fill.mutedColor,
                  compact: true,
                }}
              />
            </div>
          </InteractiveSection>
        )}
      </aside>

      <main className="relative z-10 min-w-0 flex-1" style={{ padding: `${pad}px` }}>
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
    </div>
  );
}
