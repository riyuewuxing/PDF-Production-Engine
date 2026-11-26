import { getLocaleLabels } from '../lib/resumeLocale';
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

export function SidebarRightTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e293b';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle, true);
  const metaItems = getBasicMetaItems(document);
  const allSections = getOrderedVisibleSections(document);
  const sidebarIds = new Set(['skills', 'selfEvaluation']);
  const sideSections = allSections.filter(
    (s) => sidebarIds.has(s.id) || (s.id.startsWith('custom-') && (document.customData[s.id]?.length ?? 0) <= 5),
  );
  const mainSections = allSections.filter((s) => !sideSections.some((side) => side.id === s.id));
  const showPhoto = hasVisiblePhoto(document);
  const nameFieldVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleFieldVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const labels = getLocaleLabels(globalSettings.locale);

  const sidePanelStyle =
    globalSettings.surfaceStyle === 'solid'
      ? { backgroundColor: '#f8fafc', borderLeft: '1px solid #e2e8f0' }
      : { ...fill.style, borderLeft: `1px solid ${fill.borderColor}` };
  const sideTextColor = globalSettings.surfaceStyle === 'solid' ? '#0f172a' : fill.textColor;
  const sideMutedColor = globalSettings.surfaceStyle === 'solid' ? '#64748b' : fill.mutedColor;
  const sideIsLight = globalSettings.surfaceStyle === 'solid' ? true : fill.isLight;

  return (
    <div
      className="relative flex min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-0 w-[33%] print:hidden"
        style={sidePanelStyle}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-y-0 right-0 z-0 hidden w-[33%] print:block"
        style={sidePanelStyle}
      />

      <main
        className="relative z-10 min-w-0 w-[67%]"
        style={{ padding: `${pad}px ${Math.max(16, Math.round(pad * 0.85))}px ${pad}px ${pad}px` }}
      >
        <InteractiveSection
          sectionId="basic"
          title="基本信息"
          style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
        >
          <header className="border-b-2 pb-3" style={{ borderColor: accent }}>
            {nameFieldVisible && (
              <h1
                className="font-bold tracking-tight text-slate-950"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.45)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleFieldVisible && basic.title && (
              <div className="mt-1 font-medium" style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}>
                {labels.targetRole}{basic.title}
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
              nativeStyle="left-bar"
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </main>

      <aside
        className="relative z-10 w-[33%] shrink-0 break-words"
        style={{
          color: sideTextColor,
          padding: `${pad}px ${Math.max(14, Math.round(pad * 0.72))}px`,
        }}
      >
        <InteractiveSection sectionId="basic" title="基本信息">
          {showPhoto && (
            <div className="mb-4 flex justify-center">
              <ResumePortrait doc={document} />
            </div>
          )}

          {metaItems.length > 0 && (
            <div className="mb-5">
              <h2
                className="resume-section-heading mb-2 border-b pb-1 font-bold"
                style={{
                  borderColor: sideIsLight ? '#e2e8f0' : fill.borderColor,
                  fontSize: `${Math.max(13, globalSettings.headerSize - 2)}px`,
                  color: sideIsLight ? accent : sideTextColor,
                }}
              >
                {labels.basicSection}
              </h2>
              <div className="space-y-1.5 text-[0.88em]">
                {metaItems.map((item) => (
                  <div key={item.key} className="flex items-start gap-1.5">
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={12} className="mt-0.5 shrink-0 opacity-75" />
                    )}
                    <div className="min-w-0">
                      <span style={{ color: sideMutedColor }}>{item.label}{labels.colon}</span>
                      <span className="[overflow-wrap:anywhere]">{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </InteractiveSection>

        {sideSections.map((section, idx) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            style={{
              marginBottom: idx === sideSections.length - 1 ? 0 : `${Math.round(globalSettings.sectionSpacing * 0.85)}px`,
            }}
          >
            <h2
              className="resume-section-heading mb-2 border-b pb-1 font-bold"
              style={{
                borderColor: sideIsLight ? '#e2e8f0' : fill.borderColor,
                fontSize: `${Math.max(13, globalSettings.headerSize - 2)}px`,
                color: sideIsLight ? accent : sideTextColor,
              }}
            >
              {section.title}
            </h2>
            <div className={sideIsLight ? '' : '[&_*]:!text-white/95'}>
              <SectionBody
                doc={document}
                section={section}
                options={{
                  accentColor: sideIsLight ? accent : sideTextColor,
                  mutedTextColor: sideMutedColor,
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
