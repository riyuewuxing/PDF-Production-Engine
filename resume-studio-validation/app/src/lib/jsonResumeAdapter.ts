import { type MenuSection, type ResumeDocument, ResumeDocumentSchema } from '../schema/resumeSchema';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown, fallback = ''): string { return typeof v === 'string' ? v : fallback; }
function rows(v: unknown): Record<string,unknown>[] { return Array.isArray(v)?v.filter(isPlainObject):[]; }
function strings(v:unknown):string[] {return Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'&&Boolean(x.trim())):[];}
function splitBullets(rawText: string): string[] {
  return rawText.split(/\r?\n/).map(line=>line.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
}
type CustomRow = { title:string;subtitle:string;dateRange:string;description:string };
type CustomCategory = 'awards'|'certificates'|'publications'|'volunteer'|'languages'|'interests'|'references';
type SourceDateFields={startDate?:string;endDate?:string;resumeStudioDates?:{start?:string;end?:string}};
type CustomExtra={resumeStudio?:{dateRange?:string;description?:string;subtitle?:string}};
type CustomSectionExtra={title:string;items:CustomRow[]};

export interface JsonResumePayload {
  $schema:string;
  basics:{name?:string;label?:string;email?:string;phone?:string;summary?:string;location?:{city:string};profiles:Array<{network:string;username?:string;url?:string}>};
  work:Array<{name:string;position:string;location?:string;highlights:string[]}&SourceDateFields>;
  education:Array<{institution:string;area:string;studyType:string;score?:string;courses:string[]}&SourceDateFields>;
  projects:Array<{name:string;description:string;highlights:string[];roles?:string[];url?:string}&SourceDateFields>;
  skills:Array<{name:string;keywords:string[]}>;
  awards:Array<{title:string;date?:string;awarder?:string;summary?:string}&CustomExtra>;
  certificates:Array<{name:string;date?:string;issuer?:string}&CustomExtra>;
  publications:Array<{name:string;publisher?:string;releaseDate?:string;summary?:string}&CustomExtra>;
  volunteer:Array<{organization:string;position?:string;summary?:string;highlights:string[]}&SourceDateFields&CustomExtra>;
  languages:Array<{language:string;fluency?:string}&CustomExtra>;
  interests:Array<{name:string;keywords:string[]}&CustomExtra>;
  references:Array<{name:string;reference:string}&CustomExtra>;
  meta:{theme?:string;locale:'zh-CN'|'en-US';generator:string;resumeStudio:{
    version:1;mode:'visible-content';customFields:Array<{label:string;value:string}>;unmappedSections:CustomSectionExtra[];
  }};
}
export function isJsonResumeFormat(raw:unknown):boolean {
  if(!isPlainObject(raw)||!isPlainObject(raw.basics))return false;
  if('schemaVersion' in raw&&'menuSections' in raw&&'globalSettings' in raw)return false;
  return typeof raw.$schema==='string'||['work','education','skills','projects','awards','certificates','publications','volunteer','languages','interests','references'].some(k=>Array.isArray(raw[k]));
}

// Only known, unambiguous category names are mapped. A custom research project is not an award or publication.
const CATEGORY_ALIASES:Record<CustomCategory,readonly string[]>={
  awards:['awards','honors','honours','honors & awards','honours & awards','荣誉奖项','荣誉奖励','获奖经历','奖项','获奖','奖学金'],
  certificates:['certificates','certifications','certification','资格证书','资质证书','证书','职业资格'],
  publications:['publications','publication','学术论文','论文发表','学术发表','出版物'],
  volunteer:['volunteer','volunteering','volunteer experience','志愿服务','志愿经历','志愿者经历','公益志愿'],
  languages:['languages','language','语言能力','语言技能','语言'],
  interests:['interests','hobbies','兴趣爱好','兴趣'],
  references:['references','reference','推荐人','推荐信'],
};
function categoryFor(value:string):CustomCategory|undefined {
  const norm=value.trim().toLowerCase().replace(/^custom[-_]/,'').replace(/^jr[-_]/,'');
  return (Object.keys(CATEGORY_ALIASES) as CustomCategory[]).find(key=>CATEGORY_ALIASES[key].includes(norm));
}
function categoryOf(section:MenuSection):CustomCategory|undefined {
  const a=categoryFor(section.id),b=categoryFor(section.title);
  return a&&b&&a!==b?undefined:b??a;
}
function httpUrl(raw:string):string|undefined {
  try {const u=new URL(raw.trim());return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}
}
function standardDate(raw:string,full=false):string|undefined {
  const m=/^([12]\d{3})(?:[-./年](\d{1,2})(?:[-./月](\d{1,2})日?)?月?)?$/.exec(raw.trim());
  if(!m)return undefined;
  const year=m[1]!,month=m[2]?Number(m[2]):undefined,day=m[3]?Number(m[3]):undefined;
  if(month!==undefined&&(month<1||month>12))return undefined;
  if(day!==undefined&&(month===undefined||day<1||day>new Date(Date.UTC(Number(year),month,0)).getUTCDate()))return undefined;
  if(full&&(month===undefined||day===undefined))return undefined;
  return [year,month!==undefined?String(month).padStart(2,'0'):undefined,day!==undefined?String(day).padStart(2,'0'):undefined].filter(Boolean).join('-');
}
function dateFields(start:string,end=''):SourceDateFields {
  const a=standardDate(start),b=standardDate(end);
  const original={...(start&&start!==a?{start}:{}),...(end&&end!==b?{end}:{})};
  return {...(a?{startDate:a}:{}),...(b?{endDate:b}:{}),...(Object.keys(original).length?{resumeStudioDates:original}:{})};
}
function readDates(row:Record<string,unknown>):[string,string] {
  const extra=isPlainObject(row.resumeStudioDates)?row.resumeStudioDates:{};
  // If an external tool edits a canonical date, respect it rather than silently restoring the stale extension.
  const read=(canonical:unknown,original:unknown)=>{
    const a=str(canonical),b=str(original);
    return b&&(!a||standardDate(b)===a)?b:a;
  };
  return [read(row.startDate,extra.start),read(row.endDate,extra.end)];
}
function customExtra(row:CustomRow,extra:Partial<CustomRow>={}):CustomExtra {
  return {resumeStudio:{...(row.dateRange?{dateRange:row.dateRange}:{}),...(extra.description?{description:extra.description}:{}),...(extra.subtitle?{subtitle:extra.subtitle}:{})}};
}
function visibleBasic(doc:ResumeDocument,key:string):boolean {
  return doc.menuSections.some(s=>s.id==='basic'&&s.enabled)&&doc.basic.fieldOrder.some(f=>f.key===key&&f.visible);
}

/** Standard public/interchange mode: only enabled sections and visible rows/fields.
 * The native ResumeDocument backup remains the format for full document restoration.
 * JSON Resume v1.0.0 allows custom metadata and item-level extensions; unknown sections remain
 * in meta.resumeStudio, not falsely classified as awards.
 */
export function exportToJsonResume(doc:ResumeDocument):JsonResumePayload {
  const enabled=new Set(doc.menuSections.filter(s=>s.enabled).map(s=>s.id));
  const awards:JsonResumePayload['awards']=[],certificates:JsonResumePayload['certificates']=[],publications:JsonResumePayload['publications']=[],volunteer:JsonResumePayload['volunteer']=[],languages:JsonResumePayload['languages']=[],interests:JsonResumePayload['interests']=[],references:JsonResumePayload['references']=[];
  const unmappedSections:CustomSectionExtra[]=[];
  for(const section of [...doc.menuSections].sort((a,b)=>a.order-b.order)){
    if(!section.enabled||['basic','education','experience','projects','skills','selfEvaluation'].includes(section.id))continue;
    const items=(doc.customData[section.id]??[]).filter(i=>i.visible).map(({title,subtitle,dateRange,description})=>({title,subtitle,dateRange,description}));
    if(!items.length)continue;
    const category=categoryOf(section);
    if(!category){unmappedSections.push({title:section.title,items});continue;}
    for(const row of items){
      const {title,subtitle,dateRange,description}=row;
      const date=standardDate(dateRange);
      switch(category){
        case 'awards':awards.push({title,...(date?{date}:{}),...(subtitle?{awarder:subtitle}:{}),...(description?{summary:description}:{}),...customExtra(row)});break;
        case 'certificates':{const fullDate=standardDate(dateRange,true);certificates.push({name:title,...(fullDate?{date:fullDate}:{}),...(subtitle?{issuer:subtitle}:{}),...customExtra(row,{description})});break;}
        case 'publications':publications.push({name:title,...(date?{releaseDate:date}:{}),...(subtitle?{publisher:subtitle}:{}),...(description?{summary:description}:{}),...customExtra(row)});break;
        case 'volunteer':volunteer.push({organization:title,...(subtitle?{position:subtitle}:{}),...(date?{startDate:date}:{}),highlights:splitBullets(description),...customExtra(row)});break;
        case 'languages':languages.push({language:title,...(subtitle?{fluency:subtitle}:{}),...customExtra(row,{description})});break;
        case 'interests':interests.push({name:title,keywords:splitBullets(description),...customExtra(row,{subtitle})});break;
        case 'references':references.push({name:title,reference:description,...customExtra(row,{subtitle})});break;
      }
    }
  }
  const customFields=enabled.has('basic')?doc.basic.customFields.filter(f=>f.visible&&f.value.trim()).map(({label,value})=>({label,value})):[];
  const profiles:JsonResumePayload['basics']['profiles']=[];
  const extraFields:typeof customFields=[];
  for(const field of customFields){
    const url=httpUrl(field.value);
    if(url&&/^(github|gitlab|linkedin|orcid|google scholar|website|homepage|个人主页|个人网站)$/i.test(field.label.trim()))profiles.push({network:field.label,url});
    else extraFields.push(field);
  }
  const email=visibleBasic(doc,'email')?doc.basic.email.trim():'';
  return {
    $schema:'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
    basics:{
      ...(visibleBasic(doc,'name')?{name:doc.basic.name}:{}),
      ...(visibleBasic(doc,'title')?{label:doc.basic.title}:{}),
      ...(email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?{email}:{}),
      ...(visibleBasic(doc,'phone')&&doc.basic.phone?{phone:doc.basic.phone}:{}),
      ...(enabled.has('selfEvaluation')?{summary:doc.selfEvaluationContent}:{}),
      ...(visibleBasic(doc,'location')&&doc.basic.location?{location:{city:doc.basic.location}}:{}),
      profiles,
    },
    work:enabled.has('experience')?doc.experience.filter(e=>e.visible).map(e=>({name:e.company,position:e.position,...dateFields(e.startDate,e.endDate),...(e.location?{location:e.location}:{}),highlights:splitBullets(e.description)})):[],
    education:enabled.has('education')?doc.education.filter(e=>e.visible).map(e=>({institution:e.school,area:e.major,studyType:e.degree,...dateFields(e.startDate,e.endDate),...(e.gpa?{score:e.gpa}:{}),courses:splitBullets(e.description)})):[],
    projects:enabled.has('projects')?doc.projects.filter(p=>p.visible).map(p=>{
      const trimmed=p.description.trim(),bullets=splitBullets(trimmed);
      const useHighlights=bullets.length>1||/^\s*[-*•]\s+/m.test(trimmed),url=httpUrl(p.link);
      return {name:p.name,description:useHighlights?'':trimmed,highlights:useHighlights?bullets:[],...(p.role?{roles:[p.role]}:{}),...dateFields(p.date),...(url?{url}:{})};
    }):[],
    skills:enabled.has('skills')&&doc.skillContent.trim()?[{name:doc.globalSettings.locale==='en-US'?'Skills':'专业技能',keywords:splitBullets(doc.skillContent)}]:[],
    awards,certificates,publications,volunteer,languages,interests,references,
    meta:{theme:doc.templateId,locale:doc.globalSettings.locale??'zh-CN',generator:'Resume Studio',resumeStudio:{version:1,mode:'visible-content',customFields:extraFields,unmappedSections}},
  };
}

const CATEGORY_META:Record<CustomCategory,{zh:string;en:string;icon:string}>={
  awards:{zh:'荣誉奖项',en:'Honors & Awards',icon:'Trophy'},
  certificates:{zh:'资格证书',en:'Certifications',icon:'Award'},
  publications:{zh:'学术论文',en:'Publications',icon:'BookOpen'},
  volunteer:{zh:'志愿服务',en:'Volunteering',icon:'Heart'},
  languages:{zh:'语言能力',en:'Languages',icon:'Languages'},
  interests:{zh:'兴趣爱好',en:'Interests',icon:'Star'},
  references:{zh:'推荐人',en:'References',icon:'Users'},
};
function joinHighlights(row:Record<string,unknown>,field='summary'):string {
  const primary=str(row[field]).trim(),bullets=strings(row.highlights).filter(line=>line.trim()!==primary);
  return [primary,bullets.map(line=>'- '+line).join('\n')].filter(Boolean).join('\n');
}
function importedCustom(category:CustomCategory,row:Record<string,unknown>):CustomRow {
  const ext=isPlainObject(row.resumeStudio)?row.resumeStudio:{};
  const [start,end]=readDates(row);
  const range=[start,end].filter(Boolean).join(' - ');
  switch(category){
    case 'awards':return {title:str(row.title),subtitle:str(row.awarder),dateRange:str(ext.dateRange)||str(row.date),description:str(row.summary)};
    case 'certificates':return {title:str(row.name),subtitle:str(row.issuer),dateRange:str(ext.dateRange)||str(row.date),description:str(ext.description)||str(row.url)};
    case 'publications':return {title:str(row.name),subtitle:str(row.publisher),dateRange:str(ext.dateRange)||str(row.releaseDate),description:[str(row.summary),str(row.url)].filter(Boolean).join('\n')};
    case 'volunteer':return {title:str(row.organization),subtitle:str(row.position),dateRange:str(ext.dateRange)||range,description:joinHighlights(row)};
    case 'languages':return {title:str(row.language),subtitle:str(row.fluency),dateRange:str(ext.dateRange),description:str(ext.description)};
    case 'interests':return {title:str(row.name),subtitle:str(ext.subtitle),dateRange:str(ext.dateRange),description:strings(row.keywords).map(s=>'- '+s).join('\n')};
    case 'references':return {title:str(row.name),subtitle:str(ext.subtitle),dateRange:str(ext.dateRange),description:str(row.reference)};
  }
}

/** Import standard content into a new local document; never treats interchange as a full style/asset backup. */
export function importFromJsonResume(raw:unknown):ResumeDocument {
  if(!isPlainObject(raw)||!isPlainObject(raw.basics))throw new Error('非法的 JSON Resume 文件：缺少 basics 对象。');
  const nowIso=new Date().toISOString(),basics=raw.basics,meta=isPlainObject(raw.meta)?raw.meta:{},locale=meta.locale==='en-US'?'en-US':'zh-CN';
  const ext=isPlainObject(meta.resumeStudio)&&meta.resumeStudio.version===1&&meta.resumeStudio.mode==='visible-content'?meta.resumeStudio:{};
  const locObj=isPlainObject(basics.location)?basics.location:{};
  const locationText=str(locObj.city)||str(locObj.region)||str(locObj.address);
  const education=rows(raw.education).map((e,i)=>{
    const [startDate,endDate]=readDates(e);
    return {id:'jr-edu-'+(i+1),school:str(e.institution),major:str(e.area),degree:str(e.studyType),startDate,endDate,gpa:str(e.score),description:strings(e.courses).map(c=>'- '+c).join('\n'),visible:true,logo:''};
  });
  const experience=rows(raw.work).map((w,i)=>{
    const [startDate,endDate]=readDates(w);
    return {id:'jr-exp-'+(i+1),company:str(w.name)||str(w.company),position:str(w.position),startDate,endDate,location:str(w.location),description:joinHighlights(w),visible:true,logo:''};
  });
  const projects=rows(raw.projects).map((p,i)=>{
    const [start,end]=readDates(p);
    return {id:'jr-proj-'+(i+1),name:str(p.name),role:strings(p.roles).join(' / '),date:[start,end].filter(Boolean).join(' - '),description:joinHighlights(p,'description'),link:httpUrl(str(p.url))??'',linkLabel:'',visible:true};
  });
  const skillLines=rows(raw.skills).flatMap(s=>{
    const name=str(s.name),kws=strings(s.keywords);
    return name&&kws.length?['- **'+name+'**：'+kws.join(' / ')]:kws.length?['- '+kws.join(' / ')]:name?['- '+name]:[];
  });
  const customData:ResumeDocument['customData']={};
  const menuSections:MenuSection[]=[
    {id:'basic',title:locale==='en-US'?'Basic Info':'基本信息',icon:'User',enabled:true,order:0,pageBreakBefore:false},
    {id:'education',title:locale==='en-US'?'Education':'教育经历',icon:'GraduationCap',enabled:true,order:1,pageBreakBefore:false},
    {id:'experience',title:locale==='en-US'?'Experience':'工作经历',icon:'Briefcase',enabled:true,order:2,pageBreakBefore:false},
    {id:'projects',title:locale==='en-US'?'Projects':'项目经历',icon:'Rocket',enabled:true,order:3,pageBreakBefore:false},
    {id:'skills',title:locale==='en-US'?'Skills':'专业技能',icon:'Award',enabled:true,order:4,pageBreakBefore:false},
  ];
  function addSection(id:string,title:string,icon:string,items:CustomRow[]){
    if(!items.length)return;
    customData[id]=items.map((item,i)=>({...item,id:id+'-'+(i+1),visible:true}));
    menuSections.push({id,title,icon,enabled:true,order:menuSections.length,pageBreakBefore:false});
  }
  for(const category of Object.keys(CATEGORY_META) as CustomCategory[]){
    const m=CATEGORY_META[category];
    addSection('custom-'+category,locale==='en-US'?m.en:m.zh,m.icon,rows(raw[category]).map(row=>importedCustom(category,row)));
  }
  for(const [index,section] of rows(ext.unmappedSections).entries()){
    const title=str(section.title).trim()||(locale==='en-US'?'Additional information':'其他信息');
    addSection('custom-jr-extra-'+(index+1),title,'FileText',rows(section.items).map(item=>({title:str(item.title),subtitle:str(item.subtitle),dateRange:str(item.dateRange),description:str(item.description)})));
  }
  menuSections.push({id:'selfEvaluation',title:locale==='en-US'?'Summary':'自我评价',icon:'User',enabled:true,order:menuSections.length,pageBreakBefore:false});
  const customFields=[...rows(basics.profiles).map(p=>({label:str(p.network,'Profile'),value:httpUrl(str(p.url))||str(p.username)})),...rows(ext.customFields).map(p=>({label:str(p.label),value:str(p.value)}))]
    .filter(f=>f.value.trim()).map((f,i)=>({...f,id:'jr-field-'+(i+1),visible:true}));
  return ResumeDocumentSchema.parse({
    schemaVersion:1,id:crypto.randomUUID(),title:(str(basics.name).trim()||'Imported')+' - JSON Resume',templateId:'left-right',createdAt:nowIso,updatedAt:nowIso,activeSection:'basic',
    basic:{name:str(basics.name),title:str(basics.label),email:str(basics.email),phone:str(basics.phone),location:locationText,employmentStatus:'',birthDate:'',photo:'',customFields},
    menuSections,education,experience,projects,skillContent:skillLines.join('\n'),selfEvaluationContent:str(basics.summary),customData,globalSettings:{locale,themeColor:'#167883'},
  });
}
