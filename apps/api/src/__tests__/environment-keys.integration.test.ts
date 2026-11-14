import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';

import { testConfig } from './support/config';

/** Development keys from `.env` (ADR 0016): every fallback of the writing role is reachable, not only Grok. */
describe('AI keys read from the development environment', () => {
  let test: TestDb;
  let app: App;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      LLM_MISTRAL_API_KEY: 'mistral-dev-placeholder',
      LLM_VENICE_API_KEY: 'venice-dev-placeholder',
    });
    app = await createApp(config, createLogger(config), { withPlayground: false });
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
  });

  it('hands the Mistral and Venice keys to the LLM gateway', () => {
    expect(app.modules.providers.apiKeySource('mistral')).toBe('mistral-dev-placeholder');
    expect(app.modules.providers.apiKeySource('venice')).toBe('venice-dev-placeholder');
    expect(app.modules.providers.apiKeySource('xai')).toBeUndefined();
  });
});
