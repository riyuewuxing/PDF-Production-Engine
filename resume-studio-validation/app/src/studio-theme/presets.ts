/** P2 candidate presets. Registration is not full-theme acceptance; real scene coverage is tracked separately. */
export const STUDIO_THEME_IDS = ['classic', 'dark', 'light', 'warm', 'graphite', 'obsidian', 'ocean', 'porcelain', 'aurora', 'forest', 'lavender', 'highContrast', 'nordic', 'blueprint', 'terracotta', 'ink'] as const;
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
export interface PreviewStageTokens {
  scheme: 'light' | 'dark';
  background: string;
  label: string;
}
export interface StudioThemePreset {
  id: StudioThemeId;
  label: string;
  header: ChromeTokens;
  nav: ChromeTokens;
  panel: ChromeTokens;
  preview: ChromeTokens;
  gallery: ChromeTokens;
  stage: PreviewStageTokens;
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
// Each preset owns every workbench zone; new dark IDs must never fall
// through a conditional to a white panel. Document colors are not tokens here.
const graphite: ChromeTokens = {
  ...dark, surface: '#18181b', field: '#202024', raised: '#29292e',
  overlay: '#232326', hover: '#36363c', text: '#fafafa', muted: '#d4d4d8',
  border: '#85858e', divider: '#44444c', accentText: '#d4d4d8',
  accentFill: '#52525b', accentHover: '#3f3f46', selected: '#35353b',
  selectedText: '#fafafa', selectedBorder: '#a1a1aa', focus: '#d4d4d8',
};
const obsidian: ChromeTokens = {
  ...dark, surface: '#11100f', field: '#191714', raised: '#28231d',
  overlay: '#211d18', hover: '#352d23', text: '#f5f1e9', muted: '#ded4c3',
  border: '#93846d', divider: '#4c4132', accentText: '#e7c27b',
  accentFill: '#785416', accentHover: '#604115', selected: '#3d2c15',
  selectedText: '#ffe4ad', selectedBorder: '#d4a853', focus: '#e7c27b',
};
const ocean: ChromeTokens = {
  ...dark, surface: '#0d2436', field: '#102b40', raised: '#17354b',
  overlay: '#1a3b54', hover: '#24465c', text: '#eaf6fc', muted: '#c5deed',
  border: '#8098ac', divider: '#39576b', accentText: '#a4d2ff',
  accentFill: '#1e40af', accentHover: '#1e3a8a', selected: '#193c60',
  selectedText: '#d1e8ff', selectedBorder: '#7db8ff', focus: '#a4d2ff',
};
const porcelain: ChromeTokens = {
  ...light, surface: '#e6edf4', field: '#f6f9fc', raised: '#e2eaf2',
  overlay: '#f6f9fc', hover: '#d5dfeb', text: '#183248', muted: '#40566c',
  border: '#667b90', divider: '#b8c7d7', accentText: '#1c4c80',
  accentFill: '#20518b', accentHover: '#193f6e', selected: '#d3e4f5',
  selectedText: '#183b62', selectedBorder: '#2563a6', focus: '#2563a6',
};
// P2 second batch: opaque scoped color candidates. Material and motion
// variants are separate gates; never apply them to document renderers.
const aurora: ChromeTokens = {
  ...dark, surface: '#161c36', field: '#1c2440', raised: '#222a47',
  overlay: '#272e4b', hover: '#303952', text: '#f5f7ff', muted: '#d5ddfa',
  border: '#8996bd', divider: '#4b5679', accentText: '#c4ccff',
  accentFill: '#51429e', accentHover: '#403580', selected: '#383666',
  selectedText: '#eef0ff', selectedBorder: '#a5b4fc', focus: '#a5b4fc',
};
const forest: ChromeTokens = {
  ...dark, surface: '#142820', field: '#193128', raised: '#1d382d',
  overlay: '#223c30', hover: '#2b4438', text: '#eaf6ee', muted: '#d1e8d8',
  border: '#8ba899', divider: '#496656', accentText: '#9ce8b9',
  accentFill: '#256345', accentHover: '#1d5037', selected: '#2b503b',
  selectedText: '#dcfce7', selectedBorder: '#7ddaa3', focus: '#7ddaa3',
};
const lavender: ChromeTokens = {
  ...light, surface: '#eeeaf7', field: '#faf8ff', raised: '#eae4f4',
  overlay: '#faf8ff', hover: '#e0d9f0', text: '#332a47', muted: '#524465',
  border: '#78648d', divider: '#c5b8d8', accentText: '#5b3695',
  accentFill: '#7048ac', accentHover: '#59388d', selected: '#ded1f2',
  selectedText: '#43256a', selectedBorder: '#7048ac', focus: '#7048ac',
};
const highContrast: ChromeTokens = {
  ...dark, surface: '#000000', field: '#111111', raised: '#1a1a1a',
  overlay: '#111111', hover: '#282828', text: '#ffffff', muted: '#e5e5e5',
  border: '#e5e5e5', divider: '#b3b3b3', accentText: '#fde047',
  accentFill: '#6b5100', accentHover: '#4b3900', selected: '#332900',
  selectedText: '#fef3c7', selectedBorder: '#fde047', focus: '#fde047',
};
// P2 final color batch, with explicit per-zone palette choices.
const nordic: ChromeTokens = {
  ...light, surface: '#e9ecef', field: '#f8f9fa', raised: '#e6eaee',
  overlay: '#f8f9fa', hover: '#dde2e7', text: '#26323d', muted: '#455563',
  border: '#687a87', divider: '#b7c4cd', accentText: '#285762',
  accentFill: '#386b79', accentHover: '#2b5360', selected: '#cddfe5',
  selectedText: '#24434c', selectedBorder: '#386b79', focus: '#386b79',
};
const blueprint: ChromeTokens = {
  ...dark, surface: '#102039', field: '#152942', raised: '#1b3150',
  overlay: '#203953', hover: '#29425e', text: '#e5effc', muted: '#c6d9ee',
  border: '#849db6', divider: '#425e7b', accentText: '#a5defb',
  accentFill: '#24597c', accentHover: '#194461', selected: '#244760',
  selectedText: '#e0f2fe', selectedBorder: '#7dd3fc', focus: '#7dd3fc',
};
const terracotta: ChromeTokens = {
  ...light, surface: '#ede0d7', field: '#fff7f0', raised: '#f2e5dc',
  overlay: '#fff7f0', hover: '#dcc8b9', text: '#432c26', muted: '#65483e',
  border: '#84675b', divider: '#c4ad9f', accentText: '#793321',
  accentFill: '#9a402d', accentHover: '#783121', selected: '#e7c7b6',
  selectedText: '#632f23', selectedBorder: '#9a402d', focus: '#9a402d',
  // Warm hover/nav surfaces require darker semantic text than the light base.
  success: '#14532d', warning: '#78350f', info: '#1e40af',
};
const ink: ChromeTokens = {
  ...light, surface: '#f3f3f3', field: '#ffffff', raised: '#eeeeee',
  overlay: '#ffffff', hover: '#e5e5e5', text: '#161616', muted: '#444444',
  border: '#666666', divider: '#b4b4b4', accentText: '#333333',
  accentFill: '#333333', accentHover: '#222222', selected: '#dddddd',
  selectedText: '#161616', selectedBorder: '#333333', focus: '#333333',
};
const withSurface = (palette: ChromeTokens, surface: string): ChromeTokens => ({ ...palette, surface });
export const STUDIO_THEMES: Readonly<Record<StudioThemeId, StudioThemePreset>> = {
  classic: { id: 'classic', label: '经典双拼', header: classic, nav: withSurface(classic, '#0d1118'),
    panel: withSurface(light, '#ffffff'), preview: classic, gallery: withSurface(classic, '#141922'),
    stage: { scheme: 'dark', background: '#181d27', label: '#cbd5e1' } },
  dark: { id: 'dark', label: '沉浸暗夜', header: dark, nav: withSurface(dark, '#080d1a'),
    panel: withSurface(dark, '#111827'), preview: withSurface(dark, '#182234'), gallery: dark,
    stage: { scheme: 'dark', background: '#0b0f17', label: '#cbd5e1' } },
  light: { id: 'light', label: '极简晴白', header: light, nav: withSurface(light, '#f8fafc'),
    panel: light, preview: light, gallery: withSurface(light, '#f8fafc'),
    stage: { scheme: 'light', background: '#e2e8f0', label: '#475569' } },
  warm: { id: 'warm', label: '温润羊皮', header: warm, nav: withSurface(warm, '#efe8d8'),
    panel: withSurface(warm, '#fbf7ee'), preview: warm, gallery: warm,
    stage: { scheme: 'light', background: '#e6dfd0', label: '#57534e' } },
  graphite: { id: 'graphite', label: '石墨专业', header: graphite, nav: withSurface(graphite, '#141417'),
    panel: withSurface(graphite, '#232326'), preview: withSurface(graphite, '#202024'), gallery: graphite,
    stage: { scheme: 'dark', background: '#101012', label: '#d4d4d8' } },
  obsidian: { id: 'obsidian', label: '黑金', header: obsidian, nav: withSurface(obsidian, '#0c0a09'),
    panel: withSurface(obsidian, '#1c1917'), preview: withSurface(obsidian, '#211d18'), gallery: obsidian,
    stage: { scheme: 'dark', background: '#0c0a09', label: '#ded4c3' } },
  ocean: { id: 'ocean', label: '深海蓝', header: ocean, nav: withSurface(ocean, '#0a1c2a'),
    panel: withSurface(ocean, '#17354b'), preview: withSurface(ocean, '#102b40'), gallery: ocean,
    stage: { scheme: 'dark', background: '#0a1c2a', label: '#c5deed' } },
  porcelain: { id: 'porcelain', label: '雾蓝瓷白', header: porcelain, nav: withSurface(porcelain, '#e0e8f0'),
    panel: withSurface(porcelain, '#f6f9fc'), preview: withSurface(porcelain, '#e2eaf2'), gallery: porcelain,
    stage: { scheme: 'light', background: '#d5dfe9', label: '#40566c' } },
  aurora: { id: 'aurora', label: '极光玻璃', header: aurora, nav: withSurface(aurora, '#12172b'),
    panel: withSurface(aurora, '#222a47'), preview: withSurface(aurora, '#1c2440'), gallery: aurora,
    stage: { scheme: 'dark', background: '#12172b', label: '#d5ddfa' } },
  forest: { id: 'forest', label: '森林墨绿', header: forest, nav: withSurface(forest, '#0f2019'),
    panel: withSurface(forest, '#1d382d'), preview: withSurface(forest, '#193128'), gallery: forest,
    stage: { scheme: 'dark', background: '#0f2019', label: '#d1e8d8' } },
  lavender: { id: 'lavender', label: '薰衣草', header: lavender, nav: withSurface(lavender, '#e1dbf0'),
    panel: withSurface(lavender, '#faf8ff'), preview: withSurface(lavender, '#eae4f4'), gallery: lavender,
    stage: { scheme: 'light', background: '#e1dbf0', label: '#524465' } },
  highContrast: { id: 'highContrast', label: '清晰高对比', header: highContrast, nav: highContrast,
    panel: withSurface(highContrast, '#111111'), preview: withSurface(highContrast, '#111111'), gallery: highContrast,
    stage: { scheme: 'dark', background: '#000000', label: '#ffffff' } },
  nordic: { id: 'nordic', label: '北欧雾灰', header: nordic, nav: withSurface(nordic, '#dde2e7'),
    panel: withSurface(nordic, '#f8f9fa'), preview: withSurface(nordic, '#e6eaee'), gallery: nordic,
    stage: { scheme: 'light', background: '#dde2e7', label: '#455563' } },
  blueprint: { id: 'blueprint', label: '工程蓝图', header: blueprint, nav: withSurface(blueprint, '#0c192c'),
    panel: withSurface(blueprint, '#1b3150'), preview: withSurface(blueprint, '#152942'), gallery: blueprint,
    stage: { scheme: 'dark', background: '#0c192c', label: '#c6d9ee' } },
  terracotta: { id: 'terracotta', label: '赤陶暖棕', header: terracotta, nav: withSurface(terracotta, '#dcc8b9'),
    panel: withSurface(terracotta, '#fff7f0'), preview: withSurface(terracotta, '#f2e5dc'), gallery: terracotta,
    stage: { scheme: 'light', background: '#dcc8b9', label: '#65483e' } },
  ink: { id: 'ink', label: '墨迹黑白', header: ink, nav: withSurface(ink, '#e5e5e5'),
    panel: withSurface(ink, '#ffffff'), preview: withSurface(ink, '#eeeeee'), gallery: ink,
    stage: { scheme: 'light', background: '#e5e5e5', label: '#444444' } },
};

export function resolveChromeTokens(id: unknown, zone: 'header' | 'nav'): ChromeTokens {
  return STUDIO_THEMES[isStudioThemeId(id) ? id : DEFAULT_STUDIO_THEME][zone];
}
