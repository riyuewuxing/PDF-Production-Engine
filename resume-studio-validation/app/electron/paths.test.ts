// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppPaths, resolveUniqueExportPath } from './paths';

describe('resolveAppPaths', () => {
  it('resolves repo root paths in unpackaged dist-electron mode', () => {
    const repo = path.resolve('D:\\mock-repo\\resume-studio');
    const resolved = resolveAppPaths({
      isPackaged: false,
      appPath: repo,
      mainDir: path.join(repo, 'dist-electron'),
      exePath: path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe'),
      cwd: repo,
      existsSync: () => true,
    });

    expect(resolved.preloadPath).toBe(path.join(repo, 'dist-electron', 'preload.cjs'));
    expect(resolved.indexHtmlPath).toBe(path.join(repo, 'dist', 'index.html'));
    expect(resolved.iconPath).toBe(path.join(repo, 'build', 'icon.png'));
    expect(resolved.dataRootDir).toBe(repo);
    expect(resolved.dataDir).toBe(path.join(repo, 'data'));
    expect(resolved.exportsDir).toBe(path.join(repo, 'exports'));
  });

  it('resolves dist inside app.asar while sharing repo data when launched from release/ portable exe', () => {
    const repo = path.resolve('D:\\mock-repo\\resume-studio');
    const releaseDir = path.join(repo, 'release');
    const asarApp = path.join('C:\\Users\\test\\AppData\\Local\\Temp\\app\\resources\\app.asar');
    const existing = new Set([path.join(repo, 'data', 'master.json')]);

    const resolved = resolveAppPaths({
      isPackaged: true,
      appPath: asarApp,
      mainDir: path.join(asarApp, 'dist-electron'),
      exePath: path.join('C:\\Users\\test\\AppData\\Local\\Temp\\app\\Resume Studio.exe'),
      portableExecutableDir: releaseDir,
      cwd: repo,
      existsSync: (p) => existing.has(p),
    });

    expect(resolved.preloadPath).toBe(path.join(asarApp, 'dist-electron', 'preload.cjs'));
    expect(resolved.indexHtmlPath).toBe(path.join(asarApp, 'dist', 'index.html'));
    expect(resolved.dataRootDir).toBe(repo);
    expect(resolved.dataDir).toBe(path.join(repo, 'data'));
    expect(resolved.exportsDir).toBe(path.join(repo, 'exports'));
  });

  it('resolves repo data when launched from release/win-unpacked/Resume Studio.exe', () => {
    const repo = path.resolve('D:\\mock-repo\\resume-studio');
    const unpackedDir = path.join(repo, 'release', 'win-unpacked');
    const asarApp = path.join(unpackedDir, 'resources', 'app.asar');
    const existing = new Set([path.join(repo, 'data', 'resumes')]);

    const resolved = resolveAppPaths({
      isPackaged: true,
      appPath: asarApp,
      mainDir: path.join(asarApp, 'dist-electron'),
      exePath: path.join(unpackedDir, 'Resume Studio.exe'),
      cwd: unpackedDir,
      existsSync: (p) => existing.has(p),
    });

    expect(resolved.dataRootDir).toBe(repo);
    expect(resolved.dataDir).toBe(path.join(repo, 'data'));
  });

  it('falls back to exe launch directory when copied standalone without nearby repo data', () => {
    const desktopDir = path.resolve('D:\\Tools\\ResumeStudio');
    const asarApp = path.join('C:\\Temp\\xyz\\resources\\app.asar');

    const resolved = resolveAppPaths({
      isPackaged: true,
      appPath: asarApp,
      mainDir: path.join(asarApp, 'dist-electron'),
      exePath: path.join(desktopDir, 'Resume Studio.exe'),
      portableExecutableDir: desktopDir,
      cwd: desktopDir,
      existsSync: () => false,
    });

    expect(resolved.dataRootDir).toBe(desktopDir);
    expect(resolved.dataDir).toBe(path.join(desktopDir, 'data'));
    expect(resolved.exportsDir).toBe(path.join(desktopDir, 'exports'));
  });

  it('resolves repo data and bundled icon when launched from root portable Resume Studio.exe', () => {
    const repo = path.resolve('D:\\mock-repo\\resume-studio');
    const asarApp = path.join('C:\\Users\\test\\AppData\\Local\\Temp\\app\\resources\\app.asar');
    const existing = new Set([path.join(repo, 'data', 'master.json')]);

    const resolved = resolveAppPaths({
      isPackaged: true,
      appPath: asarApp,
      mainDir: path.join(asarApp, 'dist-electron'),
      exePath: path.join('C:\\Users\\test\\AppData\\Local\\Temp\\app\\Resume Studio.exe'),
      portableExecutableDir: repo,
      cwd: repo,
      existsSync: (p) => existing.has(p),
    });

    expect(resolved.iconPath).toBe(path.join(asarApp, 'dist', 'icon.png'));
    expect(resolved.dataRootDir).toBe(repo);
    expect(resolved.dataDir).toBe(path.join(repo, 'data'));
    expect(resolved.exportsDir).toBe(path.join(repo, 'exports'));
  });

  it('appends incrementing suffixes when export filename already exists to prevent silent overwrite', () => {
    const dir = path.resolve('D:\\exports');
    const existing = new Set([
      path.join(dir, 'Synthetic-Role-20261120.pdf'),
      path.join(dir, 'Synthetic-Role-20261120-2.pdf'),
    ]);
    expect(
      resolveUniqueExportPath(path.join(dir, 'fresh.pdf'), (p) => existing.has(p)),
    ).toBe(path.join(dir, 'fresh.pdf'));
    expect(
      resolveUniqueExportPath(path.join(dir, 'Synthetic-Role-20261120.pdf'), (p) => existing.has(p)),
    ).toBe(path.join(dir, 'Synthetic-Role-20261120-3.pdf'));
  });
});
