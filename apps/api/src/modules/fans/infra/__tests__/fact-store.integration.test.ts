import {
  CreatorIdSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type FanId,
} from '@nirvana/contracts';
import { eq, schema, withAdmin } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { FanNotFound } from '../../domain/errors';
import { createFansModule, type FactProposal, type FansModule } from '../../index';

const may = new Date('2026-05-10T10:00:00Z');
const august = new Date('2026-08-10T10:00:00Z');

const city = (value: string, observedAt: Date): FactProposal => ({
  category: 'identity',
  key: 'city',
  value,
  kind: 'declared',
  confidence: 0.9,
  sourceMessageId: null,
  observedAt,
});

describe('fan facts (P3-02), as the application role sees them', () => {
  let test: TestDb;
  let fans: FansModule;

  /** One creator, one account, and as many fans as asked; invented data only (ADR 0010). */
  const seed = async (label: string, fanCount: number) => {
    const creatorId = newId(CreatorIdSchema);
    const accountId = newId(PlatformAccountIdSchema);
    const fanIds = Array.from({ length: fanCount }, () => newId(FanIdSchema));
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(schema.creators).values({
        id: creatorId,
        nameKey: creatorId,
        displayName: `Créatrice ${label}`,
        timezone: 'Europe/Paris',
      });
      await tx
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId, platform: 'reveal', handle: `handle-${label}` });
      for (const [i, fanId] of fanIds.entries()) {
        await tx.insert(schema.fans).values({
          id: fanId,
          creatorId,
          platformAccountId: accountId,
          platformFanId: `fan-${String(i)}`,
          displayName: `Fan ${label} ${String(i)}`,
        });
      }
    });
    return { creatorId, fanIds };
  };

  let her: { creatorId: CreatorId; fanIds: FanId[] };
  let other: { creatorId: CreatorId; fanIds: FanId[] };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    fans = createFansModule({ db: test.app.db, adminDb: test.admin.db });
    her = await seed('a', 2);
    other = await seed('b', 1);
  });

  afterAll(async () => {
    await test.close();
  });

  it('keeps the history: Paris supersedes Lyon, and only Paris is active', async () => {
    const [fanId] = her.fanIds;
    if (fanId === undefined) throw new Error('seed');
    const [lyon] = await fans.proposeFacts(her.creatorId, fanId, [city('Lyon', may)]);
    const [paris] = await fans.proposeFacts(her.creatorId, fanId, [city('Paris', august)]);
    expect((await fans.activeFacts(her.creatorId, fanId)).map((fact) => fact.value)).toEqual(['Paris']);

    const rows = await withAdmin(test.admin.db, (tx) =>
      tx.select().from(schema.fanFacts).where(eq(schema.fanFacts.fanId, fanId)),
    );
    expect(rows.map((row) => [row.value, row.supersededBy])).toEqual(
      expect.arrayContaining([
        ['Lyon', paris?.id],
        ['Paris', null],
      ]),
    );
    expect(lyon?.id).not.toBe(paris?.id);
  });

  it('writes nothing when a job is replayed', async () => {
    const [, fanId] = her.fanIds;
    if (fanId === undefined) throw new Error('seed');
    await fans.proposeFacts(her.creatorId, fanId, [city('Nice', may)]);
    expect(await fans.proposeFacts(her.creatorId, fanId, [city('Nice', may)])).toEqual([]);
    expect(await fans.activeFacts(her.creatorId, fanId)).toHaveLength(1);
  });

  it('never shows a fan the facts of another fan, nor another creator those of hers', async () => {
    const [first, second] = her.fanIds;
    const [theirs] = other.fanIds;
    if (first === undefined || second === undefined || theirs === undefined) throw new Error('seed');
    expect((await fans.activeFacts(her.creatorId, second)).map((fact) => fact.value)).toEqual(['Nice']);
    expect(await fans.activeFacts(other.creatorId, first)).toEqual([]);
    expect(await fans.activeFacts(other.creatorId, theirs)).toEqual([]);
    // Her fan is out of sight for the other creator: nothing can be written about him.
    await expect(fans.proposeFacts(other.creatorId, first, [city('Brest', august)])).rejects.toThrow(
      FanNotFound,
    );
  });

  it('drops every fact of a fan last seen a year ago, history included, and nothing else', async () => {
    const stale = await seed('c', 2);
    const [gone, kept] = stale.fanIds;
    if (gone === undefined || kept === undefined) throw new Error('seed');
    await fans.proposeFacts(stale.creatorId, gone, [city('Lyon', may)]);
    await fans.proposeFacts(stale.creatorId, gone, [city('Paris', august)]);
    await fans.proposeFacts(stale.creatorId, kept, [city('Nantes', august)]);
    await withAdmin(test.admin.db, (tx) =>
      tx
        .update(schema.fans)
        .set({ lastSeenAt: new Date(Date.now() - 400 * 86_400_000) })
        .where(eq(schema.fans.id, gone)),
    );

    expect(await fans.jobs.purgeFacts()).toBe(2);
    expect(await fans.activeFacts(stale.creatorId, gone)).toEqual([]);
    expect((await fans.activeFacts(stale.creatorId, kept)).map((fact) => fact.value)).toEqual(['Nantes']);
    expect(await fans.jobs.purgeFacts()).toBe(0);
  });

  it('sets and lifts a limit with its author, one event per real change', async () => {
    const [fanId] = her.fanIds;
    if (fanId === undefined) throw new Error('seed');
    const command = {
      author: 'system',
      reason: 'il dit ne plus pouvoir payer',
      correlationId: 'flags-1',
    } as const;
    const frozen = { reason: 'money_trouble', since: '2026-10-02T10:00:00.000Z' } as const;

    expect(await fans.flags(her.creatorId, fanId)).toEqual({});
    expect(await fans.setFlag(her.creatorId, fanId, { flag: 'salesFrozen', value: frozen }, command)).toEqual(
      {
        flags: { salesFrozen: frozen },
        mayConfirmDisputedAge: false,
      },
    );
    await fans.setFlag(her.creatorId, fanId, { flag: 'salesFrozen', value: frozen }, command);
    expect(
      await fans.clearFlag(her.creatorId, fanId, 'salesFrozen', { ...command, correlationId: 'flags-2' }),
    ).toEqual({ flags: {}, mayConfirmDisputedAge: false });
    await fans.clearFlag(her.creatorId, fanId, 'salesFrozen', command);

    const events = await withAdmin(test.admin.db, (tx) =>
      tx.select().from(schema.domainEvents).where(eq(schema.domainEvents.creatorId, her.creatorId)),
    );
    expect(events.map((event) => [event.type, event.actor, event.payload])).toEqual([
      [
        'fan_flag_set',
        'system',
        { fanId, flag: 'salesFrozen', flags: { salesFrozen: frozen }, reason: command.reason },
      ],
      ['fan_flag_cleared', 'system', { fanId, flag: 'salesFrozen', flags: {}, reason: command.reason }],
    ]);
  });

  it('never lets another creator read or change his limits', async () => {
    const [fanId] = her.fanIds;
    if (fanId === undefined) throw new Error('seed');
    await expect(
      fans.setFlag(
        other.creatorId,
        fanId,
        { flag: 'fragile', value: true },
        { author: 'system', correlationId: 'x' },
      ),
    ).rejects.toThrow(FanNotFound);
    await expect(fans.flags(other.creatorId, fanId)).rejects.toThrow(FanNotFound);
  });
});
