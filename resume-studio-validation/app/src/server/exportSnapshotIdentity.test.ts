// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {LocalResumeStore} from './localFsApi';
import {ResumeDocumentSchema,resumeRevision} from '../schema/resumeSchema';
const roots:string[]=[];
const doc=(id:string,name:string)=>ResumeDocumentSchema.parse({id,title:'Synthetic '+name,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',basic:{name,title:'Role'},menuSections:[{id:'basic',title:'Basic',order:0}],globalSettings:{}});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-export-identity-'));roots.push(root);return new LocalResumeStore(root);}
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})});
describe('export history identity and frozen content',()=>{
  it('refuses to create export history for a missing or reused version slug',async()=>{
    const store=await fixture(),old=await store.saveResume('demo',doc('old-id','Original'));
    await store.deleteResume('demo',resumeRevision(old));
    await expect(store.createExportSnapshot('demo','export',old,false)).rejects.toMatchObject({code:'NOT_FOUND'});
    const trash=await store.listTrash();await store.purgeTrash(trash.items[0]!.id,trash.items[0]!.revision,'PERMANENT_DELETE');
    const fresh=await store.saveResume('demo',doc('new-id','Replacement'));
    for(const redacted of [false,true])await expect(store.createExportSnapshot('demo','export',old,redacted)).rejects.toMatchObject({code:'DOCUMENT_ID_CONFLICT'});
    expect(await store.listSnapshots('demo')).toEqual([]);expect(await store.getResume('demo')).toEqual(fresh);
  });
  it('stores exactly the frozen exported document for later edits of the same identity',async()=>{
    const store=await fixture(),old=await store.saveResume('demo',doc('same-id','Original'));
    const current=await store.saveResume('demo',{...old,basic:{...old.basic,name:'Later'}},{expectedRevision:resumeRevision(old)});
    const meta=await store.createExportSnapshot('demo','export',old,false);
    const archived=JSON.parse(await fs.readFile(path.join(store.backupsDir,'demo',meta.id+'.json'),'utf8'));
    expect(archived.document).toEqual(old);expect(await store.getResume('demo')).toEqual(current);
  });
  it('redacted export preserves current original without saving a redacted payload',async()=>{
    const store=await fixture(),original=await store.saveResume('demo',doc('same-id','Original'));
    const meta=await store.createExportSnapshot('demo','redacted',{...original,basic:{...original.basic,name:'Masked'}},true);
    const archived=JSON.parse(await fs.readFile(path.join(store.backupsDir,'demo',meta.id+'.json'),'utf8'));
    expect(archived.document).toEqual(original);expect(await store.getResume('demo')).toEqual(original);
  });
});