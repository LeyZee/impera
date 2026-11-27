import { CopilotAssistSchema, type CopilotAssist, type FanStanding } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { HEAT_MARK, heatOf, type HeatInput } from './heat';
import { standingOf } from './standing';

/* Invented data (ADR 0010). */
const NOW = new Date('2026-11-27T21:00:00Z');

const assist = (patch: Partial<CopilotAssist> = {}): CopilotAssist =>
  CopilotAssistSchema.parse({
    nextMove: null,
    reasons: [],
    sale: null,
    signals: { desireTrend: null, followUpDue: false },
    cuts: [],
    buttons: [],
    clicksLeftToday: 30,
    ...patch,
  });

const money = (lastPurchaseAt: string | null): FanStanding => ({
  tier: null,
  spentMinor: 4_500,
  lastPurchaseAt,
});

const input = (patch: Partial<HeatInput> = {}): HeatInput => ({
  standing: standingOf({}, 'hot'),
  money: money(null),
  assist: assist(),
  cut: null,
  now: NOW,
  ...patch,
});

const good = assist({
  nextMove: { kind: 'offer_step', label: 'Proposer l’étape 3', priceMinor: 1_500, block: null },
  saleMoment: { verdict: 'good', conditions: [{ code: 'fan_asks_for_paid', met: true }] },
});

describe('his desire as fire (maquette v4, 27/11)', () => {
  it('places each band under the line and says it in the glossary’s words', () => {
    for (const [band, word] of [
      ['neutral', 'neutre'],
      ['playful', 'joueur'],
      ['hot', 'chaud'],
    ] as const) {
      const heat = heatOf(input({ standing: standingOf({}, band) }));
      expect(heat?.word).toBe(word);
      expect(heat?.lit).toBe(false);
      expect(heat?.level).toBeLessThan(HEAT_MARK);
    }
  });

  it('warms from cold to hot as the band rises', () => {
    const levels = (['neutral', 'playful', 'hot'] as const).map(
      (band) => heatOf(input({ standing: standingOf({}, band) }))?.level ?? 0,
    );
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it('crosses the line and burns only when the code says it is the moment to sell', () => {
    const heat = heatOf(input({ assist: good }));
    expect(heat).toMatchObject({ lit: true, rest: false, word: 'brûlant' });
    expect(heat?.level).toBeGreaterThan(HEAT_MARK);
  });

  it('names what is missing next to his band, never a figure', () => {
    const heat = heatOf(
      input({
        assist: assist({
          saleMoment: {
            verdict: 'soon',
            conditions: [
              { code: 'availability_unconfirmed', met: false },
              { code: 'desire_below_threshold', met: true },
            ],
          },
        }),
      }),
    );
    expect(heat?.word).toBe('chaud · il manque sa dispo');
    expect(heat?.label).not.toMatch(/\d/u);
  });

  it('nudges with his direction without ever crossing the line', () => {
    const flat = heatOf(input())?.level ?? 0;
    const up = heatOf(input({ assist: assist({ signals: { desireTrend: 'up', followUpDue: false } }) }));
    const down = heatOf(input({ assist: assist({ signals: { desireTrend: 'down', followUpDue: false } }) }));
    expect(up?.level).toBeGreaterThan(flat);
    expect(up?.level).toBeLessThan(HEAT_MARK);
    expect(down?.level).toBeLessThan(flat);
    expect(up?.label).toContain('en hausse');
  });

  it('rests after a purchase for the pause of the method, unless the script goes on tonight', () => {
    const bought = money('2026-11-27T20:40:00Z');
    expect(heatOf(input({ money: bought }))).toMatchObject({
      rest: true,
      lit: false,
      color: null,
      word: 'après achat · pause 48 h',
    });
    expect(heatOf(input({ money: bought, assist: good }))?.lit).toBe(true);
    expect(heatOf(input({ money: money('2026-11-25T20:00:00Z') }))?.rest).toBe(false);
  });

  it('says nothing of his desire under a cut, a contested age, or before his band is known', () => {
    expect(heatOf(input({ cut: 'sales_frozen' }))).toBeNull();
    expect(heatOf(input({ standing: { ...standingOf({}, 'hot'), ageDisputed: true } }))).toBeNull();
    expect(heatOf(input({ standing: standingOf({}, null) }))).toBeNull();
    expect(heatOf(input({ standing: null }))).toBeNull();
  });
});
