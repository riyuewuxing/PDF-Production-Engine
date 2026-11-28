// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {COMPONENT_SKINS_KEY,DEFAULT_COMPONENT_SKINS,FIELD_VARIANTS} from './componentSkins';
import {StudioThemeProvider,useStudioTheme} from './StudioThemeProvider';
import {PdfImportModal} from '../components/Versions/PdfImportModal';
import type {PdfImportDraft} from '../lib/pdfResumeImporter';

const fixture:PdfImportDraft={
  title:'合成导入版本',name:'合成候选',jobTitle:'合成岗位',email:'candidate@example.invalid',
  phone:'000-0000',location:'合成城市',birthDate:'2000-01',employmentStatus:'合成状态',
  educationText:'合成教育',experienceText:'合成经历',projectsText:'合成项目',
  skillsText:'合成技能',selfEvaluationText:'合成评价',honorsText:'合成奖项',
  rawText:'合成原文，始终保留',unclassifiedText:'合成未分类材料',sourceKind:'docx'
};
const setStored=(text:string,multiline:string)=>localStorage.setItem(COMPONENT_SKINS_KEY,JSON.stringify({schemaVersion:2,skins:{button:'inherit',icon:'inherit',text,multiline}}));
function ChangeSkins(){
  const {selectSkins}=useStudioTheme();
  return <button type="button" onClick={()=>selectSkins({...DEFAULT_COMPONENT_SKINS,text:'gradient',multiline:'soft'})}>外部切换皮肤</button>;
}
beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();localStorage.clear()});
describe('native import controls: text skin coverage and approval isolation',()=>{
  it.each(FIELD_VARIANTS)('styles seven text and seven multiline controls with %s, excluding date and choices',variant=>{
    setStored(variant,variant);
    const onCreate=vi.fn(async()=>{}),onCancel=vi.fn();
    const view=render(<StudioThemeProvider><PdfImportModal draft={fixture} onCancel={onCancel} onCreateVersion={onCreate}/><ChangeSkins/></StudioThemeProvider>);
    const dialog=screen.getByRole('dialog');
    const inputs=dialog.querySelectorAll('input[data-studio-skin-family="text"]');
    const areas=dialog.querySelectorAll('textarea[data-studio-skin-family="multiline"]');
    expect(inputs).toHaveLength(7);expect(areas).toHaveLength(7);
    for(const el of [...inputs,...areas])expect(el).toHaveAttribute('data-studio-skin',variant);
    const date=within(dialog).getByDisplayValue(fixture.birthDate);
    expect(date).not.toHaveAttribute('data-studio-skin');
    expect(dialog.querySelectorAll('input:is([type=checkbox],[type=radio],[type=password],[type=number])[data-studio-skin]')).toHaveLength(0);
    const name=within(dialog).getByDisplayValue(fixture.name) as HTMLInputElement;
    const area=within(dialog).getByDisplayValue(fixture.educationText) as HTMLTextAreaElement;
    const create=within(dialog).getByRole('button',{name:'创建为新简历版本'});
    expect(create).toBeDisabled();
    fireEvent.change(name,{target:{value:'合成更名'}});
    fireEvent.change(area,{target:{value:'合成教育改写'}});
    area.focus();area.setSelectionRange(1,3);
    fireEvent.click(screen.getByText('外部切换皮肤'));
    expect(within(dialog).getByDisplayValue('合成更名')).toBe(name);
    expect(within(dialog).getByDisplayValue('合成教育改写')).toBe(area);
    expect(document.activeElement).toBe(area);
    expect(area.selectionStart).toBe(1);expect(area.selectionEnd).toBe(3);
    expect(name).toHaveAttribute('data-studio-skin','gradient');expect(area).toHaveAttribute('data-studio-skin','soft');
    expect(date).not.toHaveAttribute('data-studio-skin');
    expect(within(dialog).getByText(fixture.rawText)).toBeInTheDocument();
    expect(create).toBeDisabled();
    fireEvent.click(create);expect(onCreate).not.toHaveBeenCalled();expect(onCancel).not.toHaveBeenCalled();
    expect(fixture.name).toBe('合成候选');expect(fixture.educationText).toBe('合成教育');
    expect(view.container.querySelector('[data-studio-paper] [data-studio-skin]')).toBeNull();
  });
  it('default inherited mode leaves all field attributes and review gates unchanged',()=>{
    const onCreate=vi.fn(async()=>{});
    render(<StudioThemeProvider><PdfImportModal draft={fixture} onCancel={()=>{}} onCreateVersion={onCreate}/></StudioThemeProvider>);
    const dialog=screen.getByRole('dialog');
    expect(dialog.querySelectorAll('input[data-studio-skin],textarea[data-studio-skin]')).toHaveLength(0);
    expect(within(dialog).getByRole('button',{name:'创建为新简历版本'})).toBeDisabled();
    expect(localStorage.getItem(COMPONENT_SKINS_KEY)).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
