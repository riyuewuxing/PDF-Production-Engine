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

function writeFrame(payload: unknown, mode: FramingMode): void {
  const json = JSON.stringify(payload);
  if (mode === 'content-length') {
    const byteLen = Buffer.byteLength(json, 'utf8');
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

let incomingBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
let queue: Promise<void> = Promise.resolve();

function scheduleDispatch(rawJsonText: string, mode: FramingMode): void {
  queue = queue.then(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJsonText);
    } catch (err) {
      process.stderr.write(`[resume-studio-mcp] Invalid JSON frame: ${String(err)}\n`);
      writeFrame(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        },
        mode,
      );
      return;
    }

    try {
      const response = await dispatcher.handleMessage(parsed);
      if (response) {
        writeFrame(response, mode);
      }
    } catch (err) {
      process.stderr.write(`[resume-studio-mcp] Unhandled dispatch error: ${String(err)}\n`);
      const id =
        parsed && typeof parsed === 'object' && 'id' in parsed
          ? ((parsed as { id?: string | number | null }).id ?? null)
          : null;
      writeFrame(
        {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : 'Internal error',
          },
        },
        mode,
      );
    }
  });
}

function findHeaderEnd(buf: Buffer): { index: number; separatorLen: number } | null {
  const crlf = buf.indexOf('\r\n\r\n');
  const lf = buf.indexOf('\n\n');
  if (crlf === -1 && lf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, separatorLen: 4 };
  }
  return { index: lf, separatorLen: 2 };
}

function skipLeadingWhitespace(buf: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> {
  let idx = 0;
  while (idx < buf.length) {
    const b = buf[idx]!;
    if (b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0a) {
      idx += 1;
    } else {
      break;
    }
  }
  return idx === 0 ? buf : buf.subarray(idx);
}

function drainIncomingFrames(isStreamEnding = false): void {
  while (incomingBuffer.length > 0) {
    incomingBuffer = skipLeadingWhitespace(incomingBuffer);
    if (incomingBuffer.length === 0) break;

    const firstByte = incomingBuffer[0]!;
    // 1. NDJSON line frame (starts with '{' or '[')
    if (firstByte === 0x7b || firstByte === 0x5b) {
      const nlIdx = incomingBuffer.indexOf(0x0a);
      if (nlIdx === -1) {
        if (!isStreamEnding) break;
        const line = incomingBuffer.toString('utf8').trim();
        incomingBuffer = Buffer.alloc(0);
        if (line) {
          scheduleDispatch(line, 'ndjson');
        }
        break;
      }
      const lineBuf = incomingBuffer.subarray(0, nlIdx);
      incomingBuffer = incomingBuffer.subarray(nlIdx + 1);
      const line = lineBuf.toString('utf8').replace(/\r$/, '').trim();
      if (line) {
        scheduleDispatch(line, 'ndjson');
      }
      continue;
    }

    // 2. Content-Length framed message (exact UTF-8 Buffer byte slicing)
    const headerEnd = findHeaderEnd(incomingBuffer);
    if (!headerEnd) {
      // Wait for full header unless stream already closed with junk
      if (isStreamEnding) {
        process.stderr.write('[resume-studio-mcp] Discarding incomplete header on stdin EOF\n');
        incomingBuffer = Buffer.alloc(0);
      }
      break;
    }

    const headerText = incomingBuffer.subarray(0, headerEnd.index).toString('utf8');
    const match = /content-length:\s*(\d+)/i.exec(headerText);
    if (!match || !match[1]) {
      process.stderr.write(`[resume-studio-mcp] Malformed header without Content-Length: ${headerText}\n`);
      incomingBuffer = incomingBuffer.subarray(headerEnd.index + headerEnd.separatorLen);
      continue;
    }

    const contentLengthBytes = Number(match[1]);
    if (!Number.isFinite(contentLengthBytes) || contentLengthBytes < 0) {
      process.stderr.write(`[resume-studio-mcp] Invalid Content-Length value: ${match[1]}\n`);
      incomingBuffer = incomingBuffer.subarray(headerEnd.index + headerEnd.separatorLen);
      continue;
    }

    const bodyStart = headerEnd.index + headerEnd.separatorLen;
    if (incomingBuffer.length < bodyStart + contentLengthBytes) {
      if (isStreamEnding) {
        process.stderr.write('[resume-studio-mcp] Truncated Content-Length body on stdin EOF\n');
        incomingBuffer = Buffer.alloc(0);
      }
      break;
    }

    const bodyBuf = incomingBuffer.subarray(bodyStart, bodyStart + contentLengthBytes);
    incomingBuffer = incomingBuffer.subarray(bodyStart + contentLengthBytes);
    const bodyText = bodyBuf.toString('utf8');
    scheduleDispatch(bodyText, 'content-length');
  }
}

process.stdin.on('data', (chunk: Buffer | string) => {
  const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
  incomingBuffer = Buffer.concat([incomingBuffer, bufChunk]);
  drainIncomingFrames(false);
});

process.stdin.on('end', () => {
  drainIncomingFrames(true);
  void queue.then(() => {
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`[resume-studio-mcp] Uncaught exception: ${String(err)}\n`);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[resume-studio-mcp] Unhandled rejection: ${String(reason)}\n`);
});
