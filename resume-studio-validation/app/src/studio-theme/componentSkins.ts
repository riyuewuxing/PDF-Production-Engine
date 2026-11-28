import type { ThemeStorage } from './storage';

export const BUTTON_VARIANTS = ['solid','outline','soft','flat','raised','gradient'] as const;
export const ICON_VARIANTS = ['square','round','pill','ghost','floating','fine-outline'] as const;
export type ButtonVariant = typeof BUTTON_VARIANTS[number];
export type IconVariant = typeof ICON_VARIANTS[number];
export type ButtonRole = 'normal' | 'primary' | 'danger';
export type ComponentSkins = { button: 'inherit' | ButtonVariant; icon: 'inherit' | IconVariant };
export const DEFAULT_COMPONENT_SKINS: Readonly<ComponentSkins> = Object.freeze({button:'inherit',icon:'inherit'});
export const COMPONENT_SKINS_KEY = 'resume-studio-ui-component-skins-v1';
export const BUTTON_LABELS: Record<ButtonVariant,string> = {solid:'实心',outline:'描边',soft:'柔色',flat:'平面',raised:'轻立体',gradient:'渐变细边'};
export const ICON_LABELS: Record<IconVariant,string> = {square:'方形',round:'圆形',pill:'胶囊',ghost:'幽灵',floating:'浮层','fine-outline':'细描边'};
export const isButtonVariant = (v: unknown): v is ButtonVariant => typeof v==='string' && (BUTTON_VARIANTS as readonly string[]).includes(v);
export const isIconVariant = (v: unknown): v is IconVariant => typeof v==='string' && (ICON_VARIANTS as readonly string[]).includes(v);
export function isComponentSkins(v: unknown): v is ComponentSkins {
  if (!v || typeof v!=='object' || Array.isArray(v)) return false;
  const o=v as Record<string,unknown>;
  return Object.keys(o).length===2 && Object.hasOwn(o,'button') && Object.hasOwn(o,'icon') &&
    (o.button==='inherit'||isButtonVariant(o.button)) && (o.icon==='inherit'||isIconVariant(o.icon));
}
export function equalSkins(a: Readonly<ComponentSkins>,b: Readonly<ComponentSkins>): boolean {
  return a.button===b.button && a.icon===b.icon;
}
export type SkinRead = { skins: ComponentSkins; state:'default'|'saved'|'invalid'|'unavailable'; raw:string|null };
const fallback=(state:SkinRead['state'],raw:string|null=null):SkinRead=>({skins:{...DEFAULT_COMPONENT_SKINS},state,raw});
/** Independent bounded storage. Never migrate or write during startup. */
export function readComponentSkins(storage:ThemeStorage|null):SkinRead {
  if(!storage)return fallback('unavailable');
  try {
    const raw=storage.getItem(COMPONENT_SKINS_KEY);
    if(raw===null)return fallback('default');
    if(raw.length>1024)return fallback('invalid',raw);
    try {
      const o:unknown=JSON.parse(raw);
      if(!o||typeof o!=='object'||Array.isArray(o))return fallback('invalid',raw);
      const row=o as Record<string,unknown>;
      if(Object.keys(row).length!==2||!Object.hasOwn(row,'schemaVersion')||!Object.hasOwn(row,'skins')||row.schemaVersion!==1||!isComponentSkins(row.skins))return fallback('invalid',raw);
      return {skins:{button:row.skins.button,icon:row.skins.icon},state:'saved',raw};
    }catch{return fallback('invalid',raw);}
  }catch{return fallback('unavailable');}
}
export type SkinSave = { skins:ComponentSkins; notice:string|null; basis:string|null; saved:boolean };
export function applyComponentSkins(storage:ThemeStorage|null,value:unknown,basis:string|null):SkinSave|null {
  if(!isComponentSkins(value))return null;
  const skins={button:value.button,icon:value.icon};
  const before=readComponentSkins(storage);
  if(!storage||before.state==='invalid'||before.state==='unavailable')
    return {skins,notice:'组件外观仅本次会话生效；原配置已保留。',basis:before.raw,saved:false};
  if(before.raw!==basis)return {skins,notice:'其他窗口已修改组件外观；本次仅临时生效，未覆盖原配置。',basis,saved:false};
  const raw=JSON.stringify({schemaVersion:1,skins});
  try {storage.setItem(COMPONENT_SKINS_KEY,raw);return {skins,notice:null,basis:raw,saved:true};}
  catch{return {skins,notice:'组件外观已应用，但本地持久化失败。',basis,saved:false};}
}
/** Only explicit, reviewed controls receive these attributes. Inherited mode
 * adds no attributes and preserves the original CSS and handlers. */
export function buttonSkin(skins:Readonly<ComponentSkins>,role:ButtonRole='normal') {
  return skins.button==='inherit'?{}:{'data-studio-skin-family':'button','data-studio-skin':skins.button,'data-studio-skin-role':role} as const;
}
export function iconSkin(skins:Readonly<ComponentSkins>,role:ButtonRole='normal') {
  return skins.icon==='inherit'?{}:{'data-studio-skin-family':'icon','data-studio-skin':skins.icon,'data-studio-skin-role':role} as const;
}
