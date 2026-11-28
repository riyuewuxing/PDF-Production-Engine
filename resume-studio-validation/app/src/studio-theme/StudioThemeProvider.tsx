import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { applyComponentSkins, DEFAULT_COMPONENT_SKINS, readComponentSkins, type ComponentSkins } from './componentSkins';
import type { StudioThemeId } from './presets';
import { browserThemeStorage, readStudioTheme, selectStudioTheme, themeReadNotice } from './storage';

interface StudioThemeContextValue {
  themeId: StudioThemeId;
  notice: string | null;
  selectTheme: (value: unknown) => void;
  skins: ComponentSkins;
  skinNotice: string|null;
  selectSkins: (value: unknown) => void;
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
  const [skinPref,setSkinPref]=useState(()=>{
    const loaded=readComponentSkins(browserThemeStorage());
    return {skins:loaded.skins,basis:loaded.raw,skinNotice:loaded.state==='invalid'?'已有组件外观配置不受支持，原配置已保留。':loaded.state==='unavailable'?'组件外观配置无法读取。':null};
  });
  const selectSkins=useCallback((value:unknown)=>{
    const next=applyComponentSkins(browserThemeStorage(),value,skinPref.basis);
    if(next)setSkinPref({skins:next.skins,basis:next.basis,skinNotice:next.notice});
  },[skinPref.basis]);
  const context = useMemo(() => ({ ...preference, selectTheme, skins:skinPref.skins,skinNotice:skinPref.skinNotice,selectSkins }), [preference, selectTheme,skinPref,selectSkins]);
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

/** For standalone fixtures and protected document renderers, no opt-in markers. */
export function useStudioComponentSkins(): Readonly<ComponentSkins> {
  return useContext(Context)?.skins ?? DEFAULT_COMPONENT_SKINS;
}
