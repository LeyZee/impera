import { and, eq, inArray, schema, sql, withAdmin, type Database } from '@impera/db';

import type { CreatorNotice, CreatorNoticeSubject } from '../../domain/creator-notices';
import type { CreatorNoticeSource } from '../../domain/ports';

/**
 * What the agency asked of the creators not archived, by the job's role (`withAdmin`, as `creator-sales.ts`): the job
 * crosses every creator, and her accounts are out of reach of a tenant's path. Read only, a bounded window, and of each
 * row only what her phone says (no request's words, no proposition's title). Her accounts are the ones whose role is
 * `creator` and whose only creator is hers (one link per account since CR-02).
 */
export function createCreatorNoticeSource(adminDb: Database): CreatorNoticeSource {
  const requests = schema.contentRequests;
  const suggestions = schema.creatorSuggestions;
  const weeks = schema.creatorWeeks;
  const creators = schema.creators;
  return {
    between: (from, to) =>
      withAdmin(adminDb, async (tx) => {
        // The window: after `from`, at or before `to`.
        const after = from.toISOString();
        const until = to.toISOString();
        const open = sql`${creators.archivedAt} is null`;
        const asked = await tx
          .select({
            id: requests.id,
            creatorId: requests.creatorId,
            category: requests.category,
            dueOn: requests.dueOn,
            timeZone: creators.timezone,
          })
          .from(requests)
          .innerJoin(creators, eq(creators.id, requests.creatorId))
          .where(
            and(
              open,
              eq(requests.state, 'open'),
              sql`${requests.createdAt} > ${after}::timestamptz and ${requests.createdAt} <= ${until}::timestamptz`,
            ),
          )
          .orderBy(requests.createdAt, requests.id);
        const proposed = await tx
          .select({ id: suggestions.id, creatorId: suggestions.creatorId, timeZone: creators.timezone })
          .from(suggestions)
          .innerJoin(creators, eq(creators.id, suggestions.creatorId))
          .where(
            and(
              open,
              eq(suggestions.origin, 'agency'),
              sql`${suggestions.weekRole} is null`,
              eq(suggestions.state, 'suggested'),
              sql`${suggestions.createdAt} > ${after}::timestamptz and ${suggestions.createdAt} <= ${until}::timestamptz`,
            ),
          )
          .orderBy(suggestions.createdAt, suggestions.id);
        const validated = await tx
          .select({ week: weeks.week, creatorId: weeks.creatorId, timeZone: creators.timezone })
          .from(weeks)
          .innerJoin(creators, eq(creators.id, weeks.creatorId))
          .where(
            and(
              open,
              eq(weeks.state, 'validated'),
              sql`${weeks.validatedAt} > ${after}::timestamptz and ${weeks.validatedAt} <= ${until}::timestamptz`,
            ),
          )
          .orderBy(weeks.validatedAt, weeks.id);

        const found: { creatorId: string; timeZone: string; subject: CreatorNoticeSubject }[] = [
          ...asked.map((row) => ({
            creatorId: row.creatorId,
            timeZone: row.timeZone,
            subject: {
              kind: 'content_request' as const,
              requestId: row.id,
              script: row.category === 'script',
              dueOn: row.dueOn,
            },
          })),
          ...proposed.map((row) => ({
            creatorId: row.creatorId,
            timeZone: row.timeZone,
            subject: { kind: 'proposition' as const, suggestionId: row.id },
          })),
          ...validated.map((row) => ({
            creatorId: row.creatorId,
            timeZone: row.timeZone,
            subject: { kind: 'week' as const, week: row.week },
          })),
        ];
        if (found.length === 0) return [];
        const creatorIds = [...new Set(found.map((one) => one.creatorId))];
        const linked = await tx
          .select({ id: schema.user.id, creatorIds: schema.user.creatorIds })
          .from(schema.user)
          .where(and(eq(schema.user.role, 'creator'), inArray(sql`${schema.user.creatorIds}[1]`, creatorIds)))
          .orderBy(schema.user.id);
        const accountsOf = new Map<string, string[]>();
        for (const account of linked) {
          const creatorId = account.creatorIds[0];
          if (creatorId === undefined) continue;
          accountsOf.set(creatorId, [...(accountsOf.get(creatorId) ?? []), account.id]);
        }
        return found.map((one): CreatorNotice => ({
          subject: one.subject,
          timeZone: one.timeZone,
          accounts: accountsOf.get(one.creatorId) ?? [],
        }));
      }),
  };
}
