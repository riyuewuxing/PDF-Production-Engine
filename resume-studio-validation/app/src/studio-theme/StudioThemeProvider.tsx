import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { StudioThemeId } from './presets';
import { browserThemeStorage, readStudioTheme, selectStudioTheme, themeReadNotice } from './storage';

interface StudioThemeContextValue {
  themeId: StudioThemeId;
  notice: string | null;
  selectTheme: (value: unknown) => void;
}
const Context = createContext<StudioThemeContextValue | null>(null);

/** Renderer-only UI state. Never connected to the resume/history/IPC save path. */
export function StudioThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(() => {
    const loaded = readStudioTheme(browserThemeStorage());
    return { themeId: loaded.themeId, notice: themeReadNotice(loaded.state) };
  });
  const selectTheme = useCallback((value: unknown) => {
    const next = selectStudioTheme(browserThemeStorage(), value);
    if (next) setPreference({ themeId: next.themeId, notice: next.notice });
  }, []);
  const context = useMemo(() => ({ ...preference, selectTheme }), [preference, selectTheme]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export function useStudioTheme(): StudioThemeContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('StudioThemeProvider missing');
  return value;
}

/** Optional read-only palette for independent review portals and standalone test fixtures. */
export function useStudioThemeId(): StudioThemeId {
  return useContext(Context)?.themeId ?? 'classic';
}
