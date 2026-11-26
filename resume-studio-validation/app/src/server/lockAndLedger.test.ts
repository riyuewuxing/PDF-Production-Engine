// @vitest-environment node
import {promises as fs} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {LocalResumeStore,inspectResumeWriteLock,recoverResumeWriteLock,withResumeWriteLock} from './localFsApi';
import {JobApplicationSchema} from '../schema/applicationSchema';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
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
