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

export function VipClassicTopPhotoProTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e40af';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  return (
    <div
      className="min-h-[296mm] border-t-[5px] text-slate-900"
      style={getSheetRootStyle(globalSettings, { borderColor: accent })}
    >
      <div style={{ padding: `${Math.max(16, pad - 4)}px ${pad}px ${pad}px` }}>
        <InteractiveSection
          sectionId="basic"
          title="基本信息"
          style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
        >
          <header className="flex items-start justify-between gap-6 border-b border-slate-200 pb-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-3">
                {nameVisible && (
                  <h1
                    className="font-bold tracking-tight text-slate-950"
                    style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.56)}px` }}
                  >
                    {basic.name || '[姓名]'}
                  </h1>
                )}
                {titleVisible && basic.title && (
                  <span
                    className="font-semibold"
                    style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}
                  >
                    求职岗位：{basic.title}
                  </span>
                )}
              </div>

              {metaItems.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.87em] text-slate-700">
                  {metaItems.map((item) => (
                    <span key={item.key} className="inline-flex items-center gap-1 [overflow-wrap:anywhere]">
                      {globalSettings.useIconMode && item.iconName && (
                        <LucideIconByName name={item.iconName} size={12} className="shrink-0 text-slate-400" />
                      )}
                      <span className="text-slate-500">{item.label}：</span>
                      <span className="font-medium text-slate-900">{item.value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {showPhoto && (
              <FloatingAvatar
                doc={document}
                shape="rect"
                width={84}
                height={110}
                frame="card-border"
              />
            )}
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
                nativeStyle="block-tag"
              />
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </InteractiveSection>
          ))}
        </div>
      </div>
    </div>
  );
}
