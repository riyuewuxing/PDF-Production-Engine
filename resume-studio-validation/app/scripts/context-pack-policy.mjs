import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isPrivateEvidencePath } from './private-evidence-paths.mjs';

export const CONTEXT_POLICY_VERSION = 2;

// Deliberately allow only the source tree and reviewed documentation, not all
// files in the working directory. Newly staged code is included; untracked
// local notes, secrets and arbitrary JSON are not.
const ROOT_FILES = new Set(['AGENTS.md','index.html','package.json','pnpm-workspace.yaml','start-studio.bat','tsconfig.json','vite.config.ts']);
const DOC_FILES = new Set(['docs/WEB_GEMINI_BRIDGE_WORKFLOW.md','docs/V6_UPGRADE_RESEARCH_PROPOSAL_20261126.md']);
const PRIVATE_SOURCE = new Set([
  'scripts/pack-context.mjs', // contains project-specific private redaction literals
  'src/App.test.tsx',
  'src/lib/docxExporter.test.ts','src/lib/htmlToMarkdown.test.ts','src/lib/jdMatcher.test.ts',
  'src/lib/jobToolkit.test.ts','src/lib/markdownExporter.test.ts','src/lib/masterMerge.test.ts',
  'src/lib/privacyRedactor.test.ts','src/lib/resumeDiagnostics.test.ts',
  'src/schema/legacyAdapter.test.ts','src/schema/resumeSchema.test.ts','src/templates/registry.test.tsx',
].map(s=>s.toLowerCase()));
const DENIED_PARTS = new Set(['data','exports','release','dist','dist-electron','node_modules','coverage','scratch','logs','backups','private','secrets','credentials']);
const SOURCE_EXTS = new Set(['.ts','.tsx','.js','.mjs','.cjs','.css','.py']);

export function isAllowedContextPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || /[\x00-\x1f\\:]/.test(relativePath)) return false;
  const parts=relativePath.split('/');
  if(parts.some(s=>!s||s==='.'||s==='..'||s.startsWith('.')||DENIED_PARTS.has(s.toLowerCase())))return false;
  if(isPrivateEvidencePath(relativePath)||PRIVATE_SOURCE.has(relativePath.toLowerCase()))return false;
  if(ROOT_FILES.has(relativePath)||DOC_FILES.has(relativePath))return true;
  return parts.length>=2&&['src','electron','scripts'].includes(parts[0])&&SOURCE_EXTS.has(path.extname(relativePath).toLowerCase());
}

/** Reject junctions/symlinks along the path, not merely the final file. */
export function isRegularContainedFile(root,relativePath){
  if(!isAllowedContextPath(relativePath))return false;
  let at=root;
  const parts=relativePath.split('/');
  try{
    for(let i=0;i<parts.length;i++){
      at=path.join(at,parts[i]);
      const st=fs.lstatSync(at);
      if(st.isSymbolicLink())return false;
      if(i===parts.length-1?!st.isFile():!st.isDirectory())return false;
    }
    const rel=path.relative(fs.realpathSync(root),fs.realpathSync(at));
    return rel!==''&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);
  }catch(e){if(e?.code==='ENOENT'||e?.code==='ENOTDIR')return false;throw e}
}

export function collectTrackedContextFiles(root){
  const raw=execFileSync('git',['ls-files','--cached','-z'],{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024});
  return [...new Set(raw.split('\0').filter(Boolean))].filter(p=>isRegularContainedFile(root,p)).sort((a,b)=>a.localeCompare(b));
}

export function isGeneratedContextName(name,kind){
  return typeof name==='string'&&/^(01-BASE|00-DELTA)-v[0-9]{3,}-[0-9a-f]{7,64}\.md$/.test(name)&&(!kind||name.startsWith(kind+'-'));
}

export function readContextManifest(metaPath){
  let stat;
  try{stat=fs.lstatSync(metaPath)}catch(e){if(e?.code==='ENOENT')return null;throw e}
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('Refusing non-regular context manifest');
  const m=JSON.parse(fs.readFileSync(metaPath,'utf8'));
  if(!m||!Number.isSafeInteger(m.lastSeq)||m.lastSeq<1||!Number.isSafeInteger(m.baseSeq)||m.baseSeq<1||
    !isGeneratedContextName(m.baseFileName,'01-BASE')||(m.deltaFileName!==undefined&&!isGeneratedContextName(m.deltaFileName,'00-DELTA'))||
    typeof m.baseCommit!=='string'||!/^[0-9a-f]{7,64}$/.test(m.baseCommit)||!m.fileHashes||typeof m.fileHashes!=='object'||Array.isArray(m.fileHashes)){
    throw Error('Unknown or malformed context manifest; existing files preserved. Use a new output directory.');
  }
  return m;
}
