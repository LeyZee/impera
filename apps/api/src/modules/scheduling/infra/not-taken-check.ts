import { EVENT_PAYLOADS, EventIdSchema, newId } from '@impera/contracts';
import { eq, schema, sql, withAdmin, type Database } from '@impera/db';

import { NOT_TAKEN_LOOKBACK_MS, notTakenShifts } from '../domain/not-taken';
import { DEFAULT_SCHEDULING_SETTINGS } from '../domain/shifts';

import { plannedMembersOf, shiftColumns, toShift } from './rows';

/**
 * « Chatteur pas là » (ADR 0094 § 1, lot b), on the admin connection: the shifts of the creators not archived whose
 * member has not taken them the agency's delay after their start (`notTakenShifts`). One `shift_not_taken` per shift
 * (index `domain_events_shift_not_taken_unique`), so a run again publishes nothing new. Nothing while the agency has set
 * no delay. It writes nothing but the outbox: no shift, no pay, no mode (§ 4). The alert router (ADR 0150) and Telegram
 * tell the owner and the managers; never a chatter (§ 3).
 */
export function createDrizzleNotTakenCheck(adminDb: Database): {
  run(now: Date, correlationId: string): Promise<number>;
} {
  return {
    run: (now, correlationId) =>
      withAdmin(adminDb, async (tx) => {
        const [settings] = await tx
          .select({
            delay: schema.schedulingSettings.notTakenDelayMinutes,
            timeZone: schema.schedulingSettings.timeZone,
          })
          .from(schema.schedulingSettings);
        const delay = settings?.delay ?? null;
        if (delay === null) return 0;
        const timeZone = settings?.timeZone ?? DEFAULT_SCHEDULING_SETTINGS.timeZone;
        // Begun between the lookback and the delay ago, not over, never taken: the rest is the pure rule's.
        const earliest = new Date(now.getTime() - delay * 60_000 - NOT_TAKEN_LOOKBACK_MS);
        const latest = new Date(now.getTime() - delay * 60_000);
        const candidates = (
          await tx
            .select(shiftColumns)
            .from(schema.shifts)
            .innerJoin(schema.creators, eq(schema.creators.id, schema.shifts.creatorId))
            .where(
              sql`${schema.shifts.cancelledAt} is null
                and ${schema.shifts.checkedInAt} is null
                and ${schema.shifts.stoppedAt} is null
                and ${schema.creators.archivedAt} is null
                and ${schema.shifts.startsAt} > ${earliest}
                and ${schema.shifts.startsAt} <= ${latest}
                and ${schema.shifts.endsAt} > ${now}`,
            )
        ).map(toShift);
        if (candidates.length === 0) return 0;
        const members = await plannedMembersOf(tx, [...new Set(candidates.map((shift) => shift.memberId))]);
        const memberOf = new Map(members.map((member) => [member.id, member]));
        const due = notTakenShifts({ shifts: candidates, members: memberOf, delayMinutes: delay, now });
        if (due.length === 0) return 0;
        const accounts = new Map(
          (
            await tx
              .select({ id: schema.platformAccounts.id, platform: schema.platformAccounts.platform })
              .from(schema.platformAccounts)
          ).map((account) => [account.id, account.platform]),
        );
        let published = 0;
        for (const shift of due) {
          const platform = accounts.get(shift.platformAccountId);
          const member = memberOf.get(shift.memberId);
          if (platform === undefined || member === undefined) continue;
          const rows = await tx
            .insert(schema.domainEvents)
            .values({
              id: newId(EventIdSchema),
              creatorId: shift.creatorId,
              type: 'shift_not_taken',
              payload: EVENT_PAYLOADS.shift_not_taken.parse({
                creatorId: shift.creatorId,
                platform,
                platformAccountId: shift.platformAccountId,
                shiftId: shift.id,
                memberId: shift.memberId,
                memberName: member.displayName,
                startsAt: shift.startsAt.toISOString(),
                endsAt: shift.endsAt.toISOString(),
                timeZone,
              }),
              actor: 'system',
              correlationId,
            })
            .onConflictDoNothing()
            .returning({ id: schema.domainEvents.id });
          published += rows.length;
        }
        return published;
      }),
  };
}
