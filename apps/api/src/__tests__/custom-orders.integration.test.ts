import {
  CreatorIdSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type FanId,
  type OpenCustomOrder,
} from '@impera/contracts';
import { eq, schema, withAdmin, withTenant } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { customOrderTurn, type CustomOrderTurnInput } from '../modules/custom-orders';
import { createDrizzleCustomOrderStore } from '../modules/custom-orders/infra/db/order-store';

const store = createDrizzleCustomOrderStore();
const AT = new Date('2026-11-20T21:00:00Z');

/** A turn of hers on his request, with neutral readings (ADR 0010: invented people, no grid). */
const turn = (order: OpenCustomOrder | null, input: Partial<CustomOrderTurnInput> = {}) =>
  customOrderTurn({
    asksForService: true,
    reading: { format: 'photo', supplements: [], minutes: null, details: {} },
    order,
    stop: 'none',
    chatterOnShift: false,
    grid: null,
    ...input,
  });

/**
 * His custom orders (ADR 0159 § A): kept by the agent's turn under her RLS, one open order per fan, the same message
 * recorded once, never seen from another creator. Invented creators and fans only (ADR 0010).
 */
describe('custom orders, kept for the agent turn', () => {
  let test: TestDb;
  let nora: CreatorId;
  let ines: CreatorId;
  let fan: FanId;

  const openFor = (creatorId: CreatorId) =>
    withTenant(test.app.db, creatorId, (tx) => store.openFor(tx, { creatorId, fanId: fan }));
  const record = (creatorId: CreatorId, inboundMessageId: string, decided: ReturnType<typeof turn>) =>
    withTenant(test.app.db, creatorId, (tx) =>
      store.record(tx, { creatorId, fanId: fan, inboundMessageId, turn: decided, at: AT }),
    );

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    fan = newId(FanIdSchema);
    const accountId = newId(PlatformAccountIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      for (const [id, name] of [
        [nora, 'Nora'],
        [ines, 'Ines'],
      ] as const)
        await tx
          .insert(schema.creators)
          .values({ id, displayName: name, nameKey: name.toLowerCase(), timezone: 'Europe/Paris' });
      await tx
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId: nora, platform: 'reveal', handle: 'nora-demo' });
      await tx.insert(schema.fans).values({
        id: fan,
        creatorId: nora,
        platformAccountId: accountId,
        platformFanId: 'fan-1',
        displayName: 'Basile',
      });
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('opens his order on the first question and counts it', async () => {
    expect(await openFor(nora)).toBeNull();
    await record(nora, 'm1', turn(null));
    expect(await openFor(nora)).toMatchObject({ state: 'gathering', format: 'photo', questionsAsked: 1 });
  });

  it('records the same message once', async () => {
    const before = await openFor(nora);
    await record(nora, 'm1', turn(before));
    expect(await openFor(nora)).toMatchObject({ questionsAsked: 1 });
  });

  it('moves the same order on, and keeps the card once ready', async () => {
    const reading = {
      format: 'photo' as const,
      supplements: [],
      minutes: null,
      details: { what: 'a', when: 'b' },
    };
    await record(nora, 'm2', turn(await openFor(nora), { reading }));
    expect(await openFor(nora)).toMatchObject({
      state: 'awaiting_creator',
      details: { what: 'a', when: 'b' },
    });
    const rows = await withAdmin(test.admin.db, (tx) =>
      tx.select().from(schema.customOrders).where(eq(schema.customOrders.fanId, fan)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.card).toMatchObject({ format: 'photo', to: 'creator' });
  });

  it('closes his order when the turn declines it', async () => {
    await record(nora, 'm3', turn(await openFor(nora), { stop: 'no_sale' }));
    expect(await openFor(nora)).toBeNull();
    const [row] = await withAdmin(test.admin.db, (tx) =>
      tx.select().from(schema.customOrders).where(eq(schema.customOrders.fanId, fan)),
    );
    expect(row?.state).toBe('cancelled');
  });

  it('a turn with nothing about an order writes nothing', async () => {
    await record(nora, 'm4', turn(null, { asksForService: false }));
    expect(await openFor(nora)).toBeNull();
  });

  it('another creator neither reads nor writes his orders', async () => {
    await record(nora, 'm5', turn(null));
    expect(await openFor(nora)).not.toBeNull();
    expect(await openFor(ines)).toBeNull();
    await expect(record(ines, 'm6', turn(null))).rejects.toThrow();
  });
});
