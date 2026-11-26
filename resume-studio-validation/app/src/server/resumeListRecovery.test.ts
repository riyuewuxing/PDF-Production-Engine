// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LocalResumeStore,ensureInitialDataFromLegacy} from './localFsApi';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
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
