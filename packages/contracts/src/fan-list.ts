import { z } from 'zod';

import { AgencyPeriodSchema } from './agency-insights';
import { ConversationIdSchema, CreatorIdSchema, FanIdSchema } from './ids';

/**
 * `GET /v1/fans` (ADR 0124): every fan the CRM knows for one creator, for the owner and an active manager of her list.
 * His pseudonym and figures only: never a message, never his card (that is read in Suivi, with its rights).
 */

/** The lists of ADR 0092 § 3 and the others of 0124 § 2, as filters of one screen; `all` first. */
export const FanListFilterSchema = z.enum([
  'all',
  'big_payers',
  'lapsed',
  'payers',
  'never_paid',
  'unanswered',
]);
export type FanListFilter = z.infer<typeof FanListFilterSchema>;

/** The order of the list, the greatest or the latest first. */
export const FanListSortSchema = z.enum(['last_message', 'paid', 'last_payment']);
export type FanListSort = z.infer<typeof FanListSortSchema>;

/** « Ont décroché » : paid before, nothing for this many days (0124 § 2, 21 by default). */
export const FAN_LAPSED_DAYS_DEFAULT = 21;

/** Longest search text: a pseudonym, never a sentence. */
export const FAN_SEARCH_MAX = 80;

export const FanListQuerySchema = z.object({
  creatorId: CreatorIdSchema,
  filter: FanListFilterSchema.default('all'),
  /** `big_payers` is always by what they paid over the period. */
  sort: FanListSortSchema.default('last_message'),
  /** The period « payé sur la période » counts, today included, as the agency's view. */
  period: AgencyPeriodSchema.default('month'),
  lapsedDays: z.coerce.number().int().min(1).max(365).default(FAN_LAPSED_DAYS_DEFAULT),
  /** Part of his pseudonym, without minding accents or case. */
  q: z.string().trim().max(FAN_SEARCH_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(400).optional(),
});
export type FanListQuery = z.infer<typeof FanListQuerySchema>;

/** Integer cents in each currency, refunds taken off. */
export const FanPaidSchema = z.strictObject({
  eurMinor: z.number().int(),
  usdMinor: z.number().int(),
});
export type FanPaid = z.infer<typeof FanPaidSchema>;

/**
 * Who holds his conversation: the agent alone (`agent`), the agent with a human checking (`copilot`), a human
 * (`human`, named when it was routed to someone), or nobody yet (`none`: no conversation).
 */
export const FanHolderSchema = z.enum(['agent', 'copilot', 'human', 'none']);
export type FanHolder = z.infer<typeof FanHolderSchema>;

/** His states, with Suivi's words on the screen. */
export const FanListStateSchema = z.enum(['age_disputed', 'do_not_contact', 'care', 'sales_frozen']);
export type FanListState = z.infer<typeof FanListStateSchema>;

export const FanListItemSchema = z.strictObject({
  fanId: FanIdSchema,
  displayName: z.string(),
  firstSeenAt: z.iso.datetime(),
  /** His last message to her; `null` when he never wrote. */
  lastMessageAt: z.iso.datetime().nullable(),
  /** His last purchase in the register; `null` when he never paid. */
  lastPaidAt: z.iso.datetime().nullable(),
  paidPeriod: FanPaidSchema,
  paidEver: FanPaidSchema,
  holder: FanHolderSchema,
  /** The member it is routed to, when a human holds it. */
  holderName: z.string().nullable(),
  /** Her latest conversation with him: the line opens it in Suivi. */
  conversationId: ConversationIdSchema.nullable(),
  /** Whether his last message waits for an answer from us. */
  unanswered: z.boolean(),
  states: z.array(FanListStateSchema),
});
export type FanListItem = z.infer<typeof FanListItemSchema>;

export const FanListPageSchema = z.strictObject({
  items: z.array(FanListItemSchema),
  nextCursor: z.string().nullable(),
  /** How many fans the filter and the search keep, every page counted. */
  total: z.number().int().nonnegative(),
  /**
   * Whether « Communs à plusieurs créatrices » can be read: only if the platform gives a fan the same id from one
   * account to another, not known yet (0124, À surveiller). `false` hides the filter and the screen says so.
   */
  sharedFansKnown: z.boolean(),
});
export type FanListPage = z.infer<typeof FanListPageSchema>;

/**
 * A pseudonym as the search compares it: no accent, lower case, as Suivi folds it. The server folds the column the
 * same way (`FAN_FOLD_FROM` → `FAN_FOLD_TO`, each letter for its plain one).
 */
export function foldPseudonym(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR').trim();
}

/** The accented lower-case letters and their plain letter, one for one, for the server's `translate`. */
export const FAN_FOLD_FROM = 'àáâãäåāçćčèéêëēėęìíîïīįñńòóôõöøōùúûüūýÿžźżšśłđ';
export const FAN_FOLD_TO = 'aaaaaaaccceeeeeeeiiiiiinnooooooouuuuuyyzzzssld';
