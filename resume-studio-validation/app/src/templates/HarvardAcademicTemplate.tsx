import {
  InteractiveSection,
  ResumePortrait,
  SectionBody,
  SectionHeading,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
  resolveFontFamilyStack,
} from './shared';
import type { ResumeTemplateProps } from './types';

export function HarvardAcademicTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#111827';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  const fontStyle = resolveFontFamilyStack(
    globalSettings,
    globalSettings.fontFamily === 'sans' ? 'serif' : globalSettings.fontFamily,
  );

  return (
    <div
      className="min-h-[296mm] text-black"
      style={getSheetRootStyle(globalSettings, {
        padding: `${pad}px`,
        fontFamily: fontStyle,
      })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.85)}px` }}
      >
        <header
          className={`flex items-center gap-6 border-b border-black pb-3 ${
            showPhoto ? 'justify-between' : 'justify-center text-center'
          }`}
        >
          <div className="min-w-0 flex-1">
            {nameVisible && (
              <h1
                className="font-bold tracking-wide text-black"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.55)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleVisible && basic.title && (
              <div
                className="mt-0.5 italic text-neutral-700"
                style={{ fontSize: `${globalSettings.subheaderSize}px` }}
              >
                {basic.title}
              </div>
            )}
            {metaItems.length > 0 && (
              <div
                className={`mt-1.5 flex flex-wrap gap-x-2 text-[0.88em] text-neutral-800 ${
                  showPhoto ? '' : 'justify-center'
                }`}
              >
                {metaItems.map((item, idx) => (
                  <span key={item.key}>
                    {idx > 0 && <span className="mr-2">•</span>}
                    {item.label}：{item.value}
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
            {globalSettings.headingStyle === 'auto' ? (
              <h2
                className="resume-section-heading mb-2 border-b border-black pb-0.5 font-bold tracking-wider"
                style={{ color: accent, fontSize: `${globalSettings.headerSize}px` }}
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
            <SectionBody
              doc={document}
              section={section}
              options={{ accentColor: accent, mutedTextColor: '#374151', italicSubtitle: true }}
            />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
