import { DEFAULT_STUDIO_THEME, isStudioThemeId, type StudioThemeId } from './presets';

export const STUDIO_THEME_KEY = 'resume-studio-ui-theme-v1';
export const LEGACY_STUDIO_THEME_KEY = 'resume-studio-ui-theme';
export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type ThemeReadState = 'default' | 'saved' | 'legacy' | 'invalid' | 'unavailable';
export interface ThemePreference {
  themeId: StudioThemeId;
  state: ThemeReadState;
}
export interface ThemeSelection {
  themeId: StudioThemeId;
  saved: boolean;
  notice: string | null;
}
export function browserThemeStorage(): ThemeStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}
const fallback = (state: ThemeReadState): ThemePreference => ({ themeId: DEFAULT_STUDIO_THEME, state });

/** Strict, bounded v1 read. No automatic writes and no overwrite of future or malformed data. */
export function readStudioTheme(storage: ThemeStorage | null): ThemePreference {
  if (!storage) return fallback('unavailable');
  try {
    const raw = storage.getItem(STUDIO_THEME_KEY);
    if (raw !== null) {
      if (raw.length > 1024) return fallback('invalid');
      let value: unknown;
      try { value = JSON.parse(raw); } catch { return fallback('invalid'); }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback('invalid');
      const row = value as Record<string, unknown>;
      if (Object.keys(row).length !== 2 || !Object.hasOwn(row, 'schemaVersion') || !Object.hasOwn(row, 'activePreset') ||
        row.schemaVersion !== 1 || !isStudioThemeId(row.activePreset)) return fallback('invalid');
      return { themeId: row.activePreset, state: 'saved' };
    }
    const legacy = storage.getItem(LEGACY_STUDIO_THEME_KEY);
    if (legacy === null) return fallback('default');
    return isStudioThemeId(legacy) ? { themeId: legacy, state: 'legacy' } : fallback('invalid');
  } catch {
    // Storage access failures must preserve existing bytes.
    return fallback('unavailable');
  }
}
export function themeReadNotice(state: ThemeReadState): string | null {
  if (state === 'invalid') return '已有主题配置不受支持，原配置已保留。';
  if (state === 'unavailable') return '主题配置无法读取，本次使用安全默认值。';
  return null;
}

/** User initiated only. Re-read before saving to avoid clobbering an unsupported record. */
export function selectStudioTheme(storage: ThemeStorage | null, id: unknown): ThemeSelection | null {
  if (!isStudioThemeId(id)) return null;
  const before = readStudioTheme(storage);
  if (!storage || before.state === 'invalid' || before.state === 'unavailable') {
    return { themeId: id, saved: false, notice: '仅本次会话生效；未覆盖已有主题配置。' };
  }
  try {
    storage.setItem(STUDIO_THEME_KEY, JSON.stringify({ schemaVersion: 1, activePreset: id }));
    return { themeId: id, saved: true, notice: null };
  } catch {
    return { themeId: id, saved: false, notice: '主题已切换，但本地持久化失败。' };
  }
}
