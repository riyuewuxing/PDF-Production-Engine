// T16 synthetic real-control test probe; does not modify production source or business state.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pairs=[['solid','square'],['outline','round'],['soft','pill'],['flat','ghost'],['raised','floating'],['gradient','fine-outline']];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function install(win,out,suite){
 const pair=pairs[Number(process.env.T16_PAIR)];assert(pair,'invalid pair');const [button,icon]=pair;
 const key='resume-studio-ui-component-skins-v1',raw=JSON.stringify({schemaVersion:1,skins:{button,icon}});
 const report={runnerSha:process.env.GITHUB_SHA,suite,pair,phase:process.env.QUEUE_PHASE||'main',setup:'',samples:[],actions:[],checks:{}};
 const write=()=>fs.writeFileSync(path.join(out,'t16-probe-'+report.phase+'.json'),JSON.stringify(report,null,2));
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const until=async(label,fn,ms=16000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error('T16 '+label)};
 const dlg='dialog[aria-label="组件外观工坊"]';
 const getPref=()=>js(k=>localStorage.getItem(k),key);
 await until('stable app root',()=>js(()=>!!document.querySelector('[data-studio-region="startup-error"]')||document.querySelector('.studio-shell')?.getAttribute('aria-busy')==='false'));
 if(await getPref()===raw){report.setup='cold-read-existing';}
 else if(await js(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='组件外观'&&!b.disabled))){
   const click=async(label,scope='body')=>assert(await js((l,s)=>{const e=[...document.querySelectorAll(s+' button')].find(b=>b.innerText.trim()===l&&!b.disabled&&b.getClientRects().length);if(!e)return false;e.click();return true},label,scope),'workshop '+label);
   await click('组件外观');await until('workshop open',()=>js(s=>document.querySelector(s)?.matches(':modal'),dlg));
   for(const [label,v] of [['普通按钮皮肤',button],['图标按钮皮肤',icon]]){
     assert(await js((s,l,v)=>{const e=document.querySelector(s+' select[aria-label='+JSON.stringify(l)+']');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('change',{bubbles:true}));return true},dlg,label,v));
     await until('draft value '+label,()=>js((s,l,v)=>document.querySelector(s+' select[aria-label='+JSON.stringify(l)+']')?.value===v,dlg,label,v));
   }
   await click('应用组件外观',dlg);await until('workshop closed',()=>js(s=>!document.querySelector(s),dlg));report.setup='explicit workshop apply';
 }else{
   assert.equal(suite,'all-corrupt','no workshop on normal fixture');
   // Test only: start a damaged synthetic workspace with a previously saved valid preference.
   await js((k,v)=>localStorage.setItem(k,v),key,raw);win.webContents.reload();await until('damaged startup reload',()=>js(()=>!!document.querySelector('[data-studio-region="startup-error"]')));report.setup='synthetic preexisting preference';
 }
 assert.equal(await getPref(),raw);write();
 const contrast=(a,b)=>{const lum=s=>{const n=s.match(/[\d.]+/g)?.map(Number);assert(n&&n.length>=3,'invalid RGB '+s);return n.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0)};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
 const rows=label=>js(label=>[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length&&(label===null?e.hasAttribute('data-studio-skin'):(e.innerText.trim()===label||e.getAttribute('aria-label')===label))).map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),scope=e.closest('[data-studio-surface][data-studio-theme]');return {label:e.getAttribute('aria-label')||e.innerText.trim(),text:e.innerText.trim(),type:e.type,disabled:e.disabled,variant:e.dataset.studioSkin||null,family:e.dataset.studioSkinFamily||null,role:e.dataset.studioSkinRole||null,scope:scope?.dataset.studioSurface||null,theme:scope?.dataset.studioTheme||null,bg:s.backgroundColor,fg:s.color,border:s.borderRadius,cursor:s.cursor,rect:[r.width,r.height],protected:!!e.closest('.a4-sheet,[data-studio-paper]')}}),label);
 const validate=(r)=>{assert(r.scope&&!r.protected,'skin outside intended scope '+JSON.stringify(r));assert.equal(r.variant,r.family==='button'?button:icon);assert(['normal','primary','danger'].includes(r.role));assert(r.rect.every(x=>x>0));if(!r.disabled){r.contrast=contrast(r.fg,r.bg);assert(r.contrast>=4.5,'enabled contrast '+JSON.stringify(r));}else assert.equal(r.cursor,'not-allowed','disabled cursor '+r.label);};
 const required=label=>/^(确认发送|预览版式请求|预览 AI 自由任务|预览文案精修请求|生成润色对比 Diff|生成整卷 JD 定向提案|核对任务绑定|确认登记岗位任务|开始岗位 |核对岗位流程 |确认进入该岗位流程|取消进入流程|分析岗位原文|记录本条人工核对|保存本次核对到本地|保存岗位自荐信|导出岗位自荐信 PDF|导出岗位原稿 PDF|核对并归档岗位 PDF|确认记入并锁定快照|关闭记入投递弹窗|刷新岗位归档台账|制作本岗位投递包 ZIP|读取并对比|关闭对照|对比版本 \/ 历史快照|恢复为新简历|查看草稿内容|取消读取快照|返回岗位队列|载入此岗位历史自荐信|只读复盘 )/.test(label);
 const probe=async label=>{if(typeof label!=='string')return;let a=await rows(label);if(required(label)){await until('actual action '+label,async()=>{a=await rows(label);return a.some(x=>!x.disabled&&x.variant)},10000);assert(a.some(x=>!x.disabled&&x.variant),'missing action marker '+label);}for(const x of a.filter(x=>x.variant))validate(x);report.actions.push({requested:label,rows:a});write()};
 const scan=async label=>{const a=await rows(null);for(const x of a)validate(x);assert(await js(()=>!document.querySelector('.a4-sheet [data-studio-skin],[data-studio-paper] [data-studio-skin]')));report.samples.push({label,rows:a});write()};
 const finish=async()=>{assert.equal(await getPref(),raw,'preference changed');await scan('terminal');assert(report.actions.some(a=>a.rows.some(x=>x.variant)),'no real marked action');report.checks={validPreference:true,markedActions:true,scopeAndContrast:true,paperMarkersAbsent:true};write()};
 return {probe,scan,finish};
};
