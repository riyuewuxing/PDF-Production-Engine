import path from 'node:path';
import { createMcpDispatcher } from '../src/mcp/mcpHandlers';
import { LocalResumeStore } from '../src/server/localFsApi';

const dataDirEnv = process.env.RESUME_STUDIO_DATA_DIR?.trim();
const dataDir = dataDirEnv ? path.resolve(dataDirEnv) : path.resolve(process.cwd(), 'data');
const store = new LocalResumeStore(dataDir);
const dispatcher = createMcpDispatcher(store, {
  allowVersionWrite: process.env.RESUME_STUDIO_MCP_ALLOW_WRITE === '1',
  allowMasterWrite: process.env.RESUME_STUDIO_MCP_ALLOW_MASTER_WRITE === '1',
});

type FramingMode = 'content-length' | 'ndjson';
// Limits apply to incoming UTF-8 wire bytes, not character counts. They are
// deliberately above the 5 MiB local HTTP request limit.
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_HEADER_BYTES = 8 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
let outputFailed = false;
process.stdout.on('error', () => { outputFailed = true; });

async function writeFrame(payload: unknown, mode: FramingMode): Promise<void> {
  if (outputFailed) throw new Error('stdout unavailable');
  const json = JSON.stringify(payload);
  const output = mode === 'content-length'
    ? `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`
    : `${json}\n`;
  // Wait for the writable stream, including pipe backpressure, before
  // dispatching another request. Never force process.exit on stdin EOF.
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(output, err => err ? reject(err) : resolve());
  });
  if (outputFailed) throw new Error('stdout unavailable');
}

async function dispatchFrame(bytes: Buffer, mode: FramingMode): Promise<void> {
  if (outputFailed) throw new Error('stdout unavailable');
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(bytes)); }
  catch {
    // Do not log input contents or replacement-decoded private text.
    await writeFrame({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, mode);
    return;
  }
  let response: unknown;
  try { response = await dispatcher.handleMessage(parsed); }
  catch {
    const id = parsed && typeof parsed === 'object' && 'id' in parsed
      ? ((parsed as { id?: string | number | null }).id ?? null) : null;
    response = { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } };
  }
  if (response) await writeFrame(response, mode);
}

function findHeaderEnd(buf: Buffer): { index: number; separatorLen: number } | null {
  const crlf = buf.indexOf('\r\n\r\n');
  const lf = buf.indexOf('\n\n');
  if (crlf === -1 && lf === -1) return null;
  return crlf !== -1 && (lf === -1 || crlf < lf)
    ? { index: crlf, separatorLen: 4 } : { index: lf, separatorLen: 2 };
}

function skipLeadingWhitespace(buf: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> {
  let idx = 0;
  while (idx < buf.length && [0x20, 0x09, 0x0d, 0x0a].includes(buf[idx]!)) idx++;
  return buf.subarray(idx);
}

function parseLength(header: Buffer): number {
  if (header.length > MAX_HEADER_BYTES) throw new Error('header exceeds limit');
  const text = header.toString('latin1');
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) throw new Error('invalid header bytes');
  let length: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    const field = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\r\n]*)$/.exec(line);
    if (!field) throw new Error('malformed header');
    if (field[1]!.toLowerCase() !== 'content-length') continue;
    const value = field[2]!.trim();
    if (length !== undefined || !/^\d+$/.test(value)) throw new Error('ambiguous content length');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_FRAME_BYTES) throw new Error('content length outside limit');
    length = n;
  }
  if (length === undefined) throw new Error('missing content length');
  return length;
}

let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
async function drain(ending = false): Promise<void> {
  while (pending.length) {
    pending = skipLeadingWhitespace(pending);
    if (!pending.length) return;
    if (pending[0] === 0x7b || pending[0] === 0x5b) {
      const nl = pending.indexOf(0x0a);
      const count = nl === -1 ? pending.length : nl;
      if (count > MAX_FRAME_BYTES) throw new Error('NDJSON frame exceeds limit');
      if (nl === -1 && !ending) return;
      const body = pending.subarray(0, count);
      pending = nl === -1 ? Buffer.alloc(0) : pending.subarray(nl + 1);
      await dispatchFrame(body, 'ndjson');
      continue;
    }
    const header = findHeaderEnd(pending);
    if (!header) {
      // Permit a partial delimiter after an exactly maximum-sized header.
      if (pending.length > MAX_HEADER_BYTES + 3) throw new Error('header exceeds limit');
      if (ending) throw new Error('incomplete header');
      return;
    }
    const length = parseLength(pending.subarray(0, header.index));
    const start = header.index + header.separatorLen;
    if (pending.length < start + length) {
      if (ending) throw new Error('incomplete body');
      return;
    }
    const body = pending.subarray(start, start + length);
    pending = pending.subarray(start + length);
    await dispatchFrame(body, 'content-length');
  }
}

async function run(): Promise<void> {
  // Async iteration propagates backpressure to stdin instead of accumulating an
  // unbounded promise queue. Invalid length framing is terminal: the boundary
  // is no longer trustworthy, so trailing bytes must never be reinterpreted.
  for await (const chunk of process.stdin) {
    if (outputFailed) throw new Error('stdout unavailable');
    pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')]);
    await drain();
  }
  await drain(true);
}

void run().catch(() => {
  pending = Buffer.alloc(0);
  process.stdin.destroy();
  // Generic diagnostic: never echo headers, request content or credentials.
  process.stderr.write('[resume-studio-mcp] Transport stopped: invalid framing, incomplete input, or unavailable pipe.\n');
  process.exitCode = 1;
});
