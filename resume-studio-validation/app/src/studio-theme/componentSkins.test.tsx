import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { applyComponentSkins, buttonSkin, iconSkin, BUTTON_VARIANTS, ICON_VARIANTS, COMPONENT_SKINS_KEY, readComponentSkins, isComponentSkins, DEFAULT_COMPONENT_SKINS } from './componentSkins';
import { StudioThemeProvider,useStudioTheme,useStudioComponentSkins } from './StudioThemeProvider';
import { STUDIO_THEME_KEY } from './storage';
import { ComponentSkinWorkshop } from './ComponentSkinWorkshop';
function memory(initial:Record<string,string>={}) {
 const data=new Map(Object.entries(initial));
 return {data,getItem:vi.fn((k:string)=>data.get(k)??null),setItem:vi.fn((k:string,v:string)=>{data.set(k,v);})};
}
const enc=(button:string,icon:string,schemaVersion=1)=>JSON.stringify({schemaVersion,skins:{button,icon}});
describe('bounded component preference',()=>{
 it('defaults to untouched original controls without writes',()=>{
  const s=memory();
  expect(readComponentSkins(s)).toMatchObject({skins:DEFAULT_COMPONENT_SKINS,state:'default',raw:null});
  expect(buttonSkin(DEFAULT_COMPONENT_SKINS)).toEqual({});expect(iconSkin(DEFAULT_COMPONENT_SKINS)).toEqual({});
  expect(s.setItem).not.toHaveBeenCalled();
 });
 it.each(BUTTON_VARIANTS)('supports button variant %s',button=>{
  const s=memory({[STUDIO_THEME_KEY]:'existing',other:'keep'});
  expect(applyComponentSkins(s,{button,icon:'inherit'},null)?.saved).toBe(true);
  expect(readComponentSkins(s).skins).toEqual({button,icon:'inherit'});
  expect(buttonSkin({button,icon:'inherit'},'danger')).toMatchObject({'data-studio-skin':button,'data-studio-skin-role':'danger'});
  expect(iconSkin({button,icon:'inherit'})).toEqual({});
  expect(s.data.get(STUDIO_THEME_KEY)).toBe('existing');expect(s.data.get('other')).toBe('keep');
 });
 it.each(ICON_VARIANTS)('supports independent icon variant %s',icon=>{
  const s=memory();
  expect(applyComponentSkins(s,{button:'inherit',icon},null)?.saved).toBe(true);
  expect(readComponentSkins(s).skins).toEqual({button:'inherit',icon});
  expect(buttonSkin({button:'inherit',icon})).toEqual({});
  expect(iconSkin({button:'inherit',icon})).toMatchObject({'data-studio-skin':icon,'data-studio-skin-family':'icon'});
 });
 it.each(['{','[]','null',enc('solid','square',2),enc('__proto__','round'),enc('solid','constructor'),JSON.stringify({schemaVersion:1,skins:{button:'solid',icon:'round',other:1}}),'x'.repeat(1025)])('retains malformed/future source %s',raw=>{
  const s=memory({[COMPONENT_SKINS_KEY]:raw});
  expect(readComponentSkins(s).state).toBe('invalid');
  expect(applyComponentSkins(s,{button:'soft',icon:'pill'},raw)?.saved).toBe(false);
  expect(s.data.get(COMPONENT_SKINS_KEY)).toBe(raw);expect(s.setItem).not.toHaveBeenCalled();
 });
 it('rejects invalid candidate, arrays, additional and prototype keys',()=>{
  const s=memory();
  for(const v of [null,[],{button:'unknown',icon:'round'},{button:'solid',icon:'round',extra:true},JSON.parse('{"button":"solid","icon":"round","__proto__":{}}')]){
   expect(isComponentSkins(v)).toBe(false);expect(applyComponentSkins(s,v,null)).toBeNull();
  }
  expect(s.setItem).not.toHaveBeenCalled();
 });
 it('preserves concurrent external valid configuration and reports temporary selection',()=>{
  const a=enc('solid','square'),b=enc('outline','pill');
  const s=memory({[COMPONENT_SKINS_KEY]:a});
  const basis=readComponentSkins(s).raw;
  s.data.set(COMPONENT_SKINS_KEY,b);
  expect(applyComponentSkins(s,{button:'soft',icon:'round'},basis)).toMatchObject({saved:false,notice:expect.stringContaining('其他窗口')});
  expect(s.data.get(COMPONENT_SKINS_KEY)).toBe(b);expect(s.setItem).not.toHaveBeenCalled();
 });
 it('reports storage read/write failures without throwing',()=>{
  const noRead={getItem:()=>{throw Error('denied')},setItem:vi.fn()};
  const noWrite={getItem:()=>null,setItem:()=>{throw Error('quota')}};
  expect(readComponentSkins(noRead).state).toBe('unavailable');
  expect(applyComponentSkins(noRead,{button:'flat',icon:'ghost'},null)?.saved).toBe(false);
  expect(noRead.setItem).not.toHaveBeenCalled();
  expect(applyComponentSkins(noWrite,{button:'flat',icon:'ghost'},null)?.saved).toBe(false);
 });
});
function Probe(){
 const ctx=useStudioTheme(),skins=useStudioComponentSkins();
 return <><input aria-label="独立草稿" defaultValue="原值"/><button type="button" {...buttonSkin(skins)} onClick={()=>ctx.selectTheme('dark')}>切换色板</button><ComponentSkinWorkshop/></>;
}
describe('workshop draft and actual controls',()=>{
 beforeEach(()=>{
  localStorage.clear();
  // jsdom lacks native top-layer behavior; Windows test covers actual modality/focus.
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');this.dispatchEvent(new Event('close'));}});
 });
 afterEach(()=>{cleanup();localStorage.clear();});
 it('draft/cancel/apply, independent persistence and retained element identity',()=>{
  render(<StudioThemeProvider><Probe/></StudioThemeProvider>);
  const control=screen.getByText('切换色板'), input=screen.getByLabelText('独立草稿') as HTMLInputElement;
  fireEvent.change(input,{target:{value:'未保存'}});
  fireEvent.click(screen.getByText('组件外观'));
  fireEvent.change(screen.getByLabelText('普通按钮皮肤'),{target:{value:'raised'}});
  expect(screen.getByText('普通操作')).toHaveAttribute('data-studio-skin','raised');
  expect(control).not.toHaveAttribute('data-studio-skin');
  expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBeNull();
  fireEvent.click(screen.getByText('取消',{exact:true}));
  fireEvent.click(screen.getByText('组件外观'));
  expect(screen.getByLabelText('普通按钮皮肤')).toHaveValue('inherit');
  fireEvent.change(screen.getByLabelText('普通按钮皮肤'),{target:{value:'gradient'}});
  fireEvent.change(screen.getByLabelText('图标按钮皮肤'),{target:{value:'pill'}});
  fireEvent.click(screen.getByText('应用组件外观'));
  expect(screen.getByText('切换色板')).toBe(control);
  expect(screen.getByLabelText('独立草稿')).toBe(input);expect(input.value).toBe('未保存');
  expect(control).toHaveAttribute('data-studio-skin','gradient');
  expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBe(enc('gradient','pill'));
  fireEvent.click(control);
  expect(localStorage.getItem(STUDIO_THEME_KEY)).toContain('dark');
  expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBe(enc('gradient','pill'));
 });
 it('synthetic danger requires explicit confirmation, disabled action never counts',()=>{
  render(<StudioThemeProvider><Probe/></StudioThemeProvider>);
  fireEvent.click(screen.getByText('组件外观'));
  fireEvent.click(screen.getByText('危险操作演示'));
  expect(screen.getByText('样例操作次数：0')).toBeInTheDocument();
  fireEvent.click(screen.getByText('取消样例操作'));
  fireEvent.click(screen.getByText('不可用'));
  expect(screen.getByText('样例操作次数：0')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('危险图标操作演示'));
  fireEvent.click(screen.getByText('确认样例操作'));
  expect(screen.getByText('样例操作次数：1')).toBeInTheDocument();
  expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBeNull();
 });
});
