import { ConversationIdSchema, CreatorIdSchema, CreatorSettingsSchema } from '@impera/contracts';
import { sql, withAdmin, type Database } from '@impera/db';
import { z } from 'zod';

import type { CardRereadScan } from '../../domain/ports';

const RowSchema = z.object({
  creatorId: CreatorIdSchema,
  conversationId: ConversationIdSchema,
  settings: z.unknown(),
});

/** Her fan card on: a stored setting that does not read leaves the default, on. */
function fanCardOn(settings: unknown): boolean {
  const parsed = CreatorSettingsSchema.safeParse(settings);
  return parsed.success ? parsed.data.copilot.fanCard : CreatorSettingsSchema.parse({}).copilot.fanCard;
}

/**
 * The week's conversations to read again (ADR 0085 § 7, amendement du 21/11), on the admin connection: the job runs for
 * no creator. Read only; each re-read is enqueued and runs in its creator's transaction.
 */
export function createDrizzleCardRereadScan(adminDb: Database): CardRereadScan {
  return {
    active: (since) =>
      withAdmin(adminDb, async (tx) => {
        const result = await tx.execute(sql`
          select c.creator_id as "creatorId", c.id as "conversationId", cr.settings
            from conversations c
            join creators cr on cr.id = c.creator_id
           where cr.archived_at is null
             and exists (select 1 from messages m
                          where m.conversation_id = c.id and m.author = 'fan'
                            and m.created_at >= ${since.toISOString()}::timestamptz)
           order by c.creator_id, c.id`);
        return z
          .array(RowSchema)
          .parse(result.rows)
          .filter((row) => fanCardOn(row.settings))
          .map(({ creatorId, conversationId }) => ({ creatorId, conversationId }));
      }),
  };
}
