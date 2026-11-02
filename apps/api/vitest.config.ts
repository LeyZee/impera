import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'src/**/*.e2e.test.ts', 'src/__tests__/fixtures/**'],
    // Vitest's 5 s is too short on a loaded laptop (the pre-push runs the web and the API suites side by side), never
    // for a test that hangs: it still fails, only later.
    testTimeout: 20_000,
  },
});
