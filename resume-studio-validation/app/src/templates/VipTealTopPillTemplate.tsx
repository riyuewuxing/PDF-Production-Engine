import { getLocaleLabels } from '../lib/resumeLocale';
import {
  InteractiveSection,
  LucideIconByName,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
  mixWithWhite,
} from './shared';
import type { ResumeTemplateProps } from './types';
import { FloatingAvatar } from './visualPrimitives';

export function VipTealTopPillTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#0e7490';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const labels = getLocaleLabels(globalSettings.locale);

  return (
    <div
      className="min-h-[296mm] border-t-[9px] text-slate-900"
      style={getSheetRootStyle(globalSettings, { borderColor: accent })}
    >
      <div style={{ padding: `${Math.max(16, pad - 6)}px ${pad}px ${pad}px` }}>
        <InteractiveSection
          sectionId="basic"
          title="基本信息"
          style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
        >
          <header className="flex items-start justify-between gap-5">
            <div className="min-w-0 flex-1">
              {nameVisible && (
                <h1
                  className="font-bold tracking-tight"
                  style={{
                    color: accent,
                    fontSize: `${Math.round(globalSettings.headerSize * 1.54)}px`,
                  }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleVisible && basic.title && (
                <div className="mt-1 font-medium text-slate-700" style={{ fontSize: `${globalSettings.subheaderSize}px` }}>
                  {labels.targetRole}{basic.title}
                </div>
              )}
              {metaItems.length > 0 && (
                <div
                  className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 rounded-md px-3 py-2 text-[0.86em] text-slate-700"
                  style={{ backgroundColor: mixWithWhite(accent, 0.94) }}
                >
                  {metaItems.map((item) => (
                    <span key={item.key} className="inline-flex items-center gap-1">
                      {globalSettings.useIconMode && item.iconName && (
                        <LucideIconByName name={item.iconName} size={12} className="text-slate-500" />
                      )}
                      <span className="text-slate-500">{item.label}{labels.colon}</span>
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
                width={Math.min(82, basic.photoConfig.width)}
                height={Math.min(106, basic.photoConfig.height)}
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
