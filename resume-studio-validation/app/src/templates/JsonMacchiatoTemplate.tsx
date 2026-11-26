import {
  InteractiveSection,
  ResumePortrait,
  SectionBody,
  getBasicMetaItems,
  getOrderedVisibleSections,
  getSheetRootStyle,
  hasVisiblePhoto,
} from './shared';
import type { ResumeTemplateProps } from './types';

export function JsonMacchiatoTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#7c2d12';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  const effectivePaper =
    globalSettings.paperBackground.toLowerCase() === '#ffffff'
      ? '#fdfcf8'
      : globalSettings.paperBackground;

  return (
    <div
      className="min-h-[296mm] text-stone-900"
      style={getSheetRootStyle(globalSettings, {
        padding: `${pad}px`,
        backgroundColor: effectivePaper,
      })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.9)}px` }}
      >
        <header className="flex items-start justify-between gap-6 border-b border-stone-300 pb-3.5">
          <div className="min-w-0 flex-1">
            {nameVisible && (
              <h1
                className="font-bold tracking-tight text-stone-950"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.52)}px` }}
              >
                {basic.name || '[姓名]'}
              </h1>
            )}
            {titleVisible && basic.title && (
              <div className="mt-0.5 font-medium" style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}>
                {basic.title}
              </div>
            )}
            {metaItems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.87em] text-stone-600">
                {metaItems.map((item) => (
                  <span key={item.key}>
                    <span className="text-stone-400">{item.label}：</span>
                    <span className="text-stone-800">{item.value}</span>
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
              marginBottom: idx === sections.length - 1 ? 0 : `${Math.round(globalSettings.sectionSpacing * 0.9)}px`,
            }}
          >
            <div className="float-left w-[20%] pr-3 pt-0.5 text-right">
              <h2
                className="font-bold uppercase tracking-wider"
                style={{
                  color: accent,
                  fontSize: `${Math.max(12, globalSettings.headerSize - 2)}px`,
                }}
              >
                {section.title}
              </h2>
            </div>
            <div className="ml-[22%] min-w-0 border-l border-stone-300 pl-4">
              <SectionBody
                doc={document}
                section={section}
                options={{ accentColor: accent, mutedTextColor: '#57534e' }}
              />
            </div>
            <div className="clear-both" />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
