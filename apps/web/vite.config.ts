import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    // Several tests drive whole pages through user-event in jsdom: under a second on a laptop,
    // 5 to 7 seconds on a shared CI runner. The 5 s default failed them at random; this limit is
    // only there to catch a test that hangs.
    testTimeout: 30_000,
    restoreMocks: true,
    clearMocks: true,
  },
});
