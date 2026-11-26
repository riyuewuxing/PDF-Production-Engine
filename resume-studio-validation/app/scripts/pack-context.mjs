import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {CONTEXT_POLICY_VERSION,collectTrackedContextFiles,isAllowedContextPath,isGeneratedContextName,readContextManifest} from './context-pack-policy.mjs';

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
  return !isAllowedContextPath(relPath);
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

// Publish validated output first; only then retire files explicitly named by
// the previous manifest. Unknown Markdown, even in a custom --out, is untouched.
function publishPackSet(generated, manifest, previousManifest, replaceBase) {
  const created=[];
  const temp=path.join(outDir,'.context-meta-'+crypto.randomUUID()+'.tmp');
  let tempCreated=false;
  try{
    for(const item of generated){
      if(!isGeneratedContextName(item.fileName))throw Error('Invalid generated context filename');
      const fd=fs.openSync(item.outPath,'wx');
      created.push(item.outPath);
      try{fs.writeFileSync(fd,item.content,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd)}
    }
    const fd=fs.openSync(temp,'wx');tempCreated=true;
    try{fs.writeFileSync(fd,JSON.stringify(manifest,null,2),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd)}
    fs.renameSync(temp,metaPath);
    tempCreated=false;
  }catch(error){
    for(const p of created){try{fs.unlinkSync(p)}catch{}}
    if(tempCreated){try{fs.unlinkSync(temp)}catch{}}
    throw error;
  }
  const keep=new Set([manifest.baseFileName,manifest.deltaFileName]);
  const retire=[previousManifest?.deltaFileName,...(replaceBase?[previousManifest?.baseFileName]:[])];
  for(const name of retire){
    if(!isGeneratedContextName(name)||keep.has(name))continue;
    const p=path.join(outDir,name);
    try{
      const st=fs.lstatSync(p);
      if(st.isFile()&&!st.isSymbolicLink())fs.unlinkSync(p);
    }catch(error){
      if(error?.code!=='ENOENT')console.warn('[pack-context] Previous generated file retained:',name);
    }
  }
}

function nextSequence(previousManifest){
  let max=previousManifest?.lastSeq??0;
  for(const name of fs.readdirSync(outDir)){
    if(!isGeneratedContextName(name))continue;
    const seq=Number(/-v([0-9]+)-/.exec(name)?.[1]);
    if(Number.isSafeInteger(seq))max=Math.max(max,seq);
  }
  if(max>=Number.MAX_SAFE_INTEGER)throw Error('Context sequence exhausted');
  return max+1;
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function verifyBaselineFile(manifest) {
  const digest = manifest.baseSha256;
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    throw Error('Baseline has no integrity digest. Run pnpm context:pack to regenerate the baseline.');
  }
  const basePath = path.join(outDir, manifest.baseFileName);
  let stat;
  try { stat = fs.lstatSync(basePath); }
  catch (e) {
    if (e?.code === 'ENOENT') throw Error('Baseline file missing. Run pnpm context:pack to regenerate the baseline.');
    throw e;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Baseline is not a regular file. Use a safe output directory or regenerate the baseline.');
  const actual = crypto.createHash('sha256').update(fs.readFileSync(basePath)).digest('hex');
  if (actual !== digest) throw Error('Baseline integrity mismatch. Run pnpm context:pack to regenerate the baseline.');
}

function prepareValidatedPack(fileName, content) {
  assertSafeOutput(fileName, content);
  const outPath = path.join(outDir, fileName);
  const bytes = Buffer.byteLength(content, 'utf8');
  const words = countWordsApprox(content);
  const lines = countLines(content);
  return { fileName, outPath, bytes, words, lines, content };
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
    '> 隐私边界：仅收集 Git 已跟踪且符合源码白名单的当前文件；排除私有测试、原始资料、未知路径及交接历史；已知字面量脱敏仍保留。不能保证代码中任意隐私信息自动识别，上传前必须审阅。',
    '',
    '## 本包分组目录',
    '',
    ...tocLines,
    '---',
    '',
    ...bodySections,
  ].join('\n');

  const result = prepareValidatedPack(baseFileName, content);
  if (result.words > 450000) {
    console.warn(`[pack-context] Warning: ${baseFileName} is ~${result.words} words, approaching 500k single-source limit.`);
  }

  const manifest = {
    policyVersion: CONTEXT_POLICY_VERSION,
    baseCommit: headSha,
    baseFileName,
    baseSha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
    baseSeq,
    lastSeq: baseSeq,
    branch,
    generatedAt: new Date().toISOString(),
    fileHashes,
    fileStats,
  };
  return { result, manifest };
}

function buildDeltaPack(safeFiles, headSha, branch, manifest, deltaSeq) {
  const baseCommit = sinceArg ? runGit(['rev-parse','--verify','--end-of-options',sinceArg+'^{commit}']) : (manifest.baseCommit || headSha);
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

  // Current reviewed paths only. Do not embed raw Git history, deleted text,
  // old credential values, commit messages or arbitrary working-tree diffs.
  const historicalPaths = baseCommit !== headSha && safeFiles.length
    ? runGit(['diff','--name-only','--no-renames','-z',baseCommit,'HEAD','--',...safeFiles]).split('\0').filter(p=>safeFiles.includes(p))
    : [];
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

  if(historicalPaths.length){
    sections.push('## 指定提交以来变更的当前允许路径（仅文件名）','',...historicalPaths.map(p=>'- '+p),'');
  }
  sections.push('> 隐私边界：不包含历史补丁、提交消息、旧文件正文或未跟踪文件；修改与新增文件提供当前正文。','');
  const changedOrAdded = [...addedFiles, ...changedFiles];
  if (changedOrAdded.length > 0) {
    sections.push('## 本次新增/修改文件全文', '');
    for (const relPath of changedOrAdded) {
      sections.push(formatFileSection(relPath, currentDiskMap.get(relPath) ?? ''));
    }
  } else if (deletedFiles.length === 0) {
    sections.push(
      '## 增量状态说明',
      '',
      `当前允许的源码文件与总基线 \`${baseFileLabel}\` 完全一致（零增量差异）。后续如有新改动或新提交，只需执行 \`pnpm context:delta\` 自动生成新标号 \`00-DELTA-vNNN-<sha>.md\` 并在 Gemini Notebook 中替换旧版增量即可，无需重传总基线。`,
      '',
    );
  }

  if (deletedFiles.length > 0) {
    sections.push('## 已删除文件', '', deletedFiles.map((f) => `- \`${f}\``).join('\n'), '');
  }

  manifest.lastSeq = deltaSeq;
  manifest.deltaFileName = deltaFileName;
  return prepareValidatedPack(deltaFileName, sections.join('\n'));
}

// Serialize all manifest reads, sequence allocation and publication for one
// output directory. A crashed process can leave a lock; fail closed rather
// than guessing whether another publisher is still active.
function withOutputLock(action) {
  const lockPath = path.join(outDir, '.context-pack.lock');
  let fd;
  try { fd = fs.openSync(lockPath, 'wx'); }
  catch (err) {
    if (err?.code === 'EEXIST') throw Error('Context output is locked. Check that no pack process is running; use another output directory or manually recover a confirmed stale lock.');
    throw err;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
    fs.fsyncSync(fd);
    return action();
  } finally {
    try { fs.closeSync(fd); }
    finally {
      try { fs.unlinkSync(lockPath); }
      catch (err) { if (err?.code !== 'ENOENT') console.warn('[pack-context] Output lock retained; inspect before retry.'); }
    }
  }
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });
  return withOutputLock(buildAndPublish);
}

function buildAndPublish() {
  const headSha = runGit(['rev-parse', '--short', 'HEAD']);
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const safeFiles = collectTrackedContextFiles(rootDir);
  if(!safeFiles.length)throw Error('No tracked, allowed source files found');
  const prevManifest = readContextManifest(metaPath);

  let manifest;
  const generated = [];

  if (deltaOnly) {
    if (!prevManifest) {
      throw Error(`Missing baseline manifest at ${metaPath}. Run "pnpm context:pack" first.`);
    }
    if(prevManifest.policyVersion!==CONTEXT_POLICY_VERSION)throw Error('Context privacy policy changed. Run pnpm context:pack to regenerate the baseline before delta export.');
    verifyBaselineFile(prevManifest);
    manifest = {...prevManifest};
    const nextDeltaSeq = nextSequence(prevManifest);
    const deltaRes = buildDeltaPack(safeFiles, headSha, branch, manifest, nextDeltaSeq);
    generated.push(deltaRes);
  } else {
    const nextBaseSeq = nextSequence(prevManifest);
    const base = buildBasePack(safeFiles, headSha, branch, nextBaseSeq);
    manifest = base.manifest;
    generated.push(base.result);
    const deltaRes = buildDeltaPack(safeFiles, headSha, branch, manifest, nextBaseSeq);
    generated.unshift(deltaRes);
  }

  publishPackSet(generated,manifest,prevManifest,!deltaOnly);
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
