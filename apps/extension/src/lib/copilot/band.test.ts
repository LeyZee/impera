import { CopilotAssistSchema, type CopilotAssist } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { bandBadges } from './band';
import { standingOf } from './standing';

/* Invented data (ADR 0010). */
const assist = (patch: Partial<CopilotAssist> = {}): CopilotAssist =>
  CopilotAssistSchema.parse({
    nextMove: null,
    reasons: [],
    sale: {
      script: null,
      nextStep: null,
      refusedSteps: [],
      usedObjections: [],
      customOrderOpen: false,
      offerPending: false,
    },
    signals: { desireTrend: null, followUpDue: false },
    cuts: [],
    buttons: [],
    clicksLeftToday: 30,
    ...patch,
  });

const words = (result: ReturnType<typeof bandBadges>): string[] => result.badges.map(({ words }) => words);

describe('the status band (Design 16/11, lot 0141-3)', () => {
  it('draws no badge when there is nothing to say', () => {
    expect(bandBadges(standingOf({}, null), null, null, false)).toEqual({ badges: [], hidden: 0 });
  });

  it('says what forbids in red first, what holds back in amber, then his desire as a flame and its direction', () => {
    const standing = standingOf(
      { salesFrozen: { reason: 'money_trouble', since: '2026-10-02T10:00:00Z' }, fragile: true },
      'hot',
    );
    const { badges } = bandBadges(
      standing,
      assist({ signals: { desireTrend: 'up', followUpDue: false } }),
      null,
      false,
    );
    expect(badges.map(({ kind, tone, icon }) => [kind, tone, icon])).toEqual([
      ['stop', 'red', 'ban'],
      ['care', 'amber', 'alert'],
      ['desire', 'neutral', 'flame'],
    ]);
    expect(badges[2]).toMatchObject({
      words: 'chaud',
      trend: 'up',
      // Next to a stop, his desire is said without its tint (Design 16/11, lot 0141-5).
      band: null,
      label: 'Désir chaud, en hausse',
    });
    expect(badges[0]?.band).toBeNull();
  });

  it('gives his desire its direction only, never a flat one, and none under a cut', () => {
    const down = bandBadges(
      standingOf({}, 'neutral'),
      assist({ signals: { desireTrend: 'down', followUpDue: false } }),
      null,
      false,
    );
    expect(down.badges[0]).toMatchObject({
      words: 'neutre',
      trend: 'down',
      label: 'Désir neutre, en baisse',
    });
    const flat = bandBadges(
      standingOf({}, 'playful'),
      assist({ signals: { desireTrend: 'flat', followUpDue: false } }),
      null,
      false,
    );
    // Nothing forbids: its band carries the ramp of tints (Design 16/11, lot 0141-5).
    expect(flat.badges[0]).toMatchObject({ trend: null, band: 'playful', label: 'Désir joueur' });
    const cut = bandBadges(
      standingOf({ fragile: true }, 'hot'),
      assist({ signals: { desireTrend: 'up', followUpDue: true } }),
      'care',
      false,
    );
    expect(words(cut)).toEqual(['Fan fragile', 'chaud']);
    expect(cut.badges[1]?.trend).toBeNull();
  });

  it('says nothing of his desire next to a contested age', () => {
    const contested = standingOf({ ageDisputed: { since: '2026-10-02T10:00:00Z', by: 'human' } }, 'hot');
    expect(words(bandBadges(contested, assist(), 'age_doubt', false))).toEqual(['Âge contesté']);
  });

  it('adds the signals not to miss up to three badges, the rest behind « +N », what holds back never folded', () => {
    const pending = assist({ signals: { desireTrend: null, followUpDue: true } });
    if (pending.sale === null) throw new Error('sale');
    const lively = { ...pending, sale: { ...pending.sale, offerPending: true } };
    expect(words(bandBadges(standingOf({}, 'hot'), lively, null, false))).toEqual([
      'chaud',
      'Relance due',
      'Offre sans réponse',
    ]);
    const held = bandBadges(
      standingOf({ salesFrozen: { reason: 'money_trouble', since: '2026-10-02T10:00:00Z' } }, 'hot'),
      lively,
      null,
      false,
    );
    expect(words(held)).toEqual(['Ventes gelées', 'chaud', 'Relance due']);
    expect(held.hidden).toBe(1);
    expect(
      words(
        bandBadges(
          standingOf({ salesFrozen: { reason: 'money_trouble', since: '2026-10-02T10:00:00Z' } }, 'hot'),
          lively,
          null,
          true,
        ),
      ),
    ).toHaveLength(4);
    const many = bandBadges(
      standingOf({ fragile: true, noExplicit: true, spendingLimitMinor: 5000 }, 'hot'),
      lively,
      null,
      false,
    );
    expect(many.badges.filter(({ kind }) => kind === 'care')).toHaveLength(3);
    expect(many.hidden).toBe(2);
  });

  it('says limits not read in amber, never as nothing to say', () => {
    expect(bandBadges(standingOf('unread', null), null, 'limits_unread', false).badges).toMatchObject([
      { tone: 'amber', words: 'Limites non lues' },
    ]);
  });
});
