import { build, context } from 'esbuild';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const rootDir = process.cwd();

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
};

async function run() {
  const configs = [
    {
      ...sharedOptions,
      entryPoints: [path.join(rootDir, 'electron', 'main.ts')],
      outfile: path.join(rootDir, 'dist-electron', 'main.cjs'),
    },
    {
      ...sharedOptions,
      entryPoints: [path.join(rootDir, 'electron', 'preload.ts')],
      outfile: path.join(rootDir, 'dist-electron', 'preload.cjs'),
    },
    {
      ...sharedOptions,
      entryPoints: [path.join(rootDir, 'scripts', 'mcp-server.ts')],
      outfile: path.join(rootDir, 'dist-electron', 'mcp-server.cjs'),
    },
  ];

  if (watch) {
    const contexts = await Promise.all(configs.map((cfg) => context(cfg)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[electron-build] watching electron/main.ts, electron/preload.ts, and scripts/mcp-server.ts');
  } else {
    await Promise.all(configs.map((cfg) => build(cfg)));
    console.log('[electron-build] built dist-electron/main.cjs, preload.cjs & mcp-server.cjs');
  }
}

run().catch((err) => {
  console.error('[electron-build] failed:', err);
  process.exit(1);
});
