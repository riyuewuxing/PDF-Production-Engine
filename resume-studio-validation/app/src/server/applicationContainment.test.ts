// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LocalResumeStore} from './localFsApi';
import {JobApplicationSchema,JobReviewArchiveSchema} from '../schema/applicationSchema';
import {ResumeDocumentSchema,resumeRevision} from '../schema/resumeSchema';
import {jobReviewBasisHash,splitJobRequirements} from '../lib/jobRequirements';
const roots:string[]=[];const links:string[]=[];
const doc=()=>ResumeDocumentSchema.parse({id:'synthetic-application-doc',title:'Synthetic resume',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',basic:{name:'Synthetic Candidate'},menuSections:[{id:'basic',title:'Basic',order:0}],globalSettings:{}});
const entry=(overrides:Record<string,unknown>={})=>JobApplicationSchema.parse({id:randomUUID(),company:'Synthetic employer',resumeSlug:'healthy',updatedAt:'2026-01-01T00:00:00Z',...overrides});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-app-containment-'));roots.push(root);const store=new LocalResumeStore(path.join(root,'data'));await store.ensureDirs();const outside=path.join(root,'external-sentinel');await fs.mkdir(outside);return{store,outside};}
afterEach(async()=>{for(const link of links.splice(0)){if(!(await fs.lstat(link)).isSymbolicLink())throw Error('expected synthetic junction');if(process.platform==='win32')await fs.rmdir(link);else await fs.unlink(link);}for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
function code(result:PromiseSettledResult<unknown>){return result.status==='rejected'?(result.reason as {code?:string})?.code:'FULFILLED';}
describe('permanent application record containment',()=>{
  it('refuses to read or overwrite a hard-linked application ledger',async()=>{
    const {store,outside}=await fixture();const before=await store.getApplications();const external=path.join(outside,'ledger.json'),bytes=JSON.stringify(before);
    await fs.writeFile(external,bytes);await fs.link(external,store.applicationsPath);
    const result=await Promise.allSettled([store.getApplications(),store.saveApplications({...before,applications:[entry()]},before.revision),store.logApplication({entry:entry(),document:doc()})]);
    expect({codes:result.map(code),external:await fs.readFile(external,'utf8'),links:(await fs.stat(external)).nlink}).toEqual({codes:['UNSAFE_ENTRY','UNSAFE_ENTRY','UNSAFE_ENTRY'],external:bytes,links:2});
  });
  it('rejects reading, creating, logging and deleting permanent snapshots through a redirected directory',async()=>{
    const {store,outside}=await fixture();const original=doc(),id='external-archive',bytes=JSON.stringify({document:original,meta:{id,applicationId:'synthetic-old',resumeSlug:'healthy',createdAt:original.updatedAt,title:original.title,templateId:original.templateId,exportedFilePath:'',atsScore:null}});
    await fs.writeFile(path.join(outside,id+'.json'),bytes);await fs.symlink(outside,store.appSnapshotsDir,process.platform==='win32'?'junction':'dir');links.push(store.appSnapshotsDir);
    const read=await Promise.allSettled([store.getApplicationSnapshot(id)]);
    const writes=await Promise.allSettled([store.saveApplicationSnapshot({snapshotId:'new',resumeSlug:'healthy',document:original}),store.logApplication({entry:entry(),document:original}),store.deleteApplicationSnapshot(id)]);
    expect({read:read.map(code),writes:writes.map(code),outside:await fs.readdir(outside),ledger:(await store.getApplications()).applications}).toEqual({read:['UNSAFE_DIRECTORY'],writes:['UNSAFE_DIRECTORY','UNSAFE_DIRECTORY','UNSAFE_DIRECTORY'],outside:[id+'.json'],ledger:[]});
    expect(await fs.readFile(path.join(outside,id+'.json'),'utf8')).toBe(bytes);
  });
  it('refuses linked permanent snapshot reads and deletion without unlinking the record',async()=>{
    const {store,outside}=await fixture();const original=doc(),id='linked-archive';
    const meta=await store.saveApplicationSnapshot({snapshotId:id,resumeSlug:'healthy',document:original});
    const target=path.join(store.appSnapshotsDir,meta.id+'.json'),external=path.join(outside,'external.json');await fs.link(target,external);
    const before=await fs.readFile(external);
    const results=await Promise.allSettled([store.getApplicationSnapshot(id),store.deleteApplicationSnapshot(id)]);
    expect({codes:results.map(code),links:(await fs.stat(external)).nlink,files:await fs.readdir(store.appSnapshotsDir)}).toEqual({codes:['UNSAFE_ENTRY','UNSAFE_ENTRY'],links:2,files:[id+'.json']});
    expect(await fs.readFile(external)).toEqual(before);
  });
  it('protects permanent snapshot referenced with a .json suffix',async()=>{
    const {store}=await fixture();const original=doc(),app=entry(),id='suffix-protected';
    await store.saveApplicationSnapshot({snapshotId:id,applicationId:app.id,resumeSlug:'healthy',document:original});
    const base=await store.getApplications();
    await store.saveApplications({...base,applications:[{...app,snapshotId:id+'.json'}]},base.revision);
    const before=await fs.readFile(path.join(store.appSnapshotsDir,id+'.json'));
    await expect(store.deleteApplicationSnapshot(id)).rejects.toMatchObject({code:'SNAPSHOT_REFERENCED'});
    expect(await fs.readFile(path.join(store.appSnapshotsDir,id+'.json'))).toEqual(before);
  });
  it.skipIf(process.platform!=='win32')('protects case aliases of a referenced snapshot on Windows',async()=>{
    const {store}=await fixture();const logged=await store.logApplication({entry:entry(),document:doc()});
    const before=await fs.readFile(path.join(store.appSnapshotsDir,logged.entry.snapshotId+'.json'));
    await expect(store.deleteApplicationSnapshot(logged.entry.snapshotId.toUpperCase())).rejects.toMatchObject({code:'SNAPSHOT_REFERENCED'});
    expect(await fs.readFile(path.join(store.appSnapshotsDir,logged.entry.snapshotId+'.json'))).toEqual(before);
  });
  it('protects suffix aliases referenced only by an immutable job review archive',async()=>{
    const {store}=await fixture();const saved=await store.saveResume('healthy',doc()),source='必须具备合成经历。',app=entry({jdText:source}),id='review-protected';
    await store.saveApplicationSnapshot({snapshotId:id,applicationId:app.id,resumeSlug:'healthy',document:saved});
    const base=await store.getApplications(),suffix=id+'.json';
    const ledger=await store.saveApplications({...base,applications:[{...app,snapshotId:suffix}]},base.revision);
    const archive=JobReviewArchiveSchema.parse({reviewVersion:1,id:randomUUID(),slug:'healthy',docId:saved.id,documentRevision:resumeRevision(saved),factRevision:null,basisHash:await jobReviewBasisHash(saved,null,source),source,createdAt:'2026-01-01T00:00:00Z',applicationId:app.id,snapshotId:suffix,rows:[{clauseId:splitJobRequirements(source)[0]!.id,review:{priority:'mandatory',outcome:'gap',evidenceIds:[],note:'Synthetic gap'}}]});
    const reviewed=await store.saveApplications({...ledger,jobReviews:[archive]},ledger.revision);
    await store.saveApplications({...reviewed,applications:[]},reviewed.revision);
    await expect(store.deleteApplicationSnapshot(id)).rejects.toMatchObject({code:'SNAPSHOT_REFERENCED'});
    expect((await store.getApplicationSnapshot(id)).document.id).toBe(saved.id);
  });
  it('allows unreferenced ordinary snapshots to be deleted and keeps ordinary idempotent logging',async()=>{
    const {store}=await fixture();const input={entry:entry(),document:doc()};
    const logged=await store.logApplication(input);
    expect((await store.logApplication(input)).store.applications).toHaveLength(1);
    const orphan=await store.saveApplicationSnapshot({resumeSlug:'healthy',document:doc()});
    expect(await store.deleteApplicationSnapshot(orphan.id)).toEqual({deleted:true});
    expect(await store.deleteApplicationSnapshot(orphan.id)).toEqual({deleted:false});
    expect((await store.getApplicationSnapshot(logged.entry.snapshotId)).document.id).toBe(input.document.id);
  });
});
