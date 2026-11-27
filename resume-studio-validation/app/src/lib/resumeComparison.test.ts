import { describe,expect,it } from 'vitest';
import { compareResumeDocuments } from './resumeComparison';
import { comparisonFixture,changedComparisonFixture } from './comparisonSyntheticFixture';
describe('read-only structured resume comparison',()=>{
  it('ignores volatile timestamps, editor selection and document id but warns about independent IDs',()=>{
    const a=comparisonFixture(),b={...a,id:'another',createdAt:'later',updatedAt:'later',activeSection:'projects'};
    const d=compareResumeDocuments(a,b);expect(d.rows).toEqual([]);expect(d.warnings.join('')).toContain('文档 ID 不同');
  });
  it('distinguishes content, structure, style, added and removed rows and never mutates input',()=>{
    const a=comparisonFixture(),b=changedComparisonFixture(),before=JSON.stringify(a),after=JSON.stringify(b);
    const d=compareResumeDocuments(a,b);
    expect(new Set(d.rows.map(r=>r.category))).toEqual(new Set(['content','structure','style']));
    expect(d.counts.added).toBe(1);expect(d.counts.removed).toBe(1);expect(d.counts.modified).toBeGreaterThan(5);
    expect(d.rows.find(r=>r.label==='邮箱')?.fields[0]).toMatchObject({before:{text:'baseline@example.invalid',hidden:false},after:{text:'target@example.invalid',hidden:false}});
    expect(d.rows.find(r=>r.label==='模板')?.fields[0]?.after?.text).toBe('minimal-ats');
    expect(JSON.stringify(a)).toBe(before);expect(JSON.stringify(b)).toBe(after);
  });
  it('insertion and deletion alone do not falsely report reordering or modification',()=>{
    const a=comparisonFixture(),b=structuredClone(a);b.education.unshift({...a.education[0]!,id:'new-row',school:'新学院'});
    let d=compareResumeDocuments(a,b);expect(d.rows).toHaveLength(1);expect(d.rows[0]?.kind).toBe('added');
    b.education=b.education.filter(e=>e.id!=='edu-a');d=compareResumeDocuments(a,b);
    expect(d.counts).toEqual({added:1,removed:1,modified:0,ambiguous:0});
  });
  it('reports common-relative ranks even when an insertion makes a raw index remain unchanged',()=>{
    const a=comparisonFixture(),b=structuredClone(a);
    b.education=[{...a.education[0]!,id:'new',school:'新增'},a.education[1]!,a.education[0]!];
    const d=compareResumeDocuments(a,b);expect(d.counts.modified).toBe(2);expect(d.counts.added).toBe(1);
    const row=d.rows.find(r=>r.beforePosition===2&&r.afterPosition===2&&r.kind==='modified');
    expect(row?.fields).toEqual([{label:'共同条目中的相对顺序',before:{text:'2',hidden:false,asset:false},after:{text:'1',hidden:false,asset:false},referenceChanged:false}]);
  });
  it('never pairs duplicate IDs by ordinal or same title',()=>{
    const a=comparisonFixture(),b=structuredClone(a);
    a.education.push({...a.education[0]!,school:'冲突学院'});
    b.education[0]!.school='修改学院';
    const d=compareResumeDocuments(a,b);expect(d.counts.ambiguous).toBe(3);expect(d.counts.modified).toBe(0);expect(d.warnings.join('')).toContain('不会按标题');
    expect(d.rows.every(r=>r.kind==='ambiguous'&&((r.beforePosition===null)!==(r.afterPosition===null)))).toBe(true);
  });
  it('does not match across groups or across custom sections with the same local item id',()=>{
    const a=comparisonFixture(),b=structuredClone(a);
    b.customData['private-section']![0]!.description='NEW_HIDDEN';b.experience[0]!.id='edu-a';
    const d=compareResumeDocuments(a,b);
    expect(d.rows.filter(r=>r.group==='教育经历')).toHaveLength(0);expect(d.rows.filter(r=>r.group==='工作经历')).toHaveLength(2);
    const row=d.rows.find(r=>r.group==='自定义栏目');
    expect(row?.fields).toHaveLength(1);expect(row?.fields[0]?.before).toMatchObject({text:'HIDDEN_BODY_A',hidden:true});
  });
  it('does not fuzzy-match independently generated ids with the same title or text',()=>{
    const a=comparisonFixture(),b=structuredClone(a);b.education[0]!.id='independent-id';
    expect(compareResumeDocuments(a,b).counts).toEqual({added:1,removed:1,modified:0,ambiguous:0});
  });
  it('detects visibility changes without changing values, masks sides independently',()=>{
    const a=comparisonFixture(),b=structuredClone(a);b.basic.fieldOrder.find(f=>f.key==='phone')!.visible=true;
    b.menuSections.find(s=>s.id==='skills')!.enabled=false;b.education[0]!.visible=false;
    const d=compareResumeDocuments(a,b);
    expect(d.rows.find(r=>r.label==='电话')?.fields[0]).toMatchObject({before:{text:'HIDDEN_PHONE_A',hidden:true},after:{text:'HIDDEN_PHONE_A',hidden:false}});
    expect(d.rows.find(r=>r.label==='专业技能')?.fields[0]).toMatchObject({before:{hidden:false},after:{hidden:true}});
    expect(d.rows.find(r=>r.group==='教育经历')?.fields.some(f=>f.label==='学校'&&f.after?.hidden)).toBe(true);
  });
  it('masks missing and ambiguous basic fields or menu sections conservatively',()=>{
    const a=comparisonFixture(),b=structuredClone(a);
    b.basic.fieldOrder.push({...b.basic.fieldOrder[0]!,id:'dup-name'});b.menuSections.push({...b.menuSections[1]!,enabled:false});
    b.basic.name='CHANGED_NAME';b.education[0]!.school='CHANGED_SCHOOL';
    const d=compareResumeDocuments(a,b);
    expect(d.rows.find(r=>r.label==='姓名')?.fields[0]?.after).toMatchObject({text:'CHANGED_NAME',hidden:true});
    expect(d.rows.find(r=>r.group==='教育经历')?.fields.find(f=>f.label==='学校')?.after).toMatchObject({text:'CHANGED_SCHOOL',hidden:true});
    expect(d.warnings.join('')).toContain('保守遮蔽');
  });
  it('masks disabled or orphaned custom content and does not expose asset data or paths in the diff',()=>{
    const a=comparisonFixture(),b=changedComparisonFixture();
    b.customData['orphan']=[{id:'o',title:'ORPHAN_TEXT',subtitle:'',dateRange:'',description:'ORPHAN_BODY',visible:true}];
    b.education[0]!.logo='file:///SYNTHETIC_LOGO_PATH.png';
    const d=compareResumeDocuments(a,b),raw=JSON.stringify(d);
    expect(raw).not.toMatch(/SYNTHETIC_PHOTO_|SYNTHETIC_LOGO_PATH/);
    expect(d.rows.find(r=>r.label==='照片引用')?.fields[0]).toMatchObject({referenceChanged:true,before:{asset:true},after:{asset:true}});
    expect(d.rows.find(r=>r.fields.some(f=>f.after?.text==='ORPHAN_BODY'))?.fields.find(f=>f.after?.text==='ORPHAN_BODY')?.after?.hidden).toBe(true);
  });
  it('compares all current style keys including paper background, locale and photo configuration',()=>{
    const a=comparisonFixture(),b=structuredClone(a);
    b.globalSettings={...b.globalSettings,paperBackground:'#111111',locale:'en-US',customFontFamily:'Synthetic Font',lineHeight:1.6};
    b.basic.photoConfig={...b.basic.photoConfig,width:128,visible:false};b.basic.layout='center';b.basic.icons.email='AtSign';
    const d=compareResumeDocuments(a,b);
    const fields=d.rows.filter(r=>r.category==='style').flatMap(r=>r.fields.map(f=>f.label));
    for(const label of ['纸张底色','语言','自定义字体','行高','宽度','照片显示开关','对齐方式','图标'])expect(fields).toContain(label);
  });
  it('keeps exact whitespace, literal markup, and missing vs empty values',()=>{
    const a=comparisonFixture(),b=structuredClone(a);b.skillContent='  <script>literal</script>\n';b.experience=[];
    const d=compareResumeDocuments(a,b);
    expect(d.rows.find(r=>r.label==='专业技能')?.fields[0]?.after?.text).toBe(b.skillContent);
    const removed=d.rows.find(r=>r.kind==='removed');
    expect(removed?.fields.find(f=>f.label==='岗位')).toMatchObject({before:{text:''},after:null});
  });
  it('fails closed at structural and diff-size limits rather than showing a partial unchanged result',()=>{
    const a=comparisonFixture(),b=structuredClone(a);
    b.education=Array.from({length:1801},(_,i)=>({...a.education[0]!,id:'row-'+i}));
    expect(()=>compareResumeDocuments(a,b)).toThrow('1800');
    b.education=a.education;b.skillContent='A'.repeat(1_500_001);
    expect(()=>compareResumeDocuments(a,b)).toThrow('安全上限');
  });
});
