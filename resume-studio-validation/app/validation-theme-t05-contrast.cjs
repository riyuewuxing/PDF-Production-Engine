// Actual rendered CSS colors, not palette constants. Exclude disabled and invisible controls.
// Canvas normalization handles CSS oklch/rgb/alpha; unsupported gradient layers are recorded, not silently passed.
module.exports=async function audit(win,selector,label){
 const fn=function(selector){
  const root=document.querySelector(selector);if(!root)throw Error('contrast root missing '+selector);
  const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d',{willReadFrequently:true});
  const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle='transparent';ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
  const composite=(f,b)=>{const a=f[3]+b[3]*(1-f[3]);return a?[0,1,2].map(i=>(f[i]*f[3]+b[i]*b[3]*(1-f[3]))/a).concat(a):[0,0,0,0];};
  const lum=a=>[0,1,2].map(i=>{const v=a[i]/255;return (v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][i]}).reduce((a,b)=>a+b,0);
  const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
  const rows=[],failures=[],excluded={hidden:0,disabled:0,gradient:0,nonText:0};let min=Infinity;
  for(const e of [root,...root.querySelectorAll('*')]){
   if(!(e instanceof HTMLElement)||e instanceof HTMLImageElement||e instanceof HTMLCanvasElement){excluded.nonText++;continue}
   const control=e.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]),textarea,select');
   const hasText=[...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
   if(!hasText&&!control){excluded.nonText++;continue}
   if(!e.getClientRects().length||getComputedStyle(e).visibility!=='visible'){excluded.hidden++;continue}
   if(e.matches(':disabled')||e.closest('[aria-disabled="true"],button:disabled')){excluded.disabled++;continue}
   const chain=[];let current=e,opacity=1,gradient=false;
   while(current){const s=getComputedStyle(current);if(s.backgroundImage!=='none')gradient=true;opacity*=Number(s.opacity);chain.push(rgba(s.backgroundColor));current=current.parentElement;}
   if(gradient){excluded.gradient++;continue}
   let bg=[255,255,255,1];for(const color of chain.reverse())bg=composite(color,bg);
   const style=getComputedStyle(e),ph=control&&e.matches('input,textarea')&&!e.value&&e.placeholder;
   const color=ph?getComputedStyle(e,'::placeholder').color:style.color;
   let fg=rgba(color);fg[3]*=opacity;if(ph)fg[3]*=Number(getComputedStyle(e,'::placeholder').opacity);
   fg=composite(fg,bg);
   const score=ratio(fg,bg),size=parseFloat(style.fontSize),weight=Number(style.fontWeight)||400,threshold=size>=24||(size>=18.6667&&weight>=700)?3:4.5;
   min=Math.min(min,score);
   const row={tag:e.tagName,aria:e.getAttribute('aria-label')||null,className:e.getAttribute('class')||'',text:control?'[control]':([...e.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent.trim()).join(' ').slice(0,72)),ratio:Math.round(score*1000)/1000,threshold,fg:fg.slice(0,3).map(Math.round),bg:bg.slice(0,3).map(Math.round)};
   rows.push(row);if(score+1e-8<threshold)failures.push(row);
  }
  const scrollbars=[root,...root.querySelectorAll('*')].filter(e=>e instanceof HTMLElement&&e.getClientRects().length&&(e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1)&&/(auto|scroll)/.test(getComputedStyle(e).overflow+getComputedStyle(e).overflowY+getComputedStyle(e).overflowX)).map(e=>({aria:e.getAttribute('aria-label'),className:e.getAttribute('class'),color:getComputedStyle(e).scrollbarColor,width:e.clientWidth,height:e.clientHeight}));
  return {count:rows.length,minRatio:Number.isFinite(min)?Math.round(min*1000)/1000:null,failures,excluded,scrollbars};
 };
 const result=await win.webContents.executeJavaScript('('+fn.toString()+')('+JSON.stringify(selector)+')');
 return {label,...result};
};
