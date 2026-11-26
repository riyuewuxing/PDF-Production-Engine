import {
  InteractiveSection,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  getSurfaceFill,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';
import { FloatingAvatar } from './visualPrimitives';

export function VipBurgundyLeftSidebarTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#9f1239';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle);
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  const contactKeys = new Set(['phone', 'email', 'location']);
  const contactItems = metaItems.filter((m) => contactKeys.has(m.key));
  const profileItems = metaItems.filter((m) => !contactKeys.has(m.key));

  return (
    <div
      className="relative flex min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-0 w-[27%] print:hidden"
        style={fill.style}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-y-0 left-0 z-0 hidden w-[27%] print:block"
        style={fill.style}
      />

      <aside
        className="relative z-10 w-[27%] shrink-0 break-words"
        style={{
          color: fill.textColor,
          padding: `${pad}px ${Math.max(14, Math.round(pad * 0.65))}px`,
        }}
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
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.42)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleVisible && basic.title && (
              <div className="mt-1 text-[0.9em] font-medium" style={{ color: fill.mutedColor }}>
                {basic.title}
              </div>
            )}
          </div>

          {profileItems.length > 0 && (
            <div className="mt-5 border-t pt-3.5" style={{ borderColor: fill.borderColor }}>
              <div className="mb-2 text-[0.95em] font-bold tracking-wide">个人档案</div>
              <div className="space-y-1.5 text-[0.86em]" style={{ color: fill.mutedColor }}>
                {profileItems.map((item) => (
                  <div key={item.key} className="[overflow-wrap:anywhere]">
                    <span>{item.label}：</span>
                    <span style={{ color: fill.textColor }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {contactItems.length > 0 && (
            <div className="mt-4 border-t pt-3.5" style={{ borderColor: fill.borderColor }}>
              <div className="mb-2 text-[0.95em] font-bold tracking-wide">联系方式</div>
              <div className="space-y-1.5 text-[0.86em]" style={{ color: fill.mutedColor }}>
                {contactItems.map((item) => (
                  <div key={item.key} className="[overflow-wrap:anywhere]">
                    <span>{item.label}：</span>
                    <span style={{ color: fill.textColor }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </InteractiveSection>
      </aside>

      <main
        className="relative z-10 min-w-0 flex-1"
        style={{ padding: `${Math.max(18, Math.round(pad * 0.85))}px ${pad}px` }}
      >
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
              nativeStyle="clean"
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </main>
    </div>
  );
}
