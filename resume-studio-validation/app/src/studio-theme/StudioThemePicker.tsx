import { STUDIO_THEME_IDS, STUDIO_THEMES, type StudioThemeId } from './presets';

export function StudioThemePicker({ value, notice, onChange }: {
  value: StudioThemeId; notice: string | null; onChange: (value: unknown) => void;
}) {
  return (
    <div className="studio-theme-picker inline-flex min-w-0 shrink-0 flex-wrap items-center gap-1 text-[11px]">
      <label className="inline-flex items-center gap-1" title="阶段预览：顶栏、主导航、内容编辑、样式设置及预览外框。简历纸张及其他面板不变。">
        <span>外观预览</span>
        <select aria-label="切换工作台主题" value={value} onChange={event => onChange(event.target.value)}
          className="studio-theme-select max-w-[130px] rounded border px-2 py-1 text-xs">
          {STUDIO_THEME_IDS.map(id => <option key={id} value={id}>{STUDIO_THEMES[id].label}</option>)}
        </select>
      </label>
      {notice && <span role="status" className="studio-theme-notice max-w-[180px] whitespace-normal">{notice}</span>}
    </div>
  );
}
