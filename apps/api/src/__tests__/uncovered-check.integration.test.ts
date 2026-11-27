import {
  ConversationIdSchema,
  CreatorIdSchema,
  EVENT_PAYLOADS,
  FanIdSchema,
  MessageIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { eq, schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createDrizzleUncoveredCheck } from '../modules/scheduling/infra/uncovered-check';

/**
 * « Compte sans personne » (ADR 0094 § 1, lot a) on a real base, through the service role: the planning's default
 * créneaux (6 h each from midnight, Paris), Friday 20/11/2026 at 12 h 03 (11:03Z), the 12 h créneau begun three minutes
 * ago. Everything is invented (ADR 0010): the creators, the fans, the member.
 */
describe('compte sans personne (ADR 0094 § 1)', () => {
  let test: TestDb;
  const now = new Date('2026-11-20T11:03:00Z');
  const creators = {
    nora: newId(CreatorIdSchema),
    lea: newId(CreatorIdSchema),
    ines: newId(CreatorIdSchema),
    zoe: newId(CreatorIdSchema),
  };
  const accounts = {
    nora: newId(PlatformAccountIdSchema),
    lea: newId(PlatformAccountIdSchema),
    ines: newId(PlatformAccountIdSchema),
    zoe: newId(PlatformAccountIdSchema),
  };

  const uncovered = async () =>
    (
      await test.admin.db
        .select()
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.type, 'account_uncovered'))
    ).map((row) => EVENT_PAYLOADS.account_uncovered.parse(row.payload));

  /** A fan's message on her account, `hoursBefore` the créneau began. */
  const fanWrote = async (name: keyof typeof creators, hoursBefore: number) => {
    const fanId = newId(FanIdSchema);
    const conversationId = newId(ConversationIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(schema.fans).values({
        id: fanId,
        creatorId: creators[name],
        platformAccountId: accounts[name],
        platformFanId: `fan-${name}-${String(hoursBefore)}`,
        displayName: 'Fan inventé',
      });
      await tx.insert(schema.conversations).values({
        id: conversationId,
        creatorId: creators[name],
        platformAccountId: accounts[name],
        fanId,
        platformConversationId: `conv-${name}-${String(hoursBefore)}`,
      });
      await tx.insert(schema.messages).values({
        id: newId(MessageIdSchema),
        creatorId: creators[name],
        platformAccountId: accounts[name],
        conversationId,
        platformMessageId: `msg-${name}-${String(hoursBefore)}`,
        direction: 'inbound',
        author: 'fan',
        text: 'Coucou',
        platformCreatedAt: new Date(Date.parse('2026-11-20T11:00:00Z') - hoursBefore * 3_600_000),
      });
    });
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    for (const name of ['nora', 'lea', 'ines', 'zoe'] as const) {
      await test.admin.db.insert(schema.creators).values({
        id: creators[name],
        nameKey: `creatrice_${name}`,
        displayName: `Créatrice ${name}`,
        timezone: 'Europe/Paris',
        archivedAt: name === 'zoe' ? new Date('2026-11-01T00:00:00Z') : null,
      });
      await test.admin.db.insert(schema.platformAccounts).values({
        id: accounts[name],
        creatorId: creators[name],
        platform: 'reveal',
        handle: `creatrice_${name}`,
      });
    }
    // Nora: a fan wrote 2 h before, nobody on her créneau. Léa: a fan wrote, a chatter holds the créneau's start.
    // Inès: her last fan wrote 30 h before. Zoé: archived, a fan wrote.
    await fanWrote('nora', 2);
    await fanWrote('lea', 1);
    await fanWrote('ines', 30);
    await fanWrote('zoe', 1);
    const userId = newId(UserIdSchema);
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.user).values({
      id: userId,
      name: 'Kofi',
      email: 'kofi@example.test',
      creatorIds: [creators.lea],
    });
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole: 'chatter',
      firstName: 'Kofi',
      lastName: 'Inventé',
      displayName: 'Kofi',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-09-01',
      status: 'active',
    });
    await test.admin.db.insert(schema.shifts).values({
      id: newId(ShiftIdSchema),
      creatorId: creators.lea,
      platformAccountId: accounts.lea,
      memberId,
      startsAt: new Date('2026-11-20T10:30:00Z'),
      endsAt: new Date('2026-11-20T15:00:00Z'),
      createdBy: userId,
      updatedBy: userId,
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('publishes once the account whose créneau began with nobody, a fan having written in the 24 h before', async () => {
    const check = createDrizzleUncoveredCheck(test.service.db);
    expect(await check.run(now, 'job:test')).toBe(1);
    // Five minutes later the same créneau is seen again and published no more.
    expect(await check.run(new Date('2026-11-20T11:08:00Z'), 'job:test')).toBe(0);
    expect(await uncovered()).toEqual([
      {
        creatorId: creators.nora,
        platform: 'reveal',
        platformAccountId: accounts.nora,
        slotStartsAt: '2026-11-20T11:00:00.000Z',
        slotEndsAt: '2026-11-20T17:00:00.000Z',
        timeZone: 'Europe/Paris',
      },
    ]);
  });

  it('is quiet when the agent answers in Automatique, and tells the account a shift no longer holds', async () => {
    // The 18 h créneau: one of Nora's conversations in Automatique; Léa's chatter left at 16 h.
    await test.admin.db
      .update(schema.conversations)
      .set({ mode: 'auto' })
      .where(eq(schema.conversations.creatorId, creators.nora));
    await fanWrote('nora', -5);
    const check = createDrizzleUncoveredCheck(test.service.db);
    expect(await check.run(new Date('2026-11-20T17:02:00Z'), 'job:test')).toBe(1);
    expect((await uncovered()).map((event) => [event.platformAccountId, event.slotStartsAt])).toEqual([
      [accounts.nora, '2026-11-20T11:00:00.000Z'],
      [accounts.lea, '2026-11-20T17:00:00.000Z'],
    ]);
  });

  it('refuses a stored choice that opens « Compte sans personne » to the chatters', async () => {
    await expect(
      test.admin.db.insert(schema.creatorAlertRoutes).values({
        creatorId: creators.nora,
        alertCode: 'uncovered_account',
        role: 'chatter_on_shift',
        mode: 'muted',
      }),
    ).rejects.toThrow();
  });
});
