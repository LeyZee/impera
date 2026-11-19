import { defineConfig } from 'vitest/config';

export default defineConfig({
  // No address built in under test, as in development (wxt.config.ts); a test passes one where it needs it.
  define: { __IMPERA_BUILT_IN_CRM__: JSON.stringify('') },
  test: { include: ['src/**/*.test.ts'] },
});
