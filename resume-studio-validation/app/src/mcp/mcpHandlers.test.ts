import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_PREVIEW_DOCUMENT } from '../lib/sampleResumeData';
import { LocalResumeStore } from '../server/localFsApi';
import { resumeRevision } from '../schema/resumeSchema';
import { createMcpDispatcher, MCP_PROTOCOL_VERSION } from './mcpHandlers';

let tempDir = '';
let store: LocalResumeStore;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-mcp-'));
  store = new LocalResumeStore(tempDir);
  await store.saveResume('master', {
    ...SAMPLE_PREVIEW_DOCUMENT,
    title: '中文母库简历 · 高中物理教师',
  });
  await store.saveResume('synthetic-job', {
    ...SAMPLE_PREVIEW_DOCUMENT,
    title: '示例高中物理教师定向版',
    basic: {
      ...SAMPLE_PREVIEW_DOCUMENT.basic,
      title: '高中物理教师',
    },
    selfEvaluationContent: '熟悉新高考物理实验教学与高三备考命题。',
  });
});

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

describe('MCP Dispatcher handlers and write guards', () => {
  it('handles initialize, ping, notifications, and lists all 6 tools', async () => {
    const dispatcher = createMcpDispatcher(store);

    const init = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: MCP_PROTOCOL_VERSION },
    });
    expect(init?.error).toBeUndefined();
    expect((init?.result as { protocolVersion: string }).protocolVersion).toBe(MCP_PROTOCOL_VERSION);

    const notif = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(notif).toBeNull();

    const ping = await dispatcher.handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(ping?.result).toEqual({});

    const toolsRes = await dispatcher.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const tools = (toolsRes?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'list_resumes',
      'get_resume',
      'diagnose_resume',
      'match_jd',
      'generate_interview_questions',
      'upsert_resume_version',
    ]);
  });

  it('runs read/diagnose/jd/interview tools cleanly with Chinese UTF-8 payloads', async () => {
    const dispatcher = createMcpDispatcher(store);

    const listRes = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'list_resumes', arguments: {} },
    });
    const listText = (listRes?.result as { content: Array<{ text: string }> }).content[0]!.text;
    const parsedList = JSON.parse(listText);
    expect(parsedList.master.slug).toBe('master');
    expect(parsedList.resumes[0].slug).toBe('synthetic-job');

    const getRes = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'get_resume', arguments: { slug: 'synthetic-job' } },
    });
    const getText = (getRes?.result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(JSON.parse(getText).title).toBe('示例高中物理教师定向版');

    const diagRes = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'diagnose_resume', arguments: { slug: 'synthetic-job' } },
    });
    const diagPayload = JSON.parse(
      (diagRes?.result as { content: Array<{ text: string }> }).content[0]!.text,
    );
    expect(typeof diagPayload.report.score).toBe('number');
    expect(Array.isArray(diagPayload.report.findings)).toBe(true);

    const jdRes = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'match_jd',
        arguments: {
          slug: 'synthetic-job',
          jdText: '招聘高中物理教师，熟悉新高考命题、实验教学与班级管理优先',
        },
      },
    });
    const jdPayload = JSON.parse(
      (jdRes?.result as { content: Array<{ text: string }> }).content[0]!.text,
    );
    expect(jdPayload.match.totalKeywords).toBeGreaterThan(0);

    const qRes = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: {
        name: 'generate_interview_questions',
        arguments: { slug: 'synthetic-job', targetRole: '重点中学物理教师' },
      },
    });
    const qPayload = JSON.parse(
      (qRes?.result as { content: Array<{ text: string }> }).content[0]!.text,
    );
    expect(qPayload.questions.length).toBeGreaterThanOrEqual(8);
  });

  it('denies direct writes by default and never accepts a caller flag as authorization', async () => {
    const invoke = (dispatcher: ReturnType<typeof createMcpDispatcher>, slug: string) => dispatcher.handleMessage({
      jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'upsert_resume_version',
        arguments: { slug, document: { ...SAMPLE_PREVIEW_DOCUMENT, title: 'Blocked edit' }, allowMasterWrite: true } },
    });
    const result = await invoke(createMcpDispatcher(store), 'synthetic-job');
    expect((result?.result as {isError?: boolean}).isError).toBe(true);
    const master = await invoke(createMcpDispatcher(store, {allowVersionWrite: true}), 'master');
    expect((master?.result as {isError?: boolean}).isError).toBe(true);
    expect((await store.getResume('master')).title).toBe('中文母库简历 · 高中物理教师');
    expect((await store.getResume('synthetic-job')).title).toBe('示例高中物理教师定向版');
    expect(await store.listSnapshots('synthetic-job')).toHaveLength(0);
  });

  it('enforces all 4 upsert_resume_version guards: safe slug, master protection, Zod schema, and pre-overwrite snapshot', async () => {
    const dispatcher = createMcpDispatcher(store, { allowVersionWrite: true });

    // 1. Unsafe slug (path traversal)
    const badSlugRes = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'upsert_resume_version',
        arguments: { slug: '../escape', document: SAMPLE_PREVIEW_DOCUMENT },
      },
    });
    expect((badSlugRes?.result as { isError?: boolean }).isError).toBe(true);

    // 2. Master protection without allowMasterWrite: true
    const masterDeniedRes = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'upsert_resume_version',
        arguments: {
          slug: 'master',
          document: { ...SAMPLE_PREVIEW_DOCUMENT, title: 'Attempted overwrite' },
        },
      },
    });
    expect((masterDeniedRes?.result as { isError?: boolean }).isError).toBe(true);
    expect((await store.getResume('master')).title).toBe('中文母库简历 · 高中物理教师');

    // 3. Invalid schema rejected
    const badDocRes = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'upsert_resume_version',
        arguments: { slug: 'new-draft', document: { title: 'Missing fields' } },
      },
    });
    expect((badDocRes?.result as { isError?: boolean }).isError).toBe(true);

    // 4. Overwriting existing sub-version creates a pre-overwrite snapshot automatically
    const upsertExistingRes = await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: {
        name: 'upsert_resume_version',
        arguments: {
          slug: 'synthetic-job',
          document: { ...SAMPLE_PREVIEW_DOCUMENT, title: '示例物理教师 · MCP 精修版' },
          expectedRevision: resumeRevision(await store.getResume('synthetic-job')),
          reason: 'MCP 客户端优化前备份',
        },
      },
    });
    const upsertPayload = JSON.parse(
      (upsertExistingRes?.result as { content: Array<{ text: string }> }).content[0]!.text,
    );
    expect(upsertPayload.existedBefore).toBe(true);
    expect(typeof upsertPayload.snapshotCreatedId).toBe('string');

    const snaps = await store.listSnapshots('synthetic-job');
    expect(snaps.length).toBe(1);
    expect(snaps[0]!.reason).toBe('MCP 客户端优化前备份');
    expect((await store.getResume('synthetic-job')).title).toBe('示例物理教师 · MCP 精修版');
    const stale = await dispatcher.handleMessage({
      jsonrpc: '2.0', id: 24, method: 'tools/call',
      params: { name: 'upsert_resume_version', arguments: {
        slug: 'synthetic-job', document: SAMPLE_PREVIEW_DOCUMENT,
        expectedRevision: resumeRevision(SAMPLE_PREVIEW_DOCUMENT),
      }},
    });
    expect((stale?.result as {isError?: boolean}).isError).toBe(true);
    expect(await store.listSnapshots('synthetic-job')).toHaveLength(1);
  });
});
