// @vitest-environment node
import {promises as fs} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {LocalResumeStore,inspectResumeWriteLock,recoverResumeWriteLock,withResumeWriteLock} from './localFsApi';
import {JobApplicationSchema,JobReviewArchiveSchema} from '../schema/applicationSchema';
import {ResumeDocumentSchema,resumeRevision} from '../schema/resumeSchema';
import {jobReviewBasisHash,splitJobRequirements} from '../lib/jobRequirements';
const dirs:string[]=[];
async function fixture(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'resume-lock-ledger-'));dirs.push(dir);
  return {dir,store:new LocalResumeStore(dir)};
}
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(dirs.splice(0).map(dir=>fs.rm(dir,{recursive:true,force:true})));});
const app=(overrides:Record<string,unknown>={})=>JobApplicationSchema.parse({id:randomUUID(),company:'虚构单位',resumeSlug:'demo',updatedAt:'2026-11-26T00:00:00Z',...overrides});
const doc=()=>ResumeDocumentSchema.parse({id:'synthetic-doc',title:'合成简历',createdAt:'2026-01-01',updatedAt:'2026-01-01',basic:{name:'演示候选人'},menuSections:[{id:'basic',title:'Basic',order:0}],globalSettings:{}});
describe('explicit safe write lock recovery',()=>{
  it('does not steal a living process lock, including old timestamps',async()=>{
    const {dir}=await fixture();
    await withResumeWriteLock(dir,async()=>{
      const status=await inspectResumeWriteLock(dir);
      expect(status.state).toBe('active');
      expect(status.pid).toBe(process.pid);
      await expect(recoverResumeWriteLock(dir,status.token!,'RECOVER_DEAD_LOCK')).rejects.toMatchObject({code:'LOCK_RECOVERY_UNSAFE'});
    });
    expect((await inspectResumeWriteLock(dir)).state).toBe('unlocked');
  });
  it('recovers a lock left by a real terminated child, with token and serialized recovery',async()=>{
    const {dir,store}=await fixture();
    const worker=path.join(process.cwd(),'src/server/lockCrashWorker.ts');
    const child=spawn(process.execPath,['--import','tsx',worker,dir],{stdio:['ignore','pipe','pipe']});
    const exited=new Promise<number|null>((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(new Error('lock worker watchdog exceeded'));},12000);
      child.once('error',err=>{clearTimeout(timer);reject(err);});
      child.once('close',code=>{clearTimeout(timer);resolve(code);});
    });
    expect(await exited).toBe(7);
    const status=await inspectResumeWriteLock(dir);
    expect(status.state).toBe('recoverable');
    await expect(recoverResumeWriteLock(dir,'wrong','RECOVER_DEAD_LOCK')).rejects.toMatchObject({code:'LOCK_RECOVERY_UNSAFE'});
    await expect(recoverResumeWriteLock(dir,status.token!,'')).rejects.toMatchObject({code:'CONFIRMATION_REQUIRED'});
    const results=await Promise.allSettled([recoverResumeWriteLock(dir,status.token!,'RECOVER_DEAD_LOCK'),recoverResumeWriteLock(dir,status.token!,'RECOVER_DEAD_LOCK')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await inspectResumeWriteLock(dir)).state).toBe('unlocked');
    expect(await fs.readdir(path.join(dir,'.lock-recovery-history'))).toHaveLength(1);
    const base=await store.getApplications();
    expect((await store.saveApplications({...base,applications:[app()]},base.revision)).applications).toHaveLength(1);
  },18000);
  it('fails closed for missing, legacy, malformed and remote host owner records',async()=>{
    const {dir}=await fixture();
    const lock=path.join(dir,'.resume-write-lock');await fs.mkdir(lock);
    for(const raw of [null,{pid:process.pid,acquiredAt:'2026-01-01'},{version:1,pid:12345,hostname:'other.invalid',platform:process.platform,token:randomUUID(),acquiredAt:'2026-01-01'}]){
      if(raw)await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify(raw));
      const status=await inspectResumeWriteLock(dir);
      expect(status.state).toBe('unknown');
      await expect(recoverResumeWriteLock(dir,status.token??'unknown','RECOVER_DEAD_LOCK')).rejects.toMatchObject({code:'LOCK_RECOVERY_UNSAFE'});
      expect((await fs.stat(lock)).isDirectory()).toBe(true);
    }
  });
});
describe('application ledger CAS and immutable snapshots',()=>{
  it('reads legacy data without migrating until save and refuses stale or missing revision',async()=>{
    const {dir,store}=await fixture();
    const legacy={schemaVersion:1,applications:[],coverLetters:[],interviewAnswers:{}};
    await fs.writeFile(path.join(dir,'applications.json'),JSON.stringify(legacy));
    const a=await store.getApplications(),b=await new LocalResumeStore(dir).getApplications();
    expect(a.revision).toBe(b.revision);
    expect(await fs.readFile(path.join(dir,'applications.json'),'utf8')).toBe(JSON.stringify(legacy));
    await expect(store.saveApplications(a)).rejects.toMatchObject({code:'APPLICATION_REVISION_REQUIRED'});
    const results=await Promise.allSettled([store.saveApplications({...a,applications:[app({company:'甲'})]},a.revision),new LocalResumeStore(dir).saveApplications({...b,applications:[app({company:'乙'})]},b.revision)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'APPLICATION_CONFLICT'}});
    expect((await store.getApplications()).applications).toHaveLength(1);
  });
  it('logs two distinct requests without overwriting, then replays one idempotently',async()=>{
    const {dir,store}=await fixture();
    const first={entry:app({company:'甲'}),document:doc()},second={entry:app({company:'乙'}),document:doc()};
    const [a,b]=await Promise.all([store.logApplication(first),new LocalResumeStore(dir).logApplication(second)]);
    const replay=await store.logApplication(first);
    expect(replay.entry.id).toBe(a.entry.id);
    expect(replay.store.applications.map(x=>x.id).sort()).toEqual([a.entry.id,b.entry.id].sort());
    expect(await fs.readdir(store.appSnapshotsDir)).toHaveLength(2);
    await expect(store.logApplication({...first,document:{...first.document,title:'changed'}})).rejects.toMatchObject({code:'APPLICATION_EXISTS'});
    await expect(store.saveApplicationSnapshot({snapshotId:a.entry.snapshotId,applicationId:a.entry.id,resumeSlug:'demo',document:doc()})).rejects.toMatchObject({code:'SNAPSHOT_EXISTS'});
    await expect(store.deleteApplicationSnapshot(a.entry.snapshotId)).rejects.toMatchObject({code:'SNAPSHOT_REFERENCED'});
    const current=await store.getApplications();
    await expect(store.saveApplications({...current,applications:current.applications.map(x=>x.id===a.entry.id?{...x,snapshotId:''}:x)},current.revision)).rejects.toMatchObject({code:'SNAPSHOT_LINK_PROTECTED'});
    await store.saveApplications({...current,applications:current.applications.filter(x=>x.id!==a.entry.id)},current.revision);
    expect((await store.getApplicationSnapshot(a.entry.snapshotId)).document.id).toBe(first.document.id);
  });
  it('retains snapshot on ledger write failure and safely retries the exact request',async()=>{
    const {store}=await fixture();
    const input={entry:app(),document:doc()};
    const rename=fs.rename.bind(fs);
    const spy=vi.spyOn(fs,'rename').mockImplementation(async(from,to)=>{
      if(String(to)===store.applicationsPath)throw Object.assign(new Error('injected disk failure'),{code:'ENOSPC'});
      return rename(from,to);
    });
    await expect(store.logApplication(input)).rejects.toThrow('injected disk failure');
    expect((await store.getApplications()).applications).toEqual([]);
    expect(await fs.readdir(store.appSnapshotsDir)).toHaveLength(1);
    spy.mockRestore();
    const saved=await store.logApplication(input);
    expect(saved.store.applications).toHaveLength(1);
    expect(await fs.readdir(store.appSnapshotsDir)).toHaveLength(1);
  });
  it('refuses to overwrite malformed existing ledger',async()=>{
    const {store}=await fixture();
    const base=await store.getApplications();
    await fs.writeFile(store.applicationsPath,'malformed');
    await expect(store.saveApplications(base,base.revision)).rejects.toMatchObject({code:'CORRUPTED_JSON'});
    expect(await fs.readFile(store.applicationsPath,'utf8')).toBe('malformed');
  });
});

it('persists immutable job reviews with CAS and verified application snapshot linkage',async()=>{
  const {store,dir}=await fixture();
  const savedDoc=await store.saveResume('master',doc());
  const source='必须具备合成经历。';
  const logged=await store.logApplication({entry:app({resumeSlug:'master',jdText:source}),document:savedDoc});
  const archive=JobReviewArchiveSchema.parse({reviewVersion:1,id:randomUUID(),slug:'master',docId:savedDoc.id,documentRevision:resumeRevision(savedDoc),factRevision:null,basisHash:await jobReviewBasisHash(savedDoc,null,source),source,createdAt:'2026-11-26T00:00:00Z',applicationId:logged.entry.id,snapshotId:logged.entry.snapshotId,rows:[{clauseId:splitJobRequirements(source)[0]!.id,review:{priority:'mandatory',outcome:'gap',evidenceIds:[],note:'合成缺口'}}]});
  const base=logged.store;
  await expect(store.saveApplications({...base,applications:base.applications.map(a=>({...a,jdText:'改写已封存岗位'}))},base.revision)).rejects.toMatchObject({code:'SNAPSHOT_LINK_PROTECTED'});
  await expect(store.saveApplications({...base,jobReviews:[{...archive,documentRevision:'stale'}]},base.revision)).rejects.toMatchObject({code:'JOB_REVIEW_STALE'});
  await expect(store.saveApplications({...base,jobReviews:[{...archive,source:'不同招聘条件。',basisHash:await jobReviewBasisHash(savedDoc,null,'不同招聘条件。'),rows:[{...archive.rows[0]!,clauseId:splitJobRequirements('不同招聘条件。')[0]!.id}]}]},base.revision)).rejects.toMatchObject({code:'JOB_REVIEW_LINK'});
  const saved=await store.saveApplications({...base,jobReviews:[archive]},base.revision);
  expect(saved.revision).not.toBe(base.revision);
  expect((await new LocalResumeStore(dir).getApplications()).jobReviews).toEqual([archive]);
  await expect(store.saveApplications({...base,jobReviews:[]},base.revision)).rejects.toMatchObject({code:'APPLICATION_CONFLICT'});
  await expect(store.saveApplications({...saved,jobReviews:[{...archive,createdAt:'2026-11-27T00:00:00Z'}]},saved.revision)).rejects.toMatchObject({code:'JOB_REVIEW_IMMUTABLE'});
  const {jobReviews:_omitted,...legacy}=saved;
  const preserved=await store.saveApplications({...legacy,applications:[]},saved.revision);
  expect(preserved.jobReviews).toEqual([archive]);
  await expect(store.deleteApplicationSnapshot(logged.entry.snapshotId)).rejects.toMatchObject({code:'SNAPSHOT_REFERENCED'});
  const removed=await store.saveApplications({...preserved,jobReviews:[]},preserved.revision);
  expect(removed.jobReviews).toEqual([]);
  expect(await store.deleteApplicationSnapshot(logged.entry.snapshotId)).toEqual({deleted:true});
});

import {createWorkspaceBackup,inspectWorkspaceBackup,restoreWorkspaceBackup} from './workspaceBackup';
import {BACKUP_MANIFEST,managedBackupPath,WorkspaceBackupManifestSchema} from '../schema/workspaceBackupSchema';
import {createHash} from 'node:crypto';
async function backupFixture(){
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'resume-workspace-backup-'));dirs.push(parent);
  const root=path.join(parent,'live'),data=path.join(root,'data'),dest=path.join(parent,'copies');
  await fs.mkdir(dest,{recursive:true});
  const store=new LocalResumeStore(data);
  await store.saveResume('master',doc());
  await store.saveResume('sample',doc());
  await store.createSnapshot('sample','合成备份');
  await fs.writeFile(path.join(data,'.ai-settings.json'),'SYNTHETIC_SECRET_NEVER_COPY');
  await fs.mkdir(path.join(root,'exports'));await fs.writeFile(path.join(root,'exports','demo.pdf'),'not included');
  const signal=new AbortController().signal;
  return {parent,root,data,dest,store,signal};
}
describe('portable workspace backup',()=>{
  it('copies exact managed bytes, excludes credentials, and restores to a separate workspace',async()=>{
    const f=await backupFixture();
    const saved=await f.store.logApplication({entry:app({resumeSlug:'master',jdText:'合成招聘条件'}),document:await f.store.getResume('master')});
    const expectedDoc=await f.store.getResume('master');
    const backup=await createWorkspaceBackup(f.root,f.dest,f.signal);
    const inspection=await inspectWorkspaceBackup(backup.folder,f.signal);
    expect(inspection.manifestHash).toBe(createHash('sha256').update(await fs.readFile(path.join(backup.folder,BACKUP_MANIFEST))).digest('hex'));
    expect(inspection.summary).toMatchObject({fileCount:backup.fileCount,warnings:[]});
    expect(inspection.manifest.files.map(x=>x.path)).toContain('applications.json');
    expect(inspection.manifest.files.some(x=>x.path.startsWith('.application-snapshots/'))).toBe(true);
    expect(inspection.manifest.files.some(x=>x.path.startsWith('.backups/'))).toBe(true);
    await expect(fs.access(path.join(backup.folder,'data','.ai-settings.json'))).rejects.toMatchObject({code:'ENOENT'});
    const restored=await restoreWorkspaceBackup(f.root,backup.folder,inspection.manifestHash,f.dest,f.signal);
    const newStore=new LocalResumeStore(path.join(restored.folder,'data'));
    expect(restored.folder).not.toBe(f.root);
    expect(await newStore.getResume('master')).toEqual(expectedDoc);
    expect(await newStore.getApplications()).toEqual(saved.store);
    expect(await newStore.getApplicationSnapshot(saved.entry.snapshotId)).toEqual(await f.store.getApplicationSnapshot(saved.entry.snapshotId));
    expect(await f.store.getResume('master')).toEqual(expectedDoc);
    for(const row of inspection.manifest.files){
      const bytes=await fs.readFile(path.join(restored.folder,'data',...row.path.split('/')));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
    }
  });
  it('rejects tampering, unsafe paths, unexpected files, and destinations inside the original workspace',async()=>{
    const f=await backupFixture(),backup=await createWorkspaceBackup(f.root,f.dest,f.signal);
    const checked=await inspectWorkspaceBackup(backup.folder,f.signal);
    const original=await fs.readFile(path.join(f.data,'master.json'));
    await expect(restoreWorkspaceBackup(f.root,backup.folder,checked.manifestHash,f.data,f.signal)).rejects.toThrow('之外');
    await expect(restoreWorkspaceBackup(f.root,backup.folder,checked.manifestHash,backup.folder,f.signal)).rejects.toThrow('之外');
    await expect(restoreWorkspaceBackup(f.root,backup.folder,'f'.repeat(64),f.dest,f.signal)).rejects.toThrow('清单已变化');
    expect(managedBackupPath('../master.json')).toBe(false);
    expect(managedBackupPath('assets/CON.png')).toBe(false);
    expect(managedBackupPath('.ai-settings.json')).toBe(false);
    expect(()=>WorkspaceBackupManifestSchema.parse({...checked.manifest,files:[...checked.manifest.files,{...checked.manifest.files[0],path:'../master.json'}]})).toThrow();
    const copied=path.join(backup.folder,'data','master.json');await fs.appendFile(copied,' ');
    await expect(restoreWorkspaceBackup(f.root,backup.folder,checked.manifestHash,f.dest,f.signal)).rejects.toThrow('校验失败');
    expect(await fs.readFile(path.join(f.data,'master.json'))).toEqual(original);
    expect((await fs.readdir(f.dest)).length).toBe(1);
    await fs.writeFile(copied,original);
    await fs.writeFile(path.join(backup.folder,'data','unexpected.txt'),'extra');
    await expect(inspectWorkspaceBackup(backup.folder,f.signal)).rejects.toThrow('未识别');
    await fs.writeFile(path.join(f.data,'unexpected.txt'),'extra');
    await expect(createWorkspaceBackup(f.root,f.dest,f.signal)).rejects.toThrow('未识别');
    expect((await fs.readdir(f.dest)).length).toBe(1);
  });
  it('preserves orphan evidence bytes and reports missing index association',async()=>{
    const f=await backupFixture();
    const id=randomUUID(),relative='.evidence-files-v1/'+id+'.txt';
    await fs.mkdir(path.join(f.data,'.evidence-files-v1'));await fs.writeFile(path.join(f.data,relative),'合成附件');
    const backup=await createWorkspaceBackup(f.root,f.dest,f.signal),checked=await inspectWorkspaceBackup(backup.folder,f.signal);
    expect(checked.summary.warnings.some(w=>w.includes('1 个无索引证据附件'))).toBe(true);
    expect(checked.manifest.files.some(row=>row.path===relative)).toBe(true);
    const restored=await restoreWorkspaceBackup(f.root,backup.folder,checked.manifestHash,f.dest,f.signal);
    expect(await fs.readFile(path.join(restored.folder,'data',relative),'utf8')).toBe('合成附件');
  });
  it('restores photo assets, recycle bin documents and ordinary historical snapshots',async()=>{
    const f=await backupFixture();
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR7sAAAAASUVORK5CYII=';
    const asset=await f.store.saveAsset({filename:'synthetic-photo.png',dataUrl:'data:image/png;base64,'+png});
    const photoDoc=doc();
    await f.store.saveResume('photo-sample',{...photoDoc,basic:{...photoDoc.basic,photo:asset.url}});
    await f.store.deleteResume('sample',resumeRevision(await f.store.getResume('sample')));
    const originalTrash=await f.store.listTrash(),originalSnapshots=await f.store.listSnapshots('sample');
    expect(originalTrash.items.length).toBe(1);
    expect(originalSnapshots.length).toBeGreaterThan(0);
    const b=await createWorkspaceBackup(f.root,f.dest,f.signal),checked=await inspectWorkspaceBackup(b.folder,f.signal);
    expect(checked.manifest.files.some(row=>row.path==='assets/'+asset.filename)).toBe(true);
    expect(checked.manifest.files.some(row=>row.path.startsWith('.trash/'))).toBe(true);
    const restored=await restoreWorkspaceBackup(f.root,b.folder,checked.manifestHash,f.dest,f.signal);
    const newStore=new LocalResumeStore(path.join(restored.folder,'data'));
    expect((await newStore.getResume('photo-sample')).basic.photo).toBe(asset.url);
    expect((await newStore.readAsset(asset.filename)).buffer).toEqual(Buffer.from(png,'base64'));
    expect(await newStore.listTrash()).toEqual(originalTrash);
    expect(await newStore.listSnapshots('sample')).toEqual(originalSnapshots);
  });
  it('coordinates asset and explicit snapshot writers with the workspace write lock',async()=>{
    const f=await backupFixture();
    let assetWrite:ReturnType<LocalResumeStore['saveAsset']>|undefined,snapshotWrite:ReturnType<LocalResumeStore['createSnapshot']>|undefined;
    const before=await f.store.listSnapshots('sample');
    await withResumeWriteLock(f.data,async()=>{
      assetWrite=f.store.saveAsset({filename:'synthetic-lock-photo.png',dataUrl:'data:image/png;base64,aGVsbG8='});
      snapshotWrite=f.store.createSnapshot('sample','锁释放后创建');
      await new Promise(resolve=>setTimeout(resolve,120));
      expect(await fs.readdir(path.join(f.data,'assets'))).toEqual([]);
      expect(await f.store.listSnapshots('sample')).toEqual(before);
    });
    expect(await assetWrite).toBeDefined();
    expect(await snapshotWrite).toBeDefined();
    expect((await f.store.listSnapshots('sample')).length).toBe(before.length+1);
  });
  it('does not publish on cancellation or corrupted source',async()=>{
    const f=await backupFixture();const ctl=new AbortController();ctl.abort();
    await expect(createWorkspaceBackup(f.root,f.dest,ctl.signal)).rejects.toThrow('取消');
    await fs.writeFile(path.join(f.data,'master.json'),'corrupt');
    await expect(createWorkspaceBackup(f.root,f.dest,f.signal)).rejects.toThrow();
    expect(await fs.readdir(f.dest)).toEqual([]);
    expect(await fs.readFile(path.join(f.data,'master.json'),'utf8')).toBe('corrupt');
  });
});
