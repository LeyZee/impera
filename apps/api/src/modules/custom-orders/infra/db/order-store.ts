import {
  CustomOrderIdSchema,
  OpenCustomOrderSchema,
  newId,
  type CreatorId,
  type FanId,
  type OpenCustomOrder,
} from '@impera/contracts';
import { and, eq, inArray, schema, type Transaction } from '@impera/db';

import type { CustomOrderTurn } from '../../domain/turn';

const { customOrders } = schema;

/** The states of an order still before her yes: at most one per fan (`custom_orders_open_per_fan`). */
const OPEN_STATES = ['gathering', 'awaiting_creator'] as const;

export interface CustomOrderRecord {
  readonly creatorId: CreatorId;
  readonly fanId: FanId;
  /** His last message the turn took in (platform id): the same message recorded twice changes nothing. */
  readonly inboundMessageId: string;
  readonly turn: CustomOrderTurn;
  readonly at: Date;
}

/**
 * His custom orders for the agent's turn (ADR 0159 § A). Both calls run in the turn's own transaction, under her RLS
 * (`withTenant` of the creator): nothing here opens one, nothing crosses creators.
 */
export interface CustomOrderStore {
  /** His order still before her yes (`gathering` or `awaiting_creator`), or null. */
  openFor(
    tx: Transaction,
    who: { readonly creatorId: CreatorId; readonly fanId: FanId },
  ): Promise<OpenCustomOrder | null>;
  /**
   * What the turn decided, kept: an order opens or moves on (`turn.order`), and closes when the turn ends it (`order`
   * null after a decline). A turn with nothing about an order, or a message already recorded, changes nothing.
   */
  record(tx: Transaction, record: CustomOrderRecord): Promise<void>;
}

async function openRow(tx: Transaction, creatorId: CreatorId, fanId: FanId) {
  const [row] = await tx
    .select()
    .from(customOrders)
    .where(
      and(
        eq(customOrders.creatorId, creatorId),
        eq(customOrders.fanId, fanId),
        inArray(customOrders.state, [...OPEN_STATES]),
      ),
    )
    .for('update')
    .limit(1);
  return row;
}

async function alreadyRecorded(tx: Transaction, record: CustomOrderRecord): Promise<boolean> {
  const [row] = await tx
    .select({ id: customOrders.id })
    .from(customOrders)
    .where(
      and(
        eq(customOrders.creatorId, record.creatorId),
        eq(customOrders.fanId, record.fanId),
        eq(customOrders.lastInboundMessageId, record.inboundMessageId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export function createDrizzleCustomOrderStore(): CustomOrderStore {
  return {
    async openFor(tx, { creatorId, fanId }) {
      const row = await openRow(tx, creatorId, fanId);
      // Written by this module only, but a row is still a boundary: parsed by the contract.
      return row === undefined
        ? null
        : OpenCustomOrderSchema.parse({
            state: row.state,
            format: row.format,
            supplements: row.supplements,
            minutes: row.minutes,
            details: row.details,
            questionsAsked: row.questionsAsked,
          });
    },

    async record(tx, record) {
      const { turn } = record;
      if (turn.kind === 'none') return;
      if (await alreadyRecorded(tx, record)) return;
      const open = await openRow(tx, record.creatorId, record.fanId);
      const next = turn.order === null ? null : OpenCustomOrderSchema.parse(turn.order);
      const card =
        turn.kind === 'reply' && turn.event?.type === 'custom_order_card_ready' ? turn.event.card : null;

      if (next === null) {
        // The turn ended his order before her (declined), or none opened (held): the open one, if any, is cancelled.
        if (open !== undefined)
          await tx
            .update(customOrders)
            .set({ state: 'cancelled', lastInboundMessageId: record.inboundMessageId, updatedAt: record.at })
            .where(eq(customOrders.id, open.id));
        return;
      }
      const values = {
        state: next.state,
        format: next.format,
        supplements: next.supplements,
        minutes: next.minutes,
        details: next.details,
        questionsAsked: next.questionsAsked,
        lastInboundMessageId: record.inboundMessageId,
        updatedAt: record.at,
        ...(card === null ? {} : { card }),
      };
      if (open === undefined)
        await tx.insert(customOrders).values({
          id: newId(CustomOrderIdSchema),
          creatorId: record.creatorId,
          fanId: record.fanId,
          createdAt: record.at,
          ...values,
        });
      else await tx.update(customOrders).set(values).where(eq(customOrders.id, open.id));
    },
  };
}
