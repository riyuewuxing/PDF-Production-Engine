// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LocalResumeStore} from './localFsApi';
import {ResumeDocumentSchema,resumeRevision,type ResumeDocument} from '../schema/resumeSchema';
const roots:string[]=[];
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-snapshot-integrity-'));roots.push(root);
  const store=new LocalResumeStore(path.join(root,'data'));
  const doc=await store.saveResume('synthetic',ResumeDocumentSchema.parse({id:'synthetic-snapshot-doc',title:'Synthetic current',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',basic:{name:'Synthetic Candidate',title:'Role'},menuSections:[{id:'basic',title:'Basic',order:0}],globalSettings:{}}));
  const dir=path.join(store.backupsDir,'synthetic');
  return {root,store,doc,dir,file:store.resolveResumePath('synthetic').filePath};
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
function record(id:string,doc:ResumeDocument,createdAt:string,slug='synthetic'){
  return {meta:{id,slug,createdAt,reason:'Synthetic history',templateId:doc.templateId,title:doc.title,charCount:10},document:doc};
}
async function history(dir:string,doc:ResumeDocument){
  await fs.mkdir(dir,{recursive:true});
  for(let i=0;i<15;i++){
    const id='snap-'+String(i).padStart(2,'0');
    await fs.writeFile(path.join(dir,id+'.json'),JSON.stringify(record(id,doc,new Date(Date.UTC(2020,0,i+1)).toISOString())));
  }
}
async function exists(file:string){try{await fs.lstat(file);return true;}catch{return false;}}
describe('snapshot record identity and retention integrity',()=>{
  it('does not delete a valid newest record referenced by an older corrupt alias',async()=>{
    const {store,doc,dir}=await fixture();await history(dir,doc);
    const newest=path.join(dir,'snap-14.json'),original=await fs.readFile(newest);
    const alias=path.join(dir,'alias.json'),bad=JSON.stringify(record('snap-14',doc,'2000-01-01T00:00:00Z'));
    await fs.writeFile(alias,bad);
    await store.createSnapshot('synthetic','new');
    expect(await fs.readFile(newest)).toEqual(original);expect(await fs.readFile(alias,'utf8')).toBe(bad);
    expect(await exists(path.join(dir,'snap-00.json'))).toBe(false);
    const list=await store.listSnapshots('synthetic');expect(list).toHaveLength(15);expect(list.map(x=>x.id)).toContain('snap-14');
  });
  it('does not count invalid document content toward the fifteen valid snapshots',async()=>{
    const {store,doc,dir}=await fixture();await history(dir,doc);
    const bad=path.join(dir,'invalid.json'),bytes=JSON.stringify({...record('invalid',doc,'2099-01-01T00:00:00Z'),document:{}});
    await fs.writeFile(bad,bytes);
    await store.createSnapshot('synthetic','new');
    expect(await fs.readFile(bad,'utf8')).toBe(bytes);expect(await exists(path.join(dir,'snap-01.json'))).toBe(true);
    expect((await store.listSnapshots('synthetic')).map(x=>x.id)).not.toContain('invalid');
    expect(await store.listSnapshots('synthetic')).toHaveLength(15);
  });
  it('ignores traversal-shaped embedded IDs without aborting safe creation',async()=>{
    const {store,doc,dir}=await fixture();await history(dir,doc);
    const bad=path.join(dir,'bad-id.json'),bytes=JSON.stringify(record('../outside',doc,'2000-01-01T00:00:00Z'));
    await fs.writeFile(bad,bytes);const outside=path.join(store.backupsDir,'outside.json');await fs.writeFile(outside,'PRESERVE');
    await expect(store.createSnapshot('synthetic','new')).resolves.toBeTruthy();
    expect(await fs.readFile(bad,'utf8')).toBe(bytes);expect(await fs.readFile(outside,'utf8')).toBe('PRESERVE');
    expect(await store.listSnapshots('synthetic')).toHaveLength(15);
  });
  it('rejects a directly selected file with mismatched embedded identity before any rollback write',async()=>{
    const {store,doc,dir,file}=await fixture();await fs.mkdir(dir,{recursive:true});const before=await fs.readFile(file);
    const bad=path.join(dir,'alias.json'),bytes=JSON.stringify(record('other-id',{...doc,title:'Foreign historical contents'},'2020-01-01T00:00:00Z'));
    await fs.writeFile(bad,bytes);
    await expect(store.restoreSnapshot('synthetic','alias',resumeRevision(doc))).rejects.toMatchObject({code:'SNAPSHOT_INVALID'});
    expect(await fs.readFile(file)).toEqual(before);expect(await fs.readFile(bad,'utf8')).toBe(bytes);expect(await fs.readdir(dir)).toEqual(['alias.json']);
  });
  it('rejects a snapshot copied from a different version directory even if its document ID matches',async()=>{
    const {store,doc,dir,file}=await fixture();await fs.mkdir(dir,{recursive:true});const before=await fs.readFile(file);
    const bad=path.join(dir,'foreign.json'),bytes=JSON.stringify(record('foreign',{...doc,title:'Foreign version'},'2020-01-01T00:00:00Z','another-version'));
    await fs.writeFile(bad,bytes);
    await expect(store.restoreSnapshot('synthetic','foreign',resumeRevision(doc))).rejects.toMatchObject({code:'SNAPSHOT_INVALID'});
    expect(await fs.readFile(file)).toEqual(before);expect(await fs.readFile(bad,'utf8')).toBe(bytes);
  });
  it('rejects hard-linked snapshot files without importing outside data',async()=>{
    const {root,store,doc,dir,file}=await fixture();await fs.mkdir(dir,{recursive:true});const before=await fs.readFile(file);
    const external=path.join(root,'external.json'),bytes=JSON.stringify(record('linked',{...doc,title:'External history'},'2020-01-01T00:00:00Z'));
    await fs.writeFile(external,bytes);await fs.link(external,path.join(dir,'linked.json'));
    await expect(store.restoreSnapshot('synthetic','linked',resumeRevision(doc))).rejects.toMatchObject({code:'SNAPSHOT_INVALID'});
    expect(await fs.readFile(file)).toEqual(before);expect(await fs.readFile(external,'utf8')).toBe(bytes);expect((await fs.stat(external)).nlink).toBe(2);
    expect(await store.listSnapshots('synthetic')).toEqual([]);
  });
  it('refuses a redirected backup directory before snapshot creation or rotation',async()=>{
    const {root,store,doc,file}=await fixture();const outside=path.join(root,'outside');await fs.mkdir(outside);
    const before=await fs.readFile(file);await fs.writeFile(path.join(outside,'keep.txt'),'PRESERVE');
    await fs.symlink(outside,store.backupsDir,process.platform==='win32'?'junction':'dir');
    await expect(store.createSnapshot('synthetic','redirected',undefined,resumeRevision(doc))).rejects.toMatchObject({code:'SNAPSHOT_UNSAFE'});
    await expect(store.listSnapshots('synthetic')).rejects.toMatchObject({code:'SNAPSHOT_UNSAFE'});
    expect(await fs.readdir(outside)).toEqual(['keep.txt']);expect(await fs.readFile(file)).toEqual(before);
  });
  it('keeps regular snapshot creation, listing and reversible rollback working',async()=>{
    const {store,doc}=await fixture();expect(await store.listSnapshots('synthetic')).toEqual([]);
    const snapshot=await store.createSnapshot('synthetic','normal',undefined,resumeRevision(doc));
    const changed=await store.saveResume('synthetic',{...doc,title:'Edited current'});
    const restored=await store.restoreSnapshot('synthetic',snapshot.id,resumeRevision(changed));
    expect(restored.title).toBe(doc.title);expect(restored.id).toBe(doc.id);
    const list=await store.listSnapshots('synthetic');expect(list).toHaveLength(2);expect(list.map(x=>x.reason)).toContain('回滚前自动备份');
  });
});
