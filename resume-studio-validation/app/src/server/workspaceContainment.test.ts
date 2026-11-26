// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LocalResumeStore,ensureInitialDataFromLegacy} from './localFsApi';
import {ResumeDocumentSchema,resumeRevision} from '../schema/resumeSchema';
const roots:string[]=[];
const links:string[]=[];
const doc=(id='synthetic-entry')=>ResumeDocumentSchema.parse({id,title:'Synthetic local resume',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',basic:{name:'Synthetic Candidate',title:'Synthetic Role'},menuSections:[{id:'basic',title:'Basic',order:0}],globalSettings:{}});
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-workspace-containment-'));roots.push(root);
  const store=new LocalResumeStore(path.join(root,'data'));await store.ensureDirs();
  const outside=path.join(root,'external-sentinel');await fs.mkdir(outside);
  return{root,store,outside};
}
async function redirect(dir:string,target:string){
  try{await fs.rmdir(dir);}catch(err){if((err as NodeJS.ErrnoException).code!=='ENOENT')throw err;}
  await fs.symlink(target,dir,process.platform==='win32'?'junction':'dir');links.push(dir);
}
afterEach(async()=>{
  vi.restoreAllMocks();
  // Remove only the synthetic junction itself, never recursively descend.
  for(const link of links.splice(0)){const st=await fs.lstat(link);if(!st.isSymbolicLink())throw Error('expected synthetic directory link');if(process.platform==='win32')await fs.rmdir(link);else await fs.unlink(link);}
  for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});
});
function code(result:PromiseSettledResult<unknown>){return result.status==='rejected'?(result.reason as {code?:string})?.code:'FULFILLED';}
const png=(bytes:string)=>'data:image/png;base64,'+Buffer.from(bytes).toString('base64');
describe('managed workspace entry containment',()=>{
  it('isolates hard-linked resume and master records in listing and direct reading',async()=>{
    const {store,outside}=await fixture();const external=path.join(outside,'external.json'),bytes=JSON.stringify(doc());
    await fs.writeFile(external,bytes);await fs.link(external,path.join(store.resumesDir,'linked.json'));await fs.link(external,store.masterPath);
    await store.saveResume('healthy',doc('healthy'));
    const list=await store.listResumes();
    const calls=await Promise.allSettled([store.getResume('linked'),store.getResume('master')]);
    expect({list,reads:calls.map(code)}).toMatchObject({list:{master:null,resumes:[{slug:'healthy'}],issues:[{slug:'linked',reason:'UNSAFE_ENTRY'},{slug:'master',reason:'UNSAFE_ENTRY'}]},reads:['UNSAFE_ENTRY','UNSAFE_ENTRY']});
    expect(await fs.readFile(external,'utf8')).toBe(bytes);
  });
  it('rejects writes and deletion of linked resume without replacing the original link',async()=>{
    const {store,outside}=await fixture();const original=doc(),external=path.join(outside,'external.json'),bytes=JSON.stringify(original);
    await fs.writeFile(external,bytes);const target=path.join(store.resumesDir,'linked.json');await fs.link(external,target);
    const another=path.join(store.resumesDir,'linked-delete.json');await fs.link(external,another);
    const results=await Promise.allSettled([store.saveResume('linked',{...original,title:'Must not write'},{expectedRevision:resumeRevision(original)}),store.deleteResume('linked-delete',resumeRevision(original))]);
    expect({codes:results.map(code),original:await fs.readFile(external,'utf8'),files:(await fs.readdir(store.resumesDir)).sort(),links:(await fs.stat(external)).nlink}).toEqual({codes:['UNSAFE_ENTRY','UNSAFE_ENTRY'],original:bytes,files:['linked-delete.json','linked.json'],links:3});
  });
  it.skipIf(process.platform==='win32')('refuses a dangling linked filename instead of interpreting it as an empty slot',async()=>{
    const {store,outside}=await fixture();
    // Hard links work unprivileged on both platforms; dangling file symlinks
    // need POSIX or Windows developer-mode privileges. Linux proves this case.
    const target=path.join(store.resumesDir,'dangling.json');await fs.symlink(path.join(outside,'missing.json'),target);
    const results=await Promise.allSettled([store.getResume('dangling'),store.saveResume('dangling',doc(),{expectedRevision:null})]);
    expect({codes:results.map(code),isLink:(await fs.lstat(target)).isSymbolicLink(),external:await fs.readdir(outside)}).toEqual({codes:['UNSAFE_ENTRY','UNSAFE_ENTRY'],isLink:true,external:[]});
  });
  it('rejects redirected resume directory for list, direct read, create, save and delete',async()=>{
    const {store,outside}=await fixture();const original=doc(),bytes=JSON.stringify(original);await fs.writeFile(path.join(outside,'external.json'),bytes);
    await redirect(store.resumesDir,outside);
    const reads=await Promise.allSettled([store.listResumes(),store.getResume('external')]);
    const writes=await Promise.allSettled([store.saveResume('new-file',doc('new'),{expectedRevision:null}),store.createResume({slug:'new-copy',document:doc('copy')}),store.deleteResume('external',resumeRevision(original))]);
    expect({reads:reads.map(code),writes:writes.map(code),outside:(await fs.readdir(outside)).sort()}).toEqual({reads:['UNSAFE_DIRECTORY','UNSAFE_DIRECTORY'],writes:['UNSAFE_DIRECTORY','UNSAFE_DIRECTORY','UNSAFE_DIRECTORY'],outside:['external.json']});
    expect(await fs.readFile(path.join(outside,'external.json'),'utf8')).toBe(bytes);
  });
  it('does not initialize an empty redirected resumes directory with starter documents',async()=>{
    const {root,store,outside}=await fixture();await redirect(store.resumesDir,outside);
    const [result]=await Promise.allSettled([ensureInitialDataFromLegacy({rootDir:root})]);
    expect({code:code(result!),outside:await fs.readdir(outside),rootFiles:(await fs.readdir(store.dataDir)).sort()}).toEqual({code:'UNSAFE_DIRECTORY',outside:[],rootFiles:['assets','resumes']});
  });
  it('rejects moving an original resume into a redirected recycle bin',async()=>{
    const {store,outside}=await fixture();const original=await store.saveResume('healthy',doc());const before=await fs.readFile(path.join(store.resumesDir,'healthy.json'));
    await redirect(store.trashDir,outside);
    const [result]=await Promise.allSettled([store.deleteResume('healthy',resumeRevision(original))]);
    expect({code:code(result!),outside:await fs.readdir(outside),versions:await fs.readdir(store.resumesDir)}).toEqual({code:'UNSAFE_DIRECTORY',outside:[],versions:['healthy.json']});
    expect(await fs.readFile(path.join(store.resumesDir,'healthy.json'))).toEqual(before);
  });
  it('refuses redirected recycle-bin listing, restoration and purge',async()=>{
    const {store,outside}=await fixture();const original=doc(),bytes=JSON.stringify(original);
    const restore='restore.1767225600000.12345678-1234-4234-8234-123456789001',purge='purge.1767225600000.12345678-1234-4234-8234-123456789002';
    await fs.writeFile(path.join(outside,restore+'.json'),bytes);await fs.writeFile(path.join(outside,purge+'.json'),bytes);await redirect(store.trashDir,outside);
    const [listing]=await Promise.allSettled([store.listTrash()]);
    const writes=await Promise.allSettled([store.restoreTrash(restore,resumeRevision(original)),store.purgeTrash(purge,resumeRevision(original),'PERMANENT_DELETE')]);
    expect({list:code(listing!),writes:writes.map(code),outside:(await fs.readdir(outside)).sort(),resumes:await fs.readdir(store.resumesDir)}).toEqual({list:'UNSAFE_DIRECTORY',writes:['UNSAFE_DIRECTORY','UNSAFE_DIRECTORY'],outside:[purge+'.json',restore+'.json'],resumes:[]});
    expect(await fs.readFile(path.join(outside,restore+'.json'),'utf8')).toBe(bytes);
  });
  it('counts hard-linked archive entries as unreadable and refuses restore and purge',async()=>{
    const {store,outside}=await fixture();const original=await store.saveResume('healthy',doc());
    const archived=await store.deleteResume('healthy',resumeRevision(original)),target=path.join(store.trashDir,archived.trashId+'.json');
    const external=path.join(outside,'archive.json');await fs.link(target,external);const before=await fs.readFile(external);
    const list=await store.listTrash();
    const results=await Promise.allSettled([store.restoreTrash(archived.trashId,resumeRevision(original)),store.purgeTrash(archived.trashId,resumeRevision(original),'PERMANENT_DELETE')]);
    expect({list,codes:results.map(code),outside:await fs.readdir(outside),archives:await fs.readdir(store.trashDir)}).toEqual({list:{items:[],unreadableCount:1},codes:['UNSAFE_ENTRY','UNSAFE_ENTRY'],outside:['archive.json'],archives:[archived.trashId+'.json']});
    expect(await fs.readFile(external)).toEqual(before);expect((await fs.stat(external)).nlink).toBe(2);
  });
  it('rejects linked and redirected asset reads and writes, preserving external bytes',async()=>{
    const {store,outside}=await fixture();const external=path.join(outside,'external.png'),bytes=Buffer.from('synthetic external bytes');await fs.writeFile(external,bytes);
    const linked=path.join(store.assetsDir,'linked.png');await fs.link(external,linked);
    const [hardlink]=await Promise.allSettled([store.readAsset('linked.png')]);await fs.unlink(linked);
    await redirect(store.assetsDir,outside);
    const results=await Promise.allSettled([store.readAsset('external.png'),store.saveAsset({filename:'new.png',dataUrl:png('synthetic new bytes')})]);
    expect({hardlink:code(hardlink!),codes:results.map(code),outside:await fs.readdir(outside)}).toEqual({hardlink:'UNSAFE_ENTRY',codes:['UNSAFE_DIRECTORY','UNSAFE_DIRECTORY'],outside:['external.png']});
    expect(await fs.readFile(external)).toEqual(bytes);
    // An unrelated unsafe asset directory must not block normal document editing.
    const normal=await store.saveResume('healthy',doc());expect((await store.getResume('healthy')).id).toBe(normal.id);
  });
  it('does not overwrite different uploaded assets with identical names and wall clock',async()=>{
    const {store}=await fixture();vi.spyOn(Date,'now').mockReturnValue(1767225600000);
    const one=await store.saveAsset({filename:'same.png',dataUrl:png('first')});
    const two=await store.saveAsset({filename:'same.png',dataUrl:png('second')});
    expect({distinct:one.filename!==two.filename,one:(await store.readAsset(one.filename)).buffer.toString(),two:(await store.readAsset(two.filename)).buffer.toString()}).toEqual({distinct:true,one:'first',two:'second'});
  });
  it('preserves normal document, asset and recycle-bin round trips',async()=>{
    const {store}=await fixture();const original=await store.saveResume('healthy',doc());
    const asset=await store.saveAsset({filename:'normal.png',dataUrl:png('ordinary synthetic bytes')});
    expect((await store.readAsset(asset.filename)).buffer.toString()).toBe('ordinary synthetic bytes');
    const archived=await store.deleteResume('healthy',resumeRevision(original));
    const restored=await store.restoreTrash(archived.trashId,resumeRevision(original));
    expect(restored.document.id).toBe(original.id);expect((await store.listResumes()).resumes.map(x=>x.slug)).toEqual(['healthy']);
  });
});
