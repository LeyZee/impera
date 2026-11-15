import { newId, PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  myDays,
  myLines,
  pageOfLines,
  placeOfLine,
  type OwnGift,
  type OwnSignal,
  type OwnStatementSale,
} from '../my-sales';
import { saleIdOf, saleKeyOf } from '../sales';

/** Invented lines only (ADR 0010): Théo's own statement on an account in euros. */
const ACCOUNT = newId(PlatformAccountIdSchema);

const line = (id: string, at: string | null, netMinor = 4_200): OwnStatementSale => ({
  platform: 'reveal',
  platformSaleId: id,
  event: netMinor < 0 ? 'refund' : 'sale',
  platformAccountId: ACCOUNT,
  currency: 'EUR',
  netMinor,
  lateFrom: null,
  occurredAt: at === null ? null : new Date(at),
  shareBp: null,
});

const signalOn = (
  on: OwnStatementSale,
  kind: OwnSignal['kind'] = 'signal',
  note: string | null = 'Vendue pendant le shift de Lou',
): OwnSignal => ({
  platform: on.platform,
  platformSaleId: on.platformSaleId,
  event: on.event,
  kind,
  note,
  createdAt: new Date('2026-10-29T08:00:00.000Z'),
  platformAccountId: on.platformAccountId,
  currency: on.currency,
  netMinor: on.netMinor,
  occurredAt: on.occurredAt,
});

const NONE = new Set<string>();

describe('a member’s own sales (CRM-03 lot b4c, ADR 0050 § 10)', () => {
  const evening = line('vente-1', '2026-10-28T21:00:00.000Z');
  const morning = line('vente-2', '2026-10-28T08:00:00.000Z', 2_500);
  const refund = line('vente-3', '2026-10-30T09:15:00.000Z', -1_000);
  const older = line('vente-4', null, 900);

  it('lists the lines of their statement the most recent first, signalled or counted, a gesture open on each', () => {
    const lines = myLines({
      statement: [morning, older, evening, refund],
      signals: [signalOn(evening), signalOn(morning, 'withdraw', null)],
      excluded: NONE,
      registered: NONE,
      closed: false,
    });
    expect(lines.map((one) => [one.platformSaleId, one.state, one.signal?.note ?? null, one.open])).toEqual([
      ['vente-3', 'counted', null, true],
      ['vente-1', 'signalled', 'Vendue pendant le shift de Lou', true],
      ['vente-2', 'counted', null, true],
      ['vente-4', 'counted', null, true],
    ]);
  });

  it('keeps a signalled line once it has left the statement, excluded or removed, with what the signal kept', () => {
    const lines = myLines({
      statement: [morning],
      signals: [signalOn(evening), signalOn(refund), signalOn(older, 'withdraw', null)],
      excluded: new Set([saleIdOf(evening)]),
      registered: NONE,
      closed: false,
    });
    expect(lines.map((one) => [one.platformSaleId, one.state, one.netMinor, one.open])).toEqual([
      ['vente-3', 'removed', -1_000, false],
      ['vente-1', 'excluded', 4_200, false],
      ['vente-2', 'counted', 2_500, true],
    ]);
  });

  it('closes every gesture on a closed period, and on a line a closing counted', () => {
    const closed = myLines({
      statement: [evening, morning],
      signals: [signalOn(evening)],
      excluded: NONE,
      registered: NONE,
      closed: true,
    });
    expect(closed.map((one) => [one.state, one.open])).toEqual([
      ['signalled', false],
      ['counted', false],
    ]);
    const counted = myLines({
      statement: [evening, morning],
      signals: [],
      excluded: NONE,
      registered: new Set([saleKeyOf(morning)]),
      closed: false,
    });
    expect(counted.map((one) => [one.platformSaleId, one.open])).toEqual([
      ['vente-1', true],
      ['vente-2', false],
    ]);
  });

  it('sums each day of the statement in the agency’s zone, the lines that left it aside', () => {
    const lines = myLines({
      statement: [morning, evening, refund, older],
      signals: [signalOn(evening), signalOn(line('vente-5', '2026-10-28T10:00:00.000Z'))],
      excluded: NONE,
      registered: NONE,
      closed: false,
    });
    // 21 h UTC on the 28th is still the 28th in Paris; 23 h UTC would be the 29th.
    expect(myDays(lines, 'Europe/Paris')).toEqual([
      { day: '2026-10-30', sales: 0, refunds: 1, nets: [{ currency: 'EUR', netMinor: -1_000 }] },
      { day: '2026-10-28', sales: 2, refunds: 0, nets: [{ currency: 'EUR', netMinor: 6_700 }] },
      { day: null, sales: 1, refunds: 0, nets: [{ currency: 'EUR', netMinor: 900 }] },
    ]);
  });

  it('gives a page at a time after the last line given, until none is left', () => {
    const lines = myLines({
      statement: [morning, evening, refund, older],
      signals: [],
      excluded: NONE,
      registered: NONE,
      closed: false,
    });
    const first = pageOfLines(lines, null, 3);
    expect(first.items.map((one) => one.platformSaleId)).toEqual(['vente-3', 'vente-1', 'vente-2']);
    expect(first.next).toEqual(placeOfLine(morning));
    const second = pageOfLines(lines, first.next, 3);
    expect(second.items.map((one) => one.platformSaleId)).toEqual(['vente-4']);
    expect(second.next).toBeNull();
    expect(pageOfLines(lines, null, 4).next).toBeNull();
  });

  it('gives nothing for a member without lines on the platform’s net', () => {
    expect(myLines({ statement: [], signals: [], excluded: NONE, registered: NONE, closed: false })).toEqual(
      [],
    );
    expect(myDays([], 'Europe/Paris')).toEqual([]);
  });
});

describe('a sale the validator gave, as each of its members reads it (ADR 0101 § 6)', () => {
  const NOTE = 'Il a relancé le fan après le shift';
  const gift = (on: OwnStatementSale, patch: Partial<OwnGift>): OwnGift => ({
    platform: on.platform,
    platformSaleId: on.platformSaleId,
    role: 'recipient',
    recipientShareBp: 10_000,
    other: { kind: 'member', displayName: 'Lou' },
    note: NOTE,
    platformAccountId: on.platformAccountId,
    currency: on.currency,
    netMinor: on.netMinor,
    occurredAt: on.occurredAt ?? new Date(0),
    ...patch,
  });
  const giftsOf = (...gifts: OwnGift[]) => new Map(gifts.map((one) => [saleIdOf(one), one]));
  const read = (
    statement: OwnStatementSale[],
    gifts: ReadonlyMap<string, OwnGift>,
    signals: OwnSignal[] = [],
  ) => myLines({ statement, signals, excluded: NONE, registered: NONE, gifts, closed: false });

  it('says « Reçue de » on the recipient’s line, the whole sale or their share', () => {
    const whole = line('don-1', '2026-10-28T21:00:00.000Z', 4_200);
    const share = { ...line('don-2', '2026-10-28T22:00:00.000Z', 2_521), shareBp: 6_000 };
    const lines = read(
      [whole, share],
      giftsOf(gift(whole, {}), gift(share, { recipientShareBp: 6_000, other: { kind: 'agent' } })),
    );
    expect(lines.map((one) => [one.platformSaleId, one.state, one.given])).toEqual([
      ['don-2', 'counted', { role: 'recipient', myShareBp: 6_000, other: { kind: 'agent' }, note: NOTE }],
      [
        'don-1',
        'counted',
        { role: 'recipient', myShareBp: 10_000, other: { kind: 'member', displayName: 'Lou' }, note: NOTE },
      ],
    ]);
  });

  it('says « Partagée avec » on the author’s share, and « Donnée à » for a sale given whole, never paid', () => {
    const kept = { ...line('don-3', '2026-10-28T20:00:00.000Z', 1_680), shareBp: 4_000 };
    const away = line('don-4', '2026-10-28T19:00:00.000Z', 3_000);
    const lines = read(
      [kept],
      giftsOf(gift(kept, { role: 'author', recipientShareBp: 6_000 }), gift(away, { role: 'author' })),
    );
    expect(
      lines.map((one) => [one.platformSaleId, one.state, one.netMinor, one.given?.myShareBp, one.open]),
    ).toEqual([
      ['don-3', 'counted', 1_680, 4_000, true],
      ['don-4', 'given', 3_000, 0, false],
    ]);
    // A sale given away pays nothing: its day does not count it.
    expect(myDays(lines, 'Europe/Paris')).toEqual([
      { day: '2026-10-28', sales: 1, refunds: 0, nets: [{ currency: 'EUR', netMinor: 1_680 }] },
    ]);
  });

  it('keeps the signal of a line given away, and says nothing of a gift the statement does not carry', () => {
    const away = line('don-5', '2026-10-28T19:00:00.000Z', 3_000);
    const lines = read([], giftsOf(gift(away, { role: 'author' })), [signalOn(away)]);
    expect(lines.map((one) => [one.state, one.signal?.note, one.given?.role])).toEqual([
      ['given', 'Vendue pendant le shift de Lou', 'author'],
    ]);
    // Linked again since, the gift lapsed and the whole sale is back on the author's statement: it says nothing.
    const back = line('don-6', '2026-10-28T19:30:00.000Z', 3_000);
    expect(
      read([back], giftsOf(gift(back, { role: 'author' }))).map((one) => [one.state, one.given]),
    ).toEqual([['counted', null]]);
    // A share the statement does not carry (decided again since) says nothing either.
    const other = { ...line('don-7', '2026-10-28T19:40:00.000Z', 900), shareBp: 5_000 };
    expect(read([other], giftsOf(gift(other, { recipientShareBp: 7_000 }))).map((one) => one.given)).toEqual([
      null,
    ]);
  });
});
