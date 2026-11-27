import {
  CreatorIdSchema,
  FanIdSchema,
  PlatformAccountIdSchema,
  PlatformScriptIdSchema,
  PreparedScriptIdSchema,
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
  offered: false,
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
    ours: null,
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

/** Ours as an import recognised it on Reveal (ADR 0161): the same steps at the same prices, unless told otherwise. */
const oursOf = (
  steps: readonly HerStep[],
  description = 'Une soirée complice inventée, de la douceur au plus chaud.',
  moment: 'day' | 'night' | 'both' = 'night',
) => ({
  preparedScriptId: PreparedScriptIdSchema.parse(newId(PreparedScriptIdSchema)),
  language: 'french' as const,
  versionOf: null,
  description,
  moment,
  steps: steps.map((each) => ({ branches: [{ priceMinor: each.priceMinor, currency: 'EUR' as const }] })),
});

const linearSteps = [
  step(0, 'step-a', 0),
  step(1, 'step-b', 0, ['media-1']),
  step(2, 'step-c', 1_500, ['media-2']),
];
const linear = script('seq-1', linearSteps, { ours: oursOf(linearSteps) });

describe('her native scripts as the agent decides on them (ADR 0098)', () => {
  it('reads a step as a bridge, an offered media or a paid one, with its own ref and our description', () => {
    const view = agentScriptViewOf(linear);
    expect(view?.steps).toEqual([
      { stepRef: 'step-a', kind: 'bridge', priceMinor: null, mediaRefs: [] },
      { stepRef: 'step-b', kind: 'free', priceMinor: null, mediaRefs: ['media-1'] },
      { stepRef: 'step-c', kind: 'paid', priceMinor: 1_500, mediaRefs: ['media-2'] },
    ]);
    expect(view).toMatchObject({ scriptRef: 'seq-1', moment: 'night', mediaValidated: true });
    expect(view?.description).toBe('Une soirée complice inventée, de la douceur au plus chaud.');
    // Its own identity, validated or not, is no longer read (ADR 0161 § 5).
    expect(view?.description).not.toContain('complice et taquine');
    expect(
      agentScriptViewOf(script('seq-1b', linearSteps, { ours: oursOf(linearSteps), identity: null })),
    ).not.toBeNull();
  });

  it('offers a recognised copy whose own identity was never validated: ours stands for it (ADR 0161 § 5)', () => {
    const unvalidated = script('seq-1c', linearSteps, {
      ours: oursOf(linearSteps),
      identity: null,
      gaps: ['identity_not_validated'],
      proposable: false,
    });
    expect(agentScriptViewOf(unvalidated)?.scriptRef).toBe('seq-1c');
  });

  it('reads the language of our script and the one it is a version of, French and itself when it says none (ADR 0168 § 8)', () => {
    const ours = oursOf(linearSteps);
    expect(agentScriptViewOf(linear)).toMatchObject({
      language: 'french',
      family: linear.ours?.preparedScriptId,
    });
    // A version in English (ADR 0169) is read as it is, its family its source. A language outside the list cannot reach
    // here: the contract and the base hold it to `LANGUAGES`.
    const source = PreparedScriptIdSchema.parse(newId(PreparedScriptIdSchema));
    const inEnglish = { ...ours, language: 'english' as const, versionOf: source };
    const english = script('seq-en', linearSteps, { ours: inEnglish });
    expect(agentScriptViewOf(english)).toMatchObject({ language: 'english', family: source });
  });

  it('gives no moment to a script of ours played day and night, so it is offered at either (ADR 0112 § 27)', () => {
    const both = script('seq-both', linearSteps, { ours: oursOf(linearSteps, undefined, 'both') });
    expect(agentScriptViewOf(both)?.moment).toBeNull();
    const day = script('seq-day', linearSteps, { ours: oursOf(linearSteps, undefined, 'day') });
    expect(agentScriptViewOf(day)?.moment).toBe('day');
  });

  it('never offers a native script that is not the recognised copy of ours, even with a validated identity (ADR 0161 § 4)', () => {
    expect(agentScriptViewOf(script('seq-native', linearSteps))).toBeNull();
  });

  it('no longer offers a copy changed on Reveal: a step more or less, another price or currency (ADR 0161 § 5)', () => {
    const ours = oursOf(linearSteps);
    const repriced = linearSteps.map((each) =>
      each.ref === 'step-c' ? { ...each, priceMinor: 1_200 } : each,
    );
    expect(agentScriptViewOf(script('seq-7', repriced, { ours }))).toBeNull();
    expect(agentScriptViewOf(script('seq-8', linearSteps.slice(0, 2), { ours }))).toBeNull();
    const inDollars = linearSteps.map((each) => ({ ...each, currency: 'USD' as const }));
    expect(agentScriptViewOf(script('seq-9', inDollars, { ours }))).toBeNull();
  });

  it('never offers a copy with a gap, inactive, or with a step of several branches', () => {
    const ours = oursOf(linearSteps);
    expect(
      agentScriptViewOf(
        script('seq-2', linearSteps, { gaps: ['media_not_described'], proposable: false, ours }),
      ),
    ).toBeNull();
    expect(
      agentScriptViewOf(script('seq-2b', linearSteps, { active: false, proposable: false, ours })),
    ).toBeNull();
    const branchedSteps = [step(0, 'step-x', 0), { ...step(1, 'step-y', 900), branches: 2 }];
    expect(agentScriptViewOf(script('seq-4', branchedSteps, { ours: oursOf(branchedSteps) }))).toBeNull();
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

  it('gives no playable script to a creator with many native scripts and none of ours recognised (ADR 0161 § 4)', async () => {
    const natives = Array.from({ length: 200 }, (_, index) => script(`native-${String(index)}`, linearSteps));
    const source = createAgentScriptSource({
      ...deps,
      scripts: { accountScripts: () => Promise.resolve(natives) },
    });
    expect(await source.catalogue(creatorId, accountId)).toEqual([]);
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
