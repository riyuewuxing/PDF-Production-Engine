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
import { FloatingAvatar } from './visualPrimitives';

export function VipCrimsonDotMinimalTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#991b1b';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  const midpoint = Math.ceil(metaItems.length / 2);
  const row1 = metaItems.slice(0, midpoint);
  const row2 = metaItems.slice(midpoint);

  return (
    <div
      className="min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings, { padding: `${pad}px` })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
      >
        <header className="flex items-center gap-5 border-b border-slate-200 pb-3.5">
          {showPhoto && (
            <FloatingAvatar
              doc={document}
              shape="rect"
              width={Math.min(78, basic.photoConfig.width)}
              height={Math.min(102, basic.photoConfig.height)}
              frame="card-border"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-3">
              {nameVisible && (
                <h1
                  className="font-bold tracking-tight text-slate-950"
                  style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.5)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleVisible && basic.title && (
                <span
                  className="font-semibold"
                  style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}
                >
                  {basic.title}
                </span>
              )}
            </div>
            {row1.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[0.87em] text-slate-700">
                {row1.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1">
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={12} className="text-slate-400" />
                    )}
                    <span className="text-slate-500">{item.label}：</span>
                    <span>{item.value}</span>
                  </span>
                ))}
              </div>
            )}
            {row2.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[0.87em] text-slate-700">
                {row2.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1">
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={12} className="text-slate-400" />
                    )}
                    <span className="text-slate-500">{item.label}：</span>
                    <span>{item.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </header>
      </InteractiveSection>

      <div>
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
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
