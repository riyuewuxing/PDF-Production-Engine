const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const rootDir = path.resolve(__dirname, '..');
const svgPath = path.join(rootDir, 'build', 'icon.svg');
const outBuildPng = path.join(rootDir, 'build', 'icon.png');
const outPublicPng = path.join(rootDir, 'public', 'icon.png');
const outIco = path.join(rootDir, 'build', 'icon.ico');

function rgbaToIcoDib(size, rgbaBytes) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4, 20);

  const xorBuf = Buffer.alloc(size * size * 4);
  const andRowStride = Math.ceil(size / 32) * 4;
  const andBuf = Buffer.alloc(andRowStride * size);

  for (let y = 0; y < size; y++) {
    const dstY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const srcIdx = (y * size + x) * 4;
      const dstIdx = (dstY * size + x) * 4;
      const r = rgbaBytes[srcIdx];
      const g = rgbaBytes[srcIdx + 1];
      const b = rgbaBytes[srcIdx + 2];
      const a = rgbaBytes[srcIdx + 3];
      xorBuf[dstIdx] = b;
      xorBuf[dstIdx + 1] = g;
      xorBuf[dstIdx + 2] = r;
      xorBuf[dstIdx + 3] = a;

      if (a < 128) {
        const byteIndex = dstY * andRowStride + (x >> 3);
        andBuf[byteIndex] |= 0x80 >> (x & 7);
      }
    }
  }

  return Buffer.concat([header, xorBuf, andBuf]);
}

function buildWindowsIco(entries) {
  const dirHeader = Buffer.alloc(6);
  dirHeader.writeUInt16LE(0, 0);
  dirHeader.writeUInt16LE(1, 2);
  dirHeader.writeUInt16LE(entries.length, 4);

  const dirEntries = [];
  let offset = 6 + entries.length * 16;

  for (const item of entries) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(item.size >= 256 ? 0 : item.size, 0);
    entry.writeUInt8(item.size >= 256 ? 0 : item.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(item.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += item.data.length;
  }

  return Buffer.concat([dirHeader, ...dirEntries, ...entries.map((e) => e.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    const svgText = fs.readFileSync(svgPath, 'utf-8');
    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgText, 'utf-8').toString('base64')}`;

    await win.loadURL('data:text/html;charset=utf-8,<!doctype html><html><body style="margin:0;background:transparent"></body></html>');

    const rendered = await win.webContents.executeJavaScript(`
      (async () => {
        const img = new Image();
        img.src = ${JSON.stringify(svgDataUrl)};
        await img.decode();
        const sizes = [256, 128, 64, 48, 32, 16];
        const out = [];
        for (const size of sizes) {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, size, size);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, size, size);
          const pngBase64 = canvas.toDataURL('image/png').split(',')[1];
          const rgba = Array.from(ctx.getImageData(0, 0, size, size).data);
          out.push({ size, pngBase64, rgba });
        }
        return out;
      })()
    `);

    const png256 = Buffer.from(rendered.find((r) => r.size === 256).pngBase64, 'base64');
    fs.writeFileSync(outBuildPng, png256);
    fs.writeFileSync(outPublicPng, png256);

    const icoEntries = rendered.map((frame) => {
      if (frame.size === 256) {
        return { size: 256, data: Buffer.from(frame.pngBase64, 'base64') };
      }
      return { size: frame.size, data: rgbaToIcoDib(frame.size, frame.rgba) };
    });

    const icoBuf = buildWindowsIco(icoEntries);
    fs.writeFileSync(outIco, icoBuf);
    console.log(
      `[generate-icon] generated build/icon.png (${png256.length} B), public/icon.png, build/icon.ico (${icoBuf.length} B, ${icoEntries.length} sizes)`,
    );
  } finally {
    win.destroy();
    app.quit();
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
