import { describe, expect, it } from 'vitest';
import { STUDIO_THEME_IDS } from './presets';
import { resolveSurfaceTokens, resolvePreviewBacking, surfaceStyle, stageStyle, type PreviewBacking } from './surfaces';

function luminance(hex: string) {
  const linear = [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('Scoped panel/preview surface tokens', () => {
  it.each(STUDIO_THEME_IDS)('checks scoped token contrast for %s', id => {
    for (const zone of ['panel', 'preview'] as const) {
      const t = resolveSurfaceTokens(id, zone);
      for (const [key, value] of Object.entries(t)) {
        if (key !== 'scheme') expect(value, id + '/' + zone + '/' + key).toMatch(/^#[a-f0-9]{6}$/i);
      }
      for (const bg of [t.surface, t.field, t.raised, t.hover]) {
        for (const fg of [t.text, t.muted, t.success, t.warning, t.error, t.info]) {
          expect(contrast(fg, bg), id + '/' + zone + ': ' + fg + ' on ' + bg).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const [fg, bg] of [
        [t.onAccent, t.accentFill], [t.onAccent, t.accentHover],
        [t.onFillMuted, t.accentFill], [t.selectedText, t.selected],
        [t.success, t.successSurface], [t.warning, t.warningSurface],
        [t.error, t.dangerSurface], [t.info, t.infoSurface], [t.privacyText, t.privacySurface],
      ] as const) {
        expect(contrast(fg, bg), id + '/' + zone + ': ' + fg + ' on ' + bg).toBeGreaterThanOrEqual(4.5);
      }
      for (const bg of [t.surface, t.field]) {
        expect(contrast(t.focus, bg), id + '/' + zone + ' focus').toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('keeps classic editor light independently from its dark preview', () => {
    expect(resolveSurfaceTokens('classic', 'panel').scheme).toBe('light');
    expect(resolveSurfaceTokens('classic', 'preview').scheme).toBe('dark');
    expect(resolveSurfaceTokens('dark', 'panel').surface).toBe('#111827');
    expect(resolveSurfaceTokens('warm', 'panel').surface).toBe('#fbf7ee');
    expect(resolveSurfaceTokens('__proto__', 'panel')).toEqual(resolveSurfaceTokens('classic', 'panel'));
  });
  it('exports only studio-scoped CSS custom properties', () => {
    for (const id of STUDIO_THEME_IDS) {
      for (const zone of ['panel', 'preview'] as const) {
        const style = surfaceStyle(id, zone);
        expect(Object.keys(style).every(key => key.startsWith('--studio-'))).toBe(true);
        expect(style).not.toHaveProperty('color');
        expect(style).not.toHaveProperty('fontFamily');
        expect(style).not.toHaveProperty('colorScheme');
      }
    }
  });
});

describe('Preview backing is a UI-only override, not paper styling', () => {
  it.each(STUDIO_THEME_IDS)('supports independent override and safe labels for %s', id => {
    for (const mode of ['follow', 'dark', 'light'] as const satisfies readonly PreviewBacking[]) {
      const result = resolvePreviewBacking(id, mode);
      expect(contrast(result.label, result.background)).toBeGreaterThanOrEqual(4.5);
      if (mode !== 'follow') expect(result.scheme).toBe(mode);
      expect(Object.keys(stageStyle(result)).sort()).toEqual(['--studio-stage-background', '--studio-stage-label']);
    }
  });
  it('follows the chosen theme only when no explicit backing override exists', () => {
    expect(resolvePreviewBacking('classic', 'follow').background).toBe('#181d27');
    expect(resolvePreviewBacking('dark', 'follow').background).toBe('#0b0f17');
    expect(resolvePreviewBacking('light', 'follow').background).toBe('#e2e8f0');
    expect(resolvePreviewBacking('warm', 'follow').background).toBe('#e6dfd0');
    expect(resolvePreviewBacking('dark', 'light')).toEqual(resolvePreviewBacking('warm', 'light'));
    expect(resolvePreviewBacking('warm', 'dark')).toEqual(resolvePreviewBacking('classic', 'dark'));
    expect(resolvePreviewBacking('not-a-preset', 'follow')).toEqual(resolvePreviewBacking('classic', 'follow'));
  });
});
