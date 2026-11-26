import fs from 'node:fs';
import path from 'node:path';

export interface ResolveAppPathsInput {
  isPackaged: boolean;
  appPath: string;
  mainDir: string;
  exePath: string;
  portableExecutableDir?: string;
  envDataRoot?: string;
  cwd: string;
  existsSync?: (target: string) => boolean;
}

export interface ResolvedAppPaths {
  preloadPath: string;
  indexHtmlPath: string;
  iconPath: string;
  dataRootDir: string;
  dataDir: string;
  exportsDir: string;
}

function hasExistingResumeData(candidateRoot: string, exists: (p: string) => boolean): boolean {
  return (
    exists(path.join(candidateRoot, 'data', 'master.json')) ||
    exists(path.join(candidateRoot, 'data', 'resumes')) ||
    exists(path.join(candidateRoot, '高中物理教师（云南省内）.json'))
  );
}

/**
 * Resolves bundle paths (`preload.cjs`, `dist/index.html`) separately from
 * writable user workspace directories (`data/`, `exports/`) so both unpackaged
 * dev runs and packaged Windows `.exe` builds (portable or win-unpacked) work reliably.
 */
export function resolveAppPaths(input: ResolveAppPathsInput): ResolvedAppPaths {
  const exists = input.existsSync ?? fs.existsSync;

  const unpackagedRoot =
    path.basename(input.mainDir) === 'dist-electron'
      ? path.resolve(input.mainDir, '..')
      : input.cwd;

  const preloadPath =
    path.basename(input.mainDir) === 'dist-electron'
      ? path.join(input.mainDir, 'preload.cjs')
      : path.resolve(unpackagedRoot, 'dist-electron', 'preload.cjs');

  const indexHtmlPath = input.isPackaged
    ? path.join(input.appPath, 'dist', 'index.html')
    : path.join(unpackagedRoot, 'dist', 'index.html');

  const iconPath = input.isPackaged
    ? path.join(input.appPath, 'dist', 'icon.png')
    : path.join(unpackagedRoot, 'build', 'icon.png');

  let dataRootDir: string;
  if (input.envDataRoot && input.envDataRoot.trim()) {
    dataRootDir = path.resolve(input.envDataRoot.trim());
  } else if (!input.isPackaged) {
    dataRootDir = unpackagedRoot;
  } else {
    const launchDir = input.portableExecutableDir?.trim()
      ? path.resolve(input.portableExecutableDir.trim())
      : path.dirname(input.exePath);

    const candidates: string[] = [launchDir];
    if (path.basename(launchDir).toLowerCase() === 'release') {
      candidates.push(path.resolve(launchDir, '..'));
    }
    if (path.basename(path.dirname(launchDir)).toLowerCase() === 'release') {
      candidates.push(path.resolve(launchDir, '..', '..'));
    }

    dataRootDir = candidates.find((dir) => hasExistingResumeData(dir, exists)) ?? launchDir;
  }

  return {
    preloadPath,
    indexHtmlPath,
    iconPath,
    dataRootDir,
    dataDir: path.join(dataDirOrRoot(dataRootDir), 'data'),
    exportsDir: path.join(dataDirOrRoot(dataRootDir), 'exports'),
  };
}

function dataDirOrRoot(root: string): string {
  return root;
}

export function resolveUniqueExportPath(
  targetPath: string,
  existsSync: (candidate: string) => boolean = fs.existsSync,
): string {
  if (!existsSync(targetPath)) {
    return targetPath;
  }
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  for (let i = 2; i < 1000; i += 1) {
    const candidate = path.join(dir, `${base}-${i}${ext}`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}
