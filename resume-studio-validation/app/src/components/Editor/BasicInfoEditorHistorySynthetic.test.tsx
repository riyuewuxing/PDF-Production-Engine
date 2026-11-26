// @vitest-environment jsdom
import { fireEvent, render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumeDocumentSchema, type ResumeDocument } from '../../schema/resumeSchema';
import { useHistoryState } from '../../lib/useHistoryState';
import { ResumeEditorPane } from './ResumeEditorPane';

function fixture(){
  return ResumeDocumentSchema.parse({id:'basic-history-synthetic',title:'Synthetic',createdAt:'2026-01-01',updatedAt:'2026-01-01',templateId:'minimal-ats',
    basic:{name:'Initial synthetic name',title:'Synthetic role',customFields:[{id:'custom-history-23',label:'测试标签23',value:'Initial custom value',visible:true}],photoConfig:{visible:true}},
    menuSections:[{id:'basic',title:'基本信息',order:0},{id:'skills',title:'技能',order:1}],skillContent:'VISIBLE_SKILL_23',globalSettings:{}});
}
function Workspace({initial}:{initial:ResumeDocument}){
  const history=useHistoryState(initial);
  const doc=history.value!;
  return <><ResumeEditorPane document={doc} onChange={d=>history.set(d)} onImmediateChange={d=>history.set(d,{immediate:true})}/>
    <button type="button" onClick={history.undo} disabled={!history.canUndo}>Test undo</button>
    <button type="button" onClick={history.redo} disabled={!history.canRedo}>Test redo</button>
    <output data-testid="history-source">{JSON.stringify(doc)}</output>
    <output data-testid="history-count">{history.undoCount}</output></>;
}
function mount(){
  const initial=fixture(),view=render(<Workspace initial={initial}/>);
  const doc=()=>JSON.parse(view.getByTestId('history-source').textContent!) as ResumeDocument;
  const count=()=>Number(view.getByTestId('history-count').textContent);
  const undo=()=>fireEvent.click(view.getByRole('button',{name:'Test undo'}));
  const redo=()=>fireEvent.click(view.getByRole('button',{name:'Test redo'}));
  return {initial,view,doc,count,undo,redo};
}
beforeEach(()=>vi.spyOn(Date,'now').mockReturnValue(10000));
afterEach(()=>{cleanup();vi.restoreAllMocks()});

describe('basic editor separates discrete actions from coalesced text history',()=>{
  it('coalesces consecutive text changes but keeps rapid visibility toggling independently reversible',()=>{
    const {initial,view,doc,count,undo,redo}=mount();
    const input=view.getByLabelText('姓名');
    fireEvent.change(input,{target:{value:'Synthetic A'}});
    fireEvent.change(input,{target:{value:'Synthetic AB'}});
    expect(count()).toBe(1);
    fireEvent.click(view.getByRole('button',{name:'隐藏姓名'}));
    expect(count()).toBe(2);
    expect(doc().basic.fieldOrder.find(f=>f.key==='name')?.visible).toBe(false);
    undo();
    expect(doc().basic.name).toBe('Synthetic AB');
    expect(doc().basic.fieldOrder.find(f=>f.key==='name')?.visible).toBe(true);
    undo();expect(doc()).toEqual(initial);
    redo();expect(doc().basic.name).toBe('Synthetic AB');
    redo();expect(doc().basic.fieldOrder.find(f=>f.key==='name')?.visible).toBe(false);
  });
  it('keeps consecutive custom text, visibility, removal and addition as distinct steps',()=>{
    const {initial,view,doc,count,undo}=mount();
    fireEvent.change(view.getByLabelText('测试标签23内容'),{target:{value:'Edited custom value'}});
    fireEvent.click(view.getByRole('button',{name:'隐藏测试标签23'}));
    fireEvent.click(view.getByRole('button',{name:'删除测试标签23'}));
    fireEvent.click(view.getByRole('button',{name:'添加标签'}));
    expect(count()).toBe(4);
    expect(doc().basic.customFields[0]?.label).toBe('新标签');
    undo();expect(doc().basic.customFields).toHaveLength(0);
    undo();expect(doc().basic.customFields[0]).toMatchObject({value:'Edited custom value',visible:false});
    undo();expect(doc().basic.customFields[0]).toMatchObject({value:'Edited custom value',visible:true});
    undo();expect(doc()).toEqual(initial);
  });
  it('keeps photo visibility and select controls separate from numeric input edits',()=>{
    const {initial,view,doc,count,undo}=mount();
    fireEvent.change(view.getByLabelText('宽 (px)'),{target:{value:'110'}});
    fireEvent.click(view.getByRole('button',{name:'显示头像'}));
    fireEvent.change(view.getByLabelText('头像相框样式'),{target:{value:'white-ring'}});
    fireEvent.change(view.getByLabelText('照片底衬色'),{target:{value:'#2563eb'}});
    expect(count()).toBe(4);
    undo();expect(doc().basic.photoConfig.bgBackdrop).toBe(initial.basic.photoConfig.bgBackdrop);
    undo();expect(doc().basic.photoConfig.frameStyle).toBe(initial.basic.photoConfig.frameStyle);
    undo();expect(doc().basic.photoConfig.visible).toBe(true);
    expect(doc().basic.photoConfig.width).toBe(110);
    undo();expect(doc()).toEqual(initial);
  });
});
