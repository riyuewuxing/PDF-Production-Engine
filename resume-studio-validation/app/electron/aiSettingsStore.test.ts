import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiSettingsStore, type CredentialCodec } from './aiSettingsStore';
import { validateByokBaseUrl } from '../src/lib/byokAiClient';

const dirs: string[] = [];
const dummy = 'synthetic-test-key';
const profile = { enabled: true, providerLabel: 'Mock', baseUrl: 'https://example.invalid/v1', model: 'mock' };
async function setup(available = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-ai-test-'));
  dirs.push(dir);
  const file = path.join(dir, 'config.json');
  // Reversible fixture codec only; real OS encryption is separately tested in Electron.
  const codec: CredentialCodec = {
    available: () => available,
    encrypt: value => Buffer.from(Buffer.from(value).map(b => b ^ 0xa5)),
    decrypt: bytes => Buffer.from(bytes.map(b => b ^ 0xa5)).toString(),
  };
  return { file, store: new AiSettingsStore(file, codec) };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
describe('AI credential storage', () => {
  it('migrates legacy plaintext and never returns the key in public views', async () => {
    const { file, store } = await setup();
    await fs.writeFile(file, JSON.stringify({ ...profile, apiKey: dummy }));
    expect(await store.getPublicSettings()).toMatchObject({ apiKey: '', hasApiKey: true });
    const raw = await fs.readFile(file, 'utf8');
    expect(raw).not.toContain(dummy);
    expect(JSON.parse(raw)).not.toHaveProperty('apiKey');
    expect(JSON.parse(raw)).toHaveProperty('encryptedApiKey');
    expect((await store.getRequestSettings()).apiKey).toBe(dummy);
  });
  it('retains a key only for the same endpoint, and supports explicit clearing', async () => {
    const { store } = await setup();
    await store.save({ ...profile, apiKey: dummy });
    await store.save({ ...profile, model: 'other', apiKey: '' });
    expect((await store.getRequestSettings()).apiKey).toBe(dummy);
    await store.save({ ...profile, baseUrl: 'https://other.invalid/v1', apiKey: '' });
    expect((await store.getPublicSettings()).hasApiKey).toBe(false);
    await store.save({ ...profile, apiKey: dummy });
    await store.save({ ...profile, clearApiKey: true });
    expect((await store.getRequestSettings()).apiKey).toBe('');
  });
  it('preserves the old file if OS encryption is unavailable', async () => {
    const { file, store } = await setup(false);
    const original = JSON.stringify({ ...profile, apiKey: dummy });
    await fs.writeFile(file, original);
    await expect(store.getPublicSettings()).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe(original);
  });
  it('rejects insecure non-loopback URLs, embedded credentials, query and fragments', () => {
    for (const url of ['http://example.invalid/v1', 'http://localhost.example.invalid/v1', 'https://u:p@example.invalid/v1', 'https://example.invalid/v1?x=y', 'https://example.invalid/v1#x']) expect(() => validateByokBaseUrl(url)).toThrow();
    expect(validateByokBaseUrl('http://127.0.0.1:1234/v1/')).toEqual({ baseUrl: 'http://127.0.0.1:1234/v1', isLoopback: true });
  });
});
