// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResumeDocumentSchema } from '../schema/resumeSchema';
import {
  LocalFsApiError,
  LocalResumeStore,
  assertSafeAssetName,
  assertSafeSlug,
  createLocalFsMiddleware,
} from './localFsApi';

function syntheticFixture() {
  return ResumeDocumentSchema.parse({
    id: 'synthetic-fixture', title: '测试简历',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    basic: {name: '演示候选人', title: '示例教师', email: 'fixture@example.invalid'},
    menuSections: [{id:'basic',title:'基本信息',order:0}], globalSettings: {},
  });
}

describe('localFsApi security and persistence', () => {
  let tempDir: string;
  let store: LocalResumeStore;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'resume-studio-test-'));
    store = new LocalResumeStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects path traversal and unsafe slugs/asset filenames', () => {
    const badSlugs = [
      '../master',
      '..\\master',
      'a/b',
      'a\\b',
      '%2e%2e%2fsecret',
      '.hidden',
      'resume.json',
      'with space',
      '',
    ];
    for (const slug of badSlugs) {
      expect(() => assertSafeSlug(slug)).toThrow(LocalFsApiError);
    }

    const badAssets = ['../x.png', 'a/b.png', 'evil.svg', 'script.js', '.env.png'];
    for (const asset of badAssets) {
      expect(() => assertSafeAssetName(asset)).toThrow(LocalFsApiError);
    }

    expect(assertSafeSlug('physics-teacher_2026')).toBe('physics-teacher_2026');
    expect(assertSafeAssetName('portrait-1.jpg')).toBe('portrait-1.jpg');
  });

  it('saves, reads, clones, lists, and deletes resumes cleanly while protecting master', async () => {
    const doc = syntheticFixture();

    await store.saveResume('master', { ...doc, title: '母库' });
    await store.saveResume('fixture-teacher', doc);

    const list = await store.listResumes();
    expect(list.master?.slug).toBe('master');
    expect(list.resumes).toHaveLength(1);
    expect(list.resumes[0]?.slug).toBe('fixture-teacher');

    const loaded = await store.getResume('fixture-teacher');
    expect(loaded.basic.email).toBe('fixture@example.invalid');

    loaded.basic.phone = 'test-phone';
    const saved = await store.saveResume('fixture-teacher', loaded);
    expect(saved.basic.phone).toBe('test-phone');

    const cloned = await store.createResume({
      slug: 'fixture-second',
      title: '示例教师（第二岗位）',
      cloneFromSlug: 'fixture-teacher',
    });
    expect(cloned.slug).toBe('fixture-second');
    expect(cloned.document.title).toBe('示例教师（第二岗位）');
    expect(cloned.document.id).not.toBe(loaded.id);

    await expect(store.deleteResume('master')).rejects.toThrow(LocalFsApiError);
    await store.deleteResume('fixture-second');
    await expect(store.getResume('fixture-second')).rejects.toThrow(LocalFsApiError);
  });

  it('saves and reads uploaded PNG assets inside data/assets', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const uploaded = await store.saveAsset({
      filename: 'id-photo.png',
      dataUrl: `data:image/png;base64,${pngBase64}`,
    });
    expect(uploaded.url).toMatch(/^\/api\/assets\/id-photo-.*\.png$/);

    const asset = await store.readAsset(uploaded.filename);
    expect(asset.mimeType).toBe('image/png');
    expect(asset.buffer.byteLength).toBeGreaterThan(0);
  });

  it('handles HTTP middleware CRUD and blocks path traversal over HTTP', async () => {
    const doc = syntheticFixture();
    const seeded = await store.saveResume('fixture-teacher', doc);

    const middleware = createLocalFsMiddleware(store);
    const server = http.createServer((req, res) => {
      void middleware(req, res, () => {
        res.statusCode = 404;
        res.end('not found');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address unavailable');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const listRes = await fetch(`${baseUrl}/api/resumes`);
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { resumes: Array<{ slug: string }> };
      expect(listBody.resumes.map((r) => r.slug)).toContain('fixture-teacher');

      const updateRes = await fetch(`${baseUrl}/api/resumes/fixture-teacher`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...seeded, basic: { ...seeded.basic, name: '张同学' } }),
      });
      expect(updateRes.status).toBe(200);

      const getRes = await fetch(`${baseUrl}/api/resumes/fixture-teacher`);
      expect(getRes.status).toBe(200);
      const savedDoc = (await getRes.json()) as { basic: { name: string } };
      expect(savedDoc.basic.name).toBe('张同学');

      const traversalRes = await fetch(`${baseUrl}/api/resumes/%2e%2e%2fpackage`);
      expect(traversalRes.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rolls snapshots up to 15, backs up before restoring, and persists applications.json safely', async () => {
    const doc = syntheticFixture();
    await store.saveResume('fixture-teacher', {
      ...doc,
      basic: { ...doc.basic, name: '最初版本' },
    });

    const firstSnap = await store.createSnapshot('fixture-teacher', '初始基线');
    // Push 16 more snapshots (total 17 created -> capped at 15)
    for (let i = 1; i <= 16; i += 1) {
      await new Promise((r) => setTimeout(r, 4));
      const current = await store.getResume('fixture-teacher');
      await store.saveResume('fixture-teacher', {
        ...current,
        basic: { ...current.basic, name: `迭代-${i}` },
      });
      await store.createSnapshot('fixture-teacher', `迭代快照 ${i}`);
    }

    const listAfterCap = await store.listSnapshots('fixture-teacher');
    expect(listAfterCap).toHaveLength(15);
    expect(listAfterCap.some((s) => s.id === firstSnap.id)).toBe(false);

    // Pick older snapshot and restore -> must auto-create "回滚前自动备份" before overwriting
    const targetSnap = listAfterCap[5]!;
    const restored = await store.restoreSnapshot('fixture-teacher', targetSnap.id);
    const listAfterRestore = await store.listSnapshots('fixture-teacher');
    expect(listAfterRestore[0]?.reason).toBe('回滚前自动备份');
    expect(restored.basic.name).toBeTruthy();

    await expect(store.restoreSnapshot('fixture-teacher', '../evil')).rejects.toThrow(
      LocalFsApiError,
    );

    // Applications + coverLetters persistence round-trip
    const initialApps = await store.getApplications();
    expect(initialApps.applications).toEqual([]);
    expect(initialApps.coverLetters).toEqual([]);

    // Permanent application snapshots live in .application-snapshots/ and survive >15 .backups/ rotation
    const lockedSnap = await store.saveApplicationSnapshot({
      applicationId: 'app-1',
      resumeSlug: 'fixture-teacher',
      exportedFilePath: 'D:\\exports\\最初版本.pdf',
      atsScore: 92,
      document: {
        ...doc,
        basic: { ...doc.basic, name: '永久封存原稿' },
      },
    });
    for (let j = 1; j <= 20; j += 1) {
      await new Promise((r) => setTimeout(r, 3));
      await store.createSnapshot('fixture-teacher', `二次滚动 ${j}`);
    }
    const survivedSnap = await store.getApplicationSnapshot(lockedSnap.id);
    expect(survivedSnap.document.basic.name).toBe('永久封存原稿');
    expect(survivedSnap.meta.atsScore).toBe(92);
    await expect(store.getApplicationSnapshot('../evil')).rejects.toThrow(LocalFsApiError);

    const savedApps = await store.saveApplications({
      schemaVersion: 1,
      applications: [
        {
          id: 'app-1',
          company: '示例学校',
          role: '高中物理教师',
          city: '示例城市',
          salary: '编内',
          resumeSlug: 'fixture-teacher',
          status: 'interview',
          appliedDate: '2026-11-20',
          notes: '准备无生试讲',
          jdText: '需物理专业硕士',
          snapshotId: lockedSnap.id,
          exportedFilePath: 'D:\\exports\\最初版本.pdf',
          interviewAt: '2026-11-25 14:00',
          interviewLocation: '行政楼',
          atsScore: 92,
          updatedAt: new Date().toISOString(),
        },
      ],
      coverLetters: [
        {
          id: 'cl-1',
          title: '示例学校自荐信',
          company: '示例学校',
          role: '高中物理教师',
          bodyText: '尊敬的老师您好',
          headerVariant: 'wave-banner',
          resumeSlug: 'fixture-teacher',
          updatedAt: new Date().toISOString(),
        },
      ],
      interviewAnswers: { 'fixture-teacher:q-edu-foundation': '强化实验探究' },
    }, initialApps.revision);
    expect(savedApps.applications).toHaveLength(1);
    expect(savedApps.coverLetters).toHaveLength(1);
    const reloaded = await store.getApplications();
    expect(reloaded.applications[0]?.company).toBe('示例学校');
    expect(reloaded.applications[0]?.snapshotId).toBe(lockedSnap.id);
    expect(reloaded.coverLetters[0]?.headerVariant).toBe('wave-banner');
    expect(reloaded.interviewAnswers['fixture-teacher:q-edu-foundation']).toBe('强化实验探究');

    await expect(store.deleteApplicationSnapshot(lockedSnap.id)).rejects.toMatchObject({code:'SNAPSHOT_REFERENCED'});
    await store.saveApplications({...reloaded,applications:[]},reloaded.revision);
    expect((await store.getApplicationSnapshot(lockedSnap.id)).document.basic.name).toBe('永久封存原稿');
    expect(await store.deleteApplicationSnapshot(lockedSnap.id)).toEqual({ deleted: true });
    await expect(store.getApplicationSnapshot(lockedSnap.id)).rejects.toThrow(LocalFsApiError);
  });
});
