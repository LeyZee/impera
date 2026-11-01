import {
  BonusTierSchema,
  CommissionStatementIdSchema,
  newId,
  nextPayPeriod,
  payPeriodAt,
  previousPayPeriod,
  type PayPeriod,
} from '@nirvana/contracts';
import {
  and,
  eq,
  lockPayrollClose,
  schema,
  sql,
  withAdmin,
  type Database,
  type Transaction,
} from '@nirvana/db';
import { z } from 'zod';

import type { OpenPeriodFacts, PayrollJobStore } from '../domain/ports';
import type { CollectiveReached, StatementContent, StatementDraft } from '../domain/recalculation';

import { recordBlock } from './period-blocks';
import { closingsSpan, readSnapshot, registeredAmong, type PayInputReads } from './snapshot';

const { commissionStatementLines, commissionStatements } = schema;

/**
 * Pay's period `period` as it is first needed: from the end of the period before when it is written, else midnight in
 * the agency's zone, to the start of the one after when it is written, else the next midnight there. Written once,
 * never moved (`pay_periods` is added only): nothing falls between two periods nor in both.
 */
async function writeWindow(tx: Transaction, period: PayPeriod, timeZone: string): Promise<void> {
  const before = previousPayPeriod(period);
  const after = nextPayPeriod(period);
  await tx.execute(sql`
    insert into pay_periods (period, starts_at, ends_at, time_zone)
    select ${period}::date,
      coalesce((select ends_at from pay_periods where period = ${before}::date),
        ${period}::date::timestamp at time zone ${timeZone}),
      coalesce((select starts_at from pay_periods where period = ${after}::date),
        ${after}::date::timestamp at time zone ${timeZone}),
      ${timeZone}
    on conflict (period) do nothing`);
}

/** A statement's columns from its content, as the engine and the recalculation gave it. */
function columnsOf(draft: StatementDraft, computedAt: Date) {
  const { content } = draft;
  return {
    engineVersion: content.engineVersion,
    inputsHash: draft.inputsHash,
    netMinor: content.netMinor,
    commissionMinor: content.commissionMinor,
    teamShareBaseMinor: content.teamShare?.baseNetMinor ?? null,
    teamShareBps: content.teamShare?.bps ?? null,
    teamShareMinor: content.teamShare?.amountMinor ?? null,
    tierBonus: content.tierBonus === null ? null : BonusTierSchema.parse(content.tierBonus),
    collectiveBonusMinor: content.collectiveBonusMinor,
    bonusesMinor: content.bonusesMinor,
    penaltiesRequestedMinor: content.penaltiesRequestedMinor,
    penaltiesMinor: content.penaltiesMinor,
    carryOversInMinor: content.carryOversInMinor,
    adjustmentsMinor: content.adjustmentsMinor,
    totalMinor: content.totalMinor,
    carryOverOutMinor: content.carryOverOutMinor,
    payableMinor: content.payableMinor,
    teamNetMinor: content.teamNetMinor,
    collective: content.collective satisfies CollectiveReached,
    rules: content.rules,
    counted: content.counted,
    computedAt,
  };
}

async function writeLines(
  tx: Transaction,
  statementId: string,
  revision: number,
  content: StatementContent,
): Promise<void> {
  if (content.lines.length === 0) return;
  await tx.insert(commissionStatementLines).values(
    content.lines.map((line) => ({
      id: newId(z.uuid()),
      statementId,
      revision,
      platformAccountId: line.platformAccountId,
      currency: line.currency,
      vatBps: line.vatBps,
      platformFeeBps: line.platformFeeBps,
      rateMicros: line.rateMicros,
      grossMinor: line.grossMinor,
      grossEurMinor: line.grossEurMinor,
      exclVatMinor: line.exclVatMinor,
      netMinor: line.netMinor,
      commissionMinor: line.commissionMinor,
      shiftReportIds: [...line.shiftReportIds],
      lateReports: line.lateReports,
    })),
  );
}

/**
 * The jobs' store (EQ-04, ADR 0032), on the admin connection: pay's job reads every creator's reports, a read bounded
 * to it (ADR 0023 § Paie). Each recalculation holds `payroll.close`, so that a validation never sees half a period,
 * and records in the same transaction whether the period is blocked (`recordBlock`).
 */
export function createDrizzlePayrollJobStore(
  adminDb: Database,
  reads: PayInputReads,
  now: () => Date,
): PayrollJobStore {
  return {
    recomputeUnscoped: (period, decide) =>
      withAdmin(adminDb, async (tx) => {
        await lockPayrollClose(tx);
        await writeWindow(tx, period, await reads.agencyTimeZone(tx));
        const snapshot = await readSnapshot(
          tx,
          reads,
          period,
          await reads.validatedReportsUnscoped(tx, period),
        );
        const decision = decide(snapshot);
        const computedAt = now();
        await recordBlock(tx, period, decision, computedAt);
        if (decision.kind === 'write') {
          for (const draft of decision.inserts) {
            const id = newId(CommissionStatementIdSchema);
            await tx.insert(commissionStatements).values({
              id,
              memberId: draft.content.memberId,
              period,
              status: 'draft',
              revision: 1,
              ...columnsOf(draft, computedAt),
            });
            await writeLines(tx, id, 1, draft.content);
          }
          for (const draft of decision.updates) {
            const written = await tx
              .update(commissionStatements)
              .set({ revision: draft.revision, ...columnsOf(draft, computedAt) })
              .where(
                and(
                  eq(commissionStatements.id, draft.statementId),
                  eq(commissionStatements.status, 'draft'),
                  eq(commissionStatements.revision, draft.revision - 1),
                ),
              )
              .returning({ id: commissionStatements.id });
            if (written.length !== 1)
              throw new Error(`Statement ${draft.statementId} changed under the lock`);
            await writeLines(tx, draft.statementId, draft.revision, draft.content);
          }
        }
        return { decision, closed: snapshot.closing !== null, lastClosed: snapshot.lastClosed };
      }),

    openPeriodFactsUnscoped: (at) =>
      withAdmin(adminDb, async (tx): Promise<OpenPeriodFacts> => {
        const current = payPeriodAt(at, await reads.agencyTimeZone(tx));
        const { last } = await closingsSpan(tx);
        const reports = await reads.validatedReportsUnscoped(tx, current);
        const registered = await registeredAmong(
          tx,
          reports.map((report) => report.id),
        );
        const waiting = reports
          .filter((report) => !registered.has(report.id))
          .map((report) => report.period)
          .sort();
        return { current, lastClosed: last, earliestUncounted: waiting[0] ?? null };
      }),
  };
}
