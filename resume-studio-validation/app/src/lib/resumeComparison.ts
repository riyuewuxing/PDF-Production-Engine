import type { ResumeDocument } from '../schema/resumeSchema';

export type ComparisonCategory='content'|'structure'|'style';
export type ComparisonKind='added'|'removed'|'modified'|'ambiguous';
export interface ComparisonValue {text:string;hidden:boolean;asset:boolean}
export interface ComparisonField {label:string;before:ComparisonValue|null;after:ComparisonValue|null;referenceChanged:boolean}
export interface ComparisonRow {
  key:string;category:ComparisonCategory;group:string;label:string;kind:ComparisonKind;
  beforePosition:number|null;afterPosition:number|null;fields:ComparisonField[];
}
export interface ResumeComparison {
  rows:ComparisonRow[];
  counts:Record<ComparisonKind,number>;
  hiddenFieldCount:number;
  warnings:string[];
}
type Scalar=string|number|boolean;
type Atom={key:string;label:string;value:Scalar;hidden:boolean;asset?:boolean};
type Entry={id:string;atoms:Atom[]};
type Item=Record<string,unknown>;
const MAX_ENTRIES=1800,MAX_FIELDS=12_000,MAX_TEXT=1_500_000;
const BASIC=[
  ['name','姓名'],['title','意向岗位'],['employmentStatus','状态'],['birthDate','出生日期'],
  ['email','邮箱'],['phone','电话'],['location','所在地']
] as const;
const SETTINGS:Record<string,string>={
  baseFontSize:'正文字号',pagePadding:'页边距',paragraphSpacing:'段落间距',lineHeight:'行高',
  sectionSpacing:'栏目间距',headerSize:'主标题字号',subheaderSize:'副标题字号',useIconMode:'图标模式',
  themeColor:'主题色',paperBackground:'纸张底色',surfaceStyle:'装饰风格',headingStyle:'栏目标题样式',
  fontFamily:'字体预设',customFontFamily:'自定义字体',letterSpacing:'字间距',headingWeight:'标题字重',
  tabularNums:'等宽数字',showPageGuide:'分页参考线',avoidItemSplit:'避免条目跨页',autoCjkSpacing:'中英文间距',
  centerSubtitle:'副标题居中',locale:'语言'
};
const PHOTO:Record<string,string>={width:'宽度',height:'高度',aspectRatio:'宽高比',borderRadius:'圆角',customBorderRadius:'自定义圆角',visible:'照片显示开关',frameStyle:'边框',bgBackdrop:'照片背景'};
const EDUCATION=[['school','学校'],['major','专业'],['degree','学位'],['startDate','开始日期'],['endDate','结束日期'],['gpa','GPA'],['description','描述'],['logo','标识引用']] as const;
const EXPERIENCE=[['company','单位'],['position','岗位'],['startDate','开始日期'],['endDate','结束日期'],['location','地点'],['description','描述'],['logo','标识引用']] as const;
const PROJECT=[['name','项目名称'],['role','角色'],['date','日期'],['description','描述'],['link','链接文字地址'],['linkLabel','链接标签']] as const;
const CUSTOM=[['title','标题'],['subtitle','副标题'],['dateRange','日期'],['description','描述']] as const;
function atom(key:string,label:string,value:Scalar,hidden=false,asset=false):Atom{return {key,label,value,hidden,asset};}
function printable(a:Atom|undefined):ComparisonValue|null {
  if(!a)return null;
  const asset=Boolean(a.asset);
  return {text:asset?(a.value?'有引用（不读取资产）':'无引用'):typeof a.value==='boolean'?(a.value?'是':'否'):String(a.value),hidden:a.hidden,asset};
}
function bucket(entries:Entry[]):Map<string,{entry:Entry;index:number}[]>{
  const map=new Map<string,{entry:Entry;index:number}[]>();
  for(let i=0;i<entries.length;i++){const entry=entries[i]!;const list=map.get(entry.id)??[];list.push({entry,index:i});map.set(entry.id,list);}
  return map;
}
function section(doc:ResumeDocument,id:string){const found=doc.menuSections.filter(s=>s.id===id);return {visible:found.length===1&&found[0]!.enabled,title:found.length===1?found[0]!.title:'未确认栏目'};}
function basicVisible(doc:ResumeDocument,key:string){const fields=doc.basic.fieldOrder.filter(f=>f.key===key);return section(doc,'basic').visible&&fields.length===1&&fields[0]!.visible;}
function itemAtoms(item:Item,keys:ReadonlyArray<readonly [string,string]>,hidden:boolean):Atom[]{
  return [atom('visible','条目显示开关',item.visible===true),...keys.map(([key,label])=>atom(key,label,typeof item[key]==='string'?item[key] as string:'',hidden,key==='logo'))];
}
function objectAtoms(obj:Record<string,Scalar>,labels:Record<string,string>,hidden=false):Atom[]{
  return Object.keys(obj).sort().map(key=>atom(key,labels[key]??key,obj[key]!,hidden));
}
function checkSize(doc:ResumeDocument){
  const arrays=[doc.menuSections,doc.basic.fieldOrder,doc.basic.customFields,doc.education,doc.experience,doc.projects];
  let n=arrays.reduce((sum,items)=>sum+items.length,0)+Object.keys(doc.basic.icons).length;
  for(const values of Object.values(doc.customData)){n+=1+values.length;if(n>MAX_ENTRIES)break;}
  if(n>MAX_ENTRIES)throw new Error('版本结构超过 1800 项对照上限；未显示不完整结果，原文件保持不变。');
}

/** Exact stored-field comparison, not a text similarity, image byte, or rendered PDF diff.
 * No write, network, HTML interpretation or guessing duplicate identities. */
export function compareResumeDocuments(before:ResumeDocument,after:ResumeDocument):ResumeComparison {
  checkSize(before);checkSize(after);
  const rows:ComparisonRow[]=[],counts:Record<ComparisonKind,number>={added:0,removed:0,modified:0,ambiguous:0};
  const warnings=new Set<string>();
  let hiddenFieldCount=0,fieldCount=0,textCount=0,serial=0;
  const add=(category:ComparisonCategory,group:string,label:string,kind:ComparisonKind,left:Atom[],right:Atom[],beforePosition:number|null=null,afterPosition:number|null=null,relativeOrderChanged=false)=>{
    const l=new Map(left.map(a=>[a.key,a])),r=new Map(right.map(a=>[a.key,a]));
    const fields:ComparisonField[]=[];
    for(const key of new Set([...l.keys(),...r.keys()])){
      const a=l.get(key),b=r.get(key);
      if(kind==='modified'&&a&&b&&a.value===b.value&&a.hidden===b.hidden&&a.asset===b.asset)continue;
      const bv=printable(a),av=printable(b);
      fields.push({label:(a??b)!.label,before:bv,after:av,referenceChanged:Boolean((a?.asset||b?.asset)&&a?.value!==b?.value)});
    }
    if(relativeOrderChanged)fields.push({label:'共同条目中的相对顺序',before:printable(atom('order','',beforePosition??0)),after:printable(atom('order','',afterPosition??0)),referenceChanged:false});
    if(!fields.length&&kind==='modified')return;
    for(const f of fields){
      if(f.before?.hidden||f.after?.hidden)hiddenFieldCount++;
      textCount+=(f.before?.text.length??0)+(f.after?.text.length??0);
      if(++fieldCount>MAX_FIELDS||textCount>MAX_TEXT)throw new Error('差异字段或文字超过对照安全上限；未展示不完整结果。请分版本核对。');
    }
    rows.push({key:'diff-'+(++serial),category,group,label,kind,beforePosition,afterPosition,fields});
    counts[kind]++;
  };
  const single=(category:ComparisonCategory,group:string,label:string,l:Atom[],r:Atom[])=>add(category,group,label,'modified',l,r);
  const compareList=(category:ComparisonCategory,group:string,label:string,l:Entry[],r:Entry[],relative=true)=>{
    const lm=bucket(l),rm=bucket(r);
    const common=new Set([...lm.keys()].filter(id=>lm.get(id)?.length===1&&rm.get(id)?.length===1));
    const lrank=new Map(l.filter(e=>common.has(e.id)).map((e,i)=>[e.id,i+1]));
    const rrank=new Map(r.filter(e=>common.has(e.id)).map((e,i)=>[e.id,i+1]));
    for(const id of new Set([...lm.keys(),...rm.keys()])){
      const a=lm.get(id)??[],b=rm.get(id)??[];
      if(a.length>1||b.length>1){
        warnings.add('发现重复条目标识：相关记录分侧列出为“身份歧义”，不会按标题或位置猜测配对。');
        for(const x of a)add(category,group,label+'（基准侧歧义）','ambiguous',x.entry.atoms,[],x.index+1,null);
        for(const x of b)add(category,group,label+'（对照侧歧义）','ambiguous',[],x.entry.atoms,null,x.index+1);
      }else if(a[0]&&b[0]){
        const moved=relative&&lrank.get(id)!==rrank.get(id);
        // Actual ordinal labels are separate from relative-order detection, so insertion alone is not called a move.
        add(category,group,label,'modified',a[0].entry.atoms,b[0].entry.atoms,a[0].index+1,b[0].index+1,moved);
      }else if(a[0])add(category,group,label,'removed',a[0].entry.atoms,[],a[0].index+1,null);
      else if(b[0])add(category,group,label,'added',[],b[0].entry.atoms,null,b[0].index+1);
    }
  };
  if(before.id!==after.id)warnings.add('两份文档 ID 不同。仅同组唯一条目 ID 可机械对照；不是事实同一性判断，独立导入可能表现为新增/移除。');
  for(const doc of [before,after]){
    if(new Set(doc.menuSections.map(s=>s.id)).size!==doc.menuSections.length||new Set(doc.basic.fieldOrder.map(f=>f.key)).size!==doc.basic.fieldOrder.length)warnings.add('栏目 ID 或基本字段键重复；相关值按保守遮蔽规则处理，不推断真实版式可见性。');
  }
  single('content','文档','版本标题',[atom('title','本地版本标题',before.title)],[atom('title','本地版本标题',after.title)]);
  for(const [key,label] of BASIC)single('content','基本信息',label,[atom(key,label,before.basic[key],!basicVisible(before,key))],[atom(key,label,after.basic[key],!basicVisible(after,key))]);
  const photo=(doc:ResumeDocument)=>[atom('photo','照片引用',doc.basic.photo,!section(doc,'basic').visible||!doc.basic.photoConfig.visible,true)];
  single('content','基本信息','照片引用',photo(before),photo(after));
  const customBasic=(doc:ResumeDocument):Entry[]=>doc.basic.customFields.map(f=>({id:f.id,atoms:[atom('visible','字段显示开关',f.visible),atom('label','字段名称',f.label,!section(doc,'basic').visible||!f.visible),atom('value','字段值',f.value,!section(doc,'basic').visible||!f.visible)]}));
  compareList('content','基本信息','自定义字段',customBasic(before),customBasic(after));
  const sectionEntries=(doc:ResumeDocument):Entry[]=>[...doc.menuSections].sort((a,b)=>a.order-b.order).map(s=>({id:s.id,atoms:[atom('title','栏目名称',s.title,!section(doc,s.id).visible),atom('enabled','栏目启用',s.enabled),atom('order','排序值',s.order),atom('icon','图标',s.icon),atom('pageBreakBefore','栏目前分页',s.pageBreakBefore)]}));
  compareList('structure','栏目结构','栏目',sectionEntries(before),sectionEntries(after),false);
  const fieldEntries=(doc:ResumeDocument):Entry[]=>doc.basic.fieldOrder.map(f=>({id:f.id,atoms:[atom('visible','字段显示开关',f.visible),atom('key','字段键',f.key,!basicVisible(doc,f.key)),atom('label','字段标签',f.label,!basicVisible(doc,f.key)),atom('type','字段类型',f.type)]}));
  compareList('structure','基本信息','字段布局',fieldEntries(before),fieldEntries(after));
  for(const [id,group,keys] of [['education','教育经历',EDUCATION],['experience','工作经历',EXPERIENCE],['projects','项目经历',PROJECT]] as const){
    const entries=(doc:ResumeDocument):Entry[]=>doc[id].map(item=>({id:item.id,atoms:itemAtoms(item,keys,!section(doc,id).visible||!item.visible)}));
    compareList('content',group,'经历条目',entries(before),entries(after));
  }
  for(const [id,key,label] of [['skills','skillContent','专业技能'],['selfEvaluation','selfEvaluationContent','自我评价']] as const){
    single('content',label,label,[atom(key,label,before[key],!section(before,id).visible)],[atom(key,label,after[key],!section(after,id).visible)]);
  }
  for(const id of new Set([...Object.keys(before.customData),...Object.keys(after.customData)])){
    const entries=(doc:ResumeDocument):Entry[]=>{
      const s=section(doc,id);
      return (Object.hasOwn(doc.customData,id)?doc.customData[id]??[]:[]).map(item=>({id:item.id,atoms:[atom('section','所属栏目',s.title,!s.visible),...itemAtoms(item,CUSTOM,!s.visible||!item.visible)]}));
    };
    compareList('content','自定义栏目','自定义条目',entries(before),entries(after));
  }
  single('style','模板与排版','模板',[atom('template','模板 ID',before.templateId)],[atom('template','模板 ID',after.templateId)]);
  single('style','模板与排版','全局排版',objectAtoms(before.globalSettings,SETTINGS),objectAtoms(after.globalSettings,SETTINGS));
  single('style','基本信息','基本信息排版',[atom('layout','对齐方式',before.basic.layout)],[atom('layout','对齐方式',after.basic.layout)]);
  single('style','基本信息','照片排版',objectAtoms(before.basic.photoConfig,PHOTO),objectAtoms(after.basic.photoConfig,PHOTO));
  const icons=(doc:ResumeDocument):Entry[]=>Object.entries(doc.basic.icons).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({id:key,atoms:[atom('key','字段键',key,!basicVisible(doc,key)),atom('icon','图标',value,!basicVisible(doc,key))]}));
  compareList('style','基本信息','字段图标',icons(before),icons(after),false);
  return {rows,counts,hiddenFieldCount,warnings:[...warnings]};
}
