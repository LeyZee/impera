import {
  CurrencySchema,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type Currency,
  type PayPeriod,
  type PlatformAccountId,
  type TeamMemberId,
  type UserId,
} from '@impera/contracts';
import {
  enterCreator,
  eq,
  schema,
  SNAPSHOT_READ,
  sql,
  withMember,
  type Database,
  type Transaction,
} from '@impera/db';
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

/**
 * A shift whose reports the agency validated, as the game counts it (ADR 0118 § 1 and § 2): when it was held, the
 * account, the period and the currency it was declared in, the total validated (the report and its corrections), and what pay takes
 * off a gross on that account for that period. Never a comment, an incident nor who reviewed it.
 */
export interface ValidatedShiftForGame {
  readonly platformAccountId: PlatformAccountId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly period: PayPeriod;
  readonly currency: Currency;
  readonly grossMinor: number;
  readonly vatBps: number;
  readonly platformFeeBps: number;
}

const ValidatedRowSchema = z.object({
  platform_account_id: PlatformAccountIdSchema,
  starts_at: instant,
  ends_at: instant,
  period: PayPeriodSchema,
  currency: CurrencySchema,
  gross_minor: z.coerce.number().int(),
  vat_bps: z.number().int(),
  platform_fee_bps: z.number().int(),
});

/**
 * The member's shifts with a validated total, the oldest first, among the rows the transaction reads. A report counts
 * once validated, never before (§ 2); one sent back or still waiting is not read, so a refusal takes its amount away
 * (§ 4). A report without rules for its period was never validated: it is left out. So is one of a period whose pay
 * reads the account's sales: the sales are that shift's one source (§ 3), and the report has no effect on pay either
 * (ADR 0084 § 3).
 */
async function validatedShiftsOf(tx: Transaction, memberId: TeamMemberId): Promise<ValidatedShiftForGame[]> {
  const result = await tx.execute(sql`
    select r.platform_account_id, s.starts_at, s.ends_at, r.period::text as period, r.currency, sum(r.amount_minor) as gross_minor,
      rules.vat_bps, rules.platform_fee_bps
    from shift_reports r
    join shifts s on s.id = r.shift_id
    join lateral (
      select a.vat_bps, a.platform_fee_bps, a.earnings_source from account_pay_rules a
      where a.platform_account_id = r.platform_account_id and a.from_period <= r.period
      order by a.from_period desc limit 1
    ) rules on true
    where r.member_id = ${memberId} and r.status = 'validated' and rules.earnings_source = 'declared'
    group by s.id, r.platform_account_id, s.starts_at, s.ends_at, r.period, r.currency, rules.vat_bps, rules.platform_fee_bps
    order by s.starts_at, s.id`);
  return result.rows.map((raw) => {
    const row = ValidatedRowSchema.parse(raw);
    return {
      platformAccountId: row.platform_account_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      period: row.period,
      currency: row.currency,
      grossMinor: row.gross_minor,
      vatBps: row.vat_bps,
      platformFeeBps: row.platform_fee_bps,
    };
  });
}

/** Every creator's: the game's job runs on the admin connection, a read bounded to that job. */
export function validatedShiftsForGameUnscoped(
  tx: Transaction,
  memberId: TeamMemberId,
): Promise<ValidatedShiftForGame[]> {
  return validatedShiftsOf(tx, memberId);
}

/**
 * The account's own, read as itself, creator by creator under the policies of its reports: never a colleague's, and
 * nothing for an account that is no member.
 */
export function ownValidatedShiftsForGame(
  db: Database,
  userId: UserId,
  creatorIds: readonly string[],
): Promise<ValidatedShiftForGame[]> {
  return withMember(
    db,
    userId,
    async (tx) => {
      const [member] = await tx
        .select({ id: schema.teamMembers.id })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.userId, userId));
      if (member === undefined) return [];
      const memberId = TeamMemberIdSchema.parse(member.id);
      const read: ValidatedShiftForGame[] = [];
      for (const creatorId of creatorIds) {
        await enterCreator(tx, creatorId, creatorIds);
        read.push(...(await validatedShiftsOf(tx, memberId)));
      }
      return read.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    },
    SNAPSHOT_READ,
  );
}
