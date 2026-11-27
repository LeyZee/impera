import {
  ConversationIdSchema,
  SHIFT_DIGEST_FANS_MAX,
  type ConversationId,
  type PlatformAccountId,
  type ShiftDraftCounts,
  type UserId,
} from '@impera/contracts';
import { sql, type Transaction } from '@impera/db';
import { z } from 'zod';

/** Which shift the figures are read for: its account, its member's account, its hours `[from, to)`. */
export interface ShiftActivityQuery {
  readonly platformAccountId: PlatformAccountId;
  readonly userId: UserId;
  readonly from: Date;
  readonly to: Date;
}

/** A fan written to during the shift, for « Lier à un fan » (ADR 0170 § 2). */
interface ShiftFan {
  readonly conversationId: ConversationId;
  readonly name: string;
  readonly messages: number;
  readonly lastAt: Date;
}

/**
 * What the conversations say of a shift (ADR 0170 § 1): the agent's drafts its member decided, the conversations the
 * agent handed to the team on the account, the fans written to.
 */
export interface ShiftActivity {
  readonly drafts: ShiftDraftCounts;
  readonly handoffs: number;
  readonly fans: readonly ShiftFan[];
}

const instant = z.union([z.date(), z.string()]).transform((value) => new Date(value));
const CountRowSchema = z.object({ type: z.string(), n: z.coerce.number().int().nonnegative() });
const FanRowSchema = z.object({
  id: ConversationIdSchema,
  display_name: z.string(),
  n: z.coerce.number().int().positive(),
  last_at: instant,
});

/**
 * @public
 * The figures of a shift's feedback, read in the caller's transaction through the conversations' `index.ts`, under the
 * shift's creator entered by the planning (`scheduling`). Read only. A draft is the member's by its event's actor
 * (`human:<userId>`), whatever conversation of the account it was on; a handoff is the agent's, on the account; a fan
 * counts when a message of his conversation, his or hers, is dated within the hours. The last written to first, at
 * most `SHIFT_DIGEST_FANS_MAX`.
 */
export const conversationReadsForShifts = {
  activity: async (tx: Transaction, query: ShiftActivityQuery): Promise<ShiftActivity> => {
    const from = query.from.toISOString();
    const to = query.to.toISOString();
    const counts = await tx.execute(sql`
      select e.type, count(*)::int as n
        from conversation_events e
        join conversations c on c.id = e.conversation_id
       where c.platform_account_id = ${query.platformAccountId}
         and e.created_at >= ${from}::timestamptz and e.created_at < ${to}::timestamptz
         and (
           (e.type in ('draft_approved', 'draft_edited', 'draft_rejected') and e.actor = ${`human:${query.userId}`})
           or e.type = 'handoff_requested'
         )
       group by e.type`);
    const count = new Map(
      counts.rows.map((raw) => CountRowSchema.parse(raw)).map((row) => [row.type, row.n]),
    );
    const fans = await tx.execute(sql`
      select c.id, f.display_name, count(*)::int as n, max(m.platform_created_at) as last_at
        from messages m
        join conversations c on c.id = m.conversation_id
        join fans f on f.id = c.fan_id
       where c.platform_account_id = ${query.platformAccountId}
         and m.platform_created_at >= ${from}::timestamptz and m.platform_created_at < ${to}::timestamptz
       group by c.id, f.display_name
       order by max(m.platform_created_at) desc, c.id
       limit ${SHIFT_DIGEST_FANS_MAX}`);
    return {
      drafts: {
        asIs: count.get('draft_approved') ?? 0,
        edited: count.get('draft_edited') ?? 0,
        rejected: count.get('draft_rejected') ?? 0,
      },
      handoffs: count.get('handoff_requested') ?? 0,
      fans: fans.rows.map((raw) => {
        const row = FanRowSchema.parse(raw);
        return { conversationId: row.id, name: row.display_name, messages: row.n, lastAt: row.last_at };
      }),
    };
  },
};
