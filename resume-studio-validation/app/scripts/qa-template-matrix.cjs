/* Synthetic-only QA. Run after desktop:build using the Electron binary, never a user workspace. */
const {app,nativeImage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const repo=path.resolve(__dirname,'..');
const out=process.env.RESUME_MATRIX_OUT;
const locale=process.env.RESUME_MATRIX_LOCALE;
if(!out||!['zh-CN','en-US'].includes(locale))throw Error('RESUME_MATRIX_OUT and explicit locale required');
const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'resume-template-matrix-'));
process.env.RESUME_STUDIO_DATA_DIR=isolated;
const userData=path.join(isolated,'electron-userdata');
fs.mkdirSync(userData,{recursive:true});
app.setPath('userData',userData);
app.disableHardwareAcceleration();
// Headless QA owns the process lifecycle: closing a hidden print window must not quit Electron.
app.on('window-all-closed',()=>{});
fs.mkdirSync(out,{recursive:true});
const main=require(path.join(repo,'dist-electron','main.cjs'));
const schemaText=fs.readFileSync(path.join(repo,'src/schema/resumeSchema.ts'),'utf8');
const registryText=fs.readFileSync(path.join(repo,'src/templates/registry.ts'),'utf8');
const idBlock=schemaText.match(/export const TEMPLATE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
if(!idBlock)throw Error('Cannot derive schema IDs');
const ids=[...idBlock[1].matchAll(/^\s*'([^']+)',/gm)].map(m=>m[1]);
const matches=[...registryText.matchAll(/^\s+id: '([^']+)',/gm)];
const registryIds=matches.map(m=>m[1]);
if(ids.length!==new Set(ids).size||registryIds.length!==new Set(registryIds).size||ids.length!==registryIds.length||ids.some(id=>!registryIds.includes(id)))throw Error('Template registry/schema mismatch');
const colorFor=id=>{
  const index=registryIds.indexOf(id);
  const block=registryText.slice(matches[index].index,matches[index+1]?.index??registryText.length);
  return block.match(/recommendedColor:\s*'(#[0-9a-fA-F]{6})'/)?.[1]??'#167883';
};
function avatar(){
  const width=90,height=120,b=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,head=(x-45)**2+(y-42)**2<21**2,body=(x-45)**2/33**2+(y-98)**2/43**2<1;
    b[i]=head||body?120:235;b[i+1]=head||body?93:240;b[i+2]=head||body?48:244;b[i+3]=255;
  }
  return nativeImage.createFromBitmap(b,{width,height}).toDataURL();
}
function makeFixture(mode){
  const zh=locale==='zh-CN',long=mode==='extended';
  const t=(a,b)=>zh?a:b;
  const expected=[t('演示候选人','Demo Candidate'),t('示例大学','Example University'),t('示例机构','Example Laboratory'),t('示例课程工具','Sample Course Tool'),t('实验设计能力','Synthetic analysis skill'),t('合成总结甲','Synthetic summary text'),t('虚构奖项甲','Synthetic award entry'),'qa-'+(zh?'zh':'en')+'@example.invalid'];
  const hidden=['HIDDENBIRTHMARKER','HIDDENEDUCATIONMARKER','HIDDENCUSTOMMARKER','DISABLEDSECTIONMARKER'];
  const labels=[['name',t('姓名','Name')],['title',t('职位','Role')],['email',t('邮箱','Email')],['phone',t('电话','Phone')],['location',t('所在地','Location')],['birthDate',t('生日','Birth')],['employmentStatus',t('状态','Status')]];
  const sections=[
    ['basic',t('基本信息','Basic Info')],['education',t('教育经历','Education')],['experience',t('工作经历','Experience')],['projects',t('项目经历','Projects')],['skills',t('专业技能','Skills')],['custom-awards',t('荣誉奖项','Honors and Awards')],['selfEvaluation',t('自我评价','Summary')],['custom-disabled',t('禁用章节','Disabled Section')]
  ];
  const doc={
    schemaVersion:1,id:'qa-'+locale+'-'+mode,title:t('合成测试简历','Synthetic resume'),
    templateId:ids[0],createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',activeSection:'basic',
    basic:{name:expected[0],title:t('示例教师','Sample Instructor'),email:expected[7],phone:'',location:t('示例城市','Example City'),birthDate:hidden[0],employmentStatus:'',photo:long?avatar():'',
      fieldOrder:labels.map(([key,label],i)=>({id:'field-'+i,key,label,visible:key!=='birthDate'}))},
    menuSections:sections.map(([id,title],order)=>({id,title,order,enabled:id!=='custom-disabled',pageBreakBefore:long&&id==='projects'})),
    education:[{id:'edu-1',school:expected[1],major:t('科学教育','Science Education'),degree:t('硕士','Master'),startDate:'2022.09',endDate:'2025.06',description:t('- 实验设计与数据记录。','- Designed experiments and recorded results.')},{id:'edu-hidden',school:hidden[1],visible:false}],
    experience:[{id:'exp-1',company:expected[2],position:t('教学助理','Teaching Assistant'),startDate:'2025.09',endDate:'2026.06',description:t('- 协助课程准备与实验记录。','- Assisted with course preparation and experiment records.')}],
    projects:[{id:'project-1',name:expected[3],role:t('成员','Contributor'),date:'2025.04',description:t('- 制作示例实验材料。','- Created sample experiment materials.'),link:'https://example.invalid/demo',linkLabel:t('演示链接','Demo link')}],
    skillContent:'- '+expected[4],selfEvaluationContent:expected[5],
    customData:{'custom-awards':[{id:'award-1',title:expected[6],subtitle:t('虚构机构','Synthetic organization'),dateRange:'2025',description:t('演示说明','Sample note')},{id:'award-hidden',title:hidden[2],visible:false}], 'custom-disabled':[{id:'disabled-1',title:hidden[3]}]},
    globalSettings:{locale,themeColor:'#167883',baseFontSize:13,sectionSpacing:15,paragraphSpacing:8,pagePadding:28,lineHeight:1.25}
  };
  if(long){
    const paragraph=t('负责虚构课程的实验准备、数据整理、材料检查与讨论记录，形成可复核的报告，并与示例团队共同改进教学材料。','Prepared synthetic course experiments, organized records, reviewed materials, and summarized findings for the fictional team.');
    for(let i=2;i<=5;i++)doc.experience.push({id:'exp-'+i,company:t('示例研究小组','Example Research Group')+' '+i,position:t('研究助理','Research Assistant'),startDate:'2024.01',endDate:'2024.12',description:Array.from({length:3},()=>'- '+paragraph).join('\n')});
    const tail=t('扩展内容尾部标记','Extended content tail marker');expected.push(tail);
    doc.selfEvaluationContent=expected[5]+'\n'+paragraph+'\n'+tail;
    doc.projects[0].description+='\n- '+t('长网址与特殊字符：','Long URL and symbols: ')+'https://example.invalid/'+('synthetic-segment-'.repeat(12))+'end';
  }
  return {doc,expected,hidden};
}
const report={locale,registryCount:registryIds.length,sourceSha:process.env.RESUME_MATRIX_SOURCE_SHA??null,runnerSha:process.env.GITHUB_SHA??null,platform:process.platform,electron:process.versions.electron,cases:[]};
const reportPath=path.join(out,'matrix-manifest.json');
const writeReport=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
let stopped=false;
const globalWatchdog=setTimeout(()=>{stopped=true;report.aborted='global watchdog exceeded';writeReport();app.exit(2);},420000);
function bounded(promise,ms){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PER_CASE_WATCHDOG')),ms);})]).finally(()=>clearTimeout(timer));
}
async function run(){
  await main.registerAssetProtocol();main.registerIpcHandlers();
  for(const mode of ['compact','extended']){
    const {doc,expected,hidden}=makeFixture(mode);
    const canonical=await main.store.saveResume('qa-'+mode,doc);
    for(const id of registryIds){
      if(stopped)return;
      const item={templateId:id,mode,expected,hidden,photo:mode==='extended',file:mode+'--'+id+'.pdf',status:'pending'};
      const start=Date.now();report.cases.push(item);
      try{
        const bytes=await bounded(main.renderDocumentToPdf({...canonical,templateId:id,globalSettings:{...canonical.globalSettings,themeColor:colorFor(id)}}),25000);
        if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('invalid PDF header');
        fs.writeFileSync(path.join(out,item.file),bytes);item.status='rendered';item.bytes=bytes.length;
      }catch(err){item.status='failed';item.error=err instanceof Error?err.message:'render error';if(item.error==='PER_CASE_WATCHDOG'){report.aborted='per-case watchdog exceeded';stopped=true;}}
      item.elapsedMs=Date.now()-start;writeReport();
      console.log(locale,mode,id,item.status,item.elapsedMs);
      if(stopped)throw Error('Matrix stopped to avoid overlapping timed-out render');
    }
  }
  report.complete=true;writeReport();
}
app.whenReady().then(run).then(()=>{clearTimeout(globalWatchdog);app.exit(report.cases.some(c=>c.status!=='rendered')?1:0);}).catch(err=>{clearTimeout(globalWatchdog);report.aborted=String(err.message??err);writeReport();app.exit(1);});
