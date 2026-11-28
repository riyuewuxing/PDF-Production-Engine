const audit=require('./validation-theme-t05-contrast.cjs');
const fs=require('node:fs'),path=require('node:path');
const themes=['classic','nordic','blueprint','terracotta','ink'],bg={nordic:'rgb(248, 249, 250)',blueprint:'rgb(27, 49, 80)',terracotta:'rgb(255, 247, 240)',ink:'rgb(255, 255, 255)'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function matrix(win,out,region,label){
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const selector='[data-studio-region="'+region+'"]',results={};
 const state=()=>js(sel=>{const root=document.querySelector(sel);if(!root)throw Error('missing scope');const c=getComputedStyle(root),fields=[...root.querySelectorAll('input,textarea,select')].map(e=>({tag:e.tagName,type:e.type,value:e.value,checked:e.checked,disabled:e.disabled}));return {theme:root.dataset.studioTheme,bg:c.backgroundColor,fg:c.color,fields,body:root.innerText,actions:[...root.querySelectorAll('button')].map(b=>({label:b.innerText,disabled:b.disabled}))};},selector);
 let initial;
 for(const id of themes){
  if(!await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,id);e.dispatchEvent(new Event('change',{bubbles:true}));return true},id))throw Error('theme selector missing');
  const until=Date.now()+8000;while(Date.now()<until&&(await state()).theme!==id)await sleep(100);
  await sleep(200);const s=await state();if(s.theme!==id)throw Error('theme not applied '+id);if(id!=='classic'&&s.bg!==bg[id])throw Error('unexpected background '+id+' '+s.bg);
  const {theme,bg:back,fg,...business}=s;if(initial&&JSON.stringify(initial)!==JSON.stringify(business))throw Error('theme mutated business state '+label+' '+id);initial=business;
  const contrast=await audit(win,selector,label+'-'+id);
  const shot=await win.webContents.capturePage();if(shot.isEmpty())throw Error('empty capture');fs.writeFileSync(path.join(out,label+'-'+id+'.png'),shot.toPNG());
  results[id]={theme,bg:back,fg,contrast,business};
  fs.writeFileSync(path.join(out,label+'-theme-matrix.json'),JSON.stringify(results,null,2));
  if(id!=='classic'&&contrast.failures.length)throw Error('contrast gate '+label+' '+id+' '+JSON.stringify(contrast.failures.slice(0,8)));
 }
 return results;
};