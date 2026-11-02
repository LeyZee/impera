import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The same `@/` alias as the app (vite.config.ts), so a test can import any module of src.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Vitest's 5 s is too short for a screen test on a loaded laptop (pre-push), never for a test that hangs: it still
    // fails, only later.
    testTimeout: 20_000,
  },
});
