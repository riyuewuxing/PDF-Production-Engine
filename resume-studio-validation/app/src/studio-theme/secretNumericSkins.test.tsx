// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {COMPONENT_SKINS_KEY,DEFAULT_COMPONENT_SKINS,FIELD_VARIANTS,applyComponentSkins,readComponentSkins,fieldSkin,equalSkins} from './componentSkins';
import {StudioThemeProvider} from './StudioThemeProvider';
import {ComponentSkinWorkshop} from './ComponentSkinWorkshop';

const enc=(schemaVersion:number,skins:unknown)=>JSON.stringify({schemaVersion,skins});
const base={button:'solid',icon:'round',text:'outline',multiline:'soft'} as const;
beforeEach(()=>{
 localStorage.clear();
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','')}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');this.dispatchEvent(new Event('close'))}});
});
afterEach(()=>{cleanup();localStorage.clear()});
describe('secret and numeric skins store appearance only',()=>{
 it.each(FIELD_VARIANTS)('independent v3 preferences and backward downgrade %s',variant=>{
  const previous=enc(2,base);localStorage.setItem(COMPONENT_SKINS_KEY,previous);
  expect(readComponentSkins(localStorage).skins).toEqual(base);
  expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBe(previous);
  const next=applyComponentSkins(localStorage,{...base,password:variant,number:'raised'},previous)!;
  expect(next.saved).toBe(true);expect(next.basis).toBe(enc(3,{...base,password:variant,number:'raised'}));
  expect(fieldSkin(next.skins,'password')).toEqual({'data-studio-skin-family':'password','data-studio-skin':variant});
  expect(fieldSkin(next.skins,'number')).toEqual({'data-studio-skin-family':'number','data-studio-skin':'raised'});
  const independent=applyComponentSkins(localStorage,{...next.skins,password:'inherit'},next.basis)!;
  expect(independent.basis).toBe(enc(3,{...base,number:'raised'}));
  expect(fieldSkin(independent.skins,'password')).toEqual({});
  expect(applyComponentSkins(localStorage,base,independent.basis)?.basis).toBe(previous);
  expect(equalSkins(base,{...base,password:'inherit',number:'inherit'})).toBe(true);
  expect(equalSkins(base,{...base,number:'inset'})).toBe(false);
 });
 it.each([
  enc(2,{...base,password:'soft'}),enc(2,{...base,number:'inherit'}),
  enc(3,{...base,password:'invalid'}),enc(3,{...base,number:null}),
  enc(3,{...base,password:'inherit'}),enc(4,{...base,password:'soft'}),
  enc(3,{...base,password:'soft',apiKey:'synthetic-never-persist'})
 ])('retains malformed or unsupported source',raw=>{
  localStorage.setItem(COMPONENT_SKINS_KEY,raw);
  expect(readComponentSkins(localStorage).state).toBe('invalid');
  expect(applyComponentSkins(localStorage,{...DEFAULT_COMPONENT_SKINS,password:'outline'},raw)?.saved).toBe(false);
  expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBe(raw);
 });
 it('rejects secret payloads without serializing them',()=>{
  expect(applyComponentSkins(localStorage,{...DEFAULT_COMPONENT_SKINS,password:'synthetic-never-persist'},null)).toBeNull();
  expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBeNull();
 });
});
describe('native workshop samples retain type, value and constraints',()=>{
 it.each(FIELD_VARIANTS)('applies %s without converting native inputs',variant=>{
  render(<StudioThemeProvider><ComponentSkinWorkshop/></StudioThemeProvider>);
  fireEvent.click(screen.getByText('组件外观'));
  const secret=screen.getByLabelText('密钥输入样例') as HTMLInputElement;
  const number=screen.getByLabelText('数字输入样例') as HTMLInputElement;
  fireEvent.change(secret,{target:{value:'synthetic-never-persist'}});
  fireEvent.change(number,{target:{value:'61'}});
  fireEvent.change(screen.getByLabelText('密钥输入皮肤'),{target:{value:variant}});
  fireEvent.change(screen.getByLabelText('数字输入皮肤'),{target:{value:variant}});
  expect(screen.getByLabelText('密钥输入样例')).toBe(secret);
  expect(screen.getByLabelText('数字输入样例')).toBe(number);
  expect(secret.type).toBe('password');expect(secret.value).toBe('synthetic-never-persist');
  expect(number.type).toBe('number');expect(number.valueAsNumber).toBe(61);
  expect(number.min).toBe('1');expect(number.max).toBe('120');expect(number.step).toBe('1');
  expect(secret).toHaveAttribute('data-studio-skin-family','password');
  expect(number).toHaveAttribute('data-studio-skin-family','number');
  expect(screen.getByLabelText('不可用密钥样例')).toBeDisabled();
  expect(screen.getByLabelText('只读数字样例')).toHaveAttribute('readonly');
  expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBeNull();
  fireEvent.click(screen.getByText('应用组件外观'));
  expect(readComponentSkins(localStorage).skins).toEqual({...DEFAULT_COMPONENT_SKINS,password:variant,number:variant});
  expect(localStorage.getItem(COMPONENT_SKINS_KEY)).not.toContain('synthetic');
  expect(localStorage.getItem(COMPONENT_SKINS_KEY)).not.toContain('61');
 });
});
