// @vitest-environment jsdom
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { ResumeDocumentSchema, type ResumeDocument } from '../../schema/resumeSchema';
import { getTemplateMetadata } from '../../templates/registry';
import { ResumeEditorPane } from './ResumeEditorPane';

function fixture(missing:boolean){
  const doc=ResumeDocumentSchema.parse({id:'import-20',title:'Synthetic',templateId:'minimal-ats',createdAt:'2026-01-01',updatedAt:'2026-01-01',
    basic:{name:'SYNTH_RESTORE_NAME_20',title:'SYNTH_KEEP_HIDDEN_ROLE_20',email:'restore@example.invalid'},
    menuSections:[{id:'basic',title:'基本信息',enabled:false,order:0},{id:'skills',title:'技能',order:1}],skillContent:'VISIBLE_SKILL_20',globalSettings:{}});
  doc.basic.fieldOrder=doc.basic.fieldOrder.map(f=>f.key==='title'?{...f,visible:false}:f);
  if(missing)doc.menuSections=doc.menuSections.filter(s=>s.id!=='basic');
  return doc;
}
function Workspace({initial}:{initial:ResumeDocument}){
  const [doc,setDoc]=useState(initial);
  const Template=getTemplateMetadata(doc.templateId).component;
  return <><ResumeEditorPane document={doc} onChange={setDoc}/><div data-testid="preview"><Template document={doc}/></div><output data-testid="source">{JSON.stringify(doc)}</output></>;
}
describe('explicit recovery of imported basic section',()=>{
  it.each([false,true])('recovers missing=%s basic module without changing its stored fields or re-enabling individually hidden values',missing=>{
    const doc=fixture(missing);
    const view=render(<Workspace initial={doc}/>);
    const preview=view.getByTestId('preview');
    expect(preview.textContent).not.toContain('SYNTH_RESTORE_NAME_20');
    expect(preview.textContent).not.toContain('restore@example.invalid');
    expect(preview.textContent).toContain('VISIBLE_SKILL_20');
    const button=view.getByRole('button',{name:missing?'恢复基本信息模块':'显示模块基本信息'});
    fireEvent.click(button);
    expect(preview.textContent).toContain('SYNTH_RESTORE_NAME_20');
    expect(preview.textContent).toContain('restore@example.invalid');
    expect(preview.textContent).not.toContain('SYNTH_KEEP_HIDDEN_ROLE_20');
    const restored=JSON.parse(view.getByTestId('source').textContent??'');
    expect(restored.basic).toEqual(doc.basic);
    expect(restored.menuSections[0]).toMatchObject({id:'basic',enabled:true,order:0});
    expect(view.queryByRole('button',{name:'隐藏模块基本信息'})).toBeNull();
    expect(view.queryByRole('button',{name:'恢复基本信息模块'})).toBeNull();
    expect(within(preview).getByText('VISIBLE_SKILL_20')).toBeTruthy();
    view.unmount();
  });
});
