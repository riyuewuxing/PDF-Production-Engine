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

export function JakesResumeCnTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#111827';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = Math.max(14, Math.round(globalSettings.pagePadding * 0.85));

  return (
    <div
      className="min-h-[296mm] text-black"
      style={getSheetRootStyle(globalSettings, { padding: `${pad}px ${globalSettings.pagePadding}px` })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.max(8, Math.round(globalSettings.sectionSpacing * 0.65))}px` }}
      >
        <header className={`flex items-center gap-5 ${showPhoto ? 'justify-between' : 'justify-center text-center'}`}>
          <div className="min-w-0 flex-1">
            {nameVisible && (
              <h1
                className="font-extrabold tracking-tight text-black"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.65)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            <div className={`mt-1 flex flex-wrap gap-x-2 text-[0.87em] text-neutral-800 ${showPhoto ? '' : 'justify-center'}`}>
              {titleVisible && basic.title && <span className="font-semibold">{basic.title}</span>}
              {metaItems.map((item) => (
                <span key={item.key}>
                  <span className="mr-2 text-neutral-400">|</span>
                  {item.value}
                </span>
              ))}
            </div>
          </div>
          {showPhoto && <ResumePortrait doc={document} overrideWidth={78} overrideHeight={100} />}
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
              marginBottom:
                idx === sections.length - 1 ? 0 : `${Math.max(8, Math.round(globalSettings.sectionSpacing * 0.72))}px`,
            }}
          >
            <SectionHeading
              section={section}
              globalSettings={globalSettings}
              accent={accent}
              nativeStyle="clean"
            />
            <SectionBody
              doc={document}
              section={section}
              options={{ accentColor: accent, mutedTextColor: '#374151', compact: true }}
            />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
