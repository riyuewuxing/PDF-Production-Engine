const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-stat-diagnostic-'));try{
 const file=path.join(dir,'fixture.pdf');await fs.writeFile(file,Buffer.from('%PDF-1.7\nsynthetic\n%%EOF'));
 const a=await fs.lstat(file,{bigint:true}),real=await fs.realpath(file),h=await fs.open(file,'r');try{
 const b=await h.stat({bigint:true});const c=await h.readFile();const d=await h.stat({bigint:true}),e=await fs.lstat(file,{bigint:true});
 const keys=['dev','ino','size','mtimeNs','ctimeNs','nlink','birthtimeNs','mode'];
 const report={platform:process.platform,node:process.version,relative:path.relative(file,real),samePath:path.relative(path.resolve(file),file)==='',pdf:c.subarray(0,5).toString('ascii'),stats:[a,b,d,e].map(s=>({file:s.isFile(),link:s.isSymbolicLink(),...Object.fromEntries(keys.map(k=>[k,String(s[k])]))}))};
 console.log(JSON.stringify(report,null,2));
 }finally{await h.close()}
 }finally{await fs.rm(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
