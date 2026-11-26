import { getLocaleLabels } from '../lib/resumeLocale';
import {
  InteractiveSection,
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

export function WondercvRoyalBannerTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#2859b6';
  const fill = getSurfaceFill(accent, globalSettings.surfaceStyle);
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const labels = getLocaleLabels(globalSettings.locale);

  const row1Keys = new Set(['phone', 'email', 'location']);
  const row2Keys = new Set(['birthDate']);
  const row1 = metaItems.filter((m) => row1Keys.has(m.key));
  const row2 = metaItems.filter((m) => row2Keys.has(m.key) || m.key.startsWith('custom-'));
  const row3 = metaItems.filter((m) => !row1Keys.has(m.key) && !row2Keys.has(m.key) && !m.key.startsWith('custom-'));

  return (
    <div className="min-h-[296mm] text-slate-900" style={getSheetRootStyle(globalSettings)}>
      <InteractiveSection sectionId="basic" title="基本信息">
        <header
          className="flex items-center justify-between gap-6"
          style={{
            ...fill.style,
            color: fill.textColor,
            padding: `${Math.max(18, Math.round(pad * 0.78))}px ${pad}px`,
          }}
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            {nameVisible && (
              <h1
                className="font-bold tracking-tight"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.55)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}

            <div className="space-y-1 text-[0.88em]" style={{ color: fill.mutedColor }}>
              {row1.length > 0 && (
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {row1.map((item, idx) => (
                    <span key={item.key}>
                      {idx > 0 && <span className="mr-2 opacity-60">|</span>}
                      {item.label}{labels.colon}{item.value}
                    </span>
                  ))}
                </div>
              )}

              {row2.length > 0 && (
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {row2.map((item, idx) => (
                    <span key={item.key}>
                      {idx > 0 && <span className="mr-2 opacity-60">|</span>}
                      {item.label}{labels.colon}{item.value}
                    </span>
                  ))}
                </div>
              )}

              {(row3.length > 0 || (titleVisible && basic.title)) && (
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {row3.map((item, idx) => (
                    <span key={item.key}>
                      {idx > 0 && <span className="mr-2 opacity-60">|</span>}
                      {item.label}{labels.colon}{item.value}
                    </span>
                  ))}
                  {titleVisible && basic.title && (
                    <span>
                      {row3.length > 0 && <span className="mr-2 opacity-60">|</span>}
                      {labels.targetRole}{basic.title}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {showPhoto && <ResumePortrait doc={document} className="border-white/40" />}
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
              nativeStyle="circle-icon"
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
