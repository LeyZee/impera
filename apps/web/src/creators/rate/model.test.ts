import {
  AgencyShareAlertSchema,
  CreatorAgencyRateSchema,
  ObservedAgencyShareSchema,
  type CreatorAgencyRateList,
  type ObservedAgencyShare,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  alertText,
  bpsOfPercent,
  confirmSentence,
  dayLabel,
  gapText,
  earliestDay,
  nextDay,
  percentOf,
  readAt,
  shareText,
  shareWhere,
  sheetHead,
  singleShare,
  standing,
  windowLabel,
} from './model';

/* An invented creator and percentages: never the agency's own. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const rate = (id: string, fromDay: string, agencyBps: number) =>
  CreatorAgencyRateSchema.parse({
    id,
    creatorId: CREATOR,
    fromDay,
    agencyBps,
    createdAt: '2026-11-03T10:00:00.000Z',
  });
const NOTHING_READ = {
  linked: false,
  last30Days: { from: '2026-10-05', to: '2026-11-03', shares: [] },
  fortnights: [],
};

describe('what the owner types as a percentage (CR-04)', () => {
  it('reads whole and decimal percentages as basis points, a comma or a point', () => {
    expect(bpsOfPercent('35')).toBe(3500);
    expect(bpsOfPercent(' 35,5 ')).toBe(3550);
    expect(bpsOfPercent('35.25')).toBe(3525);
    expect(bpsOfPercent('35 %')).toBe(3500);
    expect(bpsOfPercent('0')).toBe(0);
    expect(bpsOfPercent('100')).toBe(10_000);
  });

  it('refuses anything else: no guess, no rounding', () => {
    for (const text of ['', 'trente', '35,555', '100,01', '101', '-5', '3 5', '1e2', ',5']) {
      expect(bpsOfPercent(text), text).toBeNull();
    }
  });
});

describe('how a percentage and its day are said', () => {
  it('writes the sign after a non-breaking space, the decimals only when there are some', () => {
    expect(percentOf(3500)).toBe('35\u00a0%');
    expect(percentOf(3550)).toBe('35,5\u00a0%');
    expect(percentOf(3525)).toBe('35,25\u00a0%');
    expect(confirmSentence(3500, '2026-11-10')).toBe('35\u00a0% pour l’agence à partir du 10 novembre 2026.');
  });

  it('writes a day the French way and counts the next on the calendar', () => {
    expect(dayLabel('2026-11-10')).toBe('10 novembre 2026');
    expect(dayLabel('2026-10-01')).toBe('1er octobre 2026');
    expect(nextDay('2026-11-30')).toBe('2026-12-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
  });
});

describe('where a percentage stands', () => {
  const first = rate('0192f3a0-0000-7000-8000-0000000000e1', '2026-11-01', 3500);
  const next = rate('0192f3a0-0000-7000-8000-0000000000e2', '2026-11-20', 3000);
  const older = rate('0192f3a0-0000-7000-8000-0000000000e0', '2026-10-01', 4000);

  it('lets her first start today, and any later one tomorrow at the earliest', () => {
    expect(
      earliestDay({ today: '2026-11-03', current: null, rates: [], observed: NOTHING_READ, alerts: [] }),
    ).toBe('2026-11-03');
    expect(
      earliestDay({
        today: '2026-11-03',
        current: first,
        rates: [first],
        observed: NOTHING_READ,
        alerts: [],
      }),
    ).toBe('2026-11-04');
  });

  it('marks the one the server says is in force, those to come, and those replaced', () => {
    const list = {
      today: '2026-11-03',
      current: first,
      rates: [next, first, older],
      observed: NOTHING_READ,
      alerts: [],
    };
    expect(standing(first, list)).toBe('current');
    expect(standing(next, list)).toBe('coming');
    expect(standing(older, list)).toBe('past');
  });
});

describe('the agency’s share read at the platform (ADR 0054 § 4)', () => {
  const share = (platformAccountId: string, patch: object = {}) =>
    ObservedAgencyShareSchema.parse({
      platform: 'reveal',
      platformAccountId,
      currency: 'EUR',
      netMinor: 1800,
      agencyMinor: 700,
      agencyBps: 3889,
      differsFromRate: null,
      ...patch,
    });
  const A = '0192f3a0-0000-7000-8000-0000000000a1';
  const B = '0192f3a0-0000-7000-8000-0000000000a2';

  it('says the ratio and the two sums it comes from, never computed again', () => {
    expect(shareText(share(A))).toEqual({
      value: '38,89\u00a0% du net',
      detail: '7,00\u00a0€ pour l’agence sur 18,00\u00a0€ nets',
    });
    expect(shareText(share(A, { agencyBps: null, netMinor: -100, agencyMinor: 0 })).value).toBe('—');
  });

  it('names an account only when she has several, and a currency other than the euro', () => {
    const shares = [share(A), share(A, { currency: 'USD' }), share(B)];
    expect(shareWhere(share(A), [share(A)])).toBeNull();
    expect(shareWhere(share(A, { currency: 'USD' }), [share(A), share(A, { currency: 'USD' })])).toBe(
      'en USD',
    );
    expect(readAt([share(A)])).toBe('Reveal');
    expect(readAt([])).toBe('Reveal');
    expect(readAt([share(A), share(B, { platform: 'onlyfans' })])).toBe('la plateforme');
    expect(shareWhere(share(A, { currency: 'USD' }), shares)).toBe('Reveal 1, en USD');
    expect(shareWhere(share(B), shares)).toBe('Reveal 2');
  });

  it('writes a fortnight short, and puts one share in the head only when it is alone', () => {
    expect(windowLabel({ from: '2026-11-01', to: '2026-11-15' }, '2026-11-20')).toBe('du 1er au 15 novembre');
    expect(windowLabel({ from: '2026-10-16', to: '2026-11-03' }, '2026-11-20')).toBe(
      'du 16 octobre au 3 novembre',
    );
    expect(windowLabel({ from: '2026-11-16', to: '2026-11-16' }, '2026-11-16')).toBe('aujourd’hui');
    expect(windowLabel({ from: '2026-11-16', to: '2026-11-16' }, '2026-11-20')).toBe('le 16 novembre');
    const list = (shares: ObservedAgencyShare[]) => ({
      today: '2026-11-03',
      current: null,
      rates: [],
      observed: { ...NOTHING_READ, last30Days: { ...NOTHING_READ.last30Days, shares } },
      alerts: [],
    });
    expect(singleShare(list([share(A)]))).toEqual(share(A));
    expect(singleShare(list([share(A), share(B)]))).toBeNull();
    expect(singleShare(list([share(A, { agencyBps: null })]))).toBeNull();
  });

  it('heads the sheet with the share read, the percentage second; « à régler » only with nothing linked nor set', () => {
    const rateOf = rate('0192f3a0-0000-7000-8000-0000000000e1', '2026-10-01', 3500);
    const sheet = (
      patch: Partial<CreatorAgencyRateList>,
      observed: Partial<CreatorAgencyRateList['observed']> = {},
    ) =>
      sheetHead(
        {
          today: '2026-11-03',
          current: null,
          rates: [],
          alerts: [],
          ...patch,
          observed: { ...NOTHING_READ, ...observed },
        },
        'Anna',
      );
    const read = { last30Days: { ...NOTHING_READ.last30Days, shares: [share(A)] }, linked: true };
    expect(sheet({}, read)).toEqual({
      dot: 'ok',
      lead: 'Lue chez Reveal : 38,89\u00a0% du net sur 30 jours.',
      then: 'Le pourcentage est facultatif.',
    });
    expect(sheet({ current: rateOf, rates: [rateOf] }, read).then).toBe(
      'Pourcentage réglé : 35\u00a0% depuis le 1er octobre 2026.',
    );
    expect(sheet({}, { linked: true })).toEqual({
      dot: 'idle',
      lead: 'Aucune vente lue chez Reveal sur 30 jours.',
      then: 'Le pourcentage est facultatif.',
    });
    expect(sheet({}).dot).toBe('warn');
    expect(sheet({ current: rateOf, rates: [rateOf] }).lead).toBe(
      '35\u00a0% pour l’agence aujourd’hui, depuis le 1er octobre 2026.',
    );
  });

  it('warns in amber when the share read differs from her percentage, as the server reads it (V-PIL-25)', () => {
    const rateOf = rate('0192f3a0-0000-7000-8000-0000000000e1', '2026-10-01', 4000);
    const head = (shares: ObservedAgencyShare[], current: typeof rateOf | null = rateOf) =>
      sheetHead(
        {
          today: '2026-11-16',
          current,
          rates: current === null ? [] : [current],
          observed: { ...NOTHING_READ, linked: true, last30Days: { ...NOTHING_READ.last30Days, shares } },
          alerts: [],
        },
        'Anna',
      );
    expect(head([share(A, { agencyBps: 3750, differsFromRate: true })])).toEqual({
      dot: 'warn',
      lead: 'Écart : Reveal donne 37,5\u00a0% du net sur 30 jours, tu as réglé 40\u00a0%.',
      then: 'Vérifie le partage chez Reveal ou règle un nouveau pourcentage ci-dessous.',
    });
    expect(head([share(A, { differsFromRate: true }), share(B, { differsFromRate: false })]).lead).toBe(
      'Écart : un compte s’écarte des 40\u00a0% réglés, sur 30 jours (détail ci-dessous).',
    );
    // A window straddling a change of percentage names none: each of its days was compared with its own.
    const later = rate('0192f3a0-0000-7000-8000-0000000000e2', '2026-11-10', 3500);
    const straddling = sheetHead(
      {
        today: '2026-11-16',
        current: later,
        rates: [later, rateOf],
        observed: {
          ...NOTHING_READ,
          linked: true,
          last30Days: {
            from: '2026-10-18',
            to: '2026-11-16',
            shares: [share(A, { agencyBps: 3750, differsFromRate: true })],
          },
        },
        alerts: [],
      },
      'Anna',
    );
    expect(straddling.lead).toBe(
      'Écart : Reveal donne 37,5\u00a0% du net sur 30 jours, loin du pourcentage réglé sur ces jours.',
    );
    expect(gapText({ rates: [later, rateOf] }, { from: '2026-10-16', to: '2026-10-31' })).toBe(
      'écart avec les 40\u00a0% réglés',
    );
    expect(gapText({ rates: [later, rateOf] }, { from: '2026-11-01', to: '2026-11-15' })).toBe(
      'écart avec le pourcentage réglé',
    );
    expect(gapText({ rates: [rateOf] }, { from: '2026-09-20', to: '2026-10-05' })).toBe(
      'écart avec le pourcentage réglé',
    );
    expect(head([share(A, { agencyBps: 4000, differsFromRate: false })]).dot).toBe('ok');
    expect(head([share(A, { differsFromRate: null })]).dot).toBe('ok');
  });

  it('says each alert of the automatic check on its fortnight, never an amount (PAY-04)', () => {
    const base = {
      id: '0192f3a0-0000-7000-8000-0000000000f1',
      at: '2026-11-02T05:30:00.000Z',
      from: '2026-10-16',
      to: '2026-10-31',
      platform: 'reveal',
      platformAccountId: A,
      currency: 'EUR',
    };
    const list = (alerts: CreatorAgencyRateList['alerts']): CreatorAgencyRateList => ({
      today: '2026-11-16',
      current: null,
      rates: [],
      observed: { ...NOTHING_READ, linked: true },
      alerts,
    });
    const mismatch = AgencyShareAlertSchema.parse({ ...base, kind: 'mismatch' });
    const changed = AgencyShareAlertSchema.parse({
      ...base,
      kind: 'changed',
      previousAgencyBps: 3333,
      agencyBps: 3750,
    });
    expect(alertText(mismatch, list([mismatch]))).toBe(
      'Alerte du 2 novembre, quinzaine du 16 au 31 octobre : sa part lue s’écartait du pourcentage réglé.',
    );
    expect(alertText(changed, list([changed]))).toBe(
      'Alerte du 2 novembre, quinzaine du 16 au 31 octobre : la part de l’agence est passée de 33,33\u00a0% à 37,5\u00a0%.',
    );
    // Two accounts: each alert names its own.
    const other = AgencyShareAlertSchema.parse({
      ...base,
      kind: 'mismatch',
      id: '0192f3a0-0000-7000-8000-0000000000f2',
      platformAccountId: B,
    });
    expect(alertText(other, list([mismatch, other]))).toBe(
      'Alerte du 2 novembre, quinzaine du 16 au 31 octobre, Reveal 2 : sa part lue s’écartait du pourcentage réglé.',
    );
  });
});
