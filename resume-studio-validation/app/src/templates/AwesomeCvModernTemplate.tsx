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
} from './shared';
import type { ResumeTemplateProps } from './types';

function splitSplicedName(rawName: string): { first: string; rest: string } {
  const name = (rawName || '[姓名]').trim();
  if (name.includes(' ')) {
    const idx = name.indexOf(' ');
    return { first: name.slice(0, idx + 1), rest: name.slice(idx + 1) };
  }
  if (name.length >= 2 && !name.startsWith('[')) {
    return { first: name.slice(0, 1), rest: name.slice(1) };
  }
  return { first: '', rest: name };
}

export function AwesomeCvModernTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const accent = globalSettings.themeColor || '#881337';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;
  const { first, rest } = splitSplicedName(basic.name);

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
        <header className={`flex items-center gap-6 ${showPhoto ? 'justify-between' : 'justify-center text-center'}`}>
          <div className="min-w-0 flex-1">
            {nameVisible && (
              <h1
                className="tracking-tight"
                style={{ fontSize: `${Math.round(globalSettings.headerSize * 1.65)}px` }}
              >
                {first && <span className="font-light text-slate-500">{first}</span>}
                <span className="font-extrabold text-slate-950">{rest}</span>
              </h1>
            )}
            {titleVisible && basic.title && (
              <div
                className="mt-0.5 text-[0.92em] font-semibold uppercase tracking-wider"
                style={{ color: accent }}
              >
                {basic.title}
              </div>
            )}
            {metaItems.length > 0 && (
              <div
                className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.86em] text-slate-600 ${
                  showPhoto ? '' : 'justify-center'
                }`}
              >
                {metaItems.map((item, idx) => (
                  <span key={item.key} className="inline-flex items-center gap-1">
                    {idx > 0 && <span className="text-slate-300">|</span>}
                    {globalSettings.useIconMode && item.iconName && (
                      <LucideIconByName name={item.iconName} size={11} className="text-slate-400" />
                    )}
                    <span>{item.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          {showPhoto && <ResumePortrait doc={document} />}
        </header>
      </InteractiveSection>

      <div>
        {sections.map((section, idx) => {
          const headPrefix = section.title.slice(0, 3);
          const headTail = section.title.slice(3);
          return (
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
                  className="resume-section-heading mb-2 flex items-center gap-2 font-bold text-slate-900"
                  style={{ fontSize: `${globalSettings.headerSize}px` }}
                >
                  <span>
                    <span style={{ color: accent }}>{headPrefix}</span>
                    <span>{headTail}</span>
                  </span>
                  <span className="h-px flex-1 bg-slate-300" />
                </h2>
              ) : (
                <SectionHeading
                  section={section}
                  globalSettings={globalSettings}
                  accent={accent}
                  nativeStyle="clean"
                />
              )}
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </InteractiveSection>
          );
        })}
      </div>
    </div>
  );
}
