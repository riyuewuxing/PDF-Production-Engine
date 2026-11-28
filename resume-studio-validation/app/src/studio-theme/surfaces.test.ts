import { describe, expect, it } from 'vitest';
import { STUDIO_THEME_IDS, STUDIO_THEMES } from './presets';
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
    for (const zone of ['panel', 'preview', 'gallery'] as const) {
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
      for (const zone of ['panel', 'preview', 'gallery'] as const) {
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


describe('Gallery chrome is independent of paper', () => {
  it('preserves classic dark gallery with a light editor', () => {
    expect(resolveSurfaceTokens('classic', 'gallery').surface).toBe('#141922');
    expect(resolveSurfaceTokens('classic', 'gallery').scheme).toBe('dark');
    expect(resolveSurfaceTokens('classic', 'panel').scheme).toBe('light');
  });
  it.each(STUDIO_THEME_IDS)('gallery root style exposes only custom properties for %s', id => {
    const css = surfaceStyle(id, 'gallery');
    expect(Object.keys(css).every(k => k.startsWith('--studio-'))).toBe(true);
    for (const key of ['color','colorScheme','fontFamily','filter','transform','opacity','zoom']) expect(css).not.toHaveProperty(key);
  });
});

describe('P2 explicit zone registry — candidate, not completed visual presets', () => {
  it.each([
    ['graphite', '#232326', '#202024', '#18181b', '#101012', 'dark'],
    ['obsidian', '#1c1917', '#211d18', '#11100f', '#0c0a09', 'dark'],
    ['ocean', '#17354b', '#102b40', '#0d2436', '#0a1c2a', 'dark'],
    ['porcelain', '#f6f9fc', '#e2eaf2', '#e6edf4', '#d5dfe9', 'light'],
    ['aurora', '#222a47', '#1c2440', '#161c36', '#12172b', 'dark'],
    ['forest', '#1d382d', '#193128', '#142820', '#0f2019', 'dark'],
    ['lavender', '#faf8ff', '#eae4f4', '#eeeaf7', '#e1dbf0', 'light'],
    ['highContrast', '#111111', '#111111', '#000000', '#000000', 'dark'],
    ['nordic', '#f8f9fa', '#e6eaee', '#e9ecef', '#dde2e7', 'light'],
    ['blueprint', '#1b3150', '#152942', '#102039', '#0c192c', 'dark'],
    ['terracotta', '#fff7f0', '#f2e5dc', '#ede0d7', '#dcc8b9', 'light'],
    ['ink', '#ffffff', '#eeeeee', '#f3f3f3', '#e5e5e5', 'light'],
  ] as const)('does not fall back for %s', (id, panel, preview, gallery, stage, scheme) => {
    expect(resolveSurfaceTokens(id, 'panel').surface).toBe(panel);
    expect(resolveSurfaceTokens(id, 'preview').surface).toBe(preview);
    expect(resolveSurfaceTokens(id, 'gallery').surface).toBe(gallery);
    expect(resolvePreviewBacking(id, 'follow').background).toBe(stage);
    for (const zone of ['header','nav','panel','preview','gallery'] as const) {
      expect(STUDIO_THEMES[id][zone].scheme).toBe(scheme);
      expect(contrast(STUDIO_THEMES[id][zone].text, STUDIO_THEMES[id][zone].surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('retains exact pilot region surface/backing choices', () => {
    for (const [id, panel, preview, gallery, stage] of [
      ['classic','#ffffff','#11161f','#141922','#181d27'],
      ['dark','#111827','#182234','#0b1120','#0b0f17'],
      ['light','#ffffff','#ffffff','#f8fafc','#e2e8f0'],
      ['warm','#fbf7ee','#f4eee1','#f4eee1','#e6dfd0'],
    ] as const) {
      expect(resolveSurfaceTokens(id,'panel').surface).toBe(panel);
      expect(resolveSurfaceTokens(id,'preview').surface).toBe(preview);
      expect(resolveSurfaceTokens(id,'gallery').surface).toBe(gallery);
      expect(resolvePreviewBacking(id,'follow').background).toBe(stage);
    }
  });
});

describe('High contrast candidate colors, not a whole-application accessibility claim', () => {
  it('has prominent foreground and focus in every scoped zone', () => {
    for (const zone of ['header','nav','panel','preview','gallery'] as const) {
      const t=STUDIO_THEMES.highContrast[zone];
      for(const bg of [t.surface,t.field,t.raised,t.hover,t.overlay]) {
        expect(contrast(t.text,bg)).toBeGreaterThanOrEqual(7);
        expect(contrast(t.focus,bg)).toBeGreaterThanOrEqual(7);
        expect(contrast(t.border,bg)).toBeGreaterThanOrEqual(7);
      }
    }
  });
  it('never mixes preview override with the persisted workbench theme', () => {
    for(const id of ['aurora','forest','lavender','highContrast'] as const) {
      expect(resolvePreviewBacking(id,'dark')).toEqual(resolvePreviewBacking('classic','dark'));
      expect(resolvePreviewBacking(id,'light')).toEqual(resolvePreviewBacking('classic','light'));
    }
  });
});

describe('P2 sixteen palette registry completeness, not complete visual themes', () => {
  it('has exactly the approved sixteen distinct IDs and complete independent region records', () => {
    expect(STUDIO_THEME_IDS).toEqual(['classic','dark','light','warm','graphite','obsidian','ocean','porcelain','aurora','forest','lavender','highContrast','nordic','blueprint','terracotta','ink']);
    expect(Object.keys(STUDIO_THEMES).sort()).toEqual([...STUDIO_THEME_IDS].sort());
    expect(new Set(STUDIO_THEME_IDS.map(id=>STUDIO_THEMES[id].label)).size).toBe(16);
    expect(new Set(STUDIO_THEME_IDS.map(id=>JSON.stringify(STUDIO_THEMES[id].header))).size).toBe(16);
    for(const id of STUDIO_THEME_IDS) {
      expect(STUDIO_THEMES[id].id).toBe(id);
      expect(resolvePreviewBacking(id,'dark')).toEqual(resolvePreviewBacking('classic','dark'));
      expect(resolvePreviewBacking(id,'light')).toEqual(resolvePreviewBacking('classic','light'));
    }
  });
});
