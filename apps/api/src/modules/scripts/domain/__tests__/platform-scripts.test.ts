import { createHash } from 'node:crypto';

import {
  PLATFORM_SCRIPT_NAME_MAX,
  PLATFORM_SCRIPT_REF_MAX,
  PLATFORM_SCRIPT_STEP_MEDIA_MAX,
  PLATFORM_SCRIPT_STEP_TEXT_MAX,
  PLATFORM_SCRIPT_STEPS_MAX,
  type PlatformScript,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  boundedPlatformScript,
  descriptionRefusal,
  planPlatformScripts,
  platformScriptFingerprint,
  platformScriptGaps,
  priceNotAbovePrevious,
  priceWarnings,
  stepTotalsOf,
  type KnownPlatformScript,
  type StepMediaState,
} from '../platform-scripts';

const reveal = (id: string) => ({ platform: 'reveal' as const, id });

/** An invented script of three steps: offered, then 15 €, then 30 €. */
function script(id: string, prices: readonly number[] = [0, 1_500, 3_000]): PlatformScript {
  return {
    ref: reveal(id),
    name: `Script inventé ${id}`,
    moment: 'night',
    steps: prices.map((priceMinor, index) => ({
      ref: reveal(`${id}_step_${String(index)}`),
      index,
      platformIndex: index,
      name: `Étape ${String(index + 1)}`,
      text: 'Texte inventé',
      media: [{ ref: reveal(`${id}_media_${String(index)}`), kind: 'image' as const }],
      previewMedia: [],
      priceMinor,
      currency: 'EUR' as const,
      discount: null,
    })),
  };
}

const known = (id: string, from: PlatformScript, active = true): KnownPlatformScript => ({
  id,
  ref: from.ref.id,
  fingerprint: platformScriptFingerprint(from),
  active,
});

describe('the import of the native scripts (ADR 0099 § 1, time 2)', () => {
  it('adds the new, rewrites the changed, keeps the unchanged and deactivates the gone, never deletes', () => {
    const kept = script('seq_1');
    const changed = script('seq_2');
    const gone = script('seq_3');
    const plan = planPlatformScripts(
      [known('a', kept), known('b', changed), known('c', gone)],
      [kept, script('seq_2', [0, 1_500, 3_500]), script('seq_4')],
    );
    expect(plan.added.map((each) => each.ref.id)).toEqual(['seq_4']);
    expect(plan.changed.map((each) => each.id)).toEqual(['b']);
    expect(plan.unchanged).toEqual(['a']);
    expect(plan.gone).toEqual(['c']);
  });

  it('brings back a script gone then listed again, and leaves one already gone as it is', () => {
    const back = script('seq_1');
    const plan = planPlatformScripts([known('a', back, false), known('b', script('seq_2'), false)], [back]);
    expect([plan.changed.map((each) => each.id), plan.unchanged, plan.gone]).toEqual([['a'], [], []]);
  });

  it('takes a script listed twice once', () => {
    const twice = script('seq_1');
    expect(planPlatformScripts([], [twice, twice]).added).toHaveLength(1);
  });

  it('cuts a name or a text past the bounds, never half of an emoji, and keeps the rest as the platform gives it', () => {
    const base = script('seq_1');
    const [first] = base.steps;
    if (first === undefined) throw new Error('one step');
    const long: PlatformScript = {
      ...base,
      name: `${'a'.repeat(PLATFORM_SCRIPT_NAME_MAX - 1)}😈`,
      steps: [
        {
          ...first,
          name: 'b'.repeat(PLATFORM_SCRIPT_NAME_MAX + 5),
          text: 'c'.repeat(PLATFORM_SCRIPT_STEP_TEXT_MAX + 1),
        },
      ],
    };
    const bounded = boundedPlatformScript(long);
    expect(bounded?.name).toBe('a'.repeat(PLATFORM_SCRIPT_NAME_MAX - 1));
    expect(bounded?.steps[0]?.name).toHaveLength(PLATFORM_SCRIPT_NAME_MAX);
    expect(bounded?.steps[0]?.text).toHaveLength(PLATFORM_SCRIPT_STEP_TEXT_MAX);
    expect(bounded?.steps[0]?.priceMinor).toBe(first.priceMinor);
    expect(boundedPlatformScript(base)).toEqual(base);
  });

  it('does not import a script past the bounds of steps, media or ids, and leaves one known as it was', () => {
    const base = script('seq_1');
    const [first] = base.steps;
    if (first === undefined) throw new Error('one step');
    const tooMany = script(
      'seq_2',
      Array.from({ length: PLATFORM_SCRIPT_STEPS_MAX + 1 }, () => 0),
    );
    const media = Array.from({ length: PLATFORM_SCRIPT_STEP_MEDIA_MAX + 1 }, (_, rank) => ({
      ref: reveal(`m_${String(rank)}`),
      kind: 'image' as const,
    }));
    const tooManyMedia: PlatformScript = { ...script('seq_3'), steps: [{ ...first, media }] };
    const tooManyPreviews: PlatformScript = {
      ...script('seq_4'),
      steps: [{ ...first, previewMedia: media }],
    };
    const longRef: PlatformScript = { ...base, ref: reveal('r'.repeat(PLATFORM_SCRIPT_REF_MAX + 1)) };
    for (const each of [tooMany, tooManyMedia, tooManyPreviews, longRef])
      expect(boundedPlatformScript(each)).toBeNull();
    expect(
      boundedPlatformScript(
        script(
          'seq_5',
          Array.from({ length: PLATFORM_SCRIPT_STEPS_MAX }, () => 0),
        ),
      ),
    ).not.toBeNull();

    const plan = planPlatformScripts([known('b', script('seq_2'))], [tooMany, tooManyMedia, base]);
    expect(plan.refused).toBe(2);
    expect(plan.added.map((each) => each.ref.id)).toEqual(['seq_1']);
    expect([plan.changed, plan.unchanged, plan.gone]).toEqual([[], [], []]);
  });

  it('says a change of order, price, text or media in the fingerprint, nothing else', () => {
    const base = script('seq_1');
    const same = script('seq_1');
    expect(platformScriptFingerprint(same)).toBe(platformScriptFingerprint(base));
    const [first, second, third] = base.steps;
    if (first === undefined || second === undefined || third === undefined) throw new Error('three steps');
    const variants: PlatformScript[] = [
      { ...base, steps: [first, third, second] },
      { ...base, steps: [first, second, { ...third, priceMinor: 3_100 }] },
      { ...base, steps: [first, second, { ...third, text: 'Autre texte' }] },
      { ...base, steps: [first, second, { ...third, previewMedia: [{ ref: reveal('m'), kind: 'video' }] }] },
      { ...base, name: 'Autre nom' },
      { ...base, moment: 'day' },
    ];
    for (const variant of variants)
      expect(platformScriptFingerprint(variant)).not.toBe(platformScriptFingerprint(base));
  });
});

describe('the price warnings of P6-01, never a refusal', () => {
  const eur = (priceMinor: number) => ({ priceMinor, currency: 'EUR' as const });
  /** A script without branches: each step on its own rank. */
  const line = (...steps: { priceMinor: number; currency: 'EUR' | 'USD' }[]) =>
    steps.map((step, platformIndex) => ({ ...step, platformIndex }));
  const at = (platformIndex: number, priceMinor: number) => ({ ...eur(priceMinor), platformIndex });

  it('warns a paid step over twice the paid step before it, offered steps skipped', () => {
    expect(priceWarnings(line(eur(1_000), eur(0), eur(2_000), eur(2_100), eur(0), eur(4_300)))).toEqual([
      { code: 'price_more_than_double', position: 5 },
      { code: 'price_above_ceiling', position: 5 },
    ]);
  });

  it('warns a step above 40 € VAT included, and none at exactly 40 €', () => {
    expect(priceWarnings(line(eur(4_000), eur(4_001)))).toEqual([
      { code: 'price_above_ceiling', position: 1 },
    ]);
  });

  it('compares nothing across two currencies, nor the first paid step', () => {
    expect(priceWarnings(line(eur(500), { priceMinor: 2_000, currency: 'USD' }))).toEqual([]);
    expect(priceWarnings(line(eur(0), eur(3_000)))).toEqual([]);
  });

  it('reads branches path by path, never one branch after its neighbour (ADR 0112 § 14)', () => {
    // Rank 1 has a cheap branch and a premium one: 2 500 follows 1 000 on one path only, still warned.
    expect(priceWarnings([at(0, 1_000), at(1, 1_200), at(1, 2_500), at(2, 2_400)])).toEqual([
      { code: 'price_more_than_double', position: 2 },
    ]);
    // Two branches at the same price, side by side: neither follows the other.
    expect(priceWarnings([at(0, 500), at(1, 900), at(1, 900)])).toEqual([]);
  });

  it('keeps the paid step before an offered branch on its path', () => {
    // An offered branch at rank 1 carries the 1 000 of rank 0 to rank 2: 2 100 is more than double on that path.
    expect(priceWarnings([at(0, 1_000), at(1, 0), at(1, 1_500), at(2, 2_100)])).toEqual([
      { code: 'price_more_than_double', position: 3 },
    ]);
  });
});

describe('the staircase of paid steps (ADR 0098 and ADR 0112 § 14, avenant du 27/11/2026)', () => {
  const at = (platformIndex: number, priceMinor: number, spendBranch?: boolean) => ({
    platformIndex,
    priceMinor,
    currency: 'EUR' as const,
    ...(spendBranch !== undefined && { spendBranch }),
  });

  it('asks each paid step to cost strictly more than the last paid one, free bridges skipped, nothing more', () => {
    expect(
      priceNotAbovePrevious([at(0, 0), at(1, 1_000), at(2, 0), at(3, 1_100), at(4, 0), at(5, 1_200)]),
    ).toEqual([]);
    // The same price as the last paid step, across a free bridge: refused; cheaper: refused.
    expect(priceNotAbovePrevious([at(0, 1_000), at(1, 0), at(2, 1_000), at(3, 900)])).toEqual([2, 3]);
  });

  it('reads branches path by path, a free branch carrying the paid step before it', () => {
    // Rank 1: a free branch and a paid one. On the free branch's path, 1 100 follows 1 000; on the other, 1 200.
    expect(priceNotAbovePrevious([at(0, 1_000), at(1, 0), at(1, 1_200), at(2, 1_100)])).toEqual([3]);
    expect(priceNotAbovePrevious([at(0, 1_000), at(1, 0), at(1, 1_200), at(2, 1_300)])).toEqual([]);
  });

  it('reads a branch on his spend against the agency’s jump setting, and as any step without it', () => {
    // Invented setting.
    const options = { spendBranchJumpMultiple: 2.4 };
    expect(priceWarnings([at(0, 1_000), at(1, 2_400, true)], options)).toEqual([]);
    expect(priceWarnings([at(0, 1_000), at(1, 2_500, true)], options)).toEqual([
      { code: 'price_jump_over_setting', position: 1 },
    ]);
    expect(priceWarnings([at(0, 1_000), at(1, 2_400, true)])).toEqual([
      { code: 'price_more_than_double', position: 1 },
    ]);
    expect(priceWarnings([at(0, 1_000), at(1, 2_400)], options)).toEqual([
      { code: 'price_more_than_double', position: 1 },
    ]);
  });
});

describe('what keeps a native script from being proposable', () => {
  const inVault: StepMediaState = {
    kind: 'image',
    inVault: true,
    imported: true,
    described: true,
    offered: false,
  };
  const one = (fields: Partial<StepMediaState>): StepMediaState => ({ ...inVault, ...fields });
  const step = (_platformIndex: number, ...media: StepMediaState[]) => ({
    discounted: false,
    paid: true,
    media,
    sold: media,
  });

  it('needs each media in the vault and described, and the identity validated', () => {
    expect(platformScriptGaps([step(0, inVault), step(1, inVault)], true, [])).toEqual([]);
    expect(platformScriptGaps([step(0, inVault)], false, [])).toEqual(['identity_not_validated']);
    expect(
      platformScriptGaps(
        [
          step(0, inVault, one({ kind: 'image', inVault: false, imported: false, described: false })),
          step(1, one({ kind: 'image', inVault: true, imported: true, described: false })),
        ],
        true,
        [],
      ),
    ).toEqual(['media_absent', 'media_not_described']);
  });

  it('never offers a script whose media is in the vault but not imported into the CRM (ADR 0145 § 5)', () => {
    expect(
      platformScriptGaps(
        [step(0, inVault, one({ kind: 'image', inVault: true, imported: false, described: true }))],
        true,
        [],
      ),
    ).toEqual(['media_not_imported']);
    // A voice note too: the agent does not see what is not in the CRM.
    expect(
      platformScriptGaps(
        [step(0, one({ kind: 'audio', inVault: true, imported: false, described: false }))],
        true,
        [],
      ),
    ).toEqual(['media_not_imported']);
  });

  it('never waits for a voice note to be described: the vision never hears one', () => {
    expect(
      platformScriptGaps(
        [step(0, one({ kind: 'audio', inVault: true, imported: true, described: false }))],
        true,
        [],
      ),
    ).toEqual([]);
  });

  it('never offers a script with a « Tarif réduit » on a step: never sold at a discount (recette 16/11)', () => {
    expect(
      platformScriptGaps([step(0, inVault), { ...step(1, inVault), discounted: true }], true, []),
    ).toEqual(['step_discounted']);
  });

  it('never sells a media offered once: a paid step with one is a gap, an offered step or a preview is not (ADR 0145 § 2)', () => {
    const offered = one({ offered: true });
    expect(platformScriptGaps([step(0, inVault), step(1, offered)], true, [])).toEqual(['media_offered']);
    // Sent for free again by a free step: nothing is sold.
    expect(platformScriptGaps([{ ...step(0, offered), paid: false }], true, [])).toEqual([]);
    // Shown before the purchase, not sold.
    expect(
      platformScriptGaps(
        [{ discounted: false, paid: true, media: [inVault, offered], sold: [inVault] }],
        true,
        [],
      ),
    ).toEqual([]);
    // Absent from the vault: `media_absent` says it, not this.
    expect(
      platformScriptGaps([step(0, one({ inVault: false, imported: false, offered: true }))], true, []),
    ).toEqual(['media_absent']);
  });

  it('adds what its branches lack (ADR 0112)', () => {
    expect(platformScriptGaps([step(0, inVault), step(1, inVault)], true, ['branch_unsettled'])).toEqual([
      'branch_unsettled',
    ]);
  });
});

describe('the fingerprint of a native script', () => {
  it('changes when a « Tarif réduit » is set or taken off, and stays the same for a step without one', () => {
    const plain = script('s1');
    const discounted: PlatformScript = {
      ...plain,
      steps: plain.steps.map((each, index) =>
        index === 1 ? { ...each, discount: { priceMinor: 1_000, minutes: 60 } } : each,
      ),
    };
    expect(platformScriptFingerprint(discounted)).not.toBe(platformScriptFingerprint(plain));
    // The fingerprint of a script without one is the one it had before discounts were read: no rewrite for nothing.
    const canonical = JSON.stringify([
      plain.name,
      plain.moment,
      plain.steps.map((step) => [
        step.ref.id,
        step.index,
        step.platformIndex,
        step.name,
        step.text,
        step.priceMinor,
        step.currency,
        step.media.map((media) => [media.ref.id, media.kind]),
        step.previewMedia.map((media) => [media.ref.id, media.kind]),
      ]),
    ]);
    expect(platformScriptFingerprint(plain)).toBe(createHash('sha256').update(canonical).digest('hex'));
  });

  it('changes with the platform rank of a step, so that branches appearing rewrite the script', () => {
    const plain = script('s1');
    const branched: PlatformScript = {
      ...plain,
      steps: plain.steps.map((each, index) => ({ ...each, platformIndex: Math.min(index, 1) })),
    };
    expect(platformScriptFingerprint(branched)).not.toBe(platformScriptFingerprint(plain));
  });
});

describe('the descriptions of a script’s media, validated as shown (ADR 0030 § 3, ADR 0099 § 4)', () => {
  const shown = new Map([
    ['d1', { reviewReasons: [], validated: false }],
    ['d2', { reviewReasons: [], validated: false }],
    ['d3', { reviewReasons: ['unsure'], validated: false }],
    ['d4', { reviewReasons: ['flagged'], validated: true }],
  ]);

  it('takes those shown now, several at once, and one that waits for a reason only alone', () => {
    expect(descriptionRefusal(['d1', 'd2'], shown)).toBeNull();
    expect(descriptionRefusal(['d3'], shown)).toBeNull();
    expect(descriptionRefusal(['d1', 'd3'], shown)).toBe('alone');
    // Already validated, its reason no longer holds the others back.
    expect(descriptionRefusal(['d1', 'd4'], shown)).toBeNull();
  });

  it('refuses one that is not shown for a media of the script now', () => {
    expect(descriptionRefusal(['d1', 'old'], shown)).toBe('stale');
  });
});

describe('the platform’s totals of each step (ADR 0129 § 12)', () => {
  /** Its first step counted by the platform, the others not. */
  const counted = (id: string, sent: number, ref = `${id}_step_0`): PlatformScript => {
    const base = script(id);
    return {
      ...base,
      steps: base.steps.map((step, index) =>
        index === 0 ? { ...step, ref: reveal(ref), totals: { sent, purchased: 1, paidMinor: 0 } } : step,
      ),
    };
  };

  it('never make a new version of the script: a send more is not a change', () => {
    expect(platformScriptFingerprint(counted('s', 3))).toBe(platformScriptFingerprint(counted('s', 4)));
    expect(platformScriptFingerprint(counted('s', 3))).toBe(platformScriptFingerprint(script('s')));
  });

  it('are kept a step once, only where the platform gave them, never for a ref the base cannot hold', () => {
    const tooLong = counted('l', 2, 'x'.repeat(PLATFORM_SCRIPT_REF_MAX + 1));
    // The same step listed twice (a read that moved): the last count.
    expect(stepTotalsOf([counted('a', 5), counted('a', 7), tooLong])).toEqual([
      { platformStepRef: 'a_step_0', sent: 7, purchased: 1, paidMinor: 0, currency: 'EUR' },
    ]);
  });
});
