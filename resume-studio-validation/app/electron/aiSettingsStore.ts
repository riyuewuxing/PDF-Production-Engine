import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_BYOK_SETTINGS, type ByokAiSettings, validateByokBaseUrl } from '../src/lib/byokAiClient';

export interface CredentialCodec {
  available: () => boolean;
  encrypt: (text: string) => Buffer;
  decrypt: (bytes: Buffer) => string;
}

type Metadata = Pick<ByokAiSettings, 'enabled' | 'providerLabel' | 'baseUrl' | 'model'>;
type InternalSettings = { metadata: Metadata; key: string };

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('AI 配置格式不合法。');
  return raw as Record<string, unknown>;
}

function metadataFrom(raw: Record<string, unknown>): Metadata {
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : DEFAULT_BYOK_SETTINGS.model;
  const providerLabel = typeof raw.providerLabel === 'string' && raw.providerLabel.trim() ? raw.providerLabel.trim() : DEFAULT_BYOK_SETTINGS.providerLabel;
  const { baseUrl } = validateByokBaseUrl(typeof raw.baseUrl === 'string' ? raw.baseUrl : DEFAULT_BYOK_SETTINGS.baseUrl);
  if (model.length > 200 || providerLabel.length > 200 || baseUrl.length > 2048) throw new Error('AI 配置字段过长。');
  return { enabled: raw.enabled === true, model, providerLabel, baseUrl };
}

export class AiSettingsStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly filePath: string, private readonly codec: CredentialCodec) {}

  private locked<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private requireEncryption(): void {
    if (!this.codec.available()) throw new Error('系统密钥加密当前不可用，未保存或覆盖密钥。');
  }

  private async write({ metadata, key }: InternalSettings): Promise<void> {
    let encryptedApiKey: string | undefined;
    if (key) {
      this.requireEncryption();
      try { encryptedApiKey = this.codec.encrypt(key).toString('base64'); }
      catch { throw new Error('系统密钥加密失败，原配置未覆盖。'); }
    }
    const record = { ...metadata, ...(encryptedApiKey ? { encryptedApiKey } : {}) };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = this.filePath + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, this.filePath);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
    }
  }

  private async read(): Promise<InternalSettings> {
    let rawText: string;
    try { rawText = await fs.readFile(this.filePath, 'utf8'); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { metadata: metadataFrom(DEFAULT_BYOK_SETTINGS as unknown as Record<string, unknown>), key: '' };
      }
      throw new Error('无法读取 AI 配置，原文件未修改。');
    }
    let raw: Record<string, unknown>;
    try { raw = asRecord(JSON.parse(rawText)); }
    catch { throw new Error('AI 配置损坏，原文件未修改。'); }
    const metadata = metadataFrom(raw);
    let key = '';
    if (typeof raw.encryptedApiKey === 'string' && raw.encryptedApiKey) {
      this.requireEncryption();
      try { key = this.codec.decrypt(Buffer.from(raw.encryptedApiKey, 'base64')); }
      catch { throw new Error('无法解密已保存的 AI 密钥，原文件未修改。'); }
    } else if (typeof raw.apiKey === 'string') {
      key = raw.apiKey.trim();
    }
    const result = { metadata, key };
    // Migrate legacy plaintext only after successful encryption + atomic replacement.
    if (Object.prototype.hasOwnProperty.call(raw, 'apiKey')) await this.write(result);
    return result;
  }

  private publicView(value: InternalSettings): ByokAiSettings {
    return { ...value.metadata, apiKey: '', hasApiKey: Boolean(value.key) };
  }

  getPublicSettings(): Promise<ByokAiSettings> {
    return this.locked(async () => this.publicView(await this.read()));
  }

  getRequestSettings(): Promise<ByokAiSettings> {
    return this.locked(async () => {
      const value = await this.read();
      return { ...value.metadata, apiKey: value.key, hasApiKey: Boolean(value.key) };
    });
  }

  save(input: unknown): Promise<ByokAiSettings> {
    return this.locked(async () => {
      const raw = asRecord(input);
      const metadata = metadataFrom(raw);
      const previous = await this.read();
      const supplied = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
      if (supplied.length > 4096) throw new Error('API Key 长度超出许可范围。');
      // Never reuse a stored credential for a different endpoint without explicit re-entry.
      const key = raw.clearApiKey === true ? '' : supplied ||
        (previous.metadata.baseUrl === metadata.baseUrl ? previous.key : '');
      const value = { metadata, key };
      await this.write(value);
      return this.publicView(value);
    });
  }
}
