import { z } from 'zod';

/**
 * Reveal's CRM API as its documentation describes it (`dashboard.reveal.me/settings/crm-api`, read on 2026-11-02,
 * `/mnt/project-files/crm-api-reference.md` outside the repository). No real answer has been seen yet: these schemas
 * follow the documentation and are to be confirmed at the first real call, by Charles's request only (ADR 0050 § 9).
 *
 * Objects are not `.strict()`: a field Reveal adds is ignored, while a field Nirvana reads that is missing or of
 * another type fails the parse, and the reading stops without moving the cursor. Values Reveal says may grow (`event`,
 * `sale.type`, `sale.status`, `models[].status`) are read as strings and mapped by the adapter, never refused here.
 */

const cents = z.number().int().min(0);
const text = z.string().min(1);

export const RevealSaleSchema = z.object({
  id: text,
  createdAt: z.iso.datetime({ offset: true }),
  modelId: text,
  type: text,
  status: text,
  refundedAt: z.iso.datetime({ offset: true }).nullable(),
  amountTtc: cents,
  amountHt: cents,
  agencyRevenue: cents,
  modelRevenue: cents,
  netAmount: cents,
  /** `null` for a purchase without an account (a payment link). The pseudo is never read past this schema. */
  fan: z.object({ memberId: text }).nullable(),
  chatterId: text.nullable(),
});

export const RevealSalesLineSchema = z.object({
  cursor: text,
  event: text,
  occurredAt: z.iso.datetime({ offset: true }),
  sale: RevealSaleSchema,
});

export const RevealSalesPageSchema = z.object({
  currency: text,
  data: z.array(RevealSalesLineSchema),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: text.nullable() }),
});

export const RevealModelsSchema = z.object({
  data: z.array(
    z.object({
      modelId: text,
      userName: text,
      displayName: z.string(),
      isActive: z.boolean(),
      status: text,
    }),
  ),
});

export const RevealChattersSchema = z.object({
  data: z.array(
    z.object({
      chatterId: text,
      firstName: z.string(),
      lastName: z.string(),
      isBot: z.boolean(),
      isExternal: z.boolean(),
      removedAt: z.iso.datetime({ offset: true }).nullable(),
      modelIds: z.array(text),
    }),
  ),
});

const day = z.iso.date();
const laterCount = cents.nullable();

export const RevealDailyStatsSchema = z.object({
  currency: text,
  data: z.array(
    z.object({
      date: day,
      modelId: text,
      newSubscribers: cents,
      activeSubscribers: cents,
      revenueTtc: cents,
      revenueHt: cents,
      agencyRevenue: cents,
      modelRevenue: cents,
      ppvPurchased: cents,
      ppvSent: laterCount,
      messagesSent: laterCount,
      messagesReceived: laterCount,
    }),
  ),
});

export const RevealChatterDailyStatsSchema = z.object({
  currency: text,
  data: z.array(
    z.object({
      date: day,
      chatterId: text.nullable(),
      modelId: text,
      salesCount: cents,
      revenueTtc: cents,
      agencyRevenue: cents,
      modelRevenue: cents,
      netRevenue: cents,
      ppvPurchased: cents,
      ppvSent: laterCount,
      messagesSent: laterCount,
    }),
  ),
});
