import { randomUUID } from 'node:crypto';

import {
  CreatorIdSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  withAdmin,
  withCreatorAccount,
  withMember,
  withTenant,
  type Database,
  type Transaction,
} from './client';
import * as s from './schema';
import { createTestDb, type TestDb } from './test/test-db';

/** The Postgres message behind a failed query (Drizzle wraps it as `cause`). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'no error';
}

async function count(tx: Transaction, table: string): Promise<number> {
  const result = await tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  const [row] = result.rows;
  return typeof row?.['n'] === 'number' ? row['n'] : -1;
}

interface Creator {
  readonly creatorId: string;
  readonly accountId: string;
  readonly fanId: string;
}

/** A creator with a Reveal account and the card of one fan, `fan-1` at the platform; invented data only. */
async function seedCreator(admin: Database, label: string): Promise<Creator> {
  const creator = {
    creatorId: newId(CreatorIdSchema),
    accountId: newId(PlatformAccountIdSchema),
    fanId: newId(FanIdSchema),
  };
  await withAdmin(admin, async (tx) => {
    await tx.insert(s.creators).values({
      id: creator.creatorId,
      nameKey: creator.creatorId,
      displayName: `Créatrice ${label}`,
      timezone: 'Europe/Paris',
    });
    await tx.insert(s.platformAccounts).values({
      id: creator.accountId,
      creatorId: creator.creatorId,
      platform: 'reveal',
      handle: `h-${label}`,
    });
    await tx.insert(s.fans).values({
      id: creator.fanId,
      creatorId: creator.creatorId,
      platformAccountId: creator.accountId,
      platformFanId: 'fan-1',
      displayName: 'Fan test',
    });
  });
  return creator;
}

/** A line of the register: 12,00 € paid, 8,00 € net, 3,00 € to the agency, 5,00 € to her. */
function line(
  creator: Creator,
  saleId: string,
  options: { readonly event?: 'sale' | 'refund'; readonly fan?: string | null; readonly at?: string } = {},
) {
  return {
    id: randomUUID(),
    creatorId: creator.creatorId,
    platformAccountId: creator.accountId,
    platform: 'reveal',
    platformSaleId: saleId,
    event: options.event ?? 'sale',
    saleType: 'ppv',
    status: options.event === 'refund' ? 'refunded' : 'paid',
    occurredAt: new Date(options.at ?? '2026-10-20T12:00:00Z'),
    platformModelId: 'model-1',
    platformChatterId: 'chatter-1',
    platformFanId: options.fan === undefined ? 'fan-1' : options.fan,
    currency: 'EUR',
    grossInclVatMinor: 1200,
    grossExclVatMinor: 1000,
    netMinor: 800,
    agencyMinor: 300,
    creatorMinor: 500,
    position: `${saleId}:${options.event ?? 'sale'}`,
    inputsHash: `hash-${saleId}-${options.event ?? 'sale'}`,
  };
}

/**
 * A creator's own account and her sales (CRM-04 lot d, ADR 0042 § 2, ADR 0054): she reads them through `creator_sales`
 * alone, which names neither the chatter nor the platform's fan; the register, the outbox and the agency's tables of
 * the sales feed close to her. Invented data only (ADR 0010).
 */
describe('a creator’s own sales (CRM-04 lot d): her view, nothing of who sold', () => {
  let test: TestDb;
  let nora: Creator;
  let ines: Creator;
  const creatorUser = newId(UserIdSchema);
  const operator = newId(UserIdSchema);
  /** A card of Ines's creator on Nora's account, `fan-x`: the view's join on `creator_id` is what keeps it out. */
  const strayCard = newId(FanIdSchema);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    nora = await seedCreator(test.admin.db, 'Nora');
    ines = await seedCreator(test.admin.db, 'Ines');
    const member = newId(TeamMemberIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(s.user).values([
        {
          id: creatorUser,
          name: 'Nora',
          email: 'nora@example.test',
          role: 'creator',
          creatorIds: [nora.creatorId],
        },
        {
          id: operator,
          name: 'Opé',
          email: 'ope@example.test',
          role: 'operator',
          creatorIds: [nora.creatorId],
        },
      ]);
      await tx.insert(s.teamMembers).values({
        id: member,
        userId: operator,
        teamRole: 'manager',
        firstName: 'Opé',
        lastName: 'Inventé',
        displayName: 'Opé',
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-09-01',
      });
      await tx.insert(s.fans).values({
        id: strayCard,
        creatorId: ines.creatorId,
        platformAccountId: nora.accountId,
        platformFanId: 'fan-x',
        displayName: 'Autre',
      });
      await tx
        .insert(s.platformSales)
        .values([
          line(nora, 'sale-known'),
          line(nora, 'sale-known', { event: 'refund', at: '2026-10-21T09:00:00Z' }),
          line(nora, 'sale-no-card', { fan: 'fan-unknown' }),
          line(nora, 'sale-stray', { fan: 'fan-x' }),
          line(nora, 'sale-no-fan', { fan: null }),
          line(ines, 'sale-ines'),
        ]);
      await tx.insert(s.platformSalesQuarantine).values({
        ...line(nora, 'sale-waiting'),
        platformModelId: 'model-unlinked',
      });
      await tx.insert(s.salesFeedChatters).values({
        platform: 'reveal',
        platformChatterId: 'chatter-1',
        kind: 'member',
        memberId: member,
      });
      await tx.insert(s.salesFeedChecks).values({
        id: randomUUID(),
        platform: 'reveal',
        fromDay: '2026-10-01',
        toDay: '2026-10-15',
        verdict: 'match',
        clean: true,
        report: {},
        generatedAt: new Date('2026-10-16T08:00:00Z'),
      });
      await tx.insert(s.domainEvents).values({
        id: randomUUID(),
        creatorId: nora.creatorId,
        type: 'sale_detected',
        payload: { seller: { kind: 'member', memberId: member } },
        actor: 'system',
        correlationId: 'sale-known',
      });
    });
  });

  afterAll(async () => {
    await test.close();
  });

  const view = (tx: Transaction) =>
    tx
      .execute(
        sql`select platform_sale_id, event, creator_minor, fan_id from creator_sales order by platform_sale_id, event desc`,
      )
      .then((result) => result.rows);

  it('gives her her lines and their amounts, the fan’s id only by a card of her creator, never another creator’s', async () => {
    const rows = await withCreatorAccount(test.app.db, creatorUser, view);
    expect(rows).toEqual([
      { platform_sale_id: 'sale-known', event: 'sale', creator_minor: 500, fan_id: nora.fanId },
      { platform_sale_id: 'sale-known', event: 'refund', creator_minor: 500, fan_id: nora.fanId },
      { platform_sale_id: 'sale-no-card', event: 'sale', creator_minor: 500, fan_id: null },
      { platform_sale_id: 'sale-no-fan', event: 'sale', creator_minor: 500, fan_id: null },
      { platform_sale_id: 'sale-stray', event: 'sale', creator_minor: 500, fan_id: null },
    ]);
    expect(rows.map((row) => row['fan_id'])).not.toContain(strayCard);
  });

  it('has no column of the chatter nor of the platform’s fan, and grants the application role nothing but reading', async () => {
    const columns = await test.admin.db.execute(
      sql`select column_name from information_schema.columns where table_name = 'creator_sales' order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row['column_name'])).toEqual([
      'id',
      'creator_id',
      'platform',
      'platform_account_id',
      'platform_sale_id',
      'event',
      'sale_type',
      'occurred_at',
      'currency',
      'gross_incl_vat_minor',
      'gross_excl_vat_minor',
      'net_minor',
      'agency_minor',
      'creator_minor',
      'fan_id',
    ]);
    const grants = await test.admin.db.execute(
      sql`select privilege_type from information_schema.role_table_grants
           where table_name = 'creator_sales' and grantee = 'nirvana_app' order by privilege_type`,
    );
    expect(grants.rows.map((row) => row['privilege_type'])).toEqual(['SELECT']);
  });

  it('gives any other door nothing: the agency in her creator, a member, the admin role', async () => {
    expect(await withTenant(test.app.db, nora.creatorId, view)).toEqual([]);
    expect(await withMember(test.app.db, operator, view)).toEqual([]);
    expect(await withAdmin(test.admin.db, view)).toEqual([]);
  });

  it('closes the register to her, and hides the outbox from her while she may still add to it', async () => {
    const closed = await withCreatorAccount(test.app.db, creatorUser, async (tx) => ({
      sales: await count(tx, 'platform_sales'),
      events: await count(tx, 'domain_events'),
    }));
    expect(closed).toEqual({ sales: 0, events: 0 });
    expect(
      await failure(
        withCreatorAccount(test.app.db, creatorUser, (tx) =>
          tx.insert(s.platformSales).values(line(nora, 'sale-forged')),
        ),
      ),
    ).toMatch(/row-level security/u);
    // An event her transaction publishes still goes in, unread by her.
    await withCreatorAccount(test.app.db, creatorUser, (tx) =>
      tx.insert(s.domainEvents).values({
        id: randomUUID(),
        creatorId: nora.creatorId,
        type: 'sale_detected',
        payload: {},
        actor: 'creator',
        correlationId: 'her-write',
      }),
    );
    // The agency still reads both in her creator: the restrictive policies key on the account, not the tenant.
    const agency = await withTenant(test.app.db, nora.creatorId, async (tx) => ({
      sales: await count(tx, 'platform_sales'),
      events: await count(tx, 'domain_events'),
    }));
    expect(agency).toEqual({ sales: 5, events: 2 });
  });

  it('closes to her the quarantine, the chatters’ links and the check reports, which the agency still reads and writes', async () => {
    const agencyTables = ['platform_sales_quarantine', 'sales_feed_chatters', 'sales_feed_checks'];
    const asCreator = await withCreatorAccount(test.app.db, creatorUser, (tx) =>
      Promise.all(agencyTables.map((table) => count(tx, table))),
    );
    expect(asCreator).toEqual([0, 0, 0]);
    expect(
      await failure(
        withCreatorAccount(test.app.db, creatorUser, (tx) =>
          tx
            .insert(s.salesFeedChatters)
            .values({ platform: 'reveal', platformChatterId: 'chatter-2', kind: 'agent' }),
        ),
      ),
    ).toMatch(/row-level security/u);
    const asMember = await withMember(test.app.db, operator, (tx) =>
      Promise.all(agencyTables.map((table) => count(tx, table))),
    );
    expect(asMember).toEqual([1, 1, 1]);
    const asJob = await withTenant(test.app.db, nora.creatorId, async (tx) => {
      await tx
        .insert(s.salesFeedChatters)
        .values({ platform: 'reveal', platformChatterId: 'chatter-3', kind: 'agent' });
      return count(tx, 'sales_feed_chatters');
    });
    expect(asJob).toBe(2);
  });
});
