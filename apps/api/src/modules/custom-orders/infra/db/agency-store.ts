import {
  ACTIVE_CUSTOM_ORDER_STATES,
  AuditEntryIdSchema,
  CUSTOM_ORDER_MOVES,
  CustomOrderCardSchema,
  CustomOrderViewSchema,
  customDepositMinor,
  CustomFormatSchema,
  CustomOrderStateSchema,
  newId,
  type AdvanceCustomOrderBody,
  type CreatorId,
  type CustomOrderId,
  type CustomOrderState,
  type CustomOrderView,
  type DecideCustomOrderBody,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  onCreatorList,
  schema,
  sql,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import type { CustomPriceActor } from '../../domain/ports';

type SQL = ReturnType<typeof sql>;

const { auditLog, conversations, creators, customOrders, fans } = schema;

/** What a gesture on one order gives back: the order after it, or why nothing changed. */
export type CustomOrderMove =
  | { readonly kind: 'moved'; readonly order: CustomOrderView }
  | { readonly kind: 'not_found' }
  /** The order is not in a state this move leaves from (already answered, delivered, cancelled…). */
  | { readonly kind: 'refused'; readonly state: CustomOrderState };

/**
 * His custom orders as the agency reads and answers them (ADR 0159 § A.3): read by the owner and by an active manager
 * who follows her; her answer (yes at a price, or no) and each later step entered by the owner alone. Every call runs
 * under her RLS with the scope read in the base, never from the session; nothing through the service role.
 */
export interface CustomOrderAgencyStore {
  /** Her orders, newest first: `active` until delivered, or `all`. Null: no such creator, or not readable by him. */
  list(
    creatorId: CreatorId,
    scope: 'active' | 'all',
    actor: CustomPriceActor,
  ): Promise<CustomOrderView[] | null>;
  decide(
    creatorId: CreatorId,
    orderId: CustomOrderId,
    body: DecideCustomOrderBody,
    actor: CustomPriceActor,
  ): Promise<CustomOrderMove | null>;
  advance(
    creatorId: CreatorId,
    orderId: CustomOrderId,
    body: AdvanceCustomOrderBody,
    actor: CustomPriceActor,
  ): Promise<CustomOrderMove | null>;
}

const COLUMNS = {
  id: customOrders.id,
  fanId: customOrders.fanId,
  fanName: fans.displayName,
  state: customOrders.state,
  format: customOrders.format,
  supplements: customOrders.supplements,
  minutes: customOrders.minutes,
  details: customOrders.details,
  card: customOrders.card,
  priceMinor: customOrders.priceMinor,
  depositMinor: customOrders.depositMinor,
  createdAt: customOrders.createdAt,
  updatedAt: customOrders.updatedAt,
  decidedAt: customOrders.decidedAt,
  // His latest conversation with her, to open from the card.
  conversationId: sql<
    string | null
  >`(select c.id from ${conversations} c where c.fan_id = ${customOrders.fanId} and c.creator_id = ${customOrders.creatorId} order by c.updated_at desc limit 1)`,
};

/** His orders with her under `where`, the fan's name beside each; locked for a move when `forMove`. */
function select(tx: Transaction, where: SQL | undefined, forMove: boolean) {
  const query = tx
    .select(COLUMNS)
    .from(customOrders)
    .innerJoin(fans, eq(fans.id, customOrders.fanId))
    .where(where)
    .orderBy(sql`${customOrders.updatedAt} desc`)
    .limit(200);
  return forMove ? query.for('update', { of: customOrders }) : query;
}

type Row = Awaited<ReturnType<typeof select>>[number];

/** A row as the contract has it: written by this module and the agent's turn, still parsed on the way out. */
function viewOf(row: Row): CustomOrderView {
  const card = row.card === null ? null : CustomOrderCardSchema.safeParse(row.card);
  return CustomOrderViewSchema.parse({
    ...row,
    // A card the contract cannot read stays out rather than breaking the list: the boxes beside it still show.
    card: !card?.success ? null : card.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
  });
}

async function one(tx: Transaction, creatorId: CreatorId, orderId: CustomOrderId): Promise<Row | undefined> {
  const [row] = await select(
    tx,
    and(eq(customOrders.creatorId, creatorId), eq(customOrders.id, orderId)),
    true,
  );
  return row;
}

export function createDrizzleCustomOrderAgencyStore(db: Database): CustomOrderAgencyStore {
  /** `fn` under her RLS when the actor may: `read` the owner or an active manager who follows her; else the owner. */
  const as = <T>(
    creatorId: CreatorId,
    actor: CustomPriceActor,
    right: 'read' | 'answer',
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T | null> =>
    withTenantMember(db, creatorId, actor.userId, async (tx, scope) => {
      const allowed =
        scope === 'owner' ||
        (right === 'read' && scope === 'agency' && (await onCreatorList(tx, actor.userId, creatorId)));
      if (!allowed) return null;
      // `creators` is the tenant root, without RLS: the same answer for a creator that does not exist.
      const [creator] = await tx.select({ id: creators.id }).from(creators).where(eq(creators.id, creatorId));
      return creator === undefined ? null : fn(tx);
    });

  async function move(
    tx: Transaction,
    creatorId: CreatorId,
    orderId: CustomOrderId,
    to: CustomOrderState,
    actor: CustomPriceActor,
    set: Partial<typeof customOrders.$inferInsert>,
    details: Record<string, unknown>,
  ): Promise<CustomOrderMove> {
    const before = await one(tx, creatorId, orderId);
    if (before === undefined) return { kind: 'not_found' };
    const from = CustomOrderStateSchema.parse(before.state);
    if (!CUSTOM_ORDER_MOVES[from].includes(to)) return { kind: 'refused', state: from };
    // A deposit to receive only when her price asks one.
    if (to === 'deposit_paid' && before.depositMinor === null) return { kind: 'refused', state: from };
    const at = new Date();
    await tx
      .update(customOrders)
      .set({ ...set, state: to, updatedAt: at })
      .where(and(eq(customOrders.id, orderId), eq(customOrders.creatorId, creatorId)));
    // The audit says who moved which order where, never a price (methods of the agency).
    await tx.insert(auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: actor.userId,
      action: 'custom_order.move',
      entity: 'custom_order',
      entityId: orderId,
      ip: actor.ip,
      details: { from, to, ...details },
    });
    const after = await one(tx, creatorId, orderId);
    if (after === undefined) throw new Error('custom order vanished after its move');
    return { kind: 'moved', order: viewOf(after) };
  }

  return {
    list: (creatorId, scope, actor) =>
      as(creatorId, actor, 'read', async (tx) => {
        const rows = await select(
          tx,
          scope === 'active'
            ? and(
                eq(customOrders.creatorId, creatorId),
                inArray(customOrders.state, [...ACTIVE_CUSTOM_ORDER_STATES]),
              )
            : eq(customOrders.creatorId, creatorId),
          false,
        );
        return rows.map(viewOf);
      }),

    decide: (creatorId, orderId, body, actor) =>
      as(creatorId, actor, 'answer', async (tx) => {
        if (body.decision === 'no')
          return move(
            tx,
            creatorId,
            orderId,
            'creator_no',
            actor,
            { decidedBy: actor.userId, decidedAt: new Date() },
            {},
          );
        const current = await one(tx, creatorId, orderId);
        if (current === undefined) return { kind: 'not_found' } as const;
        const format = CustomFormatSchema.nullable().parse(current.format);
        return move(
          tx,
          creatorId,
          orderId,
          'creator_yes',
          actor,
          {
            priceMinor: body.priceMinor,
            depositMinor: customDepositMinor(format, body.priceMinor),
            decidedBy: actor.userId,
            decidedAt: new Date(),
          },
          { priced: true },
        );
      }),

    advance: (creatorId, orderId, body, actor) =>
      as(creatorId, actor, 'answer', (tx) => move(tx, creatorId, orderId, body.to, actor, {}, {})),
  };
}
