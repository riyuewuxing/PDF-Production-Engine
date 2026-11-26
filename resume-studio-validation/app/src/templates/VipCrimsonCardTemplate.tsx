import {
  InteractiveSection,
  LucideIconByName,
  SectionBody,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
  mixWithWhite,
} from './shared';
import type { ResumeTemplateProps } from './types';
import { FloatingAvatar } from './visualPrimitives';

export function VipCrimsonCardTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#9f1239';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  return (
    <div
      className="min-h-[296mm] border-t-[10px] text-slate-900"
      style={getSheetRootStyle(globalSettings, { borderColor: accent })}
    >
      <div style={{ padding: `${Math.max(16, pad - 6)}px ${pad}px ${pad}px` }}>
        <InteractiveSection
          sectionId="basic"
          title="基本信息"
          style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
        >
          <header
            className="border-b pb-3.5"
            style={{ borderColor: mixWithWhite(accent, 0.72) }}
          >
            <div className="float-left mr-4">
              {showPhoto && (
                <FloatingAvatar
                  doc={document}
                  shape="rect"
                  width={Math.min(82, basic.photoConfig.width)}
                  height={Math.min(106, basic.photoConfig.height)}
                  frame="card-border"
                />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {nameVisible && (
                  <h1
                    className="font-bold tracking-tight"
                    style={{
                      color: accent,
                      fontSize: `${Math.round(globalSettings.headerSize * 1.48)}px`,
                    }}
                  >
                    {basic.name || '[姓名]'}
                  </h1>
                )}
                {titleVisible && basic.title && (
                  <span
                    className="rounded px-2 py-0.5 text-[0.9em] font-semibold"
                    style={{
                      backgroundColor: mixWithWhite(accent, 0.9),
                      color: accent,
                    }}
                  >
                    {basic.title}
                  </span>
                )}
              </div>
              {metaItems.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[0.87em] text-slate-700">
                  {metaItems.map((item) => (
                    <span key={item.key} className="inline-flex items-center gap-1.5">
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
            <div className="clear-both" />
          </header>
        </InteractiveSection>

        <div>
          {sections.map((section, idx) => (
            <InteractiveSection
              key={section.id}
              sectionId={section.id}
              title={section.title}
              pageBreakBefore={section.pageBreakBefore}
              className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0"
              style={{
                marginBottom:
                  idx === sections.length - 1 ? 0 : `${Math.round(globalSettings.sectionSpacing * 0.85)}px`,
              }}
            >
              <div className="float-left w-[19%] pr-2.5 pt-0.5">
                <h2
                  className="inline-block w-full rounded-r border-l-4 px-2 py-0.5 font-bold"
                  style={{
                    borderColor: accent,
                    backgroundColor: mixWithWhite(accent, 0.91),
                    color: accent,
                    fontSize: `${Math.max(12, globalSettings.headerSize - 2)}px`,
                  }}
                >
                  {section.title}
                </h2>
              </div>
              <div className="ml-[21%] min-w-0">
                <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
              </div>
              <div className="clear-both" />
            </InteractiveSection>
          ))}
        </div>
      </div>
    </div>
  );
}
