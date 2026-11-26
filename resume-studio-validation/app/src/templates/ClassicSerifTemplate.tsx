import {
  InteractiveSection,
  LucideIconByName,
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

export function ClassicSerifTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#1e293b';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameFieldVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleFieldVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;

  const fontStyle = resolveFontFamilyStack(
    globalSettings,
    globalSettings.fontFamily === 'sans' ? 'serif' : globalSettings.fontFamily,
  );

  return (
    <div
      className="min-h-[296mm] text-slate-900"
      style={getSheetRootStyle(globalSettings, {
        padding: `${globalSettings.pagePadding}px`,
        fontFamily: fontStyle,
      })}
    >
      <InteractiveSection
        sectionId="basic"
        title="基本信息"
        style={{ marginBottom: `${Math.round(globalSettings.sectionSpacing * 0.8)}px` }}
      >
        <header className="border-t border-b-2 py-3" style={{ borderColor: accent }}>
          <div className={`flex items-center gap-6 ${showPhoto ? 'justify-between' : 'justify-center text-center'}`}>
            <div className="min-w-0 flex-1">
              {nameFieldVisible && (
                <h1
                  className="font-bold tracking-wide text-slate-950"
                  style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.5)}px` }}
                >
                  {basic.name || '[姓名]'}
                </h1>
              )}
              {titleFieldVisible && basic.title && (
                <div
                  className="mt-1 font-medium tracking-wide"
                  style={{ color: accent, fontSize: `${globalSettings.subheaderSize}px` }}
                >
                  {basic.title}
                </div>
              )}
              {metaItems.length > 0 && (
                <div
                  className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.9em] text-slate-700 ${
                    showPhoto ? '' : 'justify-center'
                  }`}
                >
                  {metaItems.map((item, idx) => (
                    <span key={item.key} className="inline-flex items-center gap-1">
                      {idx > 0 && <span className="text-slate-300">|</span>}
                      {globalSettings.useIconMode && item.iconName && (
                        <LucideIconByName name={item.iconName} size={12} className="text-slate-500" />
                      )}
                      <span>
                        {item.label}：{item.value}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {showPhoto && <ResumePortrait doc={document} />}
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
              nativeStyle="clean"
            />
            <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
