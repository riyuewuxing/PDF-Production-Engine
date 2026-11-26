import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { localFsApiPlugin } from './src/server/localFsApi';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), localFsApiPlugin(), {
    name:'desktop-production-csp',
    apply:'build',
    transformIndexHtml() {
      return [{tag:'meta',attrs:{'http-equiv':'Content-Security-Policy',content:"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: resume-asset:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"},injectTo:'head-prepend'}];
    },
  }],
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
