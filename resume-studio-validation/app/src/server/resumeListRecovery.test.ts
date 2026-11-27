// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LocalResumeStore,ensureInitialDataFromLegacy} from './localFsApi';
import {ResumeDocumentSchema,resumeRevision} from '../schema/resumeSchema';
const roots:string[]=[];
const doc=()=>ResumeDocumentSchema.parse({id:'synthetic-list-doc',title:'Synthetic list fixture',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',basic:{name:'Synthetic Candidate',title:'Role'},menuSections:[{id:'basic',title:'Basic',order:0}],globalSettings:{}});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-list-recovery-'));roots.push(root);const data=path.join(root,'data'),store=new LocalResumeStore(data);await store.ensureDirs();return{root,data,store};}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
describe('resume list damaged-entry isolation',()=>{
  it('isolates invalid JSON, invalid schema and non-file entries without rewriting originals',async()=>{
    const {store,data}=await fixture();await store.saveResume('master',doc());await store.saveResume('healthy',{...doc(),id:'healthy-id'});
    const broken=path.join(data,'resumes','broken.json'),invalid=path.join(data,'resumes','invalid.json'),dir=path.join(data,'resumes','directory.json');
    await fs.writeFile(broken,'{broken');await fs.writeFile(invalid,'{"schemaVersion":999}');await fs.mkdir(dir);
    const list=await store.listResumes();
    expect(list.master?.slug).toBe('master');expect(list.resumes.map(r=>r.slug)).toEqual(['healthy']);
    expect(list.issues).toEqual([{slug:'broken',reason:'CORRUPTED_JSON'},{slug:'directory',reason:'UNSAFE_ENTRY'},{slug:'invalid',reason:'SCHEMA_INVALID'}]);
    expect(await fs.readFile(broken,'utf8')).toBe('{broken');expect(await fs.readFile(invalid,'utf8')).toBe('{"schemaVersion":999}');expect((await fs.stat(dir)).isDirectory()).toBe(true);
    await expect(store.getResume('broken')).rejects.toMatchObject({code:'CORRUPTED_JSON'});
    await expect(store.createResume({slug:'broken',document:doc()})).rejects.toMatchObject({code:'SLUG_EXISTS'});
  });
  it('reports a damaged master while keeping a healthy version editable',async()=>{
    const {store,data}=await fixture();await store.saveResume('healthy',doc());const master=path.join(data,'master.json');await fs.writeFile(master,'{broken master');
    const list=await store.listResumes();expect(list.master).toBeNull();expect(list.resumes.map(r=>r.slug)).toEqual(['healthy']);expect(list.issues).toEqual([{slug:'master',reason:'CORRUPTED_JSON'}]);
    const current=await store.getResume('healthy');await store.saveResume('healthy',{...current,title:'Edited healthy'});expect((await store.getResume('healthy')).title).toBe('Edited healthy');
    expect(await fs.readFile(master,'utf8')).toBe('{broken master');
  });
  it('never initializes over a damaged-only master workspace',async()=>{
    const {root,store,data}=await fixture();const master=path.join(data,'master.json');await fs.writeFile(master,'{broken master');
    expect((await ensureInitialDataFromLegacy({rootDir:root})).initialized).toBe(false);
    expect(await fs.readFile(master,'utf8')).toBe('{broken master');expect(await fs.readdir(store.resumesDir)).toEqual([]);
    expect((await store.listResumes()).issues).toEqual([{slug:'master',reason:'CORRUPTED_JSON'}]);
  });
  it('never initializes a workspace containing only an invalid version',async()=>{
    const {root,store,data}=await fixture();const version=path.join(store.resumesDir,'invalid.json');await fs.writeFile(version,'{}');
    expect((await ensureInitialDataFromLegacy({rootDir:root})).initialized).toBe(false);
    expect(await fs.readFile(version,'utf8')).toBe('{}');await expect(fs.lstat(path.join(data,'master.json'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('still initializes a truly empty workspace',async()=>{
    const {root,store}=await fixture();expect((await ensureInitialDataFromLegacy({rootDir:root})).initialized).toBe(true);
    const list=await store.listResumes();expect(list.master).not.toBeNull();expect(list.resumes).toHaveLength(1);expect(list.issues).toBeUndefined();
  });
  it('clears an issue only after the actual file is restored',async()=>{
    const {store}=await fixture();const version=path.join(store.resumesDir,'broken.json');await fs.writeFile(version,'{broken');
    expect((await store.listResumes()).issues?.length).toBe(1);
    await fs.writeFile(version,JSON.stringify(doc()));const list=await store.listResumes();expect(list.issues).toBeUndefined();expect(list.resumes.map(r=>r.slug)).toEqual(['broken']);
  });
});

describe('legacy startup never silently resurrects a deleted default version',()=>{
  const legacyName='高中物理教师（云南省内）.json';
  async function migrated(){
    const f=await fixture(),original=Buffer.from(JSON.stringify(doc()));
    const legacy=path.join(f.root,legacyName);await fs.writeFile(legacy,original);
    const first=await ensureInitialDataFromLegacy({rootDir:f.root});
    expect(first.initialized).toBe(true);
    const slug=path.basename(first.resumePath,'.json'),version=await f.store.getResume(slug);
    const master=await fs.readFile(first.masterPath);
    return {...f,legacy,original,first,slug,version,master};
  }
  it('keeps deleted legacy-derived version in trash on cold initialization and restores explicitly',async()=>{
    const f=await migrated();const deletion=await f.store.deleteResume(f.slug,resumeRevision(f.version));
    const archived=path.join(f.store.trashDir,deletion.trashId+'.json'),bytes=await fs.readFile(archived);
    expect((await ensureInitialDataFromLegacy({rootDir:f.root})).initialized).toBe(false);
    await expect(fs.lstat(f.first.resumePath)).rejects.toMatchObject({code:'ENOENT'});
    expect(await fs.readFile(archived)).toEqual(bytes);expect(await fs.readFile(f.first.masterPath)).toEqual(f.master);
    const restored=await f.store.restoreTrash(deletion.trashId,resumeRevision(f.version));
    expect(restored.slug).toBe(f.slug);expect(restored.document.id).toBe(f.version.id);
    expect(await fs.readFile(f.legacy)).toEqual(f.original);
  });
  it('does not recreate a permanently deleted legacy-derived version after restart',async()=>{
    const f=await migrated();const deletion=await f.store.deleteResume(f.slug,resumeRevision(f.version));
    await f.store.purgeTrash(deletion.trashId,resumeRevision(f.version),'PERMANENT_DELETE');
    expect((await ensureInitialDataFromLegacy({rootDir:f.root})).initialized).toBe(false);
    await expect(fs.lstat(f.first.resumePath)).rejects.toMatchObject({code:'ENOENT'});
    expect(await fs.readFile(f.first.masterPath)).toEqual(f.master);expect(await fs.readFile(f.legacy)).toEqual(f.original);
    expect((await f.store.listTrash()).items).toEqual([]);
  });
  it('opens a healthy master-only workspace even if the preserved legacy file is malformed',async()=>{
    const f=await migrated();await f.store.deleteResume(f.slug,resumeRevision(f.version));
    await fs.writeFile(f.legacy,'{synthetic old malformed');const old=await fs.readFile(f.legacy);
    expect((await ensureInitialDataFromLegacy({rootDir:f.root})).initialized).toBe(false);
    expect(await fs.readFile(f.first.masterPath)).toEqual(f.master);expect(await fs.readFile(f.legacy)).toEqual(old);
    await expect(fs.lstat(f.first.resumePath)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('does not fill absent master/default version into a workspace containing a different resume or an unreadable entry',async()=>{
    for(const mode of ['healthy','corrupt']){
      const f=await fixture(),legacy=path.join(f.root,legacyName);await fs.writeFile(legacy,JSON.stringify(doc()));
      const other=path.join(f.store.resumesDir,'other.json'),bytes=Buffer.from(mode==='healthy'?JSON.stringify({...doc(),id:'other-id'}):'{broken other');
      await fs.writeFile(other,bytes);
      const r=await ensureInitialDataFromLegacy({rootDir:f.root});expect(r.initialized).toBe(false);
      await expect(fs.lstat(r.masterPath)).rejects.toMatchObject({code:'ENOENT'});await expect(fs.lstat(r.resumePath)).rejects.toMatchObject({code:'ENOENT'});
      expect(await fs.readFile(other)).toEqual(bytes);
    }
  });
  it('preserves explicit force migration and leaves the original legacy bytes untouched',async()=>{
    const f=await migrated();await f.store.deleteResume(f.slug,resumeRevision(f.version));
    // Explicit force is a separate legacy CLI operation; exercise only a fresh independent directory without a trash reservation.
    const fresh=await fixture();await fs.writeFile(path.join(fresh.root,legacyName),f.original);
    await fresh.store.saveResume('master',{...doc(),title:'Existing master'});
    const r=await ensureInitialDataFromLegacy({rootDir:fresh.root,force:true});expect(r.initialized).toBe(true);
    expect((await fresh.store.getResume(path.basename(r.resumePath,'.json'))).id).toBe(f.version.id);
    expect(await fs.readFile(path.join(fresh.root,legacyName))).toEqual(f.original);
  });
});
