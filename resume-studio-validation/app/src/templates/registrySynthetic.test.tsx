// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResumeDocumentSchema, TEMPLATE_IDS } from '../schema/resumeSchema';
import { TEMPLATE_REGISTRY, getTemplateMetadata } from './registry';
import { FONT_STACKS } from './shared';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function fixture(){
  return ResumeDocumentSchema.parse({id:'registry-synthetic',title:'Synthetic',createdAt:'2026-01-01',updatedAt:'2026-01-01',
    basic:{name:'SYNTH_NAME_19',title:'SYNTH_ROLE_19',email:'registry@example.invalid'},
    education:[{id:'edu',school:'VISIBLE_SCHOOL_19',major:'Demo'}],
    projects:[{id:'proj',name:'VISIBLE_PROJECT_19',description:'Demo'}, {id:'hidden',name:'HIDDEN_PROJECT_19',visible:false}],
    menuSections:[{id:'basic',title:'Basic',order:0},{id:'education',title:'Education',order:1},{id:'projects',title:'Projects',pageBreakBefore:true,order:2},{id:'custom-awards',title:'Awards',order:3}],
    customData:{'custom-awards':[{id:'award',title:'VISIBLE_AWARD_19'}]},
    globalSettings:{locale:'en-US',paperBackground:'#fdfcf8',headingStyle:'trapezoid-flag',fontFamily:'kaiti',customFontFamily:'KaiTi',letterSpacing:0.4,avoidItemSplit:true}});
}
describe('synthetic 51-template registry contract',()=>{
  it('registers all schema IDs uniquely with stable metadata and font fallback order',()=>{
    expect(TEMPLATE_IDS).toHaveLength(51);
    expect(new Set(TEMPLATE_IDS).size).toBe(51);
    expect(TEMPLATE_REGISTRY.map(m=>m.id)).toEqual([...TEMPLATE_IDS]);
    expect(TEMPLATE_REGISTRY[0]?.id).toBe('vip-sky-notch-hero');
    for(const m of TEMPLATE_REGISTRY)expect(m.recommendedColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(FONT_STACKS.sans.indexOf('Microsoft YaHei')).toBeLessThan(FONT_STACKS.sans.indexOf('Noto Sans SC'));
    expect(FONT_STACKS.serif.indexOf('SimSun')).toBeLessThan(FONT_STACKS.serif.indexOf('Noto Serif SC'));
  });
  it.each([...TEMPLATE_IDS])('renders %s with visible data and optional portrait',id=>{
    const doc=fixture();doc.templateId=id;
    const Template=getTemplateMetadata(id).component;
    const view=render(<Template document={doc}/>);
    expect(view.container.textContent).toContain('VISIBLE_SCHOOL_19');
    expect(view.container.textContent).toContain('VISIBLE_PROJECT_19');
    expect(view.container.textContent).toContain('VISIBLE_AWARD_19');
    expect(view.container.textContent).not.toContain('HIDDEN_PROJECT_19');
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('.resume-force-page-break')).not.toBeNull();
    const withPhoto={...doc,basic:{...doc.basic,photo:image,photoConfig:{...doc.basic.photoConfig,visible:true}}};
    view.rerender(<Template document={withPhoto}/>);
    expect(view.container.querySelector('img')).not.toBeNull();
    view.rerender(<Template document={{...withPhoto,basic:{...withPhoto.basic,photoConfig:{...withPhoto.basic.photoConfig,visible:false}}}}/>);
    expect(view.container.querySelector('img')).toBeNull();
    view.unmount();
  });
  it.each([...TEMPLATE_IDS])('protects hidden basic fields in %s, including photo alt text and disabled module',id=>{
    const doc=fixture();doc.templateId=id;
    doc.basic.phone='19900000000';doc.basic.location='HIDDEN_CITY_20';doc.basic.birthDate='1991-01';doc.basic.employmentStatus='HIDDEN_STATUS_20';
    doc.basic.photo=image;doc.basic.photoConfig.visible=true;
    doc.basic.customFields=[{id:'synthetic-custom',label:'HIDDEN_LABEL_20',value:'HIDDEN_CUSTOM_20',visible:true}];
    const Template=getTemplateMetadata(id).component;
    const before=JSON.stringify(doc);
    const view=render(<Template document={doc}/>);
    expect(view.container.textContent).toContain('SYNTH_NAME_19');
    expect(view.container.querySelector('img')).not.toBeNull();
    const hidden={...doc,basic:{...doc.basic,fieldOrder:doc.basic.fieldOrder.filter(f=>f.key!=='name').map(f=>f.key==='title'?{...f,visible:false}:f)}};
    const hiddenBefore=JSON.stringify(hidden);
    view.rerender(<Template document={hidden}/>);
    for(const marker of ['SYNTH_NAME_19','SYNTH_ROLE_19'])expect(view.container.innerHTML).not.toContain(marker);
    expect(view.container.querySelector('img')).not.toBeNull();
    expect(JSON.stringify(hidden)).toBe(hiddenBefore);
    const disabled={...doc,menuSections:doc.menuSections.map(s=>s.id==='basic'?{...s,enabled:false}:s)};
    const disabledBefore=JSON.stringify(disabled);
    view.rerender(<Template document={disabled}/>);
    for(const marker of ['SYNTH_NAME_19','SYNTH_ROLE_19','registry@example.invalid','19900000000','HIDDEN_CITY_20','1991-01','HIDDEN_STATUS_20','HIDDEN_LABEL_20','HIDDEN_CUSTOM_20',image])expect(view.container.innerHTML).not.toContain(marker);
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.textContent).toContain('VISIBLE_SCHOOL_19');
    expect(view.container.textContent).toContain('VISIBLE_PROJECT_19');
    expect(JSON.stringify(disabled)).toBe(disabledBefore);
    expect(JSON.stringify(doc)).toBe(before);
    view.unmount();
  });
  it.each(['trapezoid-flag','ribbon-fold','dot-accent','block-tag'] as const)('renders heading %s and preserves item-split setting',headingStyle=>{
    const doc=fixture();doc.globalSettings.headingStyle=headingStyle;doc.globalSettings.avoidItemSplit=headingStyle!=='dot-accent';
    const Template=getTemplateMetadata('wondercv-clean-pro').component;
    const view=render(<Template document={doc}/>);
    expect(view.container.querySelector('.resume-section-heading')).not.toBeNull();
    if(headingStyle==='dot-accent')expect(view.container.querySelector('.resume-item-block')).toBeNull();
    else expect(view.container.querySelector('.resume-item-block')).not.toBeNull();
    view.unmount();
  });
});
