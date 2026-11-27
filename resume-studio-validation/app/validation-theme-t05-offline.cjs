const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.RESUME_STUDIO_DATA_DIR,out=process.env.RESUME_STUDIO_EVIDENCE_OUT,phase=process.env.STUDIO_THEME_PHASE||'candidate';
if(!root||!out||!path.basename(root).startsWith('synthetic-theme-t05-')||!['baseline','candidate'].includes(phase))throw Error('isolated fixture required');
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const main=require('./dist-electron/main.cjs'),fixture=require('./runner-fixture.json');
let providerCalls=0;
global.fetch=async()=>{providerCalls++;throw Error('unexpected external request in offline fixture')};
const checks={},results={phase,runnerSha:process.env.GITHUB_SHA,checks,themes:{},providerCalls:0};
function write(){results.providerCalls=providerCalls;fs.writeFileSync(path.join(out,'offline-'+phase+'.json'),JSON.stringify(results,null,2));}
const timer=setTimeout(()=>{results.error='offline application watchdog';write();app.exit(2)},220000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function until(label,fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(120)}throw Error('timeout '+label)}
async function run(){
 await main.store.saveResume('master',{...fixture,id:'synthetic-master',title:'合成母库'});
 await main.store.saveResume('runner-fixture',fixture);
 await main.registerAssetProtocol();main.registerIpcHandlers();
 const win=await main.createMainWindow(),js=s=>win.webContents.executeJavaScript(s),q=sel=>'document.querySelector('+JSON.stringify(sel)+')';
 const src='textarea[placeholder^="例如：招聘高中物理教师"]',notice='[aria-label="招聘公告 PDF 本地导入"]',imgSel='img[alt="公告 PDF 第 1 页实际渲染"]',scrollSel='[aria-label="公告原件滚动预览"]';
 const scopes={jd:'[data-studio-region="diagnose-jd"]',ai:'[data-studio-region="diagnose-ai"]'};
 const themes=['classic','dark','light','warm'];
 const bgs={dark:'rgb(17, 24, 39)',light:'rgb(255, 255, 255)',warm:'rgb(251, 247, 238)'};
 const fields={dark:'rgb(15, 23, 42)',light:'rgb(248, 250, 252)',warm:'rgb(255, 253, 248)'};
 const schemes={dark:'dark',light:'light',warm:'light'};
 async function click(label,scope='body'){await until('button '+label,()=>js('(()=>{const e=[...('+q(scope)+')?.querySelectorAll("button")||[]].find(b=>b.innerText.trim() === '+JSON.stringify(label)+'&&!b.disabled&&b.getClientRects().length);if(!e)return false;e.click();return true})()'));await sleep(100)}
 const enabled=(label,scope='body')=>js('[...('+q(scope)+')?.querySelectorAll("button")||[]].some(b=>b.innerText.trim() === '+JSON.stringify(label)+'&&!b.disabled)');
 async function select(sel,value){assert.equal(await js('(()=>{const e='+q(sel)+';if(!e||e.disabled)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'),true);}
 async function setText(sel,value){assert.equal(await js('(()=>{const e='+q(sel)+';if(!e)return false;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));return true})()'),true);}
 async function theme(id){await select('select[aria-label="切换工作台主题"]',id);await until('theme '+id,()=>js('document.querySelector(".studio-shell")?.dataset.studioTheme==='+JSON.stringify(id)));await sleep(200)}
 async function screenshot(name,sel){if(sel)await js(q(sel)+'?.scrollIntoView({block:"center",behavior:"instant"})');await js('document.fonts.ready.then(()=>true)');await sleep(200);const shot=await win.webContents.capturePage();assert(!shot.isEmpty());fs.writeFileSync(path.join(out,name+'.png'),shot.toPNG());}
 async function checkBox(label){assert.equal(await js('(()=>{const e='+q('input[aria-label="'+label+'"]')+';if(!e||e.disabled)return false;if(!e.checked)e.click();return e.checked})()'),true)}
 async function state(region,field,id){
   const s=await js('('+function(region,field){const f=document.querySelector(field),r=document.querySelector(region)||f?.closest('.overflow-y-auto');if(!r||!f)throw Error('missing visible field');const a=getComputedStyle(r),b=getComputedStyle(f);return {id:r.dataset.studioTheme||null,zone:r.dataset.studioSurface||null,bg:a.backgroundColor,fg:a.color,fieldBg:b.backgroundColor,fieldFg:b.color,fieldScheme:b.colorScheme,control:f.dataset.studioControl||null,viewport:[r.clientWidth,r.scrollWidth],value:f.type==='password'?'':f.value}}.toString()+')('+JSON.stringify(region)+','+JSON.stringify(field)+')');
   if(phase==='candidate'){
    assert.equal(s.id,id);assert.equal(s.zone,'panel');assert.equal(s.control,'true');if(id!=='classic'){assert.equal(s.bg,bgs[id]);assert.equal(s.fieldBg,fields[id]);assert.equal(s.fieldScheme,schemes[id]);}
    assert(s.viewport[1]<=s.viewport[0]+2,'horizontal overflow in business pane');
   }
   return s;
 }
 async function imageProof(id){
   await js('(()=>{const e='+q(scrollSel)+';e.scrollIntoView({block:"center",behavior:"instant"});e.scrollTop=0;e.scrollLeft=0;return true})()');await sleep(250);
   const s=await js('('+function(imgSel,scrollSel){const i=document.querySelector(imgSel),p=document.querySelector(scrollSel),r=i.getBoundingClientRect(),b=p.getBoundingClientRect(),c=getComputedStyle(i);const x=Math.max(Math.ceil(r.left)+2,Math.ceil(b.left)+2,0),y=Math.max(Math.ceil(r.top)+2,Math.ceil(b.top)+2,0),right=Math.min(Math.floor(r.right)-2,Math.floor(b.right)-2,innerWidth-2),bottom=Math.min(Math.floor(r.bottom)-2,Math.floor(b.bottom)-2,innerHeight-2);return {src:i.src,natural:[i.naturalWidth,i.naturalHeight],rect:[r.width,r.height],filter:c.filter,opacity:c.opacity,transform:c.transform,scroll:[p.scrollWidth,p.scrollHeight,p.clientWidth,p.clientHeight],crop:{x,y,width:right-x,height:bottom-y}}}.toString()+')('+JSON.stringify(imgSel)+','+JSON.stringify(scrollSel)+')');
   assert(s.natural[0]>100&&s.filter==='none'&&s.opacity==='1'&&s.transform==='none'&&s.crop.width>100&&s.crop.height>100,'source image visibility or styles changed');
   const shot=await win.webContents.capturePage(s.crop);assert(!shot.isEmpty());fs.writeFileSync(path.join(out,id+'-notice-paper.png'),shot.toPNG());const {src,crop,...rest}=s;
   return {...rest,sourceSha:sha(src),pixelSha:sha(shot.toBitmap()),cropSize:shot.getSize()};
 }
 await until('editor ready',()=>js('document.querySelector("#basic-field-name")?.value==="演示候选人"'));
 win.unmaximize();win.setSize(1440,920);win.focus();await sleep(350);
 const disk=path.join(main.store.resumesDir,'runner-fixture.json');assert(!path.relative(root,disk).startsWith('..'));const original=sha(fs.readFileSync(disk));
 await click('诊断优化');await click('JD 雷达');await until('JD field',()=>js('!!'+q(src)));
 const seed='合成岗位原始草稿；本科及以上学历。';await setText(src,seed);
 // Generate an actual local A4 PDF with selectable Chinese text, not a mocked image.
 const html=path.join(root,'synthetic-notice.html');fs.writeFileSync(html,'<!doctype html><meta charset="utf-8"><style>body{font-family:"Microsoft YaHei",SimSun,sans-serif;margin:45px;font-size:18px}h1{font-size:24px}</style><h1>合成学校招聘公告</h1><p>须持高中物理教师资格证；</p><p>硕士研究生优先。</p>','utf8');
 const native=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
 let bytes;try{await native.loadFile(html);await native.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');bytes=await native.webContents.printToPDF({pageSize:'A4',printBackground:true})}finally{native.destroy()}
 fs.writeFileSync(path.join(out,'synthetic-notice.pdf'),bytes);results.noticeSha=sha(bytes);
 const send=await js('(()=>{const e='+q('input[aria-label="选择本地招聘公告 PDF"]')+';const dt=new DataTransfer();dt.items.add(new File([new Uint8Array('+JSON.stringify([...bytes])+')],"synthetic-notice.pdf",{type:"application/pdf"}));e.files=dt.files;e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');assert(send);
 await until('extract original text',()=>js(q('[aria-label="公告逐页提取文本"]')+'?.innerText.replace(/\\s/g,"").includes("须持高中物理教师资格证；")'));
 assert.equal(await enabled('确认导入所选公告页'),false);await click('渲染本页 PDF 原件',notice);
 await until('rendered actual PDF',()=>js(q(imgSel)+'?.complete&&'+q(imgSel)+'?.naturalWidth>100'));
 await select('select[aria-label="公告原件显示比例"]','200');
 await until('zoom scroll',()=>js('(()=>{const e='+q(scrollSel)+';return e.scrollWidth>e.clientWidth&&e.scrollHeight>e.clientHeight})()'));
 const extracted=await js(q('[aria-label="公告逐页提取文本"]')+'.innerText');
 for(const id of themes){
   await theme(id);const jd=await state(scopes.jd,src,id);assert.equal(jd.value,seed);
   assert.equal(await enabled('确认导入所选公告页'),false);assert.equal(await js(q('[aria-label="公告逐页提取文本"]')+'.innerText'),extracted);
   await screenshot(id+'-jd',src);const paper=await imageProof(id);
   await screenshot(id+'-notice',scrollSel);
   if(id!=='classic')assert.deepEqual(paper,results.themes.classic.paper,'announcement original changed '+id);
   results.themes[id]={jd,paper};write();
 }
 checks.announcementExact=true;checks.unreviewedCannotImport=true;
 await checkBox('确认已对照 PDF 第 1 页');assert.equal(await enabled('确认导入所选公告页'),false);
 await checkBox('确认公告所选页和替换 JD');assert.equal(await enabled('确认导入所选公告页'),true);
 // Theme change retains the explicit confirmation; actual JD change invalidates it.
 await theme('dark');assert.equal(await enabled('确认导入所选公告页'),true);
 await setText(src,seed+' 新草稿');await until('confirmation revoked on JD change',async()=>!(await enabled('确认导入所选公告页')));
 await checkBox('确认公告所选页和替换 JD');await click('确认导入所选公告页');
 await until('source provenance',()=>js(q('[aria-label="当前公告来源"]')+'?.innerText.includes("synthetic-notice.pdf")'));
 const imported=await js(q(src)+'.value');assert(imported.includes('物理教师资格证'));
 await click('分析岗位原文');await until('clauses available',()=>js('!!'+q('select[aria-label="岗位候选条款"]')));
 const clauses=await js('Array.from(('+q('select[aria-label="岗位候选条款"]')+').options).map(e=>({value:e.value,text:e.innerText}))');
 assert(clauses.length>=2&&clauses.some(c=>c.text.includes('PDF 第 1 页')));results.clauses=clauses;
 const sourceState=await js(q('[aria-label="当前公告来源"]')+'.innerText');
 for(const id of themes){
   await theme(id);assert.deepEqual(await js('Array.from(('+q('select[aria-label="岗位候选条款"]')+').options).map(e=>({value:e.value,text:e.innerText}))'),clauses);
   assert.equal(await js(q(src)+'.value'),imported);assert.equal(await js(q('[aria-label="当前公告来源"]')+'.innerText'),sourceState);
   await screenshot(id+'-requirements','[aria-label="岗位条款原文"]');
 }
 checks.provenanceAndClausesExact=true;checks.confirmationRevocation=true;
 await click('AI 润色 Diff');
 const openConfig=await js('(()=>{const e=[...document.querySelectorAll("button")].find(b=>b.innerText.includes("去配置")||b.innerText.includes("已启用 · 修改"));if(e){e.click();return true}return false})()');
 // Model field is local; do not save credentials or contact provider.
 const aiField='input[aria-label="模型名"]';await until('AI configuration visible',()=>js('!!'+q(aiField)));
 for(const id of themes){await theme(id);results.themes[id].ai=await state(scopes.ai,aiField,id);await screenshot(id+'-ai',aiField);write()}
 checks.aiThemeForms=true;
 win.setSize(1080,720);await sleep(300);await screenshot('minimum-ai',aiField);
 await click('JD 雷达');await screenshot('minimum-jd',src);
 assert.equal(sha(fs.readFileSync(disk)),original);assert.equal(providerCalls,0);checks.diskUnchanged=true;checks.noProviderCalls=true;write();
}
app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{results.error=e.stack||String(e);write();clearTimeout(timer);app.exit(1)});
