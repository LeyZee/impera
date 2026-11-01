import {
  BillingRegimeSchema,
  calendarDayAt,
  ContractorRegimeSchema,
  type BillingRegime,
  type ContractorRegime,
  type CreateBillingRegimeBody,
  type RegimeVat,
} from '@nirvana/contracts';
import { eq, schema, sql, withMember, type Database, type Transaction } from '@nirvana/db';

import { assertRegimeChange } from '../domain/billing';
import {
  BillingRegimeIdConflict,
  BillingRegimeNotFound,
  BillingRegimeValidated,
  BillingRegimeValidationAhead,
  ContractorRegimeIdConflict,
  PayrollForbidden,
  TeamMemberNotFound,
} from '../domain/errors';
import type { PayrollRegimeStore } from '../domain/ports';
import { assertRegimeOfCountry, dayStartsAt, sameRegime } from '../domain/regimes';

import { enqueueInvoiceRequeue, enqueueInvoiceRequeueOn } from './invoice-queue';
import type { PayInputReads } from './snapshot';
import { audit } from './writes';

const { billingRegimes, billingRegimeValidations, contractorRegimes, teamMembers } = schema;

type RegimeRow = typeof billingRegimes.$inferSelect;
type AssignmentRow = typeof contractorRegimes.$inferSelect;

/** How VAT goes on an invoice of the regime, from its two columns (the base's CHECK keeps them together). */
export function regimeVatOf(row: Pick<RegimeRow, 'vatTreatment' | 'vatRateBps'>): unknown {
  return row.vatTreatment === 'exempt'
    ? { treatment: 'exempt' }
    : { treatment: row.vatTreatment, rateBps: row.vatRateBps };
}

const regimeOf = (row: RegimeRow, validatedOn: string | null): BillingRegime =>
  BillingRegimeSchema.parse({
    id: row.id,
    name: row.name,
    countries: row.countries,
    vat: regimeVatOf(row),
    withholding: row.withholding,
    mentions: row.mentions,
    documents: row.documents,
    taxIdRequired: row.taxIdRequired,
    validatedOn,
    createdAt: row.createdAt.toISOString(),
  });

/** What a regime sent again is compared on: the body it was written from. */
const bodyOf = (regime: BillingRegime): CreateBillingRegimeBody => ({
  id: regime.id,
  name: regime.name,
  countries: regime.countries,
  vat: regime.vat,
  withholding: regime.withholding,
  mentions: regime.mentions,
  documents: regime.documents,
  taxIdRequired: regime.taxIdRequired,
});

const vatColumns = (vat: RegimeVat): { vatTreatment: RegimeVat['treatment']; vatRateBps: number | null } =>
  vat.treatment === 'exempt'
    ? { vatTreatment: vat.treatment, vatRateBps: null }
    : { vatTreatment: vat.treatment, vatRateBps: vat.rateBps };

export const assignmentOf = (row: AssignmentRow): ContractorRegime =>
  ContractorRegimeSchema.parse({
    id: row.id,
    memberId: row.memberId,
    regimeId: row.regimeId,
    from: row.effectiveFrom,
    createdAt: row.createdAt.toISOString(),
  });

/** One write at a time on what it reads: a regime's id, its validation, a contractor's regimes. */
async function lock(tx: Transaction, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** The regimes are the owner's to write; the policies `owner_insert` say it again. */
function assertOwner(scope: string): void {
  if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
}

async function regimeById(tx: Transaction, regimeId: string): Promise<BillingRegime | null> {
  const [row] = await tx
    .select({ regime: billingRegimes, validatedOn: billingRegimeValidations.validatedOn })
    .from(billingRegimes)
    .leftJoin(billingRegimeValidations, eq(billingRegimeValidations.regimeId, billingRegimes.id))
    .where(eq(billingRegimes.id, regimeId));
  return row === undefined ? null : regimeOf(row.regime, row.validatedOn);
}

/**
 * The billing regimes (EQ-06 lot 5b): see `PayrollRegimeStore`. Today is the agency's calendar day (`calendarDayAt`),
 * never the client's: a validation is never ahead of it, a regime starts from it at the earliest.
 */
export function createDrizzlePayrollRegimeStore(
  db: Database,
  reads: Pick<PayInputReads, 'agencyTimeZone'>,
  now: () => Date,
): PayrollRegimeStore {
  return {
    regimes: (userId) =>
      withMember(db, userId, async (tx) => {
        const rows = await tx
          .select({ regime: billingRegimes, validatedOn: billingRegimeValidations.validatedOn })
          .from(billingRegimes)
          .leftJoin(billingRegimeValidations, eq(billingRegimeValidations.regimeId, billingRegimes.id))
          .orderBy(sql`${billingRegimes.createdAt} desc`, sql`${billingRegimes.id} desc`);
        return { regimes: rows.map((row) => regimeOf(row.regime, row.validatedOn)) };
      }),

    addRegime: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwner(scope);
        await lock(tx, `billing_regime:${body.id}`);
        const existing = await regimeById(tx, body.id);
        if (existing !== null) {
          if (!sameRegime(bodyOf(existing), body)) throw new BillingRegimeIdConflict();
          return { regime: existing, created: false };
        }
        const [row] = await tx
          .insert(billingRegimes)
          .values({
            id: body.id,
            name: body.name,
            countries: [...body.countries],
            ...vatColumns(body.vat),
            withholding: body.withholding,
            mentions: [...body.mentions],
            documents: [...body.documents],
            taxIdRequired: body.taxIdRequired,
            createdBy: actor.userId,
          })
          .returning();
        if (row === undefined) throw new Error('billing_regimes: insert returned no row');
        // Its text is not personal data: its shape is kept, its mentions stay in the row.
        await audit(
          tx,
          actor,
          'billing_regime.create',
          { kind: 'billing_regime', id: body.id },
          {
            countries: body.countries,
            vatTreatment: body.vat.treatment,
            withholding: body.withholding,
            documents: body.documents,
            mentions: body.mentions.length,
          },
        );
        // Neither validated nor assigned yet: no invoice waits for it.
        return { regime: regimeOf(row, null), created: true };
      }),

    validateRegime: (actor, regimeId, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwner(scope);
        await lock(tx, `billing_regime_validation:${regimeId}`);
        const regime = await regimeById(tx, regimeId);
        if (regime === null) throw new BillingRegimeNotFound();
        if (regime.validatedOn !== null) {
          if (regime.validatedOn !== body.validatedOn) throw new BillingRegimeValidated(regime.validatedOn);
          return { regime, created: false };
        }
        const today = calendarDayAt(now(), await reads.agencyTimeZone(tx));
        if (body.validatedOn > today) throw new BillingRegimeValidationAhead(body.validatedOn);
        await tx
          .insert(billingRegimeValidations)
          .values({ regimeId, validatedOn: body.validatedOn, recordedBy: actor.userId });
        await audit(
          tx,
          actor,
          'billing_regime.validate',
          { kind: 'billing_regime', id: regimeId },
          { validatedOn: body.validatedOn },
        );
        // Every contractor of the regime may have a statement that waited for it.
        await enqueueInvoiceRequeue(tx, null);
        return { regime: { ...regime, validatedOn: body.validatedOn }, created: true };
      }),

    assignRegime: (actor, memberId, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwner(scope);
        const [member] = await tx
          .select({ country: teamMembers.country })
          .from(teamMembers)
          .where(eq(teamMembers.id, memberId));
        if (member === undefined) throw new TeamMemberNotFound();
        // The key of the base's trigger: the check below and its own read the same rows.
        await lock(tx, `contractor_regimes:${memberId}`);
        const rows = await tx
          .select()
          .from(contractorRegimes)
          .where(eq(contractorRegimes.memberId, memberId));
        const sent = rows.find((row) => row.id === body.id);
        if (sent !== undefined) {
          if (sent.regimeId !== body.regimeId || sent.effectiveFrom !== body.from) {
            throw new ContractorRegimeIdConflict();
          }
          return { assignment: assignmentOf(sent), created: false };
        }
        // The id of another contractor's regime.
        const [elsewhere] = await tx
          .select({ id: contractorRegimes.id })
          .from(contractorRegimes)
          .where(eq(contractorRegimes.id, body.id));
        if (elsewhere !== undefined) throw new ContractorRegimeIdConflict();
        const regime = await regimeById(tx, body.regimeId);
        if (regime === null) throw new BillingRegimeNotFound();
        assertRegimeOfCountry(regime.countries, member.country);
        const timeZone = await reads.agencyTimeZone(tx);
        const today = calendarDayAt(now(), timeZone);
        assertRegimeChange(
          rows.map((row) => ({ regimeId: row.regimeId, from: row.effectiveFrom })),
          { regimeId: body.regimeId, from: body.from },
          today,
        );
        const [row] = await tx
          .insert(contractorRegimes)
          .values({
            id: body.id,
            memberId,
            regimeId: body.regimeId,
            effectiveFrom: body.from,
            createdBy: actor.userId,
          })
          .returning();
        if (row === undefined) throw new Error('contractor_regimes: insert returned no row');
        await audit(
          tx,
          actor,
          'contractor_regime.assign',
          { kind: 'contractor_regime', id: body.id },
          { memberId, regimeId: body.regimeId, from: body.from },
        );
        // In force today: his waiting statements are tried at once; from a day to come, on that day.
        if (body.from === today) await enqueueInvoiceRequeue(tx, memberId);
        else await enqueueInvoiceRequeueOn(tx, memberId, body.from, dayStartsAt(body.from, timeZone));
        return { assignment: assignmentOf(row), created: true };
      }),
  };
}
