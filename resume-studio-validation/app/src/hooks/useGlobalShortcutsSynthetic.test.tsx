// @vitest-environment jsdom
import { renderHook, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGlobalShortcuts } from './useGlobalShortcuts';

afterEach(()=>cleanup());
function setup(){
  const callbacks={hasActiveDoc:true,onManualSave:vi.fn(),onUndo:vi.fn(),onRedo:vi.fn(),onToggleCommandPalette:vi.fn()};
  renderHook(()=>useGlobalShortcuts(callbacks));
  const field=document.createElement('input');
  document.body.appendChild(field);
  function press(key:string,options:KeyboardEventInit={},target:EventTarget=field,legacy229=false){
    const e=new KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true,...options});
    if(legacy229)Object.defineProperty(e,'keyCode',{value:229});
    target.dispatchEvent(e);return e;
  }
  return {callbacks,field,press};
}
describe('IME-safe global shortcuts',()=>{
  it('does not consume composing undo, redo, save or command-palette events',()=>{
    const {callbacks,field,press}=setup();
    try{
      const events=['z','y','s','k'].map(key=>press(key,{isComposing:true}));
      expect(events.map(e=>e.defaultPrevented)).toEqual([false,false,false,false]);
      expect(callbacks.onUndo).not.toHaveBeenCalled();
      expect(callbacks.onRedo).not.toHaveBeenCalled();
      expect(callbacks.onManualSave).not.toHaveBeenCalled();
      expect(callbacks.onToggleCommandPalette).not.toHaveBeenCalled();
    }finally{field.remove()}
  });
  it('does not consume legacy keyCode 229 when the composition flag is false',()=>{
    const {callbacks,field,press}=setup();
    try{
      expect(press('z',{isComposing:false},field,true).defaultPrevented).toBe(false);
      expect(callbacks.onUndo).not.toHaveBeenCalled();
    }finally{field.remove()}
  });
  it('keeps ordinary global shortcuts and native-text/dialog undo behavior after composition',()=>{
    const {callbacks,field,press}=setup();
    const native=document.createElement('textarea');native.dataset.nativeUndo='true';document.body.appendChild(native);
    const dialog=document.createElement('div');dialog.setAttribute('role','dialog');const nested=document.createElement('input');dialog.appendChild(nested);document.body.appendChild(dialog);
    try{
      expect(press('z').defaultPrevented).toBe(true);
      expect(press('y').defaultPrevented).toBe(true);
      expect(press('z',{shiftKey:true}).defaultPrevented).toBe(true);
      expect(press('s').defaultPrevented).toBe(true);
      expect(press('k').defaultPrevented).toBe(true);
      expect(press('z',{},native).defaultPrevented).toBe(false);
      expect(press('z',{},nested).defaultPrevented).toBe(false);
      expect(callbacks.onUndo).toHaveBeenCalledTimes(1);
      expect(callbacks.onRedo).toHaveBeenCalledTimes(2);
      expect(callbacks.onManualSave).toHaveBeenCalledTimes(1);
      expect(callbacks.onToggleCommandPalette).toHaveBeenCalledTimes(1);
    }finally{field.remove();native.remove();dialog.remove()}
  });
});
