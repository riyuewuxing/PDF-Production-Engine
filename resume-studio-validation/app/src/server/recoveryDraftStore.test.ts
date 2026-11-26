// @vitest-environment node
import {afterEach,describe,it,expect,vi} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {RecoveryDraftStore} from './recoveryDraftStore';
import {LocalResumeStore} from './localFsApi';
import {ResumeDocumentSchema,resumeRevision} from '../schema/resumeSchema';
import {DRAFT_DIR} from '../schema/recoveryDraftSchema';
const roots:string[]=[];
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-draft-'));roots.push(root);
  const store=new LocalResumeStore(path.join(root,'data'));
  const doc=await store.saveResume('master',ResumeDocumentSchema.parse({id:'synthetic-doc',title:'Original',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',basic:{name:'Demo',title:'Teacher'},menuSections:[{id:'basic',title:'Basic',order:0}],globalSettings:{}}));
  const journal=new RecoveryDraftStore(root,store);
  const checkpoint=(title:string)=>journal.checkpoint({kind:'resume',slug:'master',baseRevision:resumeRevision(doc),data:{...doc,title}});
  return {root,store,doc,journal,checkpoint,restart:()=>new RecoveryDraftStore(root,store,()=>false)};
}
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
describe('durable recovery journal',()=>{
  it('keeps latest checkpoint independent of official data; old cleanup cannot delete newer edits',async()=>{
    const {store,checkpoint,journal,restart,doc}=await fixture();
    const a=await checkpoint('First'),b=await checkpoint('Latest');
    expect(a.id).toBe(b.id);expect(a.token).not.toBe(b.token);
    expect(await journal.clear(a,'SAVED_OR_DISCARDED')).toBe(false);
    expect(await store.getResume('master')).toEqual(doc);
    const next=restart(),rows=await next.list();
    expect(rows.drafts).toHaveLength(1);expect(rows.drafts[0]?.state).toBe('same-base');
    expect((await next.get(b.id,b.token)).input.data).toMatchObject({title:'Latest'});
    await expect(next.get(a.id,a.token)).rejects.toThrow();
    expect(await next.clear(b,'SAVED_OR_DISCARDED')).toBe(false);
    expect(await next.clear(b,'DISCARD_RECOVERY')).toBe(true);
    expect((await next.list()).drafts).toHaveLength(0);
  });
  it('distinguishes changed originals and already-saved content without modifying or clearing it',async()=>{
    const {store,doc,checkpoint,restart}=await fixture();
    const receipt=await checkpoint('Unsaved');
    await store.saveResume('master',{...doc,title:'External'});
    expect((await restart().list()).drafts[0]?.state).toBe('changed');
    const current=await store.getResume('master');
    await store.saveResume('master',{...current,title:'Unsaved'});
    const next=restart();expect((await next.list()).drafts[0]?.state).toBe('already-saved');
    expect((await next.get(receipt.id,receipt.token)).input.data).toMatchObject({title:'Unsaved'});
  });
  it('does not expose or delete another still-running process draft',async()=>{
    const {root,store,checkpoint}=await fixture();const receipt=await checkpoint('Live');
    const another=new RecoveryDraftStore(root,store,()=>true);
    expect((await another.list()).drafts[0]?.state).toBe('active');
    await expect(another.get(receipt.id,receipt.token)).rejects.toThrow();
    expect(await another.clear(receipt,'DISCARD_RECOVERY')).toBe(false);
  });
  it('preserves old checkpoint on injected write error and reports corrupt files without deleting them',async()=>{
    const {root,checkpoint,restart}=await fixture();const receipt=await checkpoint('First');
    const rename=vi.spyOn(fs,'rename').mockRejectedValueOnce(Object.assign(Error('injected disk failure'),{code:'ENOSPC'}));
    await expect(checkpoint('Second')).rejects.toThrow('injected');rename.mockRestore();
    const next=restart();expect((await next.get(receipt.id,receipt.token)).input.data).toMatchObject({title:'First'});
    const corrupt=path.join(root,DRAFT_DIR,'corrupt.json');await fs.writeFile(corrupt,'not json');
    expect((await next.list()).unreadable).toBe(1);expect(await fs.readFile(corrupt,'utf8')).toBe('not json');
  });
  it('isolates workspaces and classifies ledger revision conflicts',async()=>{
    const {root,store,journal,restart}=await fixture(),other=await fixture();
    const base=await store.getApplications();
    const receipt=await journal.checkpoint({kind:'ledger',baseRevision:base.revision!,data:{...base,interviewAnswers:{q:'draft'}}});
    expect((await other.restart().list()).drafts).toHaveLength(0);
    expect((await restart().list()).drafts[0]?.state).toBe('same-base');
    await store.saveApplications({...base,interviewAnswers:{q:'external'}},base.revision);
    expect((await restart().list()).drafts[0]?.state).toBe('changed');
    expect((await restart().get(receipt.id,receipt.token)).input.data).toMatchObject({interviewAnswers:{q:'draft'}});
    expect(await fs.readdir(path.join(root,DRAFT_DIR))).toHaveLength(1);
  });
  it('rejects bad identities and traversal without creating a journal',async()=>{
    const {root,doc,journal}=await fixture();
    await expect(journal.checkpoint({kind:'resume',slug:'../escape',baseRevision:resumeRevision(doc),data:doc})).rejects.toThrow();
    await expect(journal.checkpoint({kind:'resume',slug:'master',baseRevision:'["other","revision"]',data:doc})).rejects.toThrow();
    await expect(fs.access(path.join(root,DRAFT_DIR))).rejects.toThrow();
  });
});
