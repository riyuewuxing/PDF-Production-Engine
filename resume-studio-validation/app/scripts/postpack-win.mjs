import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release');
const builtExe = path.join(releaseDir, 'Resume Studio.exe');
const rootExe = path.join(rootDir, 'Resume Studio.exe');

function inspect(target) {
  try { return fs.lstatSync(target); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

try {
  const release = inspect(releaseDir);
  const built = release?.isDirectory() && !release.isSymbolicLink() ? inspect(builtExe) : null;
  if (!built?.isFile() || built.isSymbolicLink() || built.size === 0) {
    throw new Error('打包产物不存在、为空或不是正常文件，旧启动程序保持原样。');
  }
  const existing = inspect(rootExe);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error('根目录启动程序路径不是正常文件，拒绝替换。');
  }

  // A same-volume rename replaces the existing regular file without deleting it
  // first. If Windows denies the operation (e.g. an open executable), keep both
  // the old launcher and the new release artifact for a later retry.
  fs.renameSync(builtExe, rootExe);

  // release/ may also contain user files, other builds, or diagnostic evidence.
  // Only consume the exact new artifact; never recursively delete this directory
  // or an unrelated shortcut. A failed replacement must not run any cleanup.
  console.log('[postpack-win] 已更新根目录启动程序，其他文件保留: '+rootExe+' ('+built.size+' bytes)');
} catch (error) {
  console.error('[postpack-win] 未能替换启动程序，请关闭正在运行的程序或检查文件权限后重试。',error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
