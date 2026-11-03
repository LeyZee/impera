import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
  TeamMemberIdSchema,
  type PlatformAccountId,
} from '@nirvana/contracts';
import { schema, withAdmin } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { salesFeedReadsForPay } from '../pay-reads';
import { createDrizzleSalesLedger } from '../sales-ledger';

// Everything below is invented (ADR 0010).
const ZONE = 'Europe/Paris';

/** What pay reads of the register (CRM-03): one line per sale or refund, its author by the owner's link and version. */
describe('the sales feed read by pay', () => {
  let test: TestDb;
  let account: PlatformAccountId;
  let other: PlatformAccountId;
  let creator: string;
  const member = newId(TeamMemberIdSchema);
  const owner = 'user_test_owner';

  const line = (
    platformAccountId: PlatformAccountId,
    values: {
      id: string;
      event?: 'sale' | 'refund';
      at: string;
      chatter: string | null;
      net: number;
      recorded?: string;
      status?: 'paid' | 'refund_asked' | 'refunded' | 'other';
    },
  ) => ({
    id: newId(SalesLineIdSchema),
    creatorId: creator,
    platformAccountId,
    platform: 'reveal',
    platformSaleId: values.id,
    event: values.event ?? 'sale',
    saleType: 'ppv',
    status: values.status ?? (values.event === 'refund' ? 'refunded' : 'paid'),
    occurredAt: new Date(values.at),
    platformModelId: 'model_test_01',
    platformChatterId: values.chatter,
    platformFanId: null,
    currency: 'EUR',
    grossInclVatMinor: values.net * 2,
    grossExclVatMinor: values.net * 2,
    netMinor: values.net,
    agencyMinor: values.net,
    creatorMinor: 0,
    position: `${values.id}:${values.event ?? 'sale'}`,
    inputsHash: 'hash_test',
    recordedAt: new Date(values.recorded ?? values.at),
  });

  const range = (from: string, to: string) => ({
    platformAccountIds: [account],
    from: new Date(from),
    to: new Date(to),
    timeZone: ZONE,
  });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const db = test.admin.db;
    creator = newId(CreatorIdSchema);
    account = newId(PlatformAccountIdSchema);
    other = newId(PlatformAccountIdSchema);
    await db.insert(schema.user).values({ id: owner, name: 'Owner', email: 'owner@example.test' });
    await db
      .insert(schema.user)
      .values({ id: 'user_test_member', name: 'Membre', email: 'member@example.test' });
    await db.insert(schema.creators).values({
      id: creator,
      nameKey: 'creatrice_test',
      displayName: 'Créatrice test',
      timezone: ZONE,
    });
    await db.insert(schema.platformAccounts).values([
      { id: account, creatorId: creator, platform: 'reveal', handle: 'creatrice_test' },
      { id: other, creatorId: creator, platform: 'onlyfans', handle: 'creatrice_test' },
    ]);
    await db.insert(schema.teamMembers).values({
      id: member,
      userId: 'user_test_member',
      teamRole: 'chatter',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: 'Chatteur',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    await db.insert(schema.platformSales).values([
      // 23:30 in Paris on the 15th is still the first fortnight of October.
      line(account, { id: 'sale_a', at: '2026-10-15T21:30:00Z', chatter: 'chatter_member', net: 800 }),
      line(account, { id: 'sale_b', at: '2026-10-15T22:30:00Z', chatter: 'chatter_bot', net: 500 }),
      line(account, {
        id: 'sale_c',
        at: '2026-10-10T10:00:00Z',
        chatter: 'chatter_new',
        net: 300,
        status: 'other',
      }),
      line(account, {
        id: 'sale_d',
        at: '2026-10-11T10:00:00Z',
        chatter: null,
        net: 1000,
        status: 'refund_asked',
      }),
      // Refunded after the period closed: counts on its sale's day, recorded late, and stays its sale's author's
      // although the platform names another chatter on it.
      line(account, {
        id: 'sale_a',
        event: 'refund',
        at: '2026-10-20T09:00:00Z',
        chatter: 'chatter_bot',
        net: 800,
      }),
      // Refunded with a chatter named on the refund only: still nobody's, as its sale was.
      line(account, {
        id: 'sale_d',
        event: 'refund',
        at: '2026-10-21T09:00:00Z',
        chatter: 'chatter_bot',
        net: 1000,
      }),
      // A refund whose sale is older than the register.
      line(account, { id: 'sale_old', event: 'refund', at: '2026-10-12T09:00:00Z', chatter: null, net: 200 }),
      line(other, { id: 'sale_other', at: '2026-10-10T10:00:00Z', chatter: null, net: 999 }),
    ]);
    const ledger = createDrizzleSalesLedger(db, db);
    await ledger.linkChatter('reveal', 'chatter_member', { kind: 'member', memberId: member }, owner);
    await ledger.linkChatter('reveal', 'chatter_bot', { kind: 'agent' }, owner);
  });

  afterAll(async () => {
    await test.close();
  });

  it('gives each sale and refund of the period’s sales, a refund signed and on its sale’s day', async () => {
    const lines = await withAdmin(test.admin.db, (tx) =>
      salesFeedReadsForPay.linesOfSalesBetween(tx, range('2026-09-30T22:00:00Z', '2026-10-15T22:00:00Z')),
    );
    expect(lines.map((one) => [one.platformSaleId, one.event, one.netMinor, one.saleDay])).toEqual([
      ['sale_c', 'sale', 300, '2026-10-10'],
      ['sale_d', 'sale', 1000, '2026-10-11'],
      ['sale_d', 'refund', -1000, '2026-10-11'],
      ['sale_old', 'refund', -200, null],
      ['sale_a', 'sale', 800, '2026-10-15'],
      ['sale_a', 'refund', -800, '2026-10-15'],
    ]);
    const refund = lines.find((one) => one.event === 'refund' && one.platformSaleId === 'sale_a');
    expect(refund).toMatchObject({
      occurredAt: new Date('2026-10-20T09:00:00Z'),
      saleOccurredAt: new Date('2026-10-15T21:30:00Z'),
      recordedAt: new Date('2026-10-20T09:00:00Z'),
      currency: 'EUR',
      platformAccountId: account,
      status: 'refunded',
      author: { kind: 'member', memberId: member, platformChatterId: 'chatter_member' },
    });
    // The status the line had when first read: an unknown one and an asked refund, which pay keeps aside or signals.
    expect(lines.find((one) => one.platformSaleId === 'sale_c')?.status).toBe('other');
    expect(lines.find((one) => one.platformSaleId === 'sale_d')?.status).toBe('refund_asked');
  });

  it('names each line’s author by the owner’s link, and nobody for a chatter not linked or no chatter', async () => {
    const lines = await withAdmin(test.admin.db, (tx) =>
      salesFeedReadsForPay.linesOfSalesBetween(tx, range('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')),
    );
    const author = (id: string) =>
      lines.find((one) => one.platformSaleId === id && one.event === 'sale')?.author;
    expect(author('sale_a')).toMatchObject({
      kind: 'member',
      memberId: member,
      platformChatterId: 'chatter_member',
    });
    expect(author('sale_b')).toMatchObject({ kind: 'agent', platformChatterId: 'chatter_bot' });
    expect(author('sale_c')).toEqual({ kind: 'unlinked', platformChatterId: 'chatter_new' });
    expect(author('sale_d')).toEqual({ kind: 'none' });
    const refundOfD = lines.find((one) => one.platformSaleId === 'sale_d' && one.event === 'refund');
    expect(refundOfD?.author).toEqual({ kind: 'none' });
    expect(lines.some((one) => one.platformSaleId === 'sale_other')).toBe(false);
  });

  it('keeps a link’s version when the same link is posed again, and changes it when the link points elsewhere', async () => {
    const versionOf = async () => {
      const lines = await withAdmin(test.admin.db, (tx) =>
        salesFeedReadsForPay.linesOfSalesBetween(tx, range('2026-10-15T00:00:00Z', '2026-10-16T00:00:00Z')),
      );
      const found = lines.find((one) => one.platformSaleId === 'sale_a' && one.event === 'sale')?.author;
      return found !== undefined && found.kind !== 'none' && found.kind !== 'unlinked'
        ? found.linkVersion
        : null;
    };
    const ledger = createDrizzleSalesLedger(test.admin.db, test.admin.db);
    const first = await versionOf();
    expect(first).not.toBeNull();
    await ledger.linkChatter('reveal', 'chatter_member', { kind: 'member', memberId: member }, owner);
    expect(await versionOf()).toBe(first);
    await ledger.linkChatter('reveal', 'chatter_member', { kind: 'agent' }, owner);
    const second = await versionOf();
    expect(second).not.toBe(first);
    await ledger.linkChatter('reveal', 'chatter_member', { kind: 'member', memberId: member }, owner);
    expect(await versionOf()).not.toBe(second);
  });

  it('gives the lines recorded in a range whatever their sale’s day: the late ones after a closing', async () => {
    const lines = await withAdmin(test.admin.db, (tx) =>
      salesFeedReadsForPay.linesRecordedBetween(tx, range('2026-10-16T00:00:00Z', '2026-11-01T00:00:00Z')),
    );
    expect(lines.map((one) => [one.platformSaleId, one.event, one.saleDay])).toEqual([
      ['sale_d', 'refund', '2026-10-11'],
      ['sale_a', 'refund', '2026-10-15'],
    ]);
  });

  it('gives the lines of a chatter linked in a range whatever their sale’s day, dated by the link’s version', async () => {
    const before = new Date();
    const ledger = createDrizzleSalesLedger(test.admin.db, test.admin.db);
    await ledger.linkChatter('reveal', 'chatter_new', { kind: 'member', memberId: member }, owner);
    const after = new Date(Date.now() + 1000);
    const lines = await withAdmin(test.admin.db, (tx) =>
      salesFeedReadsForPay.linesRelinkedBetween(tx, {
        platformAccountIds: [account],
        from: before,
        to: after,
        timeZone: ZONE,
      }),
    );
    const relinked = lines.find((one) => one.platformSaleId === 'sale_c');
    expect(relinked).toMatchObject({ saleDay: '2026-10-10', author: { kind: 'member', memberId: member } });
    const at = relinked?.author.kind === 'member' ? relinked.author.linkVersionAt.getTime() : 0;
    expect(at).toBeGreaterThanOrEqual(before.getTime());
    expect(lines.some((one) => one.platformSaleId === 'sale_d')).toBe(false);
    // Posing the same link again moves neither the version nor its instant.
    await ledger.linkChatter('reveal', 'chatter_new', { kind: 'member', memberId: member }, owner);
    const later = await withAdmin(test.admin.db, (tx) =>
      salesFeedReadsForPay.linesRelinkedBetween(tx, {
        platformAccountIds: [account],
        from: after,
        to: new Date(Date.now() + 60_000),
        timeZone: ZONE,
      }),
    );
    expect(later.some((one) => one.platformSaleId === 'sale_c')).toBe(false);
  });

  it('reads nothing for no account', async () => {
    const lines = await withAdmin(test.admin.db, (tx) =>
      salesFeedReadsForPay.linesOfSalesBetween(tx, {
        ...range('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'),
        platformAccountIds: [],
      }),
    );
    expect(lines).toEqual([]);
  });
});
