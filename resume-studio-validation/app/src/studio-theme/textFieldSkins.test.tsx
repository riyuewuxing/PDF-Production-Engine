// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { FIELD_VARIANTS,COMPONENT_SKINS_KEY,applyComponentSkins,readComponentSkins,fieldSkin,DEFAULT_COMPONENT_SKINS } from './componentSkins';
import { StudioThemeProvider,useStudioTheme } from './StudioThemeProvider';
import { ComponentSkinWorkshop } from './ComponentSkinWorkshop';
import { BasicInfoEditor } from '../components/Editor/BasicInfoEditor';
import { SectionItemsEditor } from '../components/Editor/SectionItemsEditor';
import { ResumeDocumentSchema,type ResumeDocument } from '../schema/resumeSchema';
const v1=JSON.stringify({schemaVersion:1,skins:{button:'solid',icon:'round'}});
const v2=(skins:unknown)=>JSON.stringify({schemaVersion:2,skins});
const fixture=()=>ResumeDocumentSchema.parse({id:'synthetic-field-skin',title:'Synthetic',templateId:'minimal-ats',createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{name:'合成姓名',title:'合成岗位'},menuSections:[{id:'basic',title:'基本信息',order:0},{id:'skills',title:'技能',order:1}],skillContent:'合成技能',globalSettings:{}});
function Workspace(){
 const [doc,setDoc]=useState<ResumeDocument>(fixture);const {selectSkins}=useStudioTheme();
 return <><BasicInfoEditor basic={doc.basic} onChange={basic=>setDoc(d=>({...d,basic}))}/><SectionItemsEditor document={doc} section={doc.menuSections[1]!} onChange={setDoc}/><ComponentSkinWorkshop/>
  <button type="button" onClick={()=>selectSkins({...DEFAULT_COMPONENT_SKINS,text:'gradient',multiline:'soft'})}>切换文本外观</button><output data-testid="source">{JSON.stringify(doc)}</output></>;
}
beforeEach(()=>{localStorage.clear();Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');this.dispatchEvent(new Event('close'));}})});
afterEach(()=>{cleanup();localStorage.clear()});
describe('text family storage is an explicit backward compatible extension',()=>{
 it('reads v1 without writing and only writes v2 on explicit field selection',()=>{
  localStorage.setItem(COMPONENT_SKINS_KEY,v1);expect(readComponentSkins(localStorage).skins).toEqual({button:'solid',icon:'round'});expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBe(v1);
  const next=applyComponentSkins(localStorage,{button:'solid',icon:'round',text:'inset',multiline:'inherit'},v1)!;
  expect(next.saved).toBe(true);expect(next.basis).toBe(v2({button:'solid',icon:'round',text:'inset'}));
  expect(readComponentSkins(localStorage).skins).toEqual({button:'solid',icon:'round',text:'inset'});
  expect(applyComponentSkins(localStorage,{button:'solid',icon:'round',text:'inherit'},next.basis)?.basis).toBe(v1);
 });
 it.each([v2({button:'solid',icon:'round',text:'unknown'}),v2({button:'solid',icon:'round',extra:'inset'}),v2({button:'solid',icon:'round',multiline:null}),JSON.stringify({schemaVersion:1,skins:{button:'solid',icon:'round',text:'inset'}}),JSON.stringify({schemaVersion:3,skins:{button:'solid',icon:'round'}})])('retains unsupported source %s',raw=>{
  localStorage.setItem(COMPONENT_SKINS_KEY,raw);expect(readComponentSkins(localStorage).state).toBe('invalid');expect(applyComponentSkins(localStorage,{...DEFAULT_COMPONENT_SKINS,text:'soft'},raw)?.saved).toBe(false);expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBe(raw);
 });
 it('preserves external writes and does not mark inherited fields',()=>{
  localStorage.setItem(COMPONENT_SKINS_KEY,v1);const basis=readComponentSkins(localStorage).raw;const other=v2({button:'flat',icon:'round',multiline:'raised'});localStorage.setItem(COMPONENT_SKINS_KEY,other);
  expect(applyComponentSkins(localStorage,{...DEFAULT_COMPONENT_SKINS,text:'soft'},basis)?.saved).toBe(false);expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBe(other);expect(fieldSkin(DEFAULT_COMPONENT_SKINS,'text')).toEqual({});
 });
});
describe('real editor text fields and workshop',()=>{
 it.each(FIELD_VARIANTS)('applies independent %s families without replacing native editing controls',variant=>{
  localStorage.setItem(COMPONENT_SKINS_KEY,v2({...DEFAULT_COMPONENT_SKINS,text:variant,multiline:variant}));
  const view=render(<StudioThemeProvider><Workspace/></StudioThemeProvider>);const name=screen.getByLabelText('姓名') as HTMLInputElement;const area=view.container.querySelector('textarea')!;
  expect(name).toHaveAttribute('data-studio-skin',variant);expect(area).toHaveAttribute('data-studio-skin',variant);expect(name).toHaveAttribute('data-studio-skin-family','text');expect(area).toHaveAttribute('data-studio-skin-family','multiline');
  expect(view.container.querySelectorAll('input[type=number][data-studio-skin],input[type=file][data-studio-skin],input[type=password][data-studio-skin],select[data-studio-skin]')).toHaveLength(0);
  fireEvent.change(name,{target:{value:'合成改名'}});fireEvent.change(area,{target:{value:'合成改写技能'}});area.focus();area.setSelectionRange(1,3);const before=screen.getByTestId('source').textContent;
  fireEvent.click(screen.getByText('切换文本外观'));expect(view.container.querySelector('textarea')).toBe(area);expect(screen.getByLabelText('姓名')).toBe(name);expect(document.activeElement).toBe(area);expect(area.selectionStart).toBe(1);expect(area.selectionEnd).toBe(3);expect(screen.getByTestId('source').textContent).toBe(before);
  expect(name).toHaveValue('合成改名');expect(area).toHaveValue('合成改写技能');expect(name).toHaveAttribute('data-studio-skin','gradient');expect(area).toHaveAttribute('data-studio-skin','soft');
 });
 it('preview draft does not touch editor or storage; cancel and independent restore work',()=>{
  render(<StudioThemeProvider><Workspace/></StudioThemeProvider>);const name=screen.getByLabelText('姓名');fireEvent.click(screen.getByText('组件外观'));fireEvent.change(screen.getByLabelText('单行文本皮肤'),{target:{value:'raised'}});
  expect(screen.getByLabelText('单行文本样例')).toHaveAttribute('data-studio-skin','raised');expect(screen.getByLabelText('多行文本样例')).not.toHaveAttribute('data-studio-skin');expect(name).not.toHaveAttribute('data-studio-skin');expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBeNull();
  fireEvent.click(screen.getByText('取消',{exact:true}));fireEvent.click(screen.getByText('组件外观'));expect(screen.getByLabelText('单行文本皮肤')).toHaveValue('inherit');fireEvent.change(screen.getByLabelText('单行文本皮肤'),{target:{value:'outline'}});fireEvent.change(screen.getByLabelText('多行文本皮肤'),{target:{value:'soft'}});fireEvent.click(screen.getByText('应用组件外观'));
  expect(name).toHaveAttribute('data-studio-skin','outline');expect(readComponentSkins(localStorage).skins).toEqual({...DEFAULT_COMPONENT_SKINS,text:'outline',multiline:'soft'});
  fireEvent.click(screen.getByText('组件外观'));fireEvent.change(screen.getByLabelText('单行文本皮肤'),{target:{value:'inherit'}});fireEvent.click(screen.getByText('应用组件外观'));expect(name).not.toHaveAttribute('data-studio-skin');expect(readComponentSkins(localStorage).skins).toEqual({...DEFAULT_COMPONENT_SKINS,multiline:'soft'});
 });
});
