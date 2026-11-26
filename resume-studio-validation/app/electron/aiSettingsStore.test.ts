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
    expect(JSON.parse(raw)).toMatchObject({schemaVersion:2,activeProfileId:'default'});
    expect(JSON.parse(raw).profiles[0]).toHaveProperty('encryptedApiKey');
    expect((await store.getRequestSettings()).apiKey).toBe(dummy);
  });
  it('retains a key only for the same endpoint, and supports explicit clearing', async () => {
    const { store } = await setup();
    await store.save({ ...(await store.getPublicSettings()), ...profile, apiKey: dummy });
    await store.save({ ...(await store.getPublicSettings()), ...profile, model: 'other', apiKey: '' });
    expect((await store.getRequestSettings()).apiKey).toBe(dummy);
    await store.save({ ...(await store.getPublicSettings()), ...profile, baseUrl: 'https://other.invalid/v1', apiKey: '' });
    expect((await store.getPublicSettings()).hasApiKey).toBe(false);
    await store.save({ ...(await store.getPublicSettings()), ...profile, apiKey: dummy });
    await store.save({ ...(await store.getPublicSettings()), ...profile, clearApiKey: true });
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
  it('keeps independent encrypted profile credentials and metadata across selection and restart',async()=>{
    const {file,store}=await setup();
    const first=await store.save({...await store.getPublicSettings(),...profile,apiKey:dummy});
    const catalog=await store.create({providerLabel:'Second',baseUrl:'https://other.invalid/v1',model:'other'});
    const second=catalog.profiles.find(p=>p.profileId===catalog.activeProfileId)!;
    expect(second.hasApiKey).toBe(false);expect(second.enabled).toBe(false);
    const saved=await store.save({...second,enabled:true,apiKey:'synthetic-second-key',maxOutputTokens:128});
    expect((await store.getRequestSettings(first.profileId,first.revision)).apiKey).toBe(dummy);
    expect((await store.getRequestSettings(saved.profileId,saved.revision)).apiKey).toBe('synthetic-second-key');
    const switched=await store.activate(first.profileId!);
    expect(switched.activeProfileId).toBe(first.profileId);
    expect(switched.profiles.map(p=>p.apiKey)).toEqual(['','']);
    expect(JSON.stringify(switched)).not.toContain('encryptedApiKey');
    const disk=await fs.readFile(file,'utf8');expect(disk).not.toContain(dummy);expect(disk).not.toContain('synthetic-second-key');
    expect(JSON.parse(disk).profiles).toHaveLength(2);
    expect((await store.getPublicSettings()).providerLabel).toBe('Mock');
    await expect(store.remove(first.profileId!,first.revision!,'DELETE_AI_PROFILE')).rejects.toThrow();
    await expect(store.remove(saved.profileId!,'old','DELETE_AI_PROFILE')).rejects.toThrow();
    const after=await store.remove(saved.profileId!,saved.revision!,'DELETE_AI_PROFILE');
    expect(after.profiles).toHaveLength(1);
    expect((await store.getRequestSettings()).apiKey).toBe(dummy);
  });
  it('rejects stale settings and request revisions even if the endpoint and model are unchanged',async()=>{
    const {store}=await setup();
    const first=await store.save({...await store.getPublicSettings(),...profile,apiKey:dummy});
    const next=await store.save({...first,apiKey:'synthetic-new-key'});
    expect(next.revision).not.toBe(first.revision);
    await expect(store.getRequestSettings(first.profileId,first.revision)).rejects.toThrow('重新预览');
    await expect(store.save({...first,enabled:false})).rejects.toThrow('重新读取');
    expect((await store.getRequestSettings(next.profileId,next.revision)).apiKey).toBe('synthetic-new-key');
  });
  it('rejects invalid budgets without changing stored profile or credential',async()=>{
    const {file,store}=await setup();
    const saved=await store.save({...await store.getPublicSettings(),...profile,apiKey:dummy});
    const original=await fs.readFile(file,'utf8');
    await expect(store.save({...saved,contextBudgetChars:999})).rejects.toThrow('预算');
    expect(await fs.readFile(file,'utf8')).toBe(original);
  });
  it('preserves corrupt versioned files and does not silently reset or create a default',async()=>{
    const {file,store}=await setup();
    const bad=JSON.stringify({schemaVersion:2,activeProfileId:'missing',profiles:[]});
    await fs.writeFile(file,bad);
    await expect(store.getCatalog()).rejects.toThrow();
    await expect(store.create(profile)).rejects.toThrow();
    expect(await fs.readFile(file,'utf8')).toBe(bad);
  });

});
