import type { TeamMemberId } from '@impera/contracts';
import { sql, type Transaction } from '@impera/db';
import { z } from 'zod';

/**
 * What the game reads of the planning (ADR 0104 § 13), in the game's own job: the module owns the shifts and their
 * reports, the game gets this function through the module's `index.ts`, never the tables. Read only.
 */

/** A shift a member held to its end, and when they first handed its report in. */
export interface ShiftForGame {
  readonly endsAt: Date;
  /** The first time the member sent its report; `null` while there is none. A correction by the agency is not one. */
  readonly reportedAt: Date | null;
}

const instant = z.union([z.date(), z.string()]).transform((value) => new Date(value));
const RowSchema = z.object({ ends_at: instant, reported_at: instant.nullable() });

/**
 * A member's shifts ended at `now`, the oldest first, on every creator: the game's job runs on the admin connection, a
 * read bounded to that job. A cancelled shift is not theirs to hold, and a shift swapped away now belongs to the
 * colleague who took it: neither is read, so neither breaks a streak.
 */
export async function shiftsForGameUnscoped(
  tx: Transaction,
  memberId: TeamMemberId,
  now: Date,
): Promise<ShiftForGame[]> {
  const result = await tx.execute(sql`
    select s.ends_at,
      (select min(r.created_at) from shift_reports r
        where r.shift_id = s.id and r.member_id = s.member_id and not r.by_agency and r.corrects_id is null
      ) as reported_at
    from shifts s
    where s.member_id = ${memberId} and s.cancelled_at is null and s.ends_at <= ${now.toISOString()}::timestamptz
    order by s.ends_at`);
  return result.rows.map((raw) => {
    const row = RowSchema.parse(raw);
    return { endsAt: row.ends_at, reportedAt: row.reported_at };
  });
}

/** A shift a member began, as the shift's challenge reads it (ADR 0104 § 14). */
export interface ShiftForChallenge {
  readonly startsAt: Date;
  /** When it ended or will: the minute it was stopped at when a person stopped it under way. */
  readonly endsAt: Date;
}

const CHALLENGE_HISTORY_DAYS = 63;
const ChallengeRowSchema = z.object({ starts_at: instant, ends_at: instant });

/**
 * A member's shifts begun at `now` in the nine weeks before (eight weeks of history before the shift shown), the
 * oldest first, on every creator, cancelled ones left out. Read only; the caller's connection decides whose shifts
 * can be read (the member's own under row-level security).
 */
export async function shiftsForChallenge(
  tx: Transaction,
  memberId: TeamMemberId,
  now: Date,
): Promise<ShiftForChallenge[]> {
  const result = await tx.execute(sql`
    select s.starts_at, s.ends_at
    from shifts s
    where s.member_id = ${memberId} and s.cancelled_at is null
      and s.starts_at <= ${now.toISOString()}::timestamptz
      and s.starts_at >= ${now.toISOString()}::timestamptz - make_interval(days => ${CHALLENGE_HISTORY_DAYS})
    order by s.starts_at`);
  return result.rows.map((raw) => {
    const row = ChallengeRowSchema.parse(raw);
    return { startsAt: row.starts_at, endsAt: row.ends_at };
  });
}
