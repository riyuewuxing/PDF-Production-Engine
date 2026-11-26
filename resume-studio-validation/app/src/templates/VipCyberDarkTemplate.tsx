import {
  InteractiveSection,
  LucideIconByName,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';
import { DarkSheetWrapper, FloatingAvatar, SvgWaveBanner } from './visualPrimitives';

export function VipCyberDarkTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#2563eb';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  return (
    <DarkSheetWrapper
      bgColor="#0b1220"
      fontStyle={getSheetRootStyle(globalSettings, { backgroundColor: '#0b1220' })}
    >
      <InteractiveSection sectionId="basic" title="基本信息">
        <header>
          <SvgWaveBanner
            variant="cyber-glow"
            themeColor={accent}
            surfaceStyle="gradient"
            minHeight={132}
            style={{ padding: `${Math.round(pad * 0.78)}px ${pad}px ${Math.round(pad * 0.9)}px` }}
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
                      className="font-bold tracking-tight text-white"
                      style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.56)}px` }}
                    >
                      {basic.name || '[姓名]'}
                    </h1>
                  )}
                  {titleVisible && basic.title && (
                    <span className="rounded-full border border-cyan-400/50 bg-cyan-500/15 px-3 py-0.5 text-[0.88em] font-semibold text-cyan-300">
                      {basic.title}
                    </span>
                  )}
                </div>
                {metaItems.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.86em] text-slate-300">
                    {metaItems.map((item) => (
                      <span key={item.key} className="inline-flex items-center gap-1">
                        {globalSettings.useIconMode && item.iconName && (
                          <LucideIconByName name={item.iconName} size={12} className="text-cyan-400" />
                        )}
                        <span className="text-slate-400">{item.label}：</span>
                        <span className="text-slate-100">{item.value}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SvgWaveBanner>
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
              nativeStyle="dot-accent"
              darkMode
            />
            <SectionBody
              doc={document}
              section={section}
              options={{ accentColor: '#38bdf8', darkMode: true }}
            />
          </InteractiveSection>
        ))}
      </div>
    </DarkSheetWrapper>
  );
}
