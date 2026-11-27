import { MemberDepartureIdSchema, newId, type TeamMemberId, type UserId } from '@impera/contracts';
import { removePasskeys, revokeSignIns, schema, sql, type Transaction } from '@impera/db';

import type { Actor } from '../domain/ports';

const { teamMemberDepartures, teamMembers, user } = schema;

/**
 * What leaving does, in the caller's transaction (EQ-01, ADR 0166 § 2): the status `left` with the agency's day, the
 * account's creators emptied in the base, and nothing of the account still signed in: its sessions, its trusted
 * devices (ADR 0046 § 3) and its passkeys (ADR 0053 § 5). His shifts to come stay on the planning, read « À pourvoir »,
 * and his templates make no more (`makeTemplateShiftsUnscoped` reads his status).
 */
export async function leaveTeam(
  tx: Transaction,
  memberId: TeamMemberId,
  userId: UserId,
  today: string,
): Promise<{ readonly sessionsEnded: number; readonly passkeysRemoved: number }> {
  await tx
    .update(teamMembers)
    .set({ status: 'left', leftOn: today, updatedAt: sql`now()` })
    .where(sql`${teamMembers.id} = ${memberId}`);
  await tx
    .update(user)
    .set({ creatorIds: [], updatedAt: sql`now()` })
    .where(sql`${user.id} = ${userId}`);
  const sessionsEnded = (await revokeSignIns(tx, userId)).sessions;
  const passkeysRemoved = await removePasskeys(tx, userId);
  return { sessionsEnded, passkeysRemoved };
}

/** « Parti » set through the status: a departure ending now, applied in the same transaction. */
export async function recordImmediateDeparture(
  tx: Transaction,
  actor: Actor,
  memberId: TeamMemberId,
): Promise<void> {
  await tx.insert(teamMemberDepartures).values({
    id: newId(MemberDepartureIdSchema),
    memberId,
    endsAt: sql`now()`,
    createdBy: actor.userId,
    appliedAt: sql`now()`,
  });
}
