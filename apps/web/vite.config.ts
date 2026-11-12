import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  // Benchmarks run only with `vitest --mode bench` (pnpm bench).
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    clearMocks: true,
    exclude:
      mode === 'bench' ? configDefaults.exclude : [...configDefaults.exclude, 'src/bench/**'],
  },
}));
