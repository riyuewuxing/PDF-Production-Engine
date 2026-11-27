/**
 * P1 pilot: only these four presets are selectable until their real surfaces
 * are migrated. A preset in this registry is not a full-theme acceptance claim.
 */
export const STUDIO_THEME_IDS = ['classic', 'dark', 'light', 'warm'] as const;
export type StudioThemeId = typeof STUDIO_THEME_IDS[number];
export const DEFAULT_STUDIO_THEME: StudioThemeId = 'classic';
export function isStudioThemeId(value: unknown): value is StudioThemeId {
  return typeof value === 'string' && (STUDIO_THEME_IDS as readonly string[]).includes(value);
}

export interface ChromeTokens {
  scheme: 'light' | 'dark';
  surface: string;
  field: string;
  raised: string;
  overlay: string;
  hover: string;
  text: string;
  muted: string;
  border: string;
  divider: string;
  accentText: string;
  accentFill: string;
  accentHover: string;
  onAccent: string;
  selected: string;
  selectedText: string;
  selectedBorder: string;
  focus: string;
  success: string;
  warning: string;
  error: string;
  errorFill: string;
  onError: string;
  privacyFill: string;
  privacyHover: string;
  onPrivacy: string;
  privacyBorder: string;
  info: string;
}
export interface StudioThemePreset {
  id: StudioThemeId;
  label: string;
  header: ChromeTokens;
  nav: ChromeTokens;
}

const classic: ChromeTokens = {
  scheme: 'dark', surface: '#11161f', field: '#0f172a', raised: '#1e293b',
  overlay: '#19202c', hover: '#334155', text: '#f1f5f9', muted: '#cbd5e1',
  border: '#64748b', divider: '#334155', accentText: '#5eead4',
  accentFill: '#0f766e', accentHover: '#115e59', onAccent: '#ffffff',
  selected: '#134e4a', selectedText: '#99f6e4', selectedBorder: '#2dd4bf',
  focus: '#5eead4', success: '#6ee7b7', warning: '#fcd34d', error: '#fca5a5',
  errorFill: '#7f1d1d', onError: '#ffffff', privacyFill: '#6b21a8',
  privacyHover: '#581c87', onPrivacy: '#ffffff', privacyBorder: '#d8b4fe', info: '#93c5fd',
};
const dark: ChromeTokens = {
  ...classic, surface: '#0b1120', field: '#0f172a', raised: '#182234', overlay: '#1e293b',
  hover: '#334155', muted: '#cbd5e1', border: '#718096', divider: '#475569',
};
const light: ChromeTokens = {
  scheme: 'light', surface: '#ffffff', field: '#f8fafc', raised: '#f1f5f9',
  overlay: '#ffffff', hover: '#e2e8f0', text: '#0f172a', muted: '#475569',
  border: '#64748b', divider: '#cbd5e1', accentText: '#115e59',
  accentFill: '#0f766e', accentHover: '#115e59', onAccent: '#ffffff',
  selected: '#ccfbf1', selectedText: '#134e4a', selectedBorder: '#0f766e',
  focus: '#0f766e', success: '#166534', warning: '#92400e', error: '#991b1b',
  errorFill: '#fee2e2', onError: '#991b1b', privacyFill: '#6b21a8',
  privacyHover: '#581c87', onPrivacy: '#ffffff', privacyBorder: '#6b21a8', info: '#1d4ed8',
};
const warm: ChromeTokens = {
  scheme: 'light', surface: '#f4eee1', field: '#fffdf8', raised: '#efe8d8',
  overlay: '#fbf7ee', hover: '#e6dfd0', text: '#292524', muted: '#57534e',
  border: '#78716c', divider: '#d6caba', accentText: '#92400e',
  accentFill: '#92400e', accentHover: '#78350f', onAccent: '#ffffff',
  selected: '#f5dfba', selectedText: '#78350f', selectedBorder: '#92400e',
  focus: '#92400e', success: '#166534', warning: '#92400e', error: '#991b1b',
  errorFill: '#fee2e2', onError: '#991b1b', privacyFill: '#6b21a8',
  privacyHover: '#581c87', onPrivacy: '#ffffff', privacyBorder: '#6b21a8', info: '#1e40af',
};
export const STUDIO_THEMES: Readonly<Record<StudioThemeId, StudioThemePreset>> = {
  classic: { id: 'classic', label: '经典双拼', header: classic, nav: {...classic, surface: '#0d1118'} },
  dark: { id: 'dark', label: '沉浸暗夜', header: dark, nav: {...dark, surface: '#080d1a'} },
  light: { id: 'light', label: '极简晴白', header: light, nav: {...light, surface: '#f8fafc'} },
  warm: { id: 'warm', label: '温润羊皮', header: warm, nav: {...warm, surface: '#efe8d8'} },
};

export function resolveChromeTokens(id: unknown, zone: 'header' | 'nav'): ChromeTokens {
  return STUDIO_THEMES[isStudioThemeId(id) ? id : DEFAULT_STUDIO_THEME][zone];
}
