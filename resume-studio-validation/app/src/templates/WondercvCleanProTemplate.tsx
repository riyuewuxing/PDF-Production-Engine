import { getLocaleLabels } from '../lib/resumeLocale';
import {
  InteractiveSection,
  ResumePortrait,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';

export function WondercvCleanProTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e3a5f';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const labels = getLocaleLabels(globalSettings.locale);

  const midpoint = Math.ceil(metaItems.length / 2);
  const line1 = metaItems.slice(0, midpoint);
  const line2 = metaItems.slice(midpoint);

  return (
    <div
      className="min-h-[296mm] border-t-[3px] text-slate-900"
      style={getSheetRootStyle(globalSettings, { padding: `${pad}px`, borderColor: accent })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.8)}px` }}
      >
        <header className={`flex items-center gap-6 border-b pb-3 ${showPhoto ? 'justify-between' : 'justify-center text-center'}`} style={{ borderColor: `${accent}30` }}>
          <div className="min-w-0 flex-1">
            {nameVisible && (
              <h1
                className="font-bold tracking-tight text-slate-950"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.5)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleVisible && basic.title && (
              <div className="mt-1 font-medium" style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}>
                {labels.targetRole}{basic.title}
              </div>
            )}
            {line1.length > 0 && (
              <div className={`mt-2 flex flex-wrap gap-x-2 text-[0.88em] text-slate-700 ${showPhoto ? '' : 'justify-center'}`}>
                {line1.map((item, idx) => (
                  <span key={item.key}>
                    {idx > 0 && <span className="mr-2 text-slate-300">|</span>}
                    {item.label}{labels.colon}{item.value}
                  </span>
                ))}
              </div>
            )}
            {line2.length > 0 && (
              <div className={`mt-0.5 flex flex-wrap gap-x-2 text-[0.88em] text-slate-700 ${showPhoto ? '' : 'justify-center'}`}>
                {line2.map((item, idx) => (
                  <span key={item.key}>
                    {idx > 0 && <span className="mr-2 text-slate-300">|</span>}
                    {item.label}{labels.colon}{item.value}
                  </span>
                ))}
              </div>
            )}
          </div>
          {showPhoto && <ResumePortrait doc={document} />}
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
              nativeStyle="circle-icon"
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
