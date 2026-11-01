import { EventIdSchema, EVENT_PAYLOADS, newId } from '@nirvana/contracts';
import { schema, sql, withAdmin, type Database } from '@nirvana/db';
import type { BudgetEvent } from '@nirvana/llm';

/**
 * `budget_threshold_crossed` in the outbox (ADR 0020 §3): the agency-wide daily AI cap belongs to no creator, so the
 * row has `creator_id` null and is written with the owner role (RLS). The API and the worker each see the crossing;
 * the first one writes it, the other finds it (advisory lock, one row per day and kind). The search looks back two
 * days only: the day's row is younger than that, and `domain_events_created_idx` serves it instead of a full scan.
 */
export function publishBudgetThreshold(adminDb: Database, { kind, status }: BudgetEvent): Promise<void> {
  const payload = EVENT_PAYLOADS.budget_threshold_crossed.parse({
    kind,
    spentMinor: Math.round(status.spentEur * 100),
    capMinor: Math.round(status.capEur * 100),
    currency: 'EUR',
    day: status.day,
  });
  return withAdmin(adminDb, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`budget:${status.day}:${kind}`}))`);
    const seen = await tx.execute(sql`
      select 1 from domain_events
      where created_at >= now() - interval '2 days' and type = 'budget_threshold_crossed'
        and payload->>'day' = ${status.day} and payload->>'kind' = ${kind}
      limit 1`);
    if (seen.rows.length > 0) return;
    const at = new Date();
    await tx.insert(schema.domainEvents).values({
      id: newId(EventIdSchema),
      creatorId: null,
      type: 'budget_threshold_crossed',
      payload,
      actor: 'system',
      correlationId: `budget:${status.day}:${kind}`,
      createdAt: at,
    });
  });
}
