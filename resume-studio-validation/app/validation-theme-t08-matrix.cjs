const fs=require('node:fs'),path=require('node:path'),audit=require('./validation-theme-t05-contrast.cjs');
const themes=['classic','nordic','blueprint','terracotta','ink'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function matrix(win,out,region,label,source){
 const selector='[data-studio-region="'+region+'"]',res={};
 const js=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const state=()=>js(sel=>{const d=document.querySelector(sel);if(!d)return null;const c=getComputedStyle(d);return {theme:d.dataset.studioTheme,bg:c.backgroundColor,fg:c.color,body:d.innerText,fields:[...d.querySelectorAll('input,textarea,select')].map(x=>[x.tagName,x.type,x.value,x.disabled,x.readOnly,x.checked]),buttons:[...d.querySelectorAll('button')].map(x=>[x.innerText,x.disabled])}},selector);
 const before=await source(),initial=await state();if(!initial)throw Error('matrix region missing '+region);
 for(const id of themes){
  const ok=await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');if(!e)return false;e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true},id);if(!ok)throw Error('theme selector missing');
  const end=Date.now()+8000;while(Date.now()<end&&(await state())?.theme!==id)await sleep(100);
  const s=await state();if(!s||s.theme!==id)throw Error('theme missing '+region+' '+id);
  const business=x=>JSON.stringify([x.body,x.fields,x.buttons]);
  if(business(initial)!==business(s))throw Error('theme changed visible business state '+label+' '+id);
  if(JSON.stringify(before)!==JSON.stringify(await source()))throw Error('theme changed source '+label+' '+id);
  await js(sel=>document.querySelector(sel)?.scrollIntoView({block:'start',behavior:'instant'}),selector);
  await js(()=>document.fonts.ready.then(()=>true));await sleep(220);
  const contrast=await audit(win,selector,label+'-'+id);res[id]={theme:s.theme,bg:s.bg,fg:s.fg,contrast,fields:s.fields,buttons:s.buttons};
  const shot=await win.webContents.capturePage();if(shot.isEmpty())throw Error('empty screenshot');fs.writeFileSync(path.join(out,label+'-'+id+'.png'),shot.toPNG());
  fs.writeFileSync(path.join(out,label+'-matrix.json'),JSON.stringify(res,null,2));
  if(id!=='classic'&&contrast.failures.length)throw Error('contrast '+label+' '+id+' '+JSON.stringify(contrast.failures.slice(0,8)));
 }
 await js(id=>{const e=document.querySelector('select[aria-label="切换工作台主题"]');e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));return true},initial.theme);
 await sleep(100);
 return res;
};