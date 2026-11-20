import {
  CreatorIdSchema,
  MediaDescriptionIdSchema,
  PlatformAccountIdSchema,
  PlatformScriptIdSchema,
  ScriptIdentityIdSchema,
  newId,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ScriptsModule } from '../modules/scripts';

import { createPlaygroundScripts, playgroundCatalogueOf } from './playground-scripts';

type HerScript = Awaited<ReturnType<ScriptsModule['forJobs']['accountScripts']>>[number];
type HerStep = HerScript['steps'][number];

const creatorId = newId(CreatorIdSchema);
const accountId = newId(PlatformAccountIdSchema);
const AT = new Date('2026-11-16T10:00:00Z');

const media = (ref: string, described = true) => ({
  ref,
  kind: 'image' as const,
  inVault: true,
  imported: true,
  mediaAssetId: null,
  described,
  description: described
    ? {
        id: newId(MediaDescriptionIdSchema),
        detailed: `Description inventée de ${ref}.`,
        reviewReasons: [],
        validated: true,
      }
    : null,
});

function step(position: number, ref: string, priceMinor: number, sold: readonly string[] = []): HerStep {
  return {
    position,
    platformIndex: position,
    ref,
    name: `Étape ${String(position)}`,
    text: 'Texte inventé',
    priceMinor,
    currency: 'EUR',
    discount: null,
    media: sold.map((each) => media(each)),
    previewMedia: [],
    complete: true,
    condition: null,
    branches: 1,
  };
}

/** An invented script of hers (ADR 0010), proposable with a validated identity unless told otherwise. */
function script(ref: string, steps: readonly HerStep[], over: Partial<HerScript> = {}): HerScript {
  return {
    id: PlatformScriptIdSchema.parse(newId(PlatformScriptIdSchema)),
    creatorId,
    platformAccountId: accountId,
    ref,
    name: `Script ${ref}`,
    moment: 'night',
    active: true,
    deactivatedAt: null,
    syncedAt: AT,
    steps,
    warnings: [],
    gaps: [],
    proposable: true,
    identity: {
      id: newId(ScriptIdentityIdSchema),
      inputHash: 'hash',
      content: {
        ambiance: 'complice et taquine',
        energy: 'rising',
        setting: 'un salon inventé',
        useWhen: ['il est joueur'],
        avoidWhen: [],
      },
      author: 'human',
      promptHash: null,
      validatedAt: AT,
      createdAt: AT,
    },
    ...over,
  };
}

const ready = script('seq-1', [
  { ...step(0, 'step-a', 0, ['media-1']), text: 'Coucou toi' },
  { ...step(1, 'step-b', 1_500, ['media-2', 'media-3']), previewMedia: [media('media-4')] },
]);

describe('her scripts in the playground (ADR 0103 § 15)', () => {
  it('plays the scripts production would offer, each step with its words, its bundle and its teaser', () => {
    const read = playgroundCatalogueOf([ready]);
    expect(read.kind).toBe('ready');
    if (read.kind !== 'ready') return;
    expect(read.scripts.map((each) => each.name)).toEqual(['Script seq-1']);
    expect(read.scripts[0]?.view.steps.map((each) => each.kind)).toEqual(['free', 'paid']);
    expect(read.scripts[0]?.steps).toEqual([
      {
        text: 'Coucou toi',
        media: [{ ref: 'media-1', kind: 'image', description: 'Description inventée de media-1.' }],
        teaser: [],
      },
      {
        text: 'Texte inventé',
        media: [
          { ref: 'media-2', kind: 'image', description: 'Description inventée de media-2.' },
          { ref: 'media-3', kind: 'image', description: 'Description inventée de media-3.' },
        ],
        teaser: [{ ref: 'media-4', kind: 'image', description: 'Description inventée de media-4.' }],
      },
    ]);
  });

  it('leaves out what production would not offer, and says why none can be played', () => {
    const unvalidated = script('seq-2', ready.steps, { identity: null });
    const branched = script('seq-3', [{ ...step(0, 'step-z', 900, ['media-9']), branches: 2 }]);
    expect(playgroundCatalogueOf([])).toEqual({ kind: 'none', reason: 'no_script' });
    expect(playgroundCatalogueOf([unvalidated, branched])).toEqual({ kind: 'none', reason: 'none_ready' });
    const read = playgroundCatalogueOf([ready, unvalidated]);
    expect(read.kind === 'ready' ? read.scripts.map((each) => each.view.scriptRef) : []).toEqual(['seq-1']);
    // A fan's catalogue is one account's: ready on two, none is played rather than mixing them.
    const other = script('seq-4', ready.steps, { platformAccountId: newId(PlatformAccountIdSchema) });
    expect(playgroundCatalogueOf([ready, other])).toEqual({ kind: 'none', reason: 'several_accounts' });
  });

  it('reads them as the owner who trains, and sells nothing when she may not be read', async () => {
    const asked: unknown[] = [];
    const source = createPlaygroundScripts({
      platformScripts: (creator, reader) => {
        asked.push([creator, reader]);
        return Promise.resolve(asked.length === 1 ? [ready] : null);
      },
    });
    expect((await source(creatorId, { userId: 'user-1', role: 'owner' })).kind).toBe('ready');
    expect(asked).toEqual([[creatorId, { userId: 'user-1', role: 'owner' }]]);
    expect(await source(creatorId, { userId: 'user-1', role: 'owner' })).toEqual({
      kind: 'none',
      reason: 'unreadable',
    });
  });
});
