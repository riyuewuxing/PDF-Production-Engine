// @vitest-environment node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach,describe,expect,it } from 'vitest';
import { LocalResumeStore } from './localFsApi';
import { ResumeDocumentSchema,resumeRevision } from '../schema/resumeSchema';

const dirs:string[]=[];
async function fixture(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'resume-trash-'));
  dirs.push(dir);
  const store=new LocalResumeStore(dir);
  const doc=await store.saveResume('demo',ResumeDocumentSchema.parse({
    id:'synthetic-trash-doc',title:'合成归档简历',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',
    basic:{name:'虚构甲',title:'示例教师'},menuSections:[{id:'basic',title:'基本资料',order:0}],globalSettings:{}
  }));
  return {dir,store,doc};
}
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>fs.rm(dir,{recursive:true,force:true})));});
describe('recoverable version deletion',()=>{
  it('archives exact bytes, reserves slug, preserves history and rejects stale writes after restoration',async()=>{
    const {store,doc}=await fixture();
    const original=await fs.readFile(store.resolveResumePath('demo').filePath);
    const history=await store.createSnapshot('demo','before archive');
    const permanent=await store.saveApplicationSnapshot({applicationId:'demo-app',resumeSlug:'demo',document:doc});
    const removed=await store.deleteResume('demo',resumeRevision(doc));
    expect(removed.deleted).toBe(true);
    expect(await fs.readFile(path.join(store.trashDir,removed.trashId+'.json'))).toEqual(original);
    expect((await store.listResumes()).resumes).toEqual([]);
    const list=await store.listTrash();
    expect(list.unreadableCount).toBe(0);
    expect(list.items[0]).toMatchObject({slug:'demo',title:doc.title,revision:resumeRevision(doc)});
    await expect(store.createResume({slug:'DEMO',document:doc})).rejects.toMatchObject({code:'SLUG_RESERVED'});
    await expect(store.saveResume('demo',doc,{expectedRevision:null})).rejects.toMatchObject({code:'SLUG_RESERVED'});
    await expect(store.restoreSnapshot('demo',history.id)).rejects.toMatchObject({code:'NOT_FOUND'});
    const restored=await store.restoreTrash(removed.trashId,resumeRevision(doc));
    expect(restored.slug).toBe('demo');
    expect(restored.document.id).toBe(doc.id);
    expect(restored.document.basic).toEqual(doc.basic);
    expect(resumeRevision(restored.document)).not.toBe(resumeRevision(doc));
    await expect(store.saveResume('demo',doc,{requireExisting:true})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    expect((await store.listTrash()).items).toEqual([]);
    expect((await store.listSnapshots('demo')).map(s=>s.id)).toContain(history.id);
    expect((await store.getApplicationSnapshot(permanent.id)).document.id).toBe(doc.id);
  });
  it('never overwrites occupied original slug and copies explicitly without losing the archive',async()=>{
    const {store,doc}=await fixture();
    const removed=await store.deleteResume('demo',resumeRevision(doc));
    // Simulate an external legacy program creating a conflicting file outside the guarded service.
    const other={...doc,id:'other-identity',title:'Existing version'};
    await fs.writeFile(store.resolveResumePath('demo').filePath,JSON.stringify(other));
    await expect(store.restoreTrash(removed.trashId,resumeRevision(doc))).rejects.toMatchObject({code:'RESTORE_CONFLICT'});
    const copy=await store.restoreTrash(removed.trashId,resumeRevision(doc),true);
    expect(copy.slug).not.toBe('demo');
    expect(copy.document.id).not.toBe(doc.id);
    expect((await store.getResume('demo')).title).toBe('Existing version');
    expect((await store.listTrash()).items).toHaveLength(1);
  });
  it('rejects stale purge, missing confirmation and traversal, and does not delete associated assets/history',async()=>{
    const {store,doc}=await fixture();
    const snap=await store.createSnapshot('demo','history');
    const permanent=await store.saveApplicationSnapshot({applicationId:'demo-app',resumeSlug:'demo',document:doc});
    const removed=await store.deleteResume('demo',resumeRevision(doc));
    await expect(store.purgeTrash(removed.trashId,resumeRevision(doc),'')).rejects.toMatchObject({code:'CONFIRMATION_REQUIRED'});
    await expect(store.purgeTrash(removed.trashId,'stale','PERMANENT_DELETE')).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    await expect(store.restoreTrash('../escape',resumeRevision(doc))).rejects.toMatchObject({code:'INVALID_TRASH_ID'});
    expect((await store.listTrash()).items).toHaveLength(1);
    await store.purgeTrash(removed.trashId,resumeRevision(doc),'PERMANENT_DELETE');
    expect((await store.listTrash()).items).toEqual([]);
    expect((await store.listSnapshots('demo')).map(s=>s.id)).toContain(snap.id);
    expect((await store.getApplicationSnapshot(permanent.id)).document.id).toBe(doc.id);
  });
  it('shows corrupt archive count and leaves the corrupt file untouched',async()=>{
    const {store,doc}=await fixture();
    const removed=await store.deleteResume('demo',resumeRevision(doc));
    const target=path.join(store.trashDir,removed.trashId+'.json');
    await fs.writeFile(target,'invalid synthetic JSON');
    expect(await store.listTrash()).toEqual({items:[],unreadableCount:1});
    await expect(store.restoreTrash(removed.trashId,resumeRevision(doc))).rejects.toThrow();
    expect(await fs.readFile(target,'utf8')).toBe('invalid synthetic JSON');
  });
  it('retains master protection and rejects another document identity in a reused snapshot slug',async()=>{
    const {store,doc}=await fixture();
    await store.saveResume('master',{...doc,id:'synthetic-master'});
    await expect(store.deleteResume('master')).rejects.toMatchObject({code:'MASTER_PROTECTED'});
    const snap=await store.createSnapshot('demo','old identity');
    const removed=await store.deleteResume('demo',resumeRevision(doc));
    await store.purgeTrash(removed.trashId,resumeRevision(doc),'PERMANENT_DELETE');
    const fresh=await store.saveResume('demo',{...doc,id:'new-identity'});
    await expect(store.restoreSnapshot('demo',snap.id,resumeRevision(fresh))).rejects.toMatchObject({code:'DOCUMENT_ID_CONFLICT'});
    expect((await store.getResume('demo')).id).toBe('new-identity');
  });
});
