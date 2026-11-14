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
  planPlatformScripts,
  platformScriptFingerprint,
  platformScriptGaps,
  priceWarnings,
  type KnownPlatformScript,
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
      name: `Étape ${String(index + 1)}`,
      text: 'Texte inventé',
      media: [{ ref: reveal(`${id}_media_${String(index)}`), kind: 'image' as const }],
      previewMedia: [],
      priceMinor,
      currency: 'EUR' as const,
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

  it('warns a paid step over twice the paid step before it, offered steps skipped', () => {
    expect(priceWarnings([eur(1_000), eur(0), eur(2_000), eur(2_100), eur(0), eur(4_300)])).toEqual([
      { code: 'price_more_than_double', position: 5 },
      { code: 'price_above_ceiling', position: 5 },
    ]);
  });

  it('warns a step above 40 € VAT included, and none at exactly 40 €', () => {
    expect(priceWarnings([eur(4_000), eur(4_001)])).toEqual([{ code: 'price_above_ceiling', position: 1 }]);
  });

  it('compares nothing across two currencies, nor the first paid step', () => {
    expect(priceWarnings([eur(500), { priceMinor: 2_000, currency: 'USD' }])).toEqual([]);
    expect(priceWarnings([eur(0), eur(3_000)])).toEqual([]);
  });
});

describe('what keeps a native script from being proposable', () => {
  const inVault = { inVault: true, described: true };

  it('needs each media in the vault and described, and the identity validated', () => {
    expect(platformScriptGaps([{ media: [inVault] }, { media: [inVault] }], true)).toEqual([]);
    expect(platformScriptGaps([{ media: [inVault] }], false)).toEqual(['identity_not_validated']);
    expect(
      platformScriptGaps(
        [
          { media: [inVault, { inVault: false, described: false }] },
          { media: [{ inVault: true, described: false }] },
        ],
        true,
      ),
    ).toEqual(['media_absent', 'media_not_described']);
  });
});
