import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { localFsApiPlugin } from './src/server/localFsApi';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), localFsApiPlugin()],
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
