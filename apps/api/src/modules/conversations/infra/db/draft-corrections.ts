import {
  ConversationIdSchema,
  DRAFT_CORRECTIONS_MAX,
  DraftIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { sql, withTenant, type Database } from '@impera/db';
import { z } from 'zod';

import type { DraftCorrectionRow } from '../../domain/draft-corrections';

const RowSchema = z.object({
  type: z.enum(['draft_rejected', 'draft_edited']),
  created_at: z.coerce.date(),
  conversation_id: ConversationIdSchema,
  draft_id: DraftIdSchema,
  fan_display_name: z.string().nullable(),
  bubbles: z.array(z.string()),
  edited: z.array(z.string()).nullable(),
  written_reason: z.string().nullable(),
  rating: z.unknown(),
});

/**
 * Her refused and retouched drafts since `since` (trou béant 12), newest first, read from the journal in her tenant
 * (RLS, and her id on the journal and the drafts): `draft_rejected` and `draft_edited` with the draft they name, its
 * live rating if the copilot panel wrote one, and the fan's pseudonym. One more than `DRAFT_CORRECTIONS_MAX`, so the screen knows there were more.
 */
export async function readDraftCorrections(
  db: Database,
  creatorId: CreatorId,
  since: Date,
): Promise<DraftCorrectionRow[]> {
  const result = await withTenant(db, creatorId, (tx) =>
    tx.execute(sql`
      select e.type, e.created_at, e.conversation_id, d.id as draft_id, f.display_name as fan_display_name,
             d.bubbles,
             case when jsonb_typeof(e.payload -> 'editedBubbles') = 'array'
                  then array(select jsonb_array_elements_text(e.payload -> 'editedBubbles')) end as edited,
             e.payload ->> 'reason' as written_reason,
             r.verdict as rating
        from conversation_events e
        join drafts d on d.id = (e.payload ->> 'draftId')::uuid and d.conversation_id = e.conversation_id
        join conversations c on c.id = e.conversation_id
        join fans f on f.id = c.fan_id
        left join calibration_ratings r on r.draft_id = d.id and r.source = 'live'
       where e.creator_id = ${creatorId}
         and d.creator_id = ${creatorId}
         and e.type in ('draft_rejected', 'draft_edited')
         and e.created_at >= ${since.toISOString()}::timestamptz
       order by e.created_at desc, e.id desc
       limit ${DRAFT_CORRECTIONS_MAX + 1}`),
  );
  return z
    .array(RowSchema)
    .parse(result.rows)
    .map((row) => ({
      draftId: row.draft_id,
      conversationId: row.conversation_id,
      fanDisplayName: row.fan_display_name ?? '',
      at: row.created_at,
      kind: row.type === 'draft_edited' ? 'edited' : 'rejected',
      before: row.bubbles,
      edited: row.edited,
      writtenReason: row.written_reason,
      rating: row.rating,
    }));
}
