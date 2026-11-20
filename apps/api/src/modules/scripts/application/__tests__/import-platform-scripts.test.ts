import { CreatorIdSchema, newId, PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { PlatformScriptImportStore, PreparedRecognitionStore } from '../../domain/ports';
import { importPlatformScripts } from '../import-platform-scripts';

const creatorId = newId(CreatorIdSchema);
const platformAccountId = newId(PlatformAccountIdSchema);
const NOW = new Date('2026-11-20T09:00:00.000Z');

const store: PlatformScriptImportStore = {
  account: () => Promise.resolve({ id: platformAccountId, creatorId }),
  known: () => Promise.resolve([]),
  apply: () => Promise.resolve([]),
};

const run = (recognition: PreparedRecognitionStore, onRecognitionFailed?: (error: unknown) => void) =>
  importPlatformScripts(
    {
      store,
      source: () => Promise.resolve([]),
      recognition,
      askIdentities: () => Promise.resolve(),
      ...(onRecognitionFailed === undefined ? {} : { onRecognitionFailed }),
    },
    { creatorId, platformAccountId, correlationId: 'test' },
    NOW,
  );

describe('importPlatformScripts', () => {
  it('counts the scripts ready to copy that the import recognised', async () => {
    await expect(run({ recognise: () => Promise.resolve(2) })).resolves.toMatchObject({
      outcome: 'imported',
      recognised: 2,
    });
  });

  it('keeps the import when the recognition fails, and says why for the log', async () => {
    const heard: unknown[] = [];
    const failure = new Error('duplicate key');
    const outcome = await run({ recognise: () => Promise.reject(failure) }, (error) => heard.push(error));
    expect(outcome).toMatchObject({ outcome: 'imported', recognised: 0 });
    expect(heard).toEqual([failure]);
  });
});
