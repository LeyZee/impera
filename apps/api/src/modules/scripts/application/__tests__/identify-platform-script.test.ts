import {
  CreatorIdSchema,
  PlatformAccountIdSchema,
  PlatformScriptIdSchema,
  ScriptIdentityIdSchema,
  newId,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type {
  IdentityTarget,
  ScriptIdentifier,
  ScriptIdentityJobStore,
  StoredPlatformScript,
  StoredScriptIdentity,
  WrittenIdentity,
} from '../../domain/ports';
import { identityInputHash } from '../../domain/script-identity';
import { identifyPlatformScript, ScriptIdentityFailed } from '../identify-platform-script';
import { identitySourceOf } from '../platform-script-reads';

const creatorId = newId(CreatorIdSchema);
const CONTENT = {
  ambiance: 'complice et taquine',
  energy: 'rising' as const,
  setting: 'salon, robe noire',
  useWhen: ['il la complimente sur sa tenue'],
  avoidWhen: [],
};

/** An invented script of two steps: a priced photo, then a voice note offered. */
function script(overrides: Partial<StoredPlatformScript> = {}): StoredPlatformScript {
  return {
    id: newId(PlatformScriptIdSchema),
    creatorId,
    platformAccountId: newId(PlatformAccountIdSchema),
    ref: 'sequence_test',
    name: 'Script inventé',
    moment: 'night',
    active: true,
    deactivatedAt: null,
    syncedAt: new Date('2026-11-15T10:00:00Z'),
    branches: [],
    steps: [
      {
        position: 0,
        platformIndex: 0,
        ref: 'step_1',
        name: 'Étape 1',
        text: 'Texte inventé',
        priceMinor: 1_500,
        currency: 'EUR',
        discount: null,
        media: [
          {
            ref: 'media_1',
            kind: 'image',
            vault: { mediaAssetId: null, descriptionId: 'desc_1', imported: true, shown: null },
          },
        ],
        previewMedia: [],
      },
      {
        position: 1,
        platformIndex: 1,
        ref: 'step_2',
        name: 'Étape 2',
        text: 'Un vocal',
        priceMinor: 0,
        currency: 'EUR',
        discount: null,
        media: [
          {
            ref: 'media_2',
            kind: 'audio',
            vault: { mediaAssetId: null, descriptionId: null, imported: true, shown: null },
          },
        ],
        previewMedia: [],
      },
    ],
    identities: [],
    ...overrides,
  };
}

function harness(target: IdentityTarget | null, answer: Awaited<ReturnType<ScriptIdentifier['identify']>>) {
  const saved: WrittenIdentity[] = [];
  const asked: Parameters<ScriptIdentifier['identify']>[0][] = [];
  const store: ScriptIdentityJobStore = {
    target: () => Promise.resolve(target),
    save: (_creator, _script, identity) => {
      saved.push(identity);
      return Promise.resolve();
    },
    enqueueBacklog: () => Promise.resolve(0),
    enqueue: () => Promise.resolve(),
  };
  const brain: ScriptIdentifier = {
    promptHash: 'prompt_now',
    identify: (input) => {
      asked.push(input);
      return Promise.resolve(answer);
    },
  };
  return { deps: { store, brain }, saved, asked };
}

const identified = {
  kind: 'identified' as const,
  content: CONTENT,
  model: 'brain-test',
  promptHash: 'prompt_now',
};
const target = (stored: StoredPlatformScript): IdentityTarget => ({
  script: stored,
  descriptions: new Map([['desc_1', 'Une photo inventée dans un salon.']]),
});
const request = (stored: StoredPlatformScript) => ({ creatorId, platformScriptId: stored.id });

const identity = (
  inputHash: string,
  overrides: Partial<StoredScriptIdentity> = {},
): StoredScriptIdentity => ({
  id: newId(ScriptIdentityIdSchema),
  inputHash,
  content: CONTENT,
  author: 'brain',
  promptHash: 'prompt_old',
  validatedAt: null,
  createdAt: new Date('2026-11-15T09:00:00Z'),
  ...overrides,
});

describe('identifyPlatformScript', () => {
  it('tells the brain the steps and their validated descriptions, never a price, and keeps its answer', async () => {
    const stored = script();
    const { deps, saved, asked } = harness(target(stored), identified);
    expect(await identifyPlatformScript(deps, request(stored))).toBe('identified');
    expect(asked).toEqual([
      {
        creatorId,
        scriptName: 'Script inventé',
        steps: [
          {
            name: 'Étape 1',
            text: 'Texte inventé',
            media: [{ kind: 'image', description: 'Une photo inventée dans un salon.' }],
          },
          { name: 'Étape 2', text: 'Un vocal', media: [{ kind: 'audio', description: null }] },
        ],
      },
    ]);
    expect(saved).toEqual([
      {
        inputHash: identityInputHash(identitySourceOf(stored)),
        content: CONTENT,
        model: 'brain-test',
        promptHash: 'prompt_now',
      },
    ]);
  });

  it('writes nothing while a photo is undescribed, or the script has branches', async () => {
    const stored = script();
    const undescribed = script({
      steps: script().steps.map((step) => ({
        ...step,
        media: step.media.map((media) => ({ ...media, vault: null })),
      })),
    });
    expect(
      await identifyPlatformScript(harness(target(undescribed), identified).deps, request(undescribed)),
    ).toBe('waiting');
    // Every media described, one not chosen for the CRM (ADR 0145 § 5): the brain is not paid for it.
    const notImported = script({
      steps: script().steps.map((step) => ({
        ...step,
        media: step.media.map((media) => ({
          ...media,
          vault: media.vault === null ? null : { ...media.vault, imported: false },
        })),
      })),
    });
    expect(
      await identifyPlatformScript(harness(target(notImported), identified).deps, request(notImported)),
    ).toBe('waiting');
    // No media at all: nothing of hers chosen, the brain is never paid of itself for its texts.
    const textOnly = script({
      steps: script().steps.map((step) => ({ ...step, media: [], previewMedia: [] })),
    });
    const quiet = harness(target(textOnly), identified);
    expect(await identifyPlatformScript(quiet.deps, request(textOnly))).toBe('waiting');
    expect(quiet.asked).toEqual([]);
    const branched = script({ steps: script().steps.map((step) => ({ ...step, platformIndex: 0 })) });
    const run = harness(target(branched), identified);
    expect(await identifyPlatformScript(run.deps, request(branched))).toBe('branched');
    expect(run.asked).toEqual([]);
    expect(await identifyPlatformScript(harness(null, identified).deps, request(stored))).toBe('gone');
  });

  it('leaves a version alone once validated, written by hand, or told with the prompt of now', async () => {
    const stored = script();
    const hash = identityInputHash(identitySourceOf(stored));
    for (const known of [
      identity(hash, { validatedAt: new Date() }),
      identity(hash, { author: 'human', promptHash: null, validatedAt: new Date() }),
      identity(hash, { promptHash: 'prompt_now' }),
    ]) {
      const run = harness(target({ ...stored, identities: [known] }), identified);
      expect(await identifyPlatformScript(run.deps, request(stored))).toBe('already');
      expect(run.asked).toEqual([]);
    }
    // An older prompt, or another version: told again.
    const again = harness(
      target({
        ...stored,
        identities: [identity(hash), identity('0'.repeat(64), { validatedAt: new Date() })],
      }),
      identified,
    );
    expect(await identifyPlatformScript(again.deps, request(stored))).toBe('identified');
  });

  it('waits for the backlog when the budget is spent, and throws for the retry when every model failed', async () => {
    const stored = script();
    const later = harness(target(stored), { kind: 'budget' });
    expect(await identifyPlatformScript(later.deps, request(stored))).toBe('later');
    expect(later.saved).toEqual([]);
    await expect(
      identifyPlatformScript(harness(target(stored), { kind: 'failed' }).deps, request(stored)),
    ).rejects.toBeInstanceOf(ScriptIdentityFailed);
  });
});
