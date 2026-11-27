import {
  MySaleClaimsSchema,
  PendingSaleClaimsSchema,
  SALE_CLAIM_WINDOW_DAYS,
  SALE_CLAIMS_WAITING_MAX,
  SaleClaimSchema,
  SaleClaimShiftSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PayPeriod,
  type Platform,
  type PlatformAccountId,
  type SaleClaim,
  type SaleClaimShift,
  type ShiftId,
  type UserId,
} from '@impera/contracts';
import {
  and,
  enterCreator,
  eq,
  inArray,
  lockPayrollClose,
  onCreatorList,
  schema,
  sql,
  withMember,
  type Database,
  type Transaction,
} from '@impera/db';

import { PayrollForbidden } from '../../contractors/pure';
import {
  PayPeriodClosed,
  SaleClaimAnswered,
  SaleClaimConflict,
  SaleClaimNotFound,
  SaleClaimShiftConflict,
  SaleClaimsTooMany,
} from '../domain/errors';
import type { PayrollSaleClaimStore } from '../domain/ports';

import { ownMemberOf } from './sale-decision-store';
import type { PayInputReads } from './snapshot';
import { audit } from './writes';

const { payPeriodClosings, paySaleClaimAnswers, paySaleClaims, teamMembers } = schema;

/** One of a member's ended shifts, as the planning gives it: its account, its hours and the pay period it starts in. */
interface EndedShift {
  readonly shiftId: ShiftId;
  readonly creatorId: CreatorId;
  readonly creatorName: string;
  readonly platformAccountId: PlatformAccountId;
  readonly platform: Platform;
  readonly handle: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly period: PayPeriod;
}

/**
 * The `scheduling` module's `pay.endedShifts`, plugged by the composition root: the actor's own shifts not cancelled,
 * begun since `since` and ended by now, the newest first, in a transaction of its own.
 */
export type EndedShiftsRead = (actor: UserId, since: Date) => Promise<readonly EndedShift[]>;

type ClaimRow = typeof paySaleClaims.$inferSelect;
type AnswerRow = typeof paySaleClaimAnswers.$inferSelect;

const shiftOfRow = (row: ClaimRow): SaleClaimShift =>
  SaleClaimShiftSchema.parse({
    shiftId: row.shiftId,
    creatorName: row.creatorName,
    platformAccountId: row.platformAccountId,
    platform: row.platform,
    handle: row.handle,
    startsAt: row.shiftStartsAt.toISOString(),
    endsAt: row.shiftEndsAt.toISOString(),
  });

const claimOf = (row: ClaimRow, answer: AnswerRow | undefined): SaleClaim =>
  SaleClaimSchema.parse({
    id: row.id,
    memberId: row.memberId,
    period: row.period,
    shift: shiftOfRow(row),
    note: row.note,
    state: answer?.outcome ?? 'waiting',
    answerNote: answer?.note ?? null,
    createdAt: row.createdAt.toISOString(),
    answeredAt: answer?.createdAt.toISOString() ?? null,
  });

async function answersOf(tx: Transaction, ids: readonly string[]): Promise<Map<string, AnswerRow>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.select().from(paySaleClaimAnswers).where(inArray(paySaleClaimAnswers.claimId, ids));
  return new Map(rows.map((row) => [row.claimId, row]));
}

async function closedAmong(tx: Transaction, periods: readonly PayPeriod[]): Promise<Set<string>> {
  if (periods.length === 0) return new Set();
  const rows = await tx
    .select({ period: payPeriodClosings.period })
    .from(payPeriodClosings)
    .where(inArray(payPeriodClosings.period, [...new Set(periods)]));
  return new Set(rows.map((row) => row.period));
}

const shiftOfEnded = (shift: EndedShift): SaleClaimShift => ({
  shiftId: shift.shiftId,
  creatorName: shift.creatorName,
  platformAccountId: shift.platformAccountId,
  platform: shift.platform,
  handle: shift.handle,
  startsAt: shift.startsAt.toISOString(),
  endsAt: shift.endsAt.toISOString(),
});

/**
 * « J'ai été décisif sur une vente » (ADR 0101 §§ 18 to 22), as the reader (`withMember`). The policies keep a claim
 * to its member and an answer to its member (a withdrawal) or to the owner and an active manager who is not its member;
 * the composite key keeps a claim on its member's own shift; the triggers keep both added only. The store reads his
 * shifts through the planning (`endedShifts`), in a transaction of its own, before it writes: the base still refuses
 * a shift that is not his. A claim reads no sale and changes no amount.
 */
export function createDrizzleSaleClaimStore(
  db: Database,
  reads: Pick<PayInputReads, 'creatorIds'>,
  endedShifts: EndedShiftsRead,
  now: () => Date,
): PayrollSaleClaimStore {
  const since = (): Date => new Date(now().getTime() - SALE_CLAIM_WINDOW_DAYS * 86_400_000);

  /**
   * Runs `fn` in each creator the reader may read claims in (Sécurité, #1026): the policies hold a claim to its
   * creator; the owner and a member read in every one, an active manager only in those of his own list, as the
   * shift feedbacks. The claims and their answers read in one creator are those of that creator alone.
   */
  async function eachCreator<T>(
    tx: Transaction,
    userId: string,
    scope: string,
    fn: (creatorId: string) => Promise<T>,
  ): Promise<T[]> {
    const creatorIds = await reads.creatorIds();
    const found: T[] = [];
    for (const creatorId of creatorIds) {
      if (scope === 'agency' && !(await onCreatorList(tx, userId, creatorId))) continue;
      await enterCreator(tx, creatorId, creatorIds);
      found.push(await fn(creatorId));
    }
    return found;
  }

  return {
    mine: async (userId) => {
      const ended = await endedShifts(userId, since());
      return withMember(db, userId, async (tx) => {
        const member = await ownMemberOf(tx, userId);
        if (member === null) return MySaleClaimsSchema.parse({ claims: [], shifts: [] });
        // His own in every creator, whatever his scope: a manager's own claims are not bounded by his list.
        const found = await eachCreator(tx, userId, 'self', async () => {
          const rows = await tx
            .select()
            .from(paySaleClaims)
            .where(eq(paySaleClaims.memberId, member))
            .orderBy(sql`${paySaleClaims.createdAt} desc`)
            .limit(50);
          const answers = await answersOf(
            tx,
            rows.map((row) => row.id),
          );
          return rows.map((row) => ({ row, answer: answers.get(row.id) }));
        });
        const claims = found
          .flat()
          .toSorted((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime())
          .slice(0, 50);
        // Every claim of his, answered or not, whatever creator: a shift is claimed once (`pay_sale_claims_shift_unique`).
        const claimed = new Set(claims.map(({ row }) => row.shiftId));
        const closed = await closedAmong(
          tx,
          ended.map((shift) => shift.period),
        );
        return MySaleClaimsSchema.parse({
          claims: claims.map(({ row, answer }) => claimOf(row, answer)),
          shifts: ended
            .filter((shift) => !claimed.has(shift.shiftId) && !closed.has(shift.period))
            .map(shiftOfEnded),
        });
      });
    },

    pending: (userId) =>
      withMember(db, userId, async (tx, scope) => {
        if (scope === 'self') throw new PayrollForbidden();
        const found = await eachCreator(tx, userId, scope, () =>
          tx
            .select({ claim: paySaleClaims, memberName: teamMembers.displayName })
            .from(paySaleClaims)
            .innerJoin(teamMembers, eq(teamMembers.id, paySaleClaims.memberId))
            .where(
              sql`not exists (select 1 from pay_sale_claim_answers a where a.claim_id = ${paySaleClaims.id})`,
            ),
        );
        return PendingSaleClaimsSchema.parse({
          claims: found
            .flat()
            .toSorted((a, b) => a.claim.createdAt.getTime() - b.claim.createdAt.getTime())
            .map((row) => ({ ...claimOf(row.claim, undefined), memberName: row.memberName })),
        });
      }),

    create: async (actor, body) => {
      const ended = await endedShifts(actor.userId, since());
      return withMember(db, actor.userId, async (tx) => {
        // A closing and a claim never cross: the period read open here stays open until the claim is written.
        await lockPayrollClose(tx);
        const shift = ended.find((one) => one.shiftId === body.shiftId);
        if (shift === undefined) throw new SaleClaimShiftConflict();
        const creatorIds = await reads.creatorIds();
        // The claim lives in its shift's creator: read and written there.
        await enterCreator(tx, shift.creatorId, creatorIds);
        const [sent] = await tx.select().from(paySaleClaims).where(eq(paySaleClaims.id, body.id));
        if (sent !== undefined) {
          if (sent.shiftId !== body.shiftId || sent.note !== body.note) throw new SaleClaimConflict();
          const answers = await answersOf(tx, [sent.id]);
          return { value: claimOf(sent, answers.get(sent.id)), created: false };
        }
        const member = await ownMemberOf(tx, actor.userId);
        if (member === null) throw new SaleClaimShiftConflict();
        if ((await closedAmong(tx, [shift.period])).size > 0) throw new PayPeriodClosed(shift.period);
        // One member's claims one at a time: the count read here is the one the insert sees.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pay_sale_claims'), hashtext(${member}))`);
        const [taken] = await tx
          .select({ id: paySaleClaims.id })
          .from(paySaleClaims)
          .where(eq(paySaleClaims.shiftId, shift.shiftId));
        if (taken !== undefined) throw new SaleClaimShiftConflict();
        // His waiting claims in every creator: three at most in all (ADR 0101 § 18).
        let waiting = 0;
        for (const creatorId of creatorIds) {
          await enterCreator(tx, creatorId, creatorIds);
          const [count] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(paySaleClaims)
            .where(
              sql`${paySaleClaims.memberId} = ${member} and not exists (select 1 from pay_sale_claim_answers a where a.claim_id = ${paySaleClaims.id})`,
            );
          waiting += count?.count ?? 0;
          // The same key sent for a shift of another creator: one id, one claim.
          const [elsewhere] = await tx
            .select({ id: paySaleClaims.id })
            .from(paySaleClaims)
            .where(eq(paySaleClaims.id, body.id));
          if (elsewhere !== undefined) throw new SaleClaimConflict();
        }
        if (waiting >= SALE_CLAIMS_WAITING_MAX) throw new SaleClaimsTooMany(SALE_CLAIMS_WAITING_MAX);
        await enterCreator(tx, shift.creatorId, creatorIds);
        const [row] = await tx
          .insert(paySaleClaims)
          .values({
            id: body.id,
            memberId: member,
            creatorId: shift.creatorId,
            shiftId: shift.shiftId,
            platformAccountId: shift.platformAccountId,
            period: shift.period,
            shiftStartsAt: shift.startsAt,
            shiftEndsAt: shift.endsAt,
            platform: shift.platform,
            handle: shift.handle,
            creatorName: shift.creatorName,
            note: body.note,
            createdBy: actor.userId,
          })
          .returning();
        if (row === undefined) throw new Error('A claim was not written');
        // Its note stays out of the journal: the fan it names is the agency's to read on the claim, nowhere else.
        await audit(
          tx,
          actor,
          'sale_claim.create',
          { kind: 'sale_claim', id: row.id },
          { period: shift.period },
        );
        return { value: claimOf(row, undefined), created: true };
      });
    },

    answer: (actor, claimId, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        const own = await ownMemberOf(tx, actor.userId);
        // The claim where the reader may read it: in his creators for a manager, his own anywhere.
        let row: ClaimRow | undefined;
        const creatorIds = await reads.creatorIds();
        for (const creatorId of creatorIds) {
          const listed = scope !== 'agency' || (await onCreatorList(tx, actor.userId, creatorId));
          await enterCreator(tx, creatorId, creatorIds);
          const [found] = await tx
            .select()
            .from(paySaleClaims)
            .where(
              and(
                eq(paySaleClaims.id, claimId),
                listed || own === null ? undefined : eq(paySaleClaims.memberId, own),
              ),
            );
          if (found !== undefined) {
            row = found;
            break;
          }
        }
        if (row === undefined) throw new SaleClaimNotFound();
        const mine = own !== null && own === TeamMemberIdSchema.parse(row.memberId);
        // His own claim he only withdraws; another's he answers as the owner or an active manager, never withdraws.
        if (body.outcome === 'withdrawn' ? !mine : mine || scope === 'self') throw new SaleClaimAnswered();
        const answers = await answersOf(tx, [row.id]);
        const given = answers.get(row.id);
        if (given !== undefined) {
          if (given.outcome !== body.outcome || given.note !== body.note) throw new SaleClaimAnswered();
          return claimOf(row, given);
        }
        const [answer] = await tx
          .insert(paySaleClaimAnswers)
          .values({ claimId: row.id, outcome: body.outcome, note: body.note, answeredBy: actor.userId })
          .onConflictDoNothing()
          .returning();
        if (answer === undefined) throw new SaleClaimAnswered();
        await audit(
          tx,
          actor,
          'sale_claim.answer',
          { kind: 'sale_claim', id: row.id },
          { period: row.period, outcome: body.outcome, memberId: row.memberId },
        );
        return claimOf(row, answer);
      }),
  };
}
