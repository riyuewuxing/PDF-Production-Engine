// @vitest-environment node
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalResumeStore, withResumeWriteLock } from './localFsApi';
import { ResumeDocumentSchema, resumeRevision } from '../schema/resumeSchema';

const dirs: string[] = [];
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-cas-test-'));
  dirs.push(dir);
  const store = new LocalResumeStore(dir);
  const doc = await store.saveResume('demo', ResumeDocumentSchema.parse({
    id: 'synthetic-document', title: 'Initial', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', basic: {name: '虚构候选人', title: '示例岗位'},
    menuSections: [{id: 'basic', title: '基本资料', order: 0}], globalSettings: {},
  }));
  return { dir, store, doc };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, {recursive: true, force: true})));
});
describe('resume revision and cross-process locking', () => {
  it('allows exactly one competing writer across independent OS processes', async () => {
    const {dir, store, doc} = await fixture();
    // The worker uses the real TypeScript store in a separate Node process, no fake lock.
    const worker = path.join(process.cwd(), 'src/server/revisionTestWorker.ts');
    const run = (title: string) => new Promise<{code:number|null; stdout:string; stderr:string}>((resolve,reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', worker, dir, resumeRevision(doc), title], {stdio:['ignore','pipe','pipe']});
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => {stdout += String(chunk);});
      child.stderr.on('data', chunk => {stderr += String(chunk);});
      const timer = setTimeout(() => {child.kill(); reject(Error('writer watchdog expired'));}, 12000);
      child.once('error', err => {clearTimeout(timer);reject(err);});
      child.once('close', code => {clearTimeout(timer);resolve({code,stdout,stderr});});
    });
    const results = await Promise.all([run('Writer A'),run('Writer B')]);
    expect(results.map(r => r.code).sort()).toEqual([0, 3]);
    expect(results.find(r => r.code === 3)?.stdout).toContain('REVISION_CONFLICT');
    const final = await store.getResume('demo');
    expect(final.title).toBe(results.find(r => r.code === 0)?.stdout.trim());
    expect(resumeRevision(final)).not.toBe(resumeRevision(doc));
    expect(await store.listSnapshots('demo')).toHaveLength(1);
    await expect(fs.access(path.join(dir,'.resume-write-lock'))).rejects.toThrow();
  }, 18000);

  it('rejects stale delete, stale restore and stale save after deletion without recreating the file', async () => {
    const {store, doc} = await fixture();
    const snap = await store.createSnapshot('demo', 'before');
    const current = await store.saveResume('demo', {...doc, title:'Changed'});
    await expect(store.deleteResume('demo', resumeRevision(doc))).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    await expect(store.restoreSnapshot('demo',snap.id,resumeRevision(doc))).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    expect((await store.getResume('demo')).title).toBe('Changed');
    await store.deleteResume('demo',resumeRevision(current));
    await expect(store.saveResume('demo',current,{requireExisting:true})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    await expect(store.getResume('demo')).rejects.toMatchObject({code:'NOT_FOUND'});
  });

  it('fails closed on an occupied lock and leaves the lock intact for explicit recovery', async () => {
    const {dir, store, doc} = await fixture();
    const lock = path.join(dir,'.resume-write-lock');
    await fs.mkdir(lock);
    await expect(store.saveResume('demo',{...doc,title:'blocked'})).rejects.toMatchObject({code:'RESUME_WRITE_LOCKED'});
    expect((await store.getResume('demo')).title).toBe('Initial');
    expect((await fs.stat(lock)).isDirectory()).toBe(true);
  }, 8000);

  it('releases lock on thrown mutation and does not accept mismatched document identity', async () => {
    const {dir, store, doc} = await fixture();
    await expect(withResumeWriteLock(dir, async()=>{throw Error('failure');})).rejects.toThrow('failure');
    await expect(store.saveResume('demo',{...doc,id:'other-doc'},{expectedRevision:resumeRevision(doc)})).rejects.toMatchObject({code:'DOCUMENT_ID_CONFLICT'});
    expect((await store.saveResume('demo',{...doc,title:'After error'})).title).toBe('After error');
  });
});
