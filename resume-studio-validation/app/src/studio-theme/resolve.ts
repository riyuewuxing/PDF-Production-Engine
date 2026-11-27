import type { CSSProperties } from 'react';
import { resolveChromeTokens } from './presets';

/** Apply only to explicitly marked chrome regions, never to an A4 ancestor. */
export function chromeStyle(id: unknown, zone: 'header' | 'nav'): CSSProperties {
  const tokens = resolveChromeTokens(id, zone);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    const kebab = key.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase());
    result['--studio-' + kebab] = value;
  }
  return result as CSSProperties;
}
