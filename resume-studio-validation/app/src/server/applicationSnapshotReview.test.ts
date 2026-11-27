// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {LocalResumeStore,createLocalFsMiddleware} from './localFsApi';
import {JobApplicationSchema,type ApplicationSnapshotLink} from '../schema/applicationSchema';
import {comparisonFixture} from '../lib/comparisonSyntheticFixture';
const roots:string[]=[];
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-application-review-'));roots.push(root);
  const store=new LocalResumeStore(path.join(root,'data'));
  const doc=await store.saveResume('synthetic',comparisonFixture());
  const entry=JobApplicationSchema.parse({id:randomUUID(),company:'合成学校',role:'物理教师',resumeSlug:'synthetic',exportedFilePath:'C:/synthetic/export.pdf',atsScore:67,updatedAt:'2026-01-01T00:00:00Z'});
  const logged=await store.logApplication({entry,document:doc});
  const link:ApplicationSnapshotLink={applicationId:entry.id,snapshotId:logged.entry.snapshotId,ledgerRevision:logged.store.revision!};
  const file=store.resolveResumePath('synthetic').filePath,archive=path.join(store.appSnapshotsDir,link.snapshotId+'.json');
  const getRecord=async()=>JSON.parse(await fs.readFile(archive,'utf8'));
  const bytes=async()=>Object.fromEntries(await Promise.all([store.applicationsPath,file,archive].map(async f=>[f,createHash('sha256').update(await fs.readFile(f)).digest('hex')])));
  return {root,store,doc,entry:logged.entry,link,file,archive,getRecord,bytes,logged};
}
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
describe('ledger-bound permanent snapshot review',()=>{
  it('reads a unique acknowledged association and leaves ledger, resume, archive and file count unchanged',async()=>{
    const {store,doc,link,entry,bytes}=await fixture();const before=await bytes(),names=await fs.readdir(store.appSnapshotsDir);
    const rec=await store.getLinkedApplicationSnapshot(link);
    expect(rec.document).toEqual(doc);expect(rec.meta).toMatchObject({id:link.snapshotId,applicationId:entry.id,resumeSlug:entry.resumeSlug,exportedFilePath:entry.exportedFilePath,atsScore:67});
    expect(await bytes()).toEqual(before);expect(await fs.readdir(store.appSnapshotsDir)).toEqual(names);
    // A PDF is not required to exist; this method does not access or verify it.
    expect(rec.meta.exportedFilePath).toBe('C:/synthetic/export.pdf');
  });
  it('works after removal of the editable version without restoring or creating it',async()=>{
    const {store,doc,link,file,archive}=await fixture();await fs.rm(file);const original=await fs.readFile(archive);
    expect((await store.getLinkedApplicationSnapshot(link)).document).toEqual(doc);
    await expect(fs.stat(file)).rejects.toMatchObject({code:'ENOENT'});expect(await fs.readFile(archive)).toEqual(original);
  });
  it('refuses stale acknowledged ledger revision, missing app, and caller-chosen alias before raw read',async()=>{
    const {store,entry,link,logged}=await fixture();const spy=vi.spyOn(store,'getApplicationSnapshot');
    for(const bad of [{...link,applicationId:randomUUID()},{...link,snapshotId:link.snapshotId+'.json'},{...link,snapshotId:'other-archive'},{...link,ledgerRevision:'0'.repeat(64)}]){
      await expect(store.getLinkedApplicationSnapshot(bad)).rejects.toBeTruthy();
    }
    const changed=await store.saveApplications({...logged.store,applications:[{...entry,status:'interview'}]},link.ledgerRevision);
    expect(changed.revision).not.toBe(link.ledgerRevision);
    await expect(store.getLinkedApplicationSnapshot(link)).rejects.toMatchObject({code:'APPLICATION_CONFLICT'});
    expect(spy).not.toHaveBeenCalled();
  });
  it('supports an already persisted legacy .json suffix only after canonical metadata linkage',async()=>{
    const {store,doc}=await fixture();
    const old=JobApplicationSchema.parse({id:'legacy-synthetic',company:'Legacy synthetic',resumeSlug:'synthetic',exportedFilePath:'',atsScore:null});
    const meta=await store.saveApplicationSnapshot({snapshotId:'legacy-archive',applicationId:old.id,resumeSlug:'synthetic',document:doc});
    const base=await store.getApplications();
    const persisted=await store.saveApplications({...base,applications:[...base.applications,{...old,snapshotId:meta.id+'.json'}]},base.revision);
    const link={applicationId:old.id,snapshotId:meta.id+'.json',ledgerRevision:persisted.revision!};
    expect((await store.getLinkedApplicationSnapshot(link)).meta.id).toBe(meta.id);
    await expect(store.getLinkedApplicationSnapshot({...link,snapshotId:meta.id})).rejects.toMatchObject({code:'APPLICATION_SNAPSHOT_LINK'});
  });
  it('rejects invalid input shapes and noncanonical path/padding without creating workspace directories',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-review-no-write-'));roots.push(root);const store=new LocalResumeStore(path.join(root,'data'));
    const link={applicationId:'legacy',snapshotId:'synthetic',ledgerRevision:'0'.repeat(64)};
    for(const bad of [null,[],{}, {...link,applicationId:''},{...link,applicationId:'a'.repeat(201)},{...link,ledgerRevision:'wrong'},{...link,snapshotId:'../outside'},{...link,snapshotId:' synthetic'},{...link,snapshotId:'synthetic '},{...link,snapshotId:123}]){
      await expect(store.getLinkedApplicationSnapshot(bad as unknown as ApplicationSnapshotLink)).rejects.toBeTruthy();
    }
    await expect(store.getLinkedApplicationSnapshot(link)).rejects.toMatchObject({code:'APPLICATION_CONFLICT'});expect(await fs.readdir(root)).toEqual([]);
  });
  it('rejects forged identity, path, score, metadata and missing metadata, preserving archive bytes',async()=>{
    const {store,link,archive,getRecord}=await fixture();const source=await getRecord();
    for(const meta of [
      {...source.meta,id:'another'},{...source.meta,applicationId:'other'},{...source.meta,resumeSlug:'other'},
      {...source.meta,exportedFilePath:'C:/other/private.pdf'},{...source.meta,atsScore:44},{...source.meta,title:'wrong'},
      {...source.meta,templateId:'minimal-ats'},{...source.meta,createdAt:'not-a-time'},undefined
    ]){
      // Choose a template distinct from source for the template test.
      const m=meta&&meta.templateId==='minimal-ats'&&source.meta.templateId==='minimal-ats'&&Object.keys(meta).length===Object.keys(source.meta).length&&JSON.stringify(meta)===JSON.stringify(source.meta)?{...meta,templateId:'teacher-table-classic'}:meta;
      const raw=JSON.stringify({...source,meta:m});await fs.writeFile(archive,raw);
      await expect(store.getLinkedApplicationSnapshot(link)).rejects.toMatchObject({code:'APPLICATION_SNAPSHOT_LINK'});
      expect(await fs.readFile(archive,'utf8')).toBe(raw);
    }
  });
  it('rejects damaged JSON/schema without returning the private contents or repairing the original',async()=>{
    const {store,link,archive,getRecord}=await fixture();const src=await getRecord();
    for(const raw of ['{BROKEN_PRIVATE_CONTENT_39',JSON.stringify({...src,document:{id:'INVALID_PRIVATE_CONTENT_39'}})]){
      await fs.writeFile(archive,raw);
      await expect(store.getLinkedApplicationSnapshot(link)).rejects.toMatchObject({code:'APPLICATION_SNAPSHOT_INVALID'});
      expect(await fs.readFile(archive,'utf8')).toBe(raw);
    }
  });
  it('refuses a hard-linked archive and a missing archive without writing a replacement',async()=>{
    const {store,link,archive,root}=await fixture();const outside=path.join(root,'other.json');
    const bytes=await fs.readFile(archive);await fs.link(archive,outside);
    await expect(store.getLinkedApplicationSnapshot(link)).rejects.toMatchObject({code:'UNSAFE_ENTRY'});
    expect(await fs.readFile(outside)).toEqual(bytes);await fs.rm(outside);await fs.rm(archive);
    await expect(store.getLinkedApplicationSnapshot(link)).rejects.toMatchObject({code:'SNAPSHOT_NOT_FOUND'});
    await expect(fs.stat(archive)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('refuses a duplicate persisted application ID and any association changed during the read',async()=>{
    const {store,link,entry,logged}=await fixture();
    const real=store.getApplications.bind(store),spy=vi.spyOn(store,'getApplications');
    const data=await real(false);
    spy.mockResolvedValueOnce({...data,applications:[entry,entry]});
    await expect(store.getLinkedApplicationSnapshot(link)).rejects.toMatchObject({code:'APPLICATION_SNAPSHOT_LINK'});
    spy.mockResolvedValueOnce(data).mockResolvedValueOnce({...logged.store,revision:'1'.repeat(64)});
    await expect(store.getLinkedApplicationSnapshot(link)).rejects.toMatchObject({code:'APPLICATION_CONFLICT'});
  });
  it('restricts linked and legacy HTTP snapshot reads to local same-origin GET with no-store',async()=>{
    const {store,link,doc,bytes}=await fixture();const before=await bytes(),middleware=createLocalFsMiddleware(store);
    const server=http.createServer((req,res)=>void middleware(req,res,()=>{res.statusCode=404;res.end();}));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const addr=server.address();if(!addr||typeof addr==='string')throw Error('no port');const base='http://127.0.0.1:'+addr.port;
      const query=new URLSearchParams(link as unknown as Record<string,string>),url=base+'/api/application-snapshot-review?'+query.toString(),legacy=base+'/api/application-snapshots/'+link.snapshotId;
      for(const endpoint of [url,legacy]){
        const good=await fetch(endpoint,{headers:{Origin:base,'Sec-Fetch-Site':'same-origin'}});
        expect(good.status).toBe(200);expect(good.headers.get('cache-control')).toBe('no-store');expect(good.headers.get('cross-origin-resource-policy')).toBe('same-origin');expect((await good.json()).document).toEqual(doc);
        const denied=await fetch(endpoint,{headers:{Origin:'https://example.invalid','Sec-Fetch-Site':'cross-site'}});
        expect(denied.status).toBe(403);expect(await denied.text()).not.toContain(doc.basic.email);
      }
      expect((await fetch(url+'&snapshotId='+link.snapshotId)).status).toBe(400);
      expect((await fetch(url+'&unknown=x')).status).toBe(400);
      expect((await fetch(url,{method:'POST'})).status).toBe(405);
      expect((await fetch(url,{method:'DELETE'})).status).toBe(405);
      const badHost=await new Promise<number>((resolve,reject)=>{const r=http.get(url,{headers:{Host:'example.invalid'}},res=>{res.resume();resolve(res.statusCode??0)});r.on('error',reject);});expect(badHost).toBe(403);
      expect(await bytes()).toEqual(before);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
