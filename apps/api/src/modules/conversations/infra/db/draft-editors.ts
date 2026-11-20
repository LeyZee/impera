import { inArray, schema, sql, withAdmin, withTenant, type Database } from '@impera/db';
import { z } from 'zod';

const { conversationEvents, teamMembers } = schema;

const EditRowSchema = z.object({ draft_id: z.uuid(), user_id: z.string().min(1).nullable() });

/**
 * Who corrected each of these drafts of one of her conversations (CRE-04, ADR 0065 § 1): the display name of the
 * member who approved it edited, by draft. Called only after her own door (`withCreatorAccount`) showed the
 * conversation and its messages are hers. The journal is read in her creator (RLS, the agency's side: drafts and
 * events stay closed to her account); the names on the admin connection, as the colleagues' (ADR 0031), since the
 * team's policies open no member to her: the read gives a display name and nothing else of him. A corrector with no
 * member record (the owner) is not in the map.
 */
export async function draftEditors(
  db: Database,
  adminDb: Database,
  creatorId: string,
  conversationId: string,
  draftIds: readonly string[],
): Promise<Map<string, string>> {
  if (draftIds.length === 0) return new Map();
  const edits = await withTenant(db, creatorId, async (tx) => {
    // The last `draft_edited` of each draft: its decider, or the human actor that wrote it (`human:<userId>`).
    const result = await tx.execute(
      sql`select distinct on (e.payload->>'draftId')
                 e.payload->>'draftId' as draft_id,
                 coalesce(e.payload->>'decidedBy', substring(e.actor from '^human:(.+)$')) as user_id
          from ${conversationEvents} e
          where e.conversation_id = ${conversationId}::uuid
            and e.type = 'draft_edited'
            and e.payload->>'draftId' = any(${sql.param([...draftIds])}::text[])
          order by e.payload->>'draftId', e.seq desc`,
    );
    return z
      .array(EditRowSchema)
      .parse(result.rows)
      .flatMap((row) => (row.user_id === null ? [] : [{ draftId: row.draft_id, userId: row.user_id }]));
  });
  if (edits.length === 0) return new Map();
  const userIds = [...new Set(edits.map((edit) => edit.userId))];
  const members = await withAdmin(adminDb, (tx) =>
    tx
      .select({ userId: teamMembers.userId, displayName: teamMembers.displayName })
      .from(teamMembers)
      .where(inArray(teamMembers.userId, userIds)),
  );
  const names = new Map(members.map((member) => [member.userId, member.displayName]));
  return new Map(
    edits.flatMap((edit) => {
      const name = names.get(edit.userId);
      return name === undefined ? [] : [[edit.draftId, name] as const];
    }),
  );
}
