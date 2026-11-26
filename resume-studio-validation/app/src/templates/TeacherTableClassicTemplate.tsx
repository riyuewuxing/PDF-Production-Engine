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

export function TeacherTableClassicTemplate({ document }: ResumeTemplateProps) {
  const { basic, globalSettings } = document;
  const isEnglish = globalSettings.locale === 'en-US';
  const accent = globalSettings.themeColor || '#1e3a5f';
  const metaItems = getBasicMetaItems(document);
  const sections = getOrderedVisibleSections(document);
  const showPhoto = hasVisiblePhoto(document);
  const nameVisible = basic.fieldOrder.find((f) => f.key === 'name')?.visible ?? true;
  const titleVisible = basic.fieldOrder.find((f) => f.key === 'title')?.visible ?? true;
  const pad = globalSettings.pagePadding;

  const cellEntries: Array<{ label: string; value: string }> = [
    ...(nameVisible ? [{ label: isEnglish ? 'Name' : '姓名', value: basic.name || (isEnglish ? '[Name]' : '[姓名]') }] : []),
    ...(titleVisible && basic.title ? [{ label: isEnglish ? 'Target Role' : '求职岗位', value: basic.title }] : []),
    ...metaItems.map((m) => ({ label: m.label, value: m.value })),
  ];

  const rows: Array<Array<{ label: string; value: string }>> = [];
  for (let i = 0; i < cellEntries.length; i += 2) {
    rows.push(cellEntries.slice(i, i + 2));
  }

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
        <div
          className="mb-2.5 border-b-2 pb-1.5 text-center font-bold tracking-[0.42em]"
          style={{
            color: accent,
            borderColor: accent,
            fontSize: `${Math.round(globalSettings.headerSize * 1.32)}px`,
          }}
        >
          {isEnglish ? 'Resume' : '个人简历'}
        </div>

        <table className="w-full border-collapse border-[1.5px] text-[0.9em]" style={{ borderColor: accent }}>
          <tbody>
            {rows.map((pair, rowIdx) => (
              <tr key={rowIdx}>
                <th
                  className="w-[15%] border bg-slate-50/90 px-2.5 py-1.5 text-left font-semibold text-slate-700"
                  style={{ borderColor: `${accent}55` }}
                >
                  {pair[0]?.label ?? ''}
                </th>
                <td
                  className="w-[28%] border px-2.5 py-1.5 text-slate-900"
                  style={{ borderColor: `${accent}55` }}
                >
                  {pair[0]?.value ?? ''}
                </td>
                <th
                  className="w-[15%] border bg-slate-50/90 px-2.5 py-1.5 text-left font-semibold text-slate-700"
                  style={{ borderColor: `${accent}55` }}
                >
                  {pair[1]?.label ?? ''}
                </th>
                <td
                  className="border px-2.5 py-1.5 text-slate-900"
                  style={{ borderColor: `${accent}55` }}
                >
                  {pair[1]?.value ?? ''}
                </td>
                {rowIdx === 0 && showPhoto && (
                  <td
                    rowSpan={Math.max(4, rows.length)}
                    className="w-[104px] border bg-white p-1.5 text-center align-middle"
                    style={{ borderColor: `${accent}55` }}
                  >
                    <div className="flex justify-center">
                      <ResumePortrait doc={document} overrideWidth={84} overrideHeight={110} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
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
                className="resume-section-heading mb-2 border px-3 py-1 font-bold"
                style={{
                  borderColor: `${accent}50`,
                  backgroundColor: `${accent}10`,
                  color: accent,
                  fontSize: `${Math.max(13, globalSettings.headerSize - 1)}px`,
                }}
              >
                {section.title}
              </h2>
            ) : (
              <SectionHeading
                section={section}
                globalSettings={globalSettings}
                accent={accent}
                nativeStyle="left-bar"
              />
            )}
            <div className="px-1">
              <SectionBody doc={document} section={section} options={{ accentColor: accent }} />
            </div>
          </InteractiveSection>
        ))}
      </div>
    </div>
  );
}
