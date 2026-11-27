import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  type PlatformScript,
  type PlatformScriptStep,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ImportTotals, PlatformScriptImportStore, PreparedRecognitionStore } from '../../domain/ports';
import { importPlatformScripts } from '../import-platform-scripts';

const creatorId = newId(CreatorIdSchema);
const platformAccountId = newId(PlatformAccountIdSchema);
const NOW = new Date('2026-11-20T23:30:00.000Z');

/** What `apply` was given as totals, in order. */
const kept: (ImportTotals | null)[] = [];

const store: PlatformScriptImportStore = {
  account: () => Promise.resolve({ id: platformAccountId, creatorId, platform: 'reveal' }),
  known: () => Promise.resolve([]),
  apply: (_account, _plan, _now, totals) => {
    kept.push(totals);
    return Promise.resolve([]);
  },
};

/** An invented step: free, no media. */
const step = (ref: string, totals?: PlatformScriptStep['totals']): PlatformScriptStep => ({
  ref: { platform: 'reveal', id: ref },
  index: 0,
  platformIndex: 0,
  name: `Étape ${ref}`,
  text: 'Texte inventé',
  media: [],
  previewMedia: [],
  priceMinor: 0,
  currency: 'EUR',
  discount: null,
  ...(totals === undefined ? {} : { totals }),
});

const script = (ref: string, steps: PlatformScriptStep[]): PlatformScript => ({
  ref: { platform: 'reveal', id: ref },
  name: `Script ${ref}`,
  moment: 'night',
  steps: [steps[0] ?? step(`${ref}_1`), ...steps.slice(1)],
});

const run = (
  recognition: PreparedRecognitionStore,
  options: {
    readonly onRecognitionFailed?: (error: unknown) => void;
    readonly listed?: readonly PlatformScript[];
    readonly zone?: string | null;
  } = {},
) =>
  importPlatformScripts(
    {
      store,
      source: () => Promise.resolve(options.listed ?? []),
      recognition,
      dayZone: () => (options.zone === undefined ? 'Europe/Paris' : options.zone),
      ...(options.onRecognitionFailed === undefined
        ? {}
        : { onRecognitionFailed: options.onRecognitionFailed }),
    },
    { creatorId, platformAccountId, correlationId: 'test' },
    NOW,
  );

const none: PreparedRecognitionStore = { recognise: () => Promise.resolve(0) };

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
    const outcome = await run(
      { recognise: () => Promise.reject(failure) },
      { onRecognitionFailed: (error) => heard.push(error) },
    );
    expect(outcome).toMatchObject({ outcome: 'imported', recognised: 0 });
    expect(heard).toEqual([failure]);
  });

  it('keeps the totals of each step on the platform’s day, a step once, none for a step without (ADR 0129 § 12)', async () => {
    kept.length = 0;
    await run(none, {
      listed: [
        script('a', [
          step('a_1', { sent: 12, purchased: 0, paidMinor: 0 }),
          step('a_2', { sent: 9, purchased: 4, paidMinor: 4_800 }),
        ]),
        script('b', [step('b_1')]),
      ],
    });
    // 23 h 30 UTC on the 20th is already the 21st in Paris.
    expect(kept).toEqual([
      {
        day: '2026-11-21',
        steps: [
          { platformStepRef: 'a_1', sent: 12, purchased: 0, paidMinor: 0, currency: 'EUR' },
          { platformStepRef: 'a_2', sent: 9, purchased: 4, paidMinor: 4_800, currency: 'EUR' },
        ],
      },
    ]);
  });

  it('keeps no totals for a platform without days', async () => {
    kept.length = 0;
    await run(none, {
      listed: [script('a', [step('a_1', { sent: 1, purchased: 0, paidMinor: 0 })])],
      zone: null,
    });
    expect(kept).toEqual([null]);
  });
});
