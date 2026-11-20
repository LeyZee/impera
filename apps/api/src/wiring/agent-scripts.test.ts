import {
  CreatorIdSchema,
  FanIdSchema,
  PlatformAccountIdSchema,
  PlatformScriptIdSchema,
  ScriptIdentityIdSchema,
  newId,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ScriptsModule } from '../modules/scripts';

import {
  agentScriptViewOf,
  createAgentScriptSource,
  createLastOfferAt,
  scriptHistoryOf,
} from './agent-scripts';

type HerScript = Awaited<ReturnType<ScriptsModule['forJobs']['accountScripts']>>[number];
type HerStep = HerScript['steps'][number];

const creatorId = newId(CreatorIdSchema);
const accountId = newId(PlatformAccountIdSchema);
const fanId = newId(FanIdSchema);
const AT = new Date('2026-11-16T10:00:00Z');

const media = (ref: string, described = true) => ({
  ref,
  kind: 'image' as const,
  inVault: true,
  imported: true,
  mediaAssetId: null,
  described,
  description: null,
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

const linear = script('seq-1', [
  step(0, 'step-a', 0),
  step(1, 'step-b', 0, ['media-1']),
  step(2, 'step-c', 1_500, ['media-2']),
]);

describe('her native scripts as the agent decides on them (ADR 0098)', () => {
  it('reads a step as a bridge, an offered media or a paid one, with its own ref and her identity', () => {
    const view = agentScriptViewOf(linear);
    expect(view?.steps).toEqual([
      { stepRef: 'step-a', kind: 'bridge', priceMinor: null, mediaRefs: [] },
      { stepRef: 'step-b', kind: 'free', priceMinor: null, mediaRefs: ['media-1'] },
      { stepRef: 'step-c', kind: 'paid', priceMinor: 1_500, mediaRefs: ['media-2'] },
    ]);
    expect(view).toMatchObject({ scriptRef: 'seq-1', moment: 'night', mediaValidated: true });
    expect(view?.description).toContain('complice et taquine');
  });

  it('never offers a script that is not proposable, has no validated identity, or has a step of several branches', () => {
    expect(agentScriptViewOf(script('seq-2', linear.steps, { proposable: false }))).toBeNull();
    expect(agentScriptViewOf(script('seq-3', linear.steps, { identity: null }))).toBeNull();
    const branched = script('seq-4', [step(0, 'step-x', 0), { ...step(1, 'step-y', 900), branches: 2 }]);
    expect(agentScriptViewOf(branched)).toBeNull();
  });

  it('gives his history by step index, a step of a script gone ruling nothing', () => {
    const history = scriptHistoryOf(
      [linear, script('seq-5', [step(0, 'other', 0)])],
      [
        { stepRef: { platform: 'reveal', id: 'step-a' }, purchased: false },
        { stepRef: { platform: 'reveal', id: 'step-c' }, purchased: true },
        { stepRef: { platform: 'reveal', id: 'gone' }, purchased: true },
      ],
    );
    expect(history).toEqual({
      scripts: [{ scriptRef: 'seq-1', sentStepIndexes: [0, 2], boughtStepIndexes: [2] }],
    });
  });
});

describe('the reads the composer makes for her scripts', () => {
  const fan = {
    id: fanId,
    creatorId,
    platformAccountId: accountId,
    platformFanId: 'fan-platform-1',
    displayName: 'Fan inventé',
    firstSeenAt: AT,
    lastSeenAt: AT,
  };
  const asked: string[] = [];
  const deps = {
    scripts: { accountScripts: () => Promise.resolve([linear]) },
    reads: {
      scriptHistory: (_account: string, platformFanId: string) => {
        asked.push(`history:${platformFanId}`);
        return Promise.resolve([
          { stepRef: { platform: 'reveal' as const, id: 'step-a' }, purchased: false },
        ]);
      },
      lastOfferAt: (_account: string, platformFanId: string) => {
        asked.push(`offer:${platformFanId}`);
        return Promise.resolve(AT);
      },
    },
    fans: { getFan: () => Promise.resolve(fan) },
  };

  it('reads her catalogue, and his history and last offer by his platform id', async () => {
    const source = createAgentScriptSource(deps);
    expect((await source.catalogue(creatorId, accountId)).map((each) => each.scriptRef)).toEqual(['seq-1']);
    expect(await source.history(creatorId, accountId, 'conv-1', fanId)).toEqual({
      scripts: [{ scriptRef: 'seq-1', sentStepIndexes: [0], boughtStepIndexes: [] }],
    });
    expect(await createLastOfferAt(deps)(creatorId, fanId)).toEqual(AT);
    expect(asked).toEqual(['history:fan-platform-1', 'offer:fan-platform-1']);
  });

  it('refuses a fan of another account, or one it cannot find: the composer then sells nothing', async () => {
    const source = createAgentScriptSource(deps);
    await expect(
      source.history(creatorId, newId(PlatformAccountIdSchema), 'conv-1', fanId),
    ).rejects.toThrow();
    const none = createAgentScriptSource({ ...deps, fans: { getFan: () => Promise.resolve(null) } });
    await expect(none.history(creatorId, accountId, 'conv-1', fanId)).rejects.toThrow();
  });

  it('does not ask the platform for his last offer when no script of hers may be offered', async () => {
    asked.length = 0;
    const unofferable = {
      accountScripts: () => Promise.resolve([script('seq-6', linear.steps, { proposable: false })]),
    };
    expect(await createLastOfferAt({ ...deps, scripts: unofferable })(creatorId, fanId)).toBeNull();
    expect(asked).toEqual([]);
  });
});
