import type { CSSProperties } from 'react';
import { DEFAULT_STUDIO_THEME, isStudioThemeId, STUDIO_THEMES, type ChromeTokens, type StudioThemeId, type PreviewStageTokens } from './presets';

export type StudioSurfaceZone = 'panel' | 'preview' | 'gallery';
export type PreviewBacking = 'follow' | 'dark' | 'light';
export interface StudioSurfaceTokens extends ChromeTokens {
  successSurface: string;
  warningSurface: string;
  dangerSurface: string;
  infoSurface: string;
  privacySurface: string;
  privacyText: string;
  onFillMuted: string;
}

const darkStatus = {
  successSurface: '#173828', warningSurface: '#422c15', dangerSurface: '#3b1d25',
  infoSurface: '#1b3149', privacySurface: '#3b215d', privacyText: '#e9d5ff',
  onFillMuted: '#f1f5f9',
};
const lightStatus = {
  successSurface: '#dcfce7', warningSurface: '#fef3c7', dangerSurface: '#fee2e2',
  infoSurface: '#dbeafe', privacySurface: '#f3e8ff', privacyText: '#581c87',
  onFillMuted: '#f1f5f9',
};

export function resolveSurfaceTokens(value: unknown, zone: StudioSurfaceZone): StudioSurfaceTokens {
  const id: StudioThemeId = isStudioThemeId(value) ? value : DEFAULT_STUDIO_THEME;
  // Every accepted ID has explicit per-zone tokens. Classic retains its
  // existing split palette, and status colors remain semantic, not decorative.
  const palette = STUDIO_THEMES[id][zone];
  const status = palette.scheme === 'dark' ? darkStatus : lightStatus;
  return { ...palette, ...status };
}

export function surfaceStyle(id: unknown, zone: StudioSurfaceZone): CSSProperties {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(resolveSurfaceTokens(id, zone))) {
    result['--studio-' + key.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase())] = value;
  }
  return result as CSSProperties;
}

export type ResolvedPreviewBacking = PreviewStageTokens;
const defaultDark: ResolvedPreviewBacking = { scheme: 'dark', background: '#181d27', label: '#cbd5e1' };
const defaultLight: ResolvedPreviewBacking = { scheme: 'light', background: '#e2e8f0', label: '#475569' };

export function resolvePreviewBacking(id: unknown, override: PreviewBacking): ResolvedPreviewBacking {
  if (override === 'dark') return defaultDark;
  if (override === 'light') return defaultLight;
  return STUDIO_THEMES[isStudioThemeId(id) ? id : DEFAULT_STUDIO_THEME].stage;
}

/** Only these two custom properties may cross the stage ancestor.
 * Document templates never consume them; only explicit backing/label rules do.
 */
export function stageStyle(backing: ResolvedPreviewBacking): CSSProperties {
  return { '--studio-stage-background': backing.background, '--studio-stage-label': backing.label } as CSSProperties;
}
