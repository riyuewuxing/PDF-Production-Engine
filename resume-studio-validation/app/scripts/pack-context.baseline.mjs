import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {isPrivateEvidencePath} from './private-evidence-paths.mjs';

const rootDir = process.cwd();
const args = process.argv.slice(2);
const deltaOnly = args.includes('--delta-only');
const sinceFlagIndex = args.indexOf('--since');
const sinceArg = sinceFlagIndex >= 0 ? args[sinceFlagIndex + 1] : undefined;
const outFlagIndex = args.indexOf('--out');
const outDir = path.resolve(rootDir, outFlagIndex >= 0 && args[outFlagIndex + 1] ? args[outFlagIndex + 1] : 'docs/_context');
const metaPath = path.join(outDir, 'pack-meta.json');

if (sinceFlagIndex >= 0 && !sinceArg) {
  console.error('[pack-context] --since requires a commit or branch reference.');
  process.exit(1);
}

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'data',
  'exports',
  'dist',
  'dist-electron',
  'release',
  'coverage',
  '.vite',
  'public',
  'build',
  'scratch',
]);

const EXCLUDED_PATH_PREFIXES = [
  'docs/references/',
  'docs/_context/',
  'docs/inbox/',
];

const EXCLUDED_FILES = new Set([
  'pnpm-lock.yaml',
  'synthetic-private-resume.json',
  'docs/V2_UPGRADE_PLAN.md',
  'docs/V3_UPGRADE_PLAN.md',
  'docs/V4_MATURITY_UPGRADE_PLAN.md',
  'docs/V5_EXECUTION_PLAN.md',
]);

const EXCLUDED_EXTS = new Set([
  '.pdf',
  '.exe',
  '.lnk',
  '.ico',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.woff',
  '.woff2',
  '.ttf',
]);

const LANG_MAP = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.html': 'html',
  '.bat': 'bat',
  '.txt': 'text',
};

function runGit(gitArgs) {
  try {
    return execFileSync('git', gitArgs, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    }).trimEnd();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${gitArgs.join(' ')} failed: ${message}`);
  }
}

function normalizeRel(filePath) {
  return filePath.split(path.sep).join('/');
}

function isExcludedPath(relPath) {
  const norm = normalizeRel(relPath);
  if (EXCLUDED_FILES.has(norm)) return true;
  if (isPrivateEvidencePath(norm)) return true;
  if (EXCLUDED_PATH_PREFIXES.some((prefix) => norm.startsWith(prefix))) return true;
  const parts = norm.split('/');
  // Local facts must never enter a source context pack, even with a custom data directory.
  if (parts.some(part => part === '.fact-bank-v1.json' || part.startsWith('.fact-bank-v1.json.'))) return true;
  if (parts.some((part, index) => index < parts.length - 1 && EXCLUDED_DIRS.has(part))) {
    return true;
  }
  const ext = path.extname(norm).toLowerCase();
  if (EXCLUDED_EXTS.has(ext)) return true;
  return false;
}

function collectSafeFiles(dirAbs = rootDir, acc = []) {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirAbs, entry.name);
    const relPath = normalizeRel(path.relative(rootDir, fullPath));
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (isPrivateEvidencePath(relPath)) continue;
      if (EXCLUDED_PATH_PREFIXES.some((prefix) => `${relPath}/`.startsWith(prefix))) continue;
      collectSafeFiles(fullPath, acc);
    } else if (entry.isFile()) {
      if (!isExcludedPath(relPath)) {
        acc.push(relPath);
      }
    }
  }
  return acc.sort((a, b) => a.localeCompare(b));
}

// Synthetic redaction constants for public-only validation. Never copy private literals.
const SENSITIVE_ACCOUNT_ID = ['999999', '00000'].join('');
const SENSITIVE_EMAIL_REGEX = new RegExp(SENSITIVE_ACCOUNT_ID + '@example\\.invalid', 'gi');
const SENSITIVE_ID_REGEX = new RegExp(SENSITIVE_ACCOUNT_ID, 'g');
const SENSITIVE_USER_DIR_REGEX = /[Cc]:[\\/]+Users[\\/]+SYNTHETIC_USER/g;

function sanitizeText(text) {
  return text
    .replace(SENSITIVE_EMAIL_REGEX, '[REDACTED_EMAIL]')
    .replace(SENSITIVE_ID_REGEX, '[REDACTED_ID]')
    .replace(SENSITIVE_USER_DIR_REGEX, '[REDACTED_USER_DIR]');
}

function assertSafeOutput(packName, content) {
  const forbiddenPatterns = [
    {label:'synthetic account',regex:new RegExp(SENSITIVE_ACCOUNT_ID)},
    {label:'synthetic user path',regex:SENSITIVE_USER_DIR_REGEX},
    {label:'legacy JSON root file content',regex:/"employementStatus"\s*:/},
  ];
  for(const rule of forbiddenPatterns){
    rule.regex.lastIndex=0;
    if(rule.regex.test(content))throw Error('Privacy assertion failed in '+packName+': '+rule.label);
  }
}

function getFence(content) {
  const matches = content.match(/`{3,}/g) ?? [];
  const maxLen = matches.reduce((max, item) => Math.max(max, item.length), 3);
  return '`'.repeat(maxLen + 1);
}

function countLines(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function countWordsApprox(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const nonCjkTokens = text
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + nonCjkTokens;
}

function formatFileSection(relPath, rawContent) {
  const clean = sanitizeText(rawContent).replace(/\r\n/g, '\n');
  const ext = path.extname(relPath).toLowerCase();
  const lang = LANG_MAP[ext] ?? '';
  const fence = getFence(clean);
  const lines = countLines(clean);
  const kb = (Buffer.byteLength(clean, 'utf8') / 1024).toFixed(1);
  return `## File: ${relPath}\n\n- Lines: ${lines} | Size: ${kb} KB\n\n${fence}${lang}\n${clean.trimEnd()}\n${fence}\n`;
}

function assignCategory(relPath) {
  const isTest = /\.test\.[^.]+$/i.test(relPath) || relPath.startsWith('src/test/');
  if (isTest || relPath.startsWith('docs/')) {
    return '04 - 自动化测试与交接基线';
  }
  if (relPath.startsWith('src/templates/')) {
    return '03 - 51 套简历模板与排印基元';
  }
  if (relPath.startsWith('src/components/')) {
    return '02 - 工作台 UI 组件';
  }
  return '01 - 核心架构、主进程、Schema 与工具库';
}

function formatVersionTag(seq, sha) {
  return `v${String(seq).padStart(3, '0')}-${sha}`;
}

function removeStalePacks(prefix) {
  if (!fs.existsSync(outDir)) return;
  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (!prefix || entry.name.startsWith(prefix)) {
      fs.unlinkSync(path.join(outDir, entry.name));
    }
  }
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function writeValidatedPack(fileName, content) {
  assertSafeOutput(fileName, content);
  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(outPath, content, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  const words = countWordsApprox(content);
  const lines = countLines(content);
  return { fileName, outPath, bytes, words, lines };
}

function buildBasePack(safeFiles, headSha, branch, baseSeq) {
  const fileHashes = {};
  const fileStats = {};
  const categories = new Map();

  for (const relPath of safeFiles) {
    const raw = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
    const category = assignCategory(relPath);
    fileHashes[relPath] = hashText(raw);
    fileStats[relPath] = {
      pack: category,
      lines: countLines(raw),
      bytes: Buffer.byteLength(raw, 'utf8'),
    };
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category).push({ relPath, raw });
  }

  const orderedCategories = [...categories.keys()].sort((a, b) => a.localeCompare(b));
  const tocLines = [];
  const bodySections = [];

  for (const cat of orderedCategories) {
    const items = categories.get(cat);
    tocLines.push(`### ${cat} (${items.length} files)`);
    for (const item of items) {
      tocLines.push(`- \`${item.relPath}\` (${fileStats[item.relPath].lines} lines)`);
    }
    tocLines.push('');
    bodySections.push(`# ${cat}`, '');
    for (const item of items) {
      bodySections.push(formatFileSection(item.relPath, item.raw));
    }
  }

  const baseFileName = `01-BASE-${formatVersionTag(baseSeq, headSha)}.md`;
  const content = [
    `# 01 - 全仓安全源码总基线包 (${formatVersionTag(baseSeq, headSha)})`,
    '',
    `> 基线版本：\`v${String(baseSeq).padStart(3, '0')}\` | 提交：\`${headSha}\`（分支 \`${branch}\`） | 生成时间：\`${new Date().toISOString()}\` | 文件数：${safeFiles.length}`,
    '> 说明：已将核心架构/主进程/Schema/工具库、UI 组件、51 套模板矩阵与测试交接合并为单份总基线，方便 Notebook 一次上传并凭文件名版本号追踪。',
    '> 隐私边界：已排除 `data/`、根目录原始个人简历（`.json`/`.pdf`）、二进制构建产物与本地日志，并对残余测试邮箱/本机路径做脱敏替换。',
    '',
    '## 本包分组目录',
    '',
    ...tocLines,
    '---',
    '',
    ...bodySections,
  ].join('\n');

  removeStalePacks('');
  const result = writeValidatedPack(baseFileName, content);
  if (result.words > 450000) {
    console.warn(`[pack-context] Warning: ${baseFileName} is ~${result.words} words, approaching 500k single-source limit.`);
  }

  const manifest = {
    baseCommit: headSha,
    baseFileName,
    baseSeq,
    lastSeq: baseSeq,
    branch,
    generatedAt: new Date().toISOString(),
    fileHashes,
    fileStats,
  };
  fs.writeFileSync(metaPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { result, manifest };
}

function buildDeltaPack(safeFiles, headSha, branch, manifest, deltaSeq) {
  const baseCommit = sinceArg || manifest.baseCommit || headSha;
  const currentDiskMap = new Map();
  for (const relPath of safeFiles) {
    const raw = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
    currentDiskMap.set(relPath, raw);
  }

  const changedFiles = [];
  const addedFiles = [];
  const deletedFiles = [];

  for (const [relPath, raw] of currentDiskMap.entries()) {
    const prevHash = manifest.fileHashes?.[relPath];
    if (!prevHash) {
      addedFiles.push(relPath);
    } else if (hashText(raw) !== prevHash) {
      changedFiles.push(relPath);
    }
  }
  for (const oldPath of Object.keys(manifest.fileHashes ?? {})) {
    if (!isExcludedPath(oldPath) && !currentDiskMap.has(oldPath)) {
      deletedFiles.push(oldPath);
    }
  }

  let commitLog = '';
  let commitDiffStat = '';
  let commitDiff = '';
  if (baseCommit !== headSha) {
    commitLog = runGit(['log', '--oneline', `${baseCommit}..HEAD`]);
    const pathSpecs = safeFiles.length > 0 ? ['--', ...safeFiles] : [];
    commitDiffStat = runGit(['diff', '--stat', `${baseCommit}..HEAD`, ...pathSpecs]);
    commitDiff = runGit(['diff', `${baseCommit}..HEAD`, ...pathSpecs]);
  }

  const workingTreeDiff = runGit(['diff', 'HEAD', '--', ...safeFiles]);
  const indexRows = safeFiles.map((relPath) => {
    const category = assignCategory(relPath);
    const raw = currentDiskMap.get(relPath) ?? '';
    const status = addedFiles.includes(relPath)
      ? '新增'
      : changedFiles.includes(relPath)
        ? '已改'
        : '未变';
    return `| \`${relPath}\` | ${category} | ${countLines(raw)} | ${(Buffer.byteLength(raw, 'utf8') / 1024).toFixed(1)} KB | ${status} |`;
  });

  const versionTag = formatVersionTag(deltaSeq, headSha);
  const deltaFileName = `00-DELTA-${versionTag}.md`;
  const baseFileLabel = manifest.baseFileName || '01-BASE';

  const sections = [
    `# 00 - 动态增量与当前对话交接包 (${versionTag})`,
    '',
    `- **包版本号**：\`${versionTag}\`（在 Notebook 删除旧版 \`00-DELTA-*.md\` 后上传本文件即可）`,
    `- **当前 Git HEAD**：\`${headSha}\`（分支 \`${branch}\`）`,
    `- **对应总基线**：\`${baseFileLabel}\`（提交 \`${manifest.baseCommit}\`，生成于 \`${manifest.generatedAt}\`）`,
    `- **本次增量对比基线**：\`${baseCommit}\``,
    `- **文件变化统计**：新增 ${addedFiles.length} 个 | 修改 ${changedFiles.length} 个 | 删除 ${deletedFiles.length} 个`,
    '',
    '## 给 Gemini Notebook 的角色指令与提问模板',
    '',
    '你是本项目的**只读架构与代码顾问**（无法执行命令或写入磁盘），本地 Antigravity Agent 负责执行与实机验证。',
    '每次回答请遵守：',
    '1. 所有判断必须引用附件中的**真实文件路径与符号名**，严禁猜测未看到的文件；若需补充未改动文件请先点名索取。',
    '2. 输出结构固定为：`① 问题与根因定位` → `② 最小修改方案（按文件与步骤，不要整文件重写）` → `③ 本地验收标准（typecheck/test/实机看图）`。',
    '3. 不得引入破坏根目录原始 3 份参考文件、`data/` 用户数据、`unpackDirName: true` 与隐私脱敏边界的改动。',
    '',
    '## 全仓安全源码索引（共 ' + safeFiles.length + ' 个文件）',
    '',
    '| 文件路径 | 所属模块 | 行数 | 体积 | 相对常驻基线状态 |',
    '| :--- | :--- | ---: | ---: | :---: |',
    ...indexRows,
    '',
  ];

  if (commitLog || commitDiffStat) {
    sections.push(`## 提交演进（\`${baseCommit}..HEAD\`）`, '');
    if (commitLog) {
      sections.push('### 提交列表', '', '```text', commitLog, '```', '');
    }
    if (commitDiffStat) {
      sections.push('### 变更统计', '', '```text', commitDiffStat, '```', '');
    }
  }

  const combinedDiff = [commitDiff, workingTreeDiff].filter(Boolean).join('\n').trim();
  if (combinedDiff) {
    const cleanDiff = sanitizeText(combinedDiff);
    const maxDiffChars = 80000;
    const clipped = cleanDiff.length > maxDiffChars
      ? `${cleanDiff.slice(0, maxDiffChars)}\n\n... [Diff truncated at 80,000 chars; full modified files are attached below] ...`
      : cleanDiff;
    const fence = getFence(clipped);
    sections.push('## 差异补丁（Git Diff）', '', `${fence}diff`, clipped, fence, '');
  }

  const changedOrAdded = [...addedFiles, ...changedFiles];
  if (changedOrAdded.length > 0) {
    sections.push('## 本次新增/修改文件全文', '');
    for (const relPath of changedOrAdded) {
      sections.push(formatFileSection(relPath, currentDiskMap.get(relPath) ?? ''));
    }
  } else if (!combinedDiff) {
    sections.push(
      '## 增量状态说明',
      '',
      `当前工作区及最新提交与总基线 \`${baseFileLabel}\` 完全一致（零增量差异）。后续如有新改动或新提交，只需执行 \`pnpm context:delta\` 自动生成新标号 \`00-DELTA-vNNN-<sha>.md\` 并在 Gemini Notebook 中替换旧版增量即可，无需重传总基线。`,
      '',
    );
  }

  if (deletedFiles.length > 0) {
    sections.push('## 已删除文件', '', deletedFiles.map((f) => `- \`${f}\``).join('\n'), '');
  }

  removeStalePacks('00-DELTA-');
  manifest.lastSeq = deltaSeq;
  manifest.deltaFileName = deltaFileName;
  fs.writeFileSync(metaPath, JSON.stringify(manifest, null, 2), 'utf8');
  return writeValidatedPack(deltaFileName, sections.join('\n'));
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const headSha = runGit(['rev-parse', '--short', 'HEAD']);
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const safeFiles = collectSafeFiles();

  const prevManifest = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    : null;

  let manifest;
  const generated = [];

  if (deltaOnly) {
    if (!prevManifest) {
      console.error(`[pack-context] Missing baseline manifest at ${metaPath}. Run "pnpm context:pack" first.`);
      process.exit(1);
    }
    manifest = prevManifest;
    const nextDeltaSeq = (typeof manifest.lastSeq === 'number' ? manifest.lastSeq : 0) + 1;
    const deltaRes = buildDeltaPack(safeFiles, headSha, branch, manifest, nextDeltaSeq);
    generated.push(deltaRes);
  } else {
    const nextBaseSeq = (typeof prevManifest?.lastSeq === 'number' ? prevManifest.lastSeq : 0) + 1;
    const base = buildBasePack(safeFiles, headSha, branch, nextBaseSeq);
    manifest = base.manifest;
    generated.push(base.result);
    const deltaRes = buildDeltaPack(safeFiles, headSha, branch, manifest, nextBaseSeq);
    generated.unshift(deltaRes);
  }

  console.log(`[pack-context] Mode=${deltaOnly ? 'delta-only' : 'full'} | HEAD=${headSha} | Out=${normalizeRel(path.relative(rootDir, outDir))}`);
  for (const item of generated) {
    const kb = (item.bytes / 1024).toFixed(1);
    console.log(`  - ${item.fileName}: ${kb} KB | ${item.lines} lines | ~${item.words} words`);
  }
}

try {
  main();
} catch (err) {
  console.error('[pack-context] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
