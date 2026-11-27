import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_THEME_IDS, STUDIO_THEMES, isStudioThemeId, resolveChromeTokens } from './presets';
import { chromeStyle } from './resolve';
import { LEGACY_STUDIO_THEME_KEY, STUDIO_THEME_KEY, readStudioTheme, selectStudioTheme, type ThemeStorage } from './storage';
import { StudioThemeProvider, useStudioTheme } from './StudioThemeProvider';
import { StudioThemePicker } from './StudioThemePicker';
import { CommandPaletteModal } from '../components/Common/CommandPaletteModal';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
  };
}
const encoded = (activePreset: string, schemaVersion = 1) => JSON.stringify({ schemaVersion, activePreset });

describe('Studio theme preferences — independent and bounded', () => {
  it('defaults without writing and only accepts implemented ids', () => {
    const storage = memoryStorage();
    expect(readStudioTheme(storage)).toEqual({ themeId: 'classic', state: 'default' });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(STUDIO_THEME_IDS.every(isStudioThemeId)).toBe(true);
    expect(isStudioThemeId('__proto__')).toBe(false);
    expect(selectStudioTheme(storage, 'constructor')).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('reads legacy choice without destroying it; explicit selection saves v1', () => {
    const storage = memoryStorage({ [LEGACY_STUDIO_THEME_KEY]: 'warm', unrelated: 'untouched' });
    expect(readStudioTheme(storage)).toEqual({ themeId: 'warm', state: 'legacy' });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(selectStudioTheme(storage, 'light')).toEqual({ themeId: 'light', saved: true, notice: null });
    expect(readStudioTheme(storage)).toEqual({ themeId: 'light', state: 'saved' });
    expect(storage.data.get(LEGACY_STUDIO_THEME_KEY)).toBe('warm');
    expect(storage.data.get('unrelated')).toBe('untouched');
  });
  it.each([
    '{', encoded('unknown'), encoded('dark', 2), '[]', 'null',
    '{"schemaVersion":1,"activePreset":"classic","__proto__":{"x":1}}',
    'x'.repeat(1025),
  ])('retains unsupported or malformed preferences %s', raw => {
    const storage = memoryStorage({ [STUDIO_THEME_KEY]: raw, [LEGACY_STUDIO_THEME_KEY]: 'dark' });
    expect(readStudioTheme(storage)).toEqual({ themeId: 'classic', state: 'invalid' });
    expect(selectStudioTheme(storage, 'warm')).toMatchObject({ themeId: 'warm', saved: false });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.get(STUDIO_THEME_KEY)).toBe(raw);
  });
  it('handles denied read and denied write without throwing or touching other data', () => {
    const deniedRead: ThemeStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: vi.fn(),
    };
    expect(readStudioTheme(deniedRead).state).toBe('unavailable');
    expect(selectStudioTheme(deniedRead, 'dark')).toMatchObject({ saved: false });
    expect(deniedRead.setItem).not.toHaveBeenCalled();
    const deniedWrite: ThemeStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
    };
    expect(selectStudioTheme(deniedWrite, 'light')).toMatchObject({ themeId: 'light', saved: false });
    expect(selectStudioTheme(null, 'warm')).toMatchObject({ themeId: 'warm', saved: false });
  });
  it('rechecks storage on explicit selection and never overwrites a newly introduced future version', () => {
    const storage = memoryStorage({ [STUDIO_THEME_KEY]: encoded('dark') });
    expect(readStudioTheme(storage).themeId).toBe('dark');
    storage.data.set(STUDIO_THEME_KEY, encoded('dark', 99));
    expect(selectStudioTheme(storage, 'warm')).toMatchObject({ saved: false });
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

function luminance(hex: string) {
  const linear = [1, 3, 5].map(offset => {
    const v = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe('Chrome token contract (not a whole-application contrast claim)', () => {
  it.each(STUDIO_THEME_IDS)('checks token pairs for %s', id => {
    for (const zone of ['header', 'nav'] as const) {
      const t = resolveChromeTokens(id, zone);
      for (const [key, value] of Object.entries(t)) {
        if (key !== 'scheme') expect(value).toMatch(/^#[0-9a-f]{6}$/i);
      }
      for (const bg of [t.surface, t.field, t.raised, t.overlay, t.hover]) {
        for (const fg of [t.text, t.muted, t.accentText, t.success, t.warning, t.error, t.info]) {
          expect(contrast(fg, bg), id + '/' + zone + ': ' + fg + ' on ' + bg).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const [fg, bg] of [[t.onAccent, t.accentFill], [t.onAccent, t.accentHover],
        [t.selectedText, t.selected], [t.onError, t.errorFill],
        [t.onPrivacy, t.privacyFill], [t.onPrivacy, t.privacyHover]] as const) {
        expect(contrast(fg, bg), id + '/' + zone + ': ' + fg + ' on ' + bg).toBeGreaterThanOrEqual(4.5);
      }
      for (const [fg, bg] of [[t.border, t.field], [t.focus, t.surface],
        [t.focus, t.field], [t.selectedBorder, t.selected]] as const) {
        expect(contrast(fg, bg), id + '/' + zone + ': ' + fg + ' on ' + bg).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('returns safe known vars only and uses a separate classic nav palette', () => {
    expect(resolveChromeTokens('__proto__', 'header')).toEqual(STUDIO_THEMES.classic.header);
    expect(resolveChromeTokens('classic', 'header').surface).not.toBe(resolveChromeTokens('classic', 'nav').surface);
    const style = chromeStyle('warm', 'header');
    expect(Object.keys(style).every(k => k.startsWith('--studio-'))).toBe(true);
    expect(style).not.toHaveProperty('color');
    expect(style).not.toHaveProperty('colorScheme');
    expect(style).not.toHaveProperty('fontFamily');
  });
});

function Probe() {
  const theme = useStudioTheme();
  return <><StudioThemePicker value={theme.themeId} notice={theme.notice} onChange={theme.selectTheme} />
    <input aria-label="独立编辑器草稿" defaultValue="初值" /></>;
}
describe('Theme controls preserve independent editor identity', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { cleanup(); window.localStorage.clear(); });
  it('changes only preference and preserves an unrelated input, focus and draft', () => {
    window.localStorage.setItem('unrelated', 'keep');
    render(<StudioThemeProvider><Probe /></StudioThemeProvider>);
    const input = screen.getByLabelText('独立编辑器草稿') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '未保存草稿' } });
    input.focus();
    fireEvent.change(screen.getByLabelText('切换工作台主题'), { target: { value: 'dark' } });
    expect(screen.getByLabelText('独立编辑器草稿')).toBe(input);
    expect(input.value).toBe('未保存草稿');
    expect(document.activeElement).toBe(input);
    expect(window.localStorage.getItem(STUDIO_THEME_KEY)).toBe(encoded('dark'));
    expect(window.localStorage.getItem('unrelated')).toBe('keep');
  });
  it('loads saved preference on mount and exposes a storage failure notice', () => {
    window.localStorage.setItem(STUDIO_THEME_KEY, encoded('warm'));
    const view = render(<StudioThemeProvider><Probe /></StudioThemeProvider>);
    expect(screen.getByLabelText('切换工作台主题')).toHaveValue('warm');
    view.unmount();
    window.localStorage.setItem(STUDIO_THEME_KEY, encoded('dark', 2));
    render(<StudioThemeProvider><Probe /></StudioThemeProvider>);
    expect(screen.getByLabelText('切换工作台主题')).toHaveValue('classic');
    expect(screen.getByRole('status')).toHaveTextContent('原配置已保留');
    fireEvent.change(screen.getByLabelText('切换工作台主题'), { target: { value: 'light' } });
    expect(screen.getByLabelText('切换工作台主题')).toHaveValue('light');
    expect(window.localStorage.getItem(STUDIO_THEME_KEY)).toBe(encoded('dark', 2));
  });
  it('routes command palette selection to the theme callback only', () => {
    const onSelectStudioTheme = vi.fn();
    const onClose = vi.fn();
    const businessAction = vi.fn();
    render(<CommandPaletteModal isOpen onClose={onClose} activeTab="edit" activeSlug="synthetic"
      activeTemplateId="minimal-ats" activeLocale="zh-CN" isRedacted={false} summaries={[]}
      masterSummary={null} onSelectTab={businessAction} onSwitchVersion={businessAction}
      onSelectTemplate={businessAction} onExportFormat={businessAction} onFitOnePage={businessAction}
      onToggleRedacted={businessAction} onToggleLocale={businessAction}
      activeStudioTheme="classic" onSelectStudioTheme={onSelectStudioTheme} />);
    const input = screen.getByLabelText('搜索命令、模板与版本');
    fireEvent.change(input, { target: { value: '工作台主题 warm' } });
    expect(screen.getByText('工作台外观预览：温润羊皮')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelectStudioTheme).toHaveBeenCalledWith('warm');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(businessAction).not.toHaveBeenCalled();
  });
});
