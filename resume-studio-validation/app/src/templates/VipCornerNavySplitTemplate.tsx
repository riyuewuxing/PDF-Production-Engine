import {
  InteractiveSection,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
  mixWithWhite,
} from './shared';
import type { ResumeTemplateProps } from './types';
import { FloatingAvatar, SvgWaveBanner } from './visualPrimitives';

export function VipCornerNavySplitTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e3a8a';
  const sideBg = mixWithWhite(accent, 0.93);
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  const sidebarSections = sections.filter(
    (s) => s.id === 'skills' || s.id === 'selfEvaluation' || s.id.includes('interest'),
  );
  const mainSections = sections.filter((s) => !sidebarSections.some((sb) => sb.id === s.id));
  const resolvedMain = mainSections.length > 0 ? mainSections : sections;
  const resolvedSide = mainSections.length > 0 ? sidebarSections : [];

  return (
    <div
      className="relative flex min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings)}
    >
      {/* Full-height left 30% pale blue-gray backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-0 w-[30%] border-r print:hidden"
        style={{ backgroundColor: sideBg, borderColor: mixWithWhite(accent, 0.78) }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-y-0 left-0 z-0 hidden w-[30%] border-r print:block"
        style={{ backgroundColor: sideBg, borderColor: mixWithWhite(accent, 0.78) }}
      />

      {/* Top-right decorative geometric navy wedge */}
      <div aria-hidden="true" className="pointer-events-none absolute top-0 right-0 z-10 w-[55%]">
        <SvgWaveBanner
          variant="corner-wedge"
          themeColor={accent}
          surfaceStyle={globalSettings.surfaceStyle}
          minHeight={96}
        />
      </div>

      {/* Left 30% Light Ice Sidebar */}
      <aside
        className="relative z-10 w-[30%] shrink-0 break-words"
        style={{ padding: `${pad}px ${Math.max(14, Math.round(pad * 0.65))}px` }}
      >
        <InteractiveSection sectionId="basic" title="基本信息">
          {showPhoto && (
            <div className="mb-4 flex justify-center">
              <FloatingAvatar
                doc={document}
                shape="rect"
                width={Math.min(96, basic.photoConfig.width)}
                height={Math.min(126, basic.photoConfig.height)}
                frame="card-border"
              />
            </div>
          )}

          <div className={showPhoto ? 'text-center' : ''}>
            {nameVisible && (
              <h1
                className="font-bold tracking-tight"
                style={{
                  color: accent,
                  fontSize: `${Math.round(globalSettings.headerSize * 1.42)}px`,
                }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleVisible && basic.title && (
              <div className="mt-1 text-[0.9em] font-semibold text-slate-700">{basic.title}</div>
            )}
          </div>

          {metaItems.length > 0 && (
            <div
              className="mt-5 border-t pt-3.5"
              style={{ borderColor: mixWithWhite(accent, 0.72) }}
            >
              <div className="mb-2 text-[0.95em] font-bold" style={{ color: accent }}>
                个人档案
              </div>
              <div className="space-y-1.5 text-[0.85em] text-slate-700">
                {metaItems.map((item) => (
                  <div key={item.key} className="[overflow-wrap:anywhere]">
                    <span className="text-slate-500">{item.label}：</span>
                    <span className="font-medium text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </InteractiveSection>

        {resolvedSide.map((section, idx) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            className="mt-5"
            style={{
              marginBottom:
                idx === resolvedSide.length - 1 ? 0 : `${Math.round(globalSettings.sectionSpacing * 0.8)}px`,
            }}
          >
            <SectionHeading
              section={section}
              globalSettings={globalSettings}
              accent={accent}
              nativeStyle="block-tag"
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent, compact: true }} />
          </InteractiveSection>
        ))}
      </aside>

      {/* Right 70% Main Content */}
      <main
        className="relative z-10 min-w-0 flex-1"
        style={{ padding: `${Math.max(24, Math.round(pad * 1.05))}px ${pad}px ${pad}px` }}
      >
        {resolvedMain.map((section, idx) => (
          <InteractiveSection
            key={section.id}
            sectionId={section.id}
            title={section.title}
            pageBreakBefore={section.pageBreakBefore}
            style={{
              marginBottom: idx === resolvedMain.length - 1 ? 0 : `${globalSettings.sectionSpacing}px`,
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
    </div>
  );
}
