import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release');
const builtExe = path.join(releaseDir, 'Resume Studio.exe');
const rootExe = path.join(rootDir, 'Resume Studio.exe');

if (!fs.existsSync(builtExe)) {
  console.error(`[postpack-win] 未找到打包产物: ${builtExe}`);
  process.exit(1);
}

// Move single standalone executable into repository root
if (fs.existsSync(rootExe)) {
  fs.rmSync(rootExe, { force: true });
}
fs.renameSync(builtExe, rootExe);

// Remove obsolete shortcuts and extra release artifacts so only one root .exe remains
const obsoleteTargets = [
  path.join(rootDir, 'Resume Studio（极速启动）.lnk'),
  releaseDir,
];

for (const target of obsoleteTargets) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

const stat = fs.statSync(rootExe);
console.log(`[postpack-win] 已输出根目录唯一启动程序: ${rootExe} (${stat.size} bytes)`);
