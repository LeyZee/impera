import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts', 'test/**/*.integration.test.ts'],
    globalSetup: ['src/__tests__/global-setup.ts'],
    // A test that types more than three codes of one account waits for the next one, 30 s at most, as a person would:
    // the server takes each code once (recette SEC-03, `codeFor` in support/sign-in.ts).
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
