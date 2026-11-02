import {
  INVOICE_DUE_SOON_DAYS,
  INVOICE_PREFIX_PATTERN,
  PLATFORM_NAMES,
  payPeriodLastDay,
  type InvoiceDueState,
  type InvoiceKind,
  type InvoiceLineKind,
  type PayPeriod,
  type Platform,
  type RegimeVat,
} from '@nirvana/contracts';

import { addDays } from '../../contractors/pure';
import { BPS, mulDivRound } from '../../payroll/pure';

import { CreditNoteExceedsInvoice } from './errors';

/**
 * A contractor's invoice and its credit notes (EQ-06, ADR 0023 § Factures and ADR 0036), the pure rules: its number,
 * its lines from a validated statement, its totals under the regime, its due date, the credit notes a period owes and
 * the invoice each one cites, the lines of a credit note, and the corrective invoices a period owes (ADR 0040). The
 * invoice is frozen at its issue: every text here is computed once and copied, never recomputed for an issued invoice.
 */

/** A line as the invoice prints it: what it is, its detail, its amount excluding VAT (negative for a deduction). */
export interface InvoiceLine {
  readonly kind: InvoiceLineKind;
  readonly label: string;
  readonly detail: string | null;
  readonly amountMinor: number;
}

/** What the invoice reads of the validated statement, with the commission rate of its rules. */
interface StatementForInvoice {
  readonly lines: readonly {
    readonly platformAccountId: string;
    readonly netMinor: number;
    readonly commissionMinor: number;
  }[];
  readonly netMinor: number;
  readonly commissionRateBps: number;
  readonly teamShare: {
    readonly baseNetMinor: number;
    readonly bps: number;
    readonly amountMinor: number;
  } | null;
  readonly tierBonus: { readonly thresholdMinor: number; readonly bonusMinor: number } | null;
  readonly collectiveBonusMinor: number;
  readonly manualBonusesMinor: number;
  readonly penaltiesRequestedMinor: number;
  readonly penaltiesMinor: number;
  readonly carryOversInMinor: number;
  readonly adjustmentsMinor: number;
  readonly totalMinor: number;
}

type PenaltyForInvoice = { readonly reason: string } & (
  | { readonly kind: 'fixed'; readonly amountMinor: number }
  | { readonly kind: 'percent'; readonly bps: number }
);

/** A statement and the entries it counted, each with its reason, penalties in the order they were written. */
export interface InvoiceSource {
  readonly period: PayPeriod;
  readonly statement: StatementForInvoice;
  /** The accounts of the statement's lines: a platform and a handle, never a fan. */
  readonly accounts: ReadonlyMap<string, { readonly handle: string; readonly platform: Platform }>;
  readonly bonuses: readonly { readonly amountMinor: number; readonly reason: string }[];
  readonly penalties: readonly PenaltyForInvoice[];
  readonly adjustments: readonly {
    readonly amountMinor: number;
    readonly reason: string;
    /** The period whose statement the adjustment corrects, when it is known. */
    readonly correctsPeriod: PayPeriod | null;
    /** The document whose upheld contest it corrects (ADR 0039 § 3), or `null`. */
    readonly contestedInvoiceId: string | null;
  }[];
}

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const PERCENT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 });
const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

const euros = (minor: number): string => EUROS.format(minor / 100);
const percent = (bps: number): string => PERCENT.format(bps / BPS);
const quoted = (text: string): string => `«\u00a0${text.trim()}\u00a0»`;
/** « : » as French sets it, after a space that never breaks. */
const COLON = '\u00a0: ';
const sum = (amounts: readonly number[]): number => amounts.reduce((total, one) => total + one, 0);
/** A deduction of `minor`, never `-0`, which a test or a comparison tells from 0. */
const minus = (minor: number): number => 0 - minor;

/** A day as an invoice writes it: « 1er novembre 2026 », « 16 octobre 2026 ». */
export function longDay(day: string): string {
  const date = Number(day.slice(8, 10));
  const month = MONTHS[Number(day.slice(5, 7)) - 1];
  if (month === undefined) throw new RangeError(`Not a calendar day: ${day}`);
  return `${date === 1 ? '1er' : String(date)} ${month} ${day.slice(0, 4)}`;
}

/** A pay period as an invoice writes it: « du 1er au 15 octobre 2026 », « du 16 au 31 octobre 2026 ». */
export function periodWords(period: PayPeriod): string {
  const first = Number(period.slice(8, 10));
  return `du ${first === 1 ? '1er' : String(first)} au ${longDay(payPeriodLastDay(period))}`;
}

/** An adjustment's detail, on an invoice or a credit note: the period it corrects when it is known, and its reason. */
function adjustmentDetail(reason: string, correctsPeriod: PayPeriod | null): string {
  return correctsPeriod === null
    ? quoted(reason)
    : `Période ${periodWords(correctsPeriod)}${COLON}${quoted(reason)}`;
}

/**
 * The invoices a cancel and reissue names among `adjustments` (ADR 0039 § 3): a positive adjustment and a negative one
 * that name the same document. A contest ends once, so its document has one correction: an amount (one adjustment) or
 * this pair, never both.
 */
function reissuedInvoices(adjustments: InvoiceSource['adjustments']): ReadonlySet<string> {
  const credited = new Set<string>();
  const billed = new Set<string>();
  for (const one of adjustments) {
    if (one.contestedInvoiceId === null) continue;
    if (one.amountMinor < 0) credited.add(one.contestedInvoiceId);
    else if (one.amountMinor > 0) billed.add(one.contestedInvoiceId);
  }
  return new Set([...billed].filter((id) => credited.has(id)));
}

/** Whether `adjustment` is the positive half of a cancel and reissue, which a corrective invoice bills (ADR 0040). */
const reissuing = (
  adjustment: InvoiceSource['adjustments'][number],
  reissued: ReadonlySet<string>,
): boolean =>
  adjustment.amountMinor > 0 &&
  adjustment.contestedInvoiceId !== null &&
  reissued.has(adjustment.contestedInvoiceId);

/**
 * Each percent penalty's share of the one rounding the engine made on their sum: the rounded running total less the
 * one before, so that the lines add up to the engine's amount to the cent, each within a cent of its own share.
 */
function penaltyAmounts(penalties: readonly PenaltyForInvoice[], netMinor: number): number[] {
  const base = Math.max(0, netMinor);
  let runningBps = 0;
  let runningMinor = 0;
  return penalties.map((one) => {
    if (one.kind === 'fixed') return one.amountMinor;
    runningBps += one.bps;
    const upTo = mulDivRound(base, runningBps, BPS);
    const amount = upTo - runningMinor;
    runningMinor = upTo;
    return amount;
  });
}

/**
 * The lines of a statement's invoice: a commission per account, the team share, the tier and collective bonuses, each
 * manual bonus, each penalty as a deduction the contract provides for, the cap of penalties when it applied, and each
 * adjustment in the contractor's favour with the period it corrects (ADR 0023: an omission becomes a line of the next
 * invoice). An adjustment in the agency's favour is never a line: it is a credit note on the invoice it corrects
 * (`creditsDue`). Neither is the positive half of a cancel and reissue: it bills again an invoice of another period,
 * on a corrective invoice of its own under that invoice's regime (`reissuesDue`, ADR 0040). A carry-over, positive or negative, is never invoiced again: it stays invoiced in its own period,
 * and only delays the payment. The lines add up to the statement's own amount for the period, less what it owes back
 * and what its corrective invoices bill, or the source is a bug of the caller. When they add up to less than zero, nothing is issued and the period owes the
 * difference (`creditsDue`).
 */
export function invoiceLines(source: InvoiceSource): InvoiceLine[] {
  const { statement } = source;
  if (sum(source.bonuses.map((one) => one.amountMinor)) !== statement.manualBonusesMinor) {
    throw new RangeError('The bonuses are not those the statement counted');
  }
  if (sum(source.adjustments.map((one) => one.amountMinor)) !== statement.adjustmentsMinor) {
    throw new RangeError('The adjustments are not those the statement counted');
  }
  const penalties = penaltyAmounts(source.penalties, statement.netMinor);
  if (sum(penalties) !== statement.penaltiesRequestedMinor) {
    throw new RangeError('The penalties are not those the statement counted');
  }

  const lines: InvoiceLine[] = statement.lines.map((line) => {
    const account = source.accounts.get(line.platformAccountId);
    if (account === undefined) throw new RangeError(`Account ${line.platformAccountId} has no name`);
    return {
      kind: 'commission',
      label: `Commission, compte @${account.handle} sur ${PLATFORM_NAMES[account.platform]}`,
      detail: `${percent(statement.commissionRateBps)} de ${euros(line.netMinor)} de net`,
      amountMinor: line.commissionMinor,
    };
  });
  if (statement.teamShare !== null) {
    lines.push({
      kind: 'team_share',
      label: 'Part d’équipe',
      detail: `${percent(statement.teamShare.bps)} de ${euros(statement.teamShare.baseNetMinor)} de net de l’équipe`,
      amountMinor: statement.teamShare.amountMinor,
    });
  }
  if (statement.tierBonus !== null) {
    lines.push({
      kind: 'tier_bonus',
      label: 'Prime de palier',
      detail: `${euros(statement.tierBonus.thresholdMinor)} de net atteints`,
      amountMinor: statement.tierBonus.bonusMinor,
    });
  }
  if (statement.collectiveBonusMinor !== 0) {
    lines.push({
      kind: 'collective_bonus',
      label: 'Prime d’objectif collectif',
      detail: 'Objectif de l’équipe atteint',
      amountMinor: statement.collectiveBonusMinor,
    });
  }
  for (const bonus of source.bonuses) {
    lines.push({
      kind: 'bonus',
      label: 'Prime',
      detail: quoted(bonus.reason),
      amountMinor: bonus.amountMinor,
    });
  }
  source.penalties.forEach((penalty, index) => {
    lines.push({
      kind: 'penalty',
      label: 'Réfaction prévue au contrat',
      detail:
        penalty.kind === 'percent'
          ? `${percent(penalty.bps)} du net${COLON}${quoted(penalty.reason)}`
          : quoted(penalty.reason),
      amountMinor: minus(penalties[index] ?? 0),
    });
  });
  const capMinor = statement.penaltiesRequestedMinor - statement.penaltiesMinor;
  if (capMinor !== 0) {
    lines.push({
      kind: 'penalty_cap',
      label: 'Plafond des réfactions',
      detail: 'Les réfactions ne dépassent pas la part et les primes de la période',
      amountMinor: capMinor,
    });
  }
  const reissued = reissuedInvoices(source.adjustments);
  for (const adjustment of source.adjustments.filter(
    (one) => one.amountMinor > 0 && !reissuing(one, reissued),
  )) {
    lines.push({
      kind: 'adjustment',
      label: 'Régularisation',
      detail: adjustmentDetail(adjustment.reason, adjustment.correctsPeriod),
      amountMinor: adjustment.amountMinor,
    });
  }
  const owedBackMinor = sum(
    source.adjustments.filter((one) => one.amountMinor < 0).map((one) => one.amountMinor),
  );
  const reissuedMinor = sum(
    source.adjustments.filter((one) => reissuing(one, reissued)).map((one) => one.amountMinor),
  );
  if (
    sum(lines.map((line) => line.amountMinor)) !==
    statement.totalMinor - statement.carryOversInMinor - owedBackMinor - reissuedMinor
  ) {
    throw new RangeError('The lines do not add up to the statement');
  }
  return lines;
}

/** What a period owes back, each a credit note of its own (ADR 0023 § Factures, ADR 0036), amounts excluding VAT. */
export type CreditDue =
  /** An adjustment in the agency's favour: an error of the invoice of the period it corrects. */
  | {
      readonly kind: 'adjustment';
      readonly amountMinor: number;
      readonly reason: string;
      readonly correctsPeriod: PayPeriod | null;
      /**
       * The cancel of a cancel and reissue (ADR 0039 § 3, ADR 0040), the invoice it cancels, or `null`: it goes on that
       * invoice, takes off all that is left of it, and leaves only with the corrective invoice that bills it again;
       * the contractor never has an invoice cancelled with nothing in its place.
       */
      readonly reissueOf: string | null;
    }
  /** What the period's own lines leave below zero, refunds above sales for instance: the period has no invoice. */
  | { readonly kind: 'negative_period'; readonly amountMinor: number; readonly period: PayPeriod };

/**
 * The credit notes a validated statement makes due: one per adjustment in the agency's favour, then what its invoice's
 * lines leave below zero. Every amount the statement pays less is on a document: its invoice, or one of these. The
 * negative half of a cancel and reissue (an adjustment that names a contested document beside a positive one naming
 * the same) is the cancel of that invoice, which leaves with its corrective invoice (`reissuesDue`).
 */
export function creditsDue(source: InvoiceSource): CreditDue[] {
  const reissued = reissuedInvoices(source.adjustments);
  const dues: CreditDue[] = source.adjustments
    .filter((one) => one.amountMinor < 0)
    .map((one) => ({
      kind: 'adjustment',
      amountMinor: minus(one.amountMinor),
      reason: one.reason,
      correctsPeriod: one.correctsPeriod,
      reissueOf:
        one.contestedInvoiceId !== null && reissued.has(one.contestedInvoiceId)
          ? one.contestedInvoiceId
          : null,
    }));
  const leftMinor = sum(invoiceLines(source).map((line) => line.amountMinor));
  if (leftMinor < 0)
    dues.push({ kind: 'negative_period', amountMinor: minus(leftMinor), period: source.period });
  return dues;
}

/**
 * A corrective invoice a period owes (ADR 0040): the positive half of a cancel and reissue, which bills again what its
 * cancel takes off `invoiceId`, on an invoice of its own under that invoice's period, regime and mentions.
 */
export interface ReissueDue {
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly reason: string;
  readonly correctsPeriod: PayPeriod | null;
}

/** The corrective invoices a validated statement makes due, one per cancel and reissue, in the order written. */
export function reissuesDue(source: InvoiceSource): ReissueDue[] {
  const reissued = reissuedInvoices(source.adjustments);
  return source.adjustments.flatMap((one) =>
    one.contestedInvoiceId !== null && reissuing(one, reissued)
      ? [
          {
            invoiceId: one.contestedInvoiceId,
            amountMinor: one.amountMinor,
            reason: one.reason,
            correctsPeriod: one.correctsPeriod,
          },
        ]
      : [],
  );
}

/**
 * The line of a corrective invoice: the adjustment that bills the invoice again, with the period it corrects, as the
 * line of its cancel says it with the opposite amount.
 */
export function reissueLines(due: ReissueDue): InvoiceLine[] {
  if (!Number.isSafeInteger(due.amountMinor) || due.amountMinor <= 0) {
    throw new RangeError('A corrective invoice bills a whole positive amount');
  }
  return [
    {
      kind: 'adjustment',
      label: 'Régularisation',
      detail: adjustmentDetail(due.reason, due.correctsPeriod),
      amountMinor: due.amountMinor,
    },
  ];
}

/** An issued invoice of the contractor, as a credit note's target reads it. */
export interface IssuedInvoice {
  readonly id: string;
  readonly number: string;
  readonly period: PayPeriod;
  readonly exclVatMinor: number;
  readonly creditedMinor: number;
}

/** A credit note to issue: the invoice it cites and what it credits. */
export interface PlannedCreditNote {
  readonly invoiceNumber: string;
  readonly request: CreditDue;
}

/**
 * Where each credit note a period owes goes (ADR 0036), in order, each on one invoice that has enough left once the
 * notes before it are counted: the cancel of a cancel and reissue on the invoice it cancels, another adjustment on an
 * invoice of the period it corrects, a negative period on the latest invoice of an earlier period. A due that no invoice can take whole is never split nor issued: it goes back to
 * the owner, who settles it with the accountant.
 */
export function planCreditNotes(
  dues: readonly CreditDue[],
  invoices: readonly IssuedInvoice[],
): { readonly notes: PlannedCreditNote[]; readonly unplaced: CreditDue[] } {
  const credited = new Map(invoices.map((one) => [one.number, one.creditedMinor]));
  const left = (one: IssuedInvoice): number => one.exclVatMinor - (credited.get(one.number) ?? 0);
  const latestFirst = invoices.toSorted((a, b) => b.period.localeCompare(a.period));
  const notes: PlannedCreditNote[] = [];
  const unplaced: CreditDue[] = [];
  for (const due of dues) {
    const candidates =
      due.kind === 'negative_period'
        ? latestFirst.filter((one) => one.period < due.period)
        : due.reissueOf !== null
          ? invoices.filter((one) => one.id === due.reissueOf)
          : invoices.filter((one) => due.correctsPeriod !== null && one.period === due.correctsPeriod);
    const target = candidates.find((one) => left(one) >= due.amountMinor);
    if (target === undefined) {
      unplaced.push(due);
      continue;
    }
    credited.set(target.number, (credited.get(target.number) ?? 0) + due.amountMinor);
    notes.push({ invoiceNumber: target.number, request: due });
  }
  return { notes, unplaced };
}

/** An invoice's totals: what it charges, and the VAT the agency self-assesses for the purchase journal. */
export interface InvoiceTotals {
  readonly exclVatMinor: number;
  /** The VAT the invoice charges: only a contractor who charges VAT does. */
  readonly vatMinor: number;
  readonly inclVatMinor: number;
  /** Under reverse charge, the VAT the agency both owes and deducts; nothing is invoiced. */
  readonly selfAssessedVatMinor: number;
}

/** The totals of `lines` under the regime's VAT, rounded once on the total, as all of pay. */
export function invoiceTotals(lines: readonly InvoiceLine[], vat: RegimeVat): InvoiceTotals {
  const exclVatMinor = sum(lines.map((line) => line.amountMinor));
  const vatMinor = vat.treatment === 'charged' ? mulDivRound(exclVatMinor, vat.rateBps, BPS) : 0;
  const selfAssessedVatMinor =
    vat.treatment === 'reverse_charge' ? mulDivRound(exclVatMinor, vat.rateBps, BPS) : 0;
  return { exclVatMinor, vatMinor, inclVatMinor: exclVatMinor + vatMinor, selfAssessedVatMinor };
}

const PREFIX = new RegExp(INVOICE_PREFIX_PATTERN, 'u');

/** The contractor's own prefix: two to eight capitals or digits, frozen with the first invoice. */
export function isInvoicePrefix(prefix: string): boolean {
  return PREFIX.test(prefix);
}

/**
 * The number of an invoice or a credit note: the contractor's prefix, the year, the sequence of that contractor and
 * year (`NORA-2026-0007`). The sequence comes from the counter row locked in the transaction that issues.
 */
export function invoiceNumber(prefix: string, year: number, sequence: number): string {
  if (!isInvoicePrefix(prefix)) throw new RangeError(`Not an invoice prefix: ${prefix}`);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new RangeError('A sequence starts at 1');
  return `${prefix}-${String(year)}-${String(sequence).padStart(4, '0')}`;
}

/** The day an invoice falls due: its issue plus the agency's delay. */
export function invoiceDueOn(issuedOn: string, delayDays: number): string {
  if (!Number.isSafeInteger(delayDays) || delayDays < 0) throw new RangeError('A delay is whole days');
  return addDays(issuedOn, delayDays);
}

/**
 * Where a document stands with its due date on the agency's calendar day `today` (EQ-06 lot 8, `InvoiceDueStateSchema`):
 * settled once its debt ended; a credit note, which carries no payment terms, open until then; an invoice overdue from
 * the day after its due date, soon from `INVOICE_DUE_SOON_DAYS` days before it, open before.
 */
export function invoiceDueState(
  document: { readonly kind: InvoiceKind; readonly dueOn: string; readonly settled: boolean },
  today: string,
): InvoiceDueState {
  if (document.settled) return 'settled';
  if (document.kind === 'credit_note') return 'open';
  if (document.dueOn < today) return 'overdue';
  return document.dueOn <= addDays(today, INVOICE_DUE_SOON_DAYS) ? 'soon' : 'open';
}

/**
 * The payment terms an invoice prints after its regime's mentions (art. L441-9 of the Code de commerce): its due date,
 * the one fact the code writes, then the agency's terms as its settings word them (no discount, the late-payment
 * penalties, the 40 € indemnity): a contractual choice its accountant validates, never written here.
 */
export function paymentTermsMention(dueOn: string, terms: string): string {
  return `Échéance${COLON}${longDay(dueOn)}. ${terms}`;
}

/**
 * What a corrective invoice cites of the invoice it replaces (ADR 0040), its first mention, before its regime's: the
 * base checks it names that invoice.
 */
export function reissueMention(invoiceNumber: string, issuedOn: string): string {
  return `Facture rectificative de la facture ${invoiceNumber} du ${longDay(issuedOn)}`;
}

/** What a credit note cites of its invoice, printed as a mention of the credit note. */
export function creditNoteMention(invoiceNumber: string, issuedOn: string): string {
  return `Avoir sur la facture ${invoiceNumber} du ${longDay(issuedOn)}`;
}

/** A whole cancellation, a reduction the agency writes with its reason, or a credit a period owes. */
export type CreditRequest =
  | { readonly kind: 'full' }
  | { readonly kind: 'partial'; readonly amountMinor: number; readonly reason: string }
  | CreditDue;

/** An issued invoice, with what its credit notes already took off. */
export interface CreditableInvoice {
  readonly lines: readonly InvoiceLine[];
  readonly exclVatMinor: number;
  readonly creditedMinor: number;
}

/**
 * The lines of a credit note: the whole invoice cancelled line by line, or one line: a reduction with its reason, the
 * adjustment that corrects the invoice with its period, or a period's negative balance. Never more than what is left
 * of the invoice: a whole cancellation only of an invoice nothing was credited on yet. A credit note takes the VAT
 * regime and the mentions of the invoice it cites, never the regime of the day (ADR 0036): its `invoiceTotals` are
 * computed under that invoice's regime, since a negative balance may fall on an invoice issued under another one.
 */
export function creditNoteLines(invoice: CreditableInvoice, request: CreditRequest): InvoiceLine[] {
  const leftMinor = invoice.exclVatMinor - invoice.creditedMinor;
  if (request.kind === 'full') {
    if (invoice.creditedMinor !== 0 || leftMinor <= 0) throw new CreditNoteExceedsInvoice(leftMinor);
    return invoice.lines.map((line) => ({
      ...line,
      label: `Annulation${COLON}${line.label}`,
      amountMinor: minus(line.amountMinor),
    }));
  }
  if (
    !Number.isSafeInteger(request.amountMinor) ||
    request.amountMinor <= 0 ||
    request.amountMinor > leftMinor
  ) {
    throw new CreditNoteExceedsInvoice(leftMinor);
  }
  if (request.kind === 'negative_period') {
    return [
      {
        kind: 'negative_period',
        label: 'Solde négatif',
        detail: `Période ${periodWords(request.period)}`,
        amountMinor: minus(request.amountMinor),
      },
    ];
  }
  if (request.reason.trim() === '') throw new RangeError('A reduction gives its reason');
  if (request.kind === 'adjustment') {
    return [
      {
        kind: 'adjustment',
        label: 'Régularisation',
        detail: adjustmentDetail(request.reason, request.correctsPeriod),
        amountMinor: minus(request.amountMinor),
      },
    ];
  }
  return [
    {
      kind: 'reduction',
      label: 'Réduction',
      detail: quoted(request.reason),
      amountMinor: minus(request.amountMinor),
    },
  ];
}
