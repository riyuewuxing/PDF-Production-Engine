import { getLocaleLabels } from '../lib/resumeLocale';
import {
  InteractiveSection,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getHeadingFontWeight,
  getOrderedVisibleSections,
  getSheetRootStyle,
  getSurfaceFill,
  hasVisiblePhoto,
  mixWithWhite,
} from './shared';
import type { ResumeTemplateProps } from './types';
import { FloatingAvatar } from './visualPrimitives';

export function VipSkyNotchHeroTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#3b82f6';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const headingWeight = getHeadingFontWeight(globalSettings);
  const labels = getLocaleLabels(globalSettings.locale);

  const row1Keys = new Set(['phone', 'email', 'location']);
  const row1 = metaItems.filter((m) => row1Keys.has(m.key));
  const row2Base = metaItems.filter((m) => !row1Keys.has(m.key));

  const useCustomSurface =
    globalSettings.surfaceStyle === 'tint' || globalSettings.surfaceStyle === 'outline';
  const surface = getSurfaceFill(accent, globalSettings.surfaceStyle);
  const heroStyle: React.CSSProperties = useCustomSurface
    ? surface.style
    : {
        backgroundColor: accent,
        backgroundImage: `linear-gradient(96deg, ${accent} 0%, ${mixWithWhite(accent, 0.34)} 100%)`,
      };
  const heroTextColor = useCustomSurface ? surface.textColor : '#ffffff';
  const heroMutedColor = useCustomSurface ? surface.mutedColor : 'rgba(255,255,255,0.92)';

  return (
    <div className="min-h-[296mm] text-slate-900" style={getSheetRootStyle(globalSettings)}>
      {/* Flush Top-Left Protruding Gradient Banner + Right White Notch */}
      <InteractiveSection sectionId="basic" title="基本信息">
        <header className="flex items-stretch justify-between">
          <div
            className="min-w-0 flex flex-col justify-center"
            style={{
              ...heroStyle,
              width: showPhoto ? '76%' : '88%',
              color: heroTextColor,
              borderBottomRightRadius: '24px',
              padding: `${Math.max(18, Math.round(pad * 0.72))}px ${Math.max(22, pad)}px`,
            }}
          >
            {nameVisible && (
              <h1
                className="tracking-tight"
                style={{
                  fontWeight: headingWeight,
                  fontSize: `${Math.round(globalSettings.headerSize * 1.58)}px`,
                  lineHeight: 1.2,
                }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}

            <div className="mt-2 space-y-1 text-[0.87em]" style={{ color: heroMutedColor }}>
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

              {(row2Base.length > 0 || (titleVisible && basic.title)) && (
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {row2Base.map((item, idx) => (
                    <span key={item.key}>
                      {idx > 0 && <span className="mr-2 opacity-60">|</span>}
                      {item.label}{labels.colon}{item.value}
                    </span>
                  ))}
                  {titleVisible && basic.title && (
                    <span>
                      {row2Base.length > 0 && <span className="mr-2 opacity-60">|</span>}
                      {labels.targetRole}{basic.title}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {showPhoto && (
            <div
              className="flex shrink-0 items-center justify-center py-3 pr-4"
              style={{
                width: '24%',
                backgroundColor: globalSettings.paperBackground || '#ffffff',
              }}
            >
              <FloatingAvatar
                doc={document}
                shape="rect"
                width={Math.min(82, basic.photoConfig.width)}
                height={Math.min(108, basic.photoConfig.height)}
                frame="none"
              />
            </div>
          )}
        </header>
      </InteractiveSection>

      {/* Main Content */}
      <div style={{ padding: `${Math.max(18, Math.round(pad * 0.68))}px ${pad}px ${pad}px` }}>
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
            {globalSettings.headingStyle === 'auto' ? (
              <h2
                className="resume-section-heading mb-2 pb-1"
                style={{
                  color: accent,
                  fontSize: `${globalSettings.headerSize}px`,
                  fontWeight: headingWeight,
                  borderBottom: `1.5px solid ${mixWithWhite(accent, 0.72)}`,
                }}
              >
                {section.title}
              </h2>
            ) : (
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="clean"
              />
            )}
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
