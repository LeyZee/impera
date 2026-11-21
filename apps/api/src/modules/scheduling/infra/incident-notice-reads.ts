import { ShiftFeedbackIdSchema, type CreatorId, type ShiftFeedbackId } from '@impera/contracts';
import { sql, withAdmin, type Database } from '@impera/db';
import { z } from 'zod';

import type { IncidentFacts, IncidentRecipient } from '../domain/incident-notice';

import { agencyTimeZone } from './rows';

const FactsRowSchema = z.object({
  id: ShiftFeedbackIdSchema,
  author: z.string().min(1),
  member_name: z.string().min(1),
  creator_name: z.string().min(1),
  starts_at: z.coerce.date(),
  ends_at: z.coerce.date(),
  creator_id: z.uuid(),
});

const RecipientRowSchema = z.object({ user_id: z.string().min(1), time_zone: z.string().min(1).nullable() });

/**
 * What the notice of an incident reads (trous béants n° 1), on the service connection: the job crosses creators and
 * reads the owners. The feedback's who and where, never its text; the owners (in the agency's zone) and the active
 * managers whose list holds the creator (in their own zone). Nothing is written.
 */
export function createDrizzleIncidentNoticeReads(adminDb: Database): {
  factsUnscoped(
    feedbackId: ShiftFeedbackId,
    creatorId: CreatorId,
  ): Promise<{ facts: IncidentFacts; recipients: IncidentRecipient[] } | null>;
} {
  return {
    factsUnscoped: (feedbackId, creatorId) =>
      withAdmin(adminDb, async (tx) => {
        const [raw] = (
          await tx.execute(sql`
            select f.id, f.created_by as author, m.display_name as member_name, c.display_name as creator_name,
                   s.starts_at, s.ends_at, f.creator_id
              from shift_feedbacks f
              join shifts s on s.id = f.shift_id
              join team_members m on m.id = f.member_id
              join creators c on c.id = f.creator_id
             where f.id = ${feedbackId} and f.creator_id = ${creatorId} and f.incident is not null`)
        ).rows;
        if (raw === undefined) return null;
        const row = FactsRowSchema.parse(raw);
        const zone = await agencyTimeZone(tx);
        const recipients = (
          await tx.execute(sql`
            select u.id as user_id, null as time_zone from "user" u where u.role = 'owner'
            union
            select m.user_id, m.time_zone
              from team_members m
              join "user" u on u.id = m.user_id
             where m.team_role = 'manager' and m.status = 'active' and ${row.creator_id}::uuid = any(u.creator_ids)
            order by 1`)
        ).rows.map((one) => {
          const parsed = RecipientRowSchema.parse(one);
          return { userId: parsed.user_id, timeZone: parsed.time_zone ?? zone };
        });
        return {
          facts: {
            feedbackId: row.id,
            authorUserId: row.author,
            memberName: row.member_name,
            creatorName: row.creator_name,
            shiftStartsAt: row.starts_at,
            shiftEndsAt: row.ends_at,
          },
          recipients,
        };
      }),
  };
}
