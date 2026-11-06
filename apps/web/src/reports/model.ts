import {
  payPeriodLastDay,
  payPeriodOfDay,
  SHIFT_REPORT_MAX_MINOR,
  type Currency,
  type EarningsSource,
  type PayPeriod,
  type PayRulesSourceRefusal,
  type Shift,
  type ReportGapThreshold,
  type ShiftReport,
  type ShiftReportCheckReason,
  type ShiftReportList,
  type ShiftReportStatus,
} from '@impera/contracts';

import type { ReportRefusal, ReportRefusalCode } from './api';

import { swapShiftLine } from '@/scheduling/model';
import { dayOf } from '@/scheduling/time';

/**
 * The end-of-shift reports without React (EQ-03): how an amount is typed and read, how a period and a status read,
 * what is left to do, and what each refusal of the server says. The server decides; this only says it.
 */

const NBSP = '\u00a0';

/**
 * A typed amount in minor units: « 1 234,56 », « 1234.5 », « 12 € »; a sign only where it is allowed (a correction).
 * `null` for anything else: letters, three decimals, more than `max` (the slip guard, or a target's ceiling).
 */
export function parseAmount(text: string, signed = false, max = SHIFT_REPORT_MAX_MINOR): number | null {
  const bare = text.replace(/[\s\u00a0\u202f€$]/gu, '').replace(/^(EUR|USD)|(EUR|USD)$/giu, '');
  const match = /^([+\-−]?)(\d+)(?:[.,](\d{1,2}))?$/u.exec(bare);
  if (match === null) return null;
  const [, sign = '', units = '0', cents = ''] = match;
  if (sign !== '' && !signed) return null;
  if (units.length > 9) return null;
  const minor = Number(units) * 100 + Number(cents.padEnd(2, '0'));
  if (minor > max) return null;
  return sign === '-' || sign === '−' ? -minor : minor;
}

const MONEY = new Map<string, Intl.NumberFormat>();

/** An amount in French, the true minus sign « − » in place of the hyphen `Intl` gives. */
function money(minor: number, currency: Currency, signDisplay: 'auto' | 'exceptZero'): string {
  const key = `${currency} ${signDisplay}`;
  let format = MONEY.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat('fr-FR', { style: 'currency', currency, signDisplay });
    MONEY.set(key, format);
  }
  // A sum that cancels out can be -0 (« −5 + 5 » in a reduce): written « 0,00 € », never « −0,00 € ».
  return format.format(minor === 0 ? 0 : minor / 100).replace('-', '−');
}

/** An amount as French reads it, with its currency: « 1 234,56 € », « 80,00 $US ». */
export const amountText = (minor: number, currency: Currency): string => money(minor, currency, 'auto');

/**
 * An amount whose sign is always said, attached to its figure: « +5,00 € », « −30,00 € ». A correction, a bonus, a
 * penalty, a gap: every signed amount of the team's screens reads through this one.
 */
export const signedAmountText = (minor: number, currency: Currency): string =>
  money(minor, currency, 'exceptZero');

/**
 * The estimate under a report's amount (reco 19), in euros whatever the account declares in: what a report brings its
 * member, what a correction adds to it or takes off. `memberName` when the agency corrects a member's report.
 */
export function estimateLine(
  commissionMinor: number,
  correcting: boolean,
  memberName: string | null,
): string {
  if (correcting) {
    const whose = memberName === null ? 'ta commission' : `la commission de ${memberName}`;
    return `Effet estimé sur ${whose} : ${signedAmountText(commissionMinor, 'EUR')}`;
  }
  const whose = memberName === null ? 'Ta commission estimée' : `Commission estimée de ${memberName}`;
  return `${whose} : ${amountText(commissionMinor, 'EUR')}`;
}

/** What the estimate leaves to the statement, said beside it. */
export const ESTIMATE_LEAVES = 'avant paliers, objectifs, primes et malus';

/** The figure an amount field shows back, without its currency: « 1234,56 », « −30,05 » with the true minus sign. */
export const amountInput = (minor: number): string =>
  `${minor < 0 ? '−' : ''}${String(Math.trunc(Math.abs(minor) / 100))},${String(Math.abs(minor) % 100).padStart(2, '0')}`;

/** The symbol beside an amount field. */
export const CURRENCY_SIGNS: Readonly<Record<Currency, string>> = { EUR: '€', USD: '$' };

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' });
const MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const dayNumber = (day: string): string => {
  const date = Number(day.slice(8, 10));
  return date === 1 ? '1er' : String(date);
};

/** « du 1er au 15 octobre », « du 16 au 31 octobre 2026 » with its year: a period in a sentence, never « du 1er – 15 » (EQP-13). */
export function periodLine(period: PayPeriod, year = false): string {
  const last = payPeriodLastDay(period);
  const month = (year ? MONTH_YEAR : MONTH).format(new Date(`${period}T12:00:00Z`));
  return `du ${dayNumber(period)} au ${dayNumber(last)} ${month}`;
}

/** « 1er – 15 octobre 2026 »: a period as a title; « 1er – 15 octobre » in a list that has room for no more. */
export function periodTitle(period: PayPeriod, year = true): string {
  const last = payPeriodLastDay(period);
  const month = (year ? MONTH_YEAR : MONTH).format(new Date(`${period}T12:00:00Z`));
  return `${dayNumber(period)} – ${dayNumber(last)} ${month}`;
}

/** The period running at `now` in the agency's zone, which the periods follow (ADR 0023). */
export const periodAt = (now: Date, agencyZone: string): PayPeriod => payPeriodOfDay(dayOf(now, agencyZone));

/** A status as its member reads it, and as the agency does. */
export const MEMBER_STATUS: Readonly<Record<ShiftReportStatus, string>> = {
  // The word of the figure above it, « En attente », not a second name for the same state (EQ-21).
  submitted: 'En attente',
  validated: 'Validé',
  rejected: 'Renvoyé',
};
export const AGENCY_STATUS: Readonly<Record<ShiftReportStatus, string>> = {
  submitted: 'À valider',
  validated: 'Validé',
  rejected: 'Renvoyé au membre',
};

/** Quiet while it waits, green once validated, amber when it came back. Red stays for urgencies. */
export type ReportTone = 'wait' | 'ok' | 'warn';
export const STATUS_TONES: Readonly<Record<ShiftReportStatus, ReportTone>> = {
  submitted: 'wait',
  validated: 'ok',
  rejected: 'warn',
};

export const SOURCE_LABELS: Readonly<Record<EarningsSource, string>> = {
  declared: 'Rapports de fin de shift',
  detected: 'Ventes relevées par le connecteur',
};

/** The report of a shift, the one that is not a correction. */
export const reportOf = (reports: readonly ShiftReport[], shiftId: string): ShiftReport | null =>
  reports.find((one) => one.shiftId === shiftId && one.correctsId === null) ?? null;

/** What a shift's validated report and corrections add up to, in minor units. */
export const validatedTotal = (reports: readonly ShiftReport[], shiftId: string): number =>
  reports
    .filter((one) => one.shiftId === shiftId && one.status === 'validated')
    .reduce((total, one) => total + one.amount.amountMinor, 0);

/** A line the member has to act on: a shift without its report, or a report sent back. */
export interface ToDo {
  readonly shift: Shift;
  readonly report: ShiftReport | null;
}

/**
 * What is left to do in a period's list: the reports to make, those sent back, and, given the hour, those whose gap
 * with the platform waits for their member (ADR 0073 § 5), oldest shift first.
 */
export function toDoOf(list: ShiftReportList, now?: Date): ToDo[] {
  return list.shifts
    .map((shift) => ({ shift, report: reportOf(list.reports, shift.id) }))
    .filter(
      ({ report }) =>
        report === null || report.status === 'rejected' || (now !== undefined && gapWaits(report, now)),
    )
    .toSorted((a, b) => a.shift.startsAt.localeCompare(b.shift.startsAt));
}

/** The incidents said in reports, shift by shift, in the order they were said: the planning marks those shifts. */
export function incidentsOf(reports: readonly ShiftReport[]): ReadonlyMap<string, readonly string[]> {
  const byShift = new Map<string, readonly string[]>();
  for (const report of reports.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (report.incident !== null)
      byShift.set(report.shiftId, [...(byShift.get(report.shiftId) ?? []), report.incident]);
  }
  return byShift;
}

/** Several reads of the list as one: each report, shift, account and member once. */
export function mergeLists(lists: readonly ShiftReportList[]): ShiftReportList {
  const once = <T extends { readonly id: string }>(items: readonly T[]): T[] => [
    ...new Map(items.map((item) => [item.id, item])).values(),
  ];
  return {
    reports: once(lists.flatMap((list) => list.reports)),
    shifts: once(lists.flatMap((list) => list.shifts)),
    accounts: once(lists.flatMap((list) => list.accounts)),
    members: once(lists.flatMap((list) => list.members)),
  };
}

/** One shift of a list with what it was reported: its report, its corrections, and what is validated of it. */
export interface ShiftLine {
  readonly shift: Shift;
  readonly report: ShiftReport | null;
  readonly corrections: readonly ShiftReport[];
  readonly validatedMinor: number;
}

/** The list shift by shift, the latest first: a shift without a report is a « Sans rapport » line. */
export function linesOf(list: ShiftReportList): ShiftLine[] {
  return list.shifts
    .map((shift) => ({
      shift,
      report: reportOf(list.reports, shift.id),
      corrections: list.reports
        .filter((one) => one.shiftId === shift.id && one.correctsId !== null)
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
      validatedMinor: validatedTotal(list.reports, shift.id),
    }))
    .toSorted((a, b) => b.shift.startsAt.localeCompare(a.shift.startsAt));
}

/** The shifts over with no report yet, the oldest first: the late ones the agency sees at a glance (EQ-14). */
export function lateLines(list: ShiftReportList, now: Date): ShiftLine[] {
  return linesOf(list)
    .filter((line) => line.report === null && new Date(line.shift.endsAt).getTime() <= now.getTime())
    .toReversed();
}

/** « depuis 25 min », « depuis 8 h », « depuis 2 jours »: how long a report has been waiting since its shift ended. */
export function lateFor(endsAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(endsAt).getTime()) / 60_000));
  if (minutes < 60) return `depuis ${String(minutes)}${NBSP}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `depuis ${String(hours)}${NBSP}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'depuis 1 jour' : `depuis ${String(days)} jours`;
}

/**
 * The word « Relancer » copies for a member whose report is late (EQ-15), at his own hour: « Kofi, ton rapport du
 * mer. 28 oct. · 11 h – 17 h (Léa) n’est pas encore fait. Fais-le dans Impera dès que tu peux. » Impera sends
 * nothing: the agency pastes it where it talks to him.
 */
export function nudgeText(
  name: string,
  shift: Pick<Shift, 'startsAt' | 'endsAt'>,
  creatorName: string | undefined,
  timeZone: string,
): string {
  const when = swapShiftLine(shift.startsAt, shift.endsAt, undefined, timeZone);
  const on = creatorName === undefined ? '' : ` (${creatorName})`;
  return `${name}, ton rapport du ${when}${on} n’est pas encore fait. Fais-le dans Impera dès que tu peux.`;
}

/**
 * A period's figures per currency: what is validated, what still waits for the agency (sent, not yet read), and what
 * came back and waits for its member. Corrections count in each, as their amounts do.
 */
export interface PeriodSum {
  readonly currency: Currency;
  readonly validatedMinor: number;
  /** Reports and corrections validated, one validated at zero among them. */
  readonly validated: number;
  readonly waitingMinor: number;
  readonly waiting: number;
  readonly sentBackMinor: number;
  readonly sentBack: number;
}

export function periodSums(reports: readonly ShiftReport[]): PeriodSum[] {
  const sums = new Map<Currency, Omit<PeriodSum, 'currency'>>();
  for (const report of reports) {
    const sum = sums.get(report.amount.currency) ?? {
      validatedMinor: 0,
      validated: 0,
      waitingMinor: 0,
      waiting: 0,
      sentBackMinor: 0,
      sentBack: 0,
    };
    const minor = report.amount.amountMinor;
    sums.set(
      report.amount.currency,
      report.status === 'validated'
        ? { ...sum, validatedMinor: sum.validatedMinor + minor, validated: sum.validated + 1 }
        : report.status === 'submitted'
          ? { ...sum, waitingMinor: sum.waitingMinor + minor, waiting: sum.waiting + 1 }
          : { ...sum, sentBackMinor: sum.sentBackMinor + minor, sentBack: sum.sentBack + 1 },
    );
  }
  return [...sums].map(([currency, sum]) => ({ currency, ...sum }));
}

/** A rate in basis points as a percentage: « 20 % », « 5,5 % ». */
export const percentText = (bps: number): string =>
  `${(bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${NBSP}%`;

/** A typed percentage in basis points, 0 to `max` (100 %) with two decimals at most; `null` otherwise. */
export function parsePercent(text: string, max = 10_000): number | null {
  const match = /^(\d{1,4})(?:[.,](\d{1,2}))?$/u.exec(text.replace(/[\s\u00a0%]/gu, ''));
  if (match === null) return null;
  const [, units = '0', decimals = ''] = match;
  const bps = Number(units) * 100 + Number(decimals.padEnd(2, '0'));
  return bps <= max ? bps : null;
}

/** The periods new rules may start with: the current one for an account's first rules, then the next ones. */
export function startablePeriods(current: PayPeriod, first: boolean, count = 4): PayPeriod[] {
  const periods: PayPeriod[] = first ? [current] : [];
  let next = current;
  while (periods.length < count) {
    next = followingPeriod(next);
    periods.push(next);
  }
  return periods;
}

/** The period before `period`: a report made late still lists its shift there. */
export const previousPeriod = (period: PayPeriod): PayPeriod => {
  const before = new Date(`${period}T12:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  return payPeriodOfDay(before.toISOString().slice(0, 10));
};

/** The period after `period`. */
export const followingPeriod = (period: PayPeriod): PayPeriod => {
  const last = payPeriodLastDay(period);
  const after = new Date(`${last}T12:00:00Z`);
  after.setUTCDate(after.getUTCDate() + 1);
  return payPeriodOfDay(after.toISOString().slice(0, 10));
};

/** What each refusal says, in the screens' words. */
export const REPORT_ERRORS: Readonly<Record<ReportRefusalCode, string>> = {
  shift_not_found: 'Ce shift n’existe plus ou a été annulé : la liste est relue.',
  shift_report_not_found: 'Ce rapport n’existe plus : la liste est relue.',
  shift_report_conflict: 'Ce rapport a déjà été envoyé avec d’autres valeurs : la liste est relue.',
  shift_report_exists_conflict: 'Ce shift a déjà son rapport : rouvre-le pour le modifier.',
  shift_report_early_conflict: 'Le rapport se fait à la fin du shift, 30 minutes avant au plus tôt.',
  shift_report_changed_conflict:
    'Ce rapport ou son shift a changé depuis qu’il a été lu : la liste est relue.',
  shift_report_validated_conflict: 'Un rapport validé ne change plus : il se corrige.',
  shift_report_total_conflict: 'Cette correction ferait passer le total validé du shift sous zéro.',
  shift_report_detected_conflict:
    'Sur cette quinzaine, la paie de ce compte lit les ventes relevées : pas de montant à déclarer.',
  shift_report_currency_conflict: 'Les règles de ce compte ont changé de devise : le rapport est relu.',
  pay_rules_missing_conflict:
    'Les règles de paie de ce compte ne sont pas posées pour cette quinzaine : préviens l’agence.',
  shift_report_own_review_forbidden:
    'Ce rapport se relit par quelqu’un d’autre : ton propre shift, ou ce que tu as envoyé.',
  shift_report_forbidden: 'Ce rapport est celui d’un autre membre.',
  platform_account_not_found: 'Ce compte n’existe plus : la liste est relue.',
  pay_rules_conflict: 'Ces règles ont déjà été posées avec d’autres valeurs : la liste est relue.',
  pay_rules_period_conflict: 'Ce compte a déjà des règles à partir de cette quinzaine.',
  pay_rules_period_invalid:
    'De nouvelles règles partent d’une quinzaine qui n’a pas commencé ; seules les premières d’un compte partent de celle en cours.',
  pay_rules_source_conflict:
    'Ce compte ne peut pas encore être payé sur le net de sa plateforme : sa paie se lit dans les rapports validés.',
  shift_report_gap_conflict:
    'Ce rapport s’écarte des ventes lues sur la plateforme : son membre a 48 heures après son shift pour le corriger ou l’expliquer.',
  role_forbidden: 'Ton rôle ne permet pas ce geste.',
  request_invalid: 'Ces valeurs ne conviennent pas : vérifie le montant et les textes.',
};

/**
 * Why « Ventes relevées » is refused, and what unblocks it (`details.reason` of `pay_rules_source_conflict`, ADR 0050
 * § 8, CRM-03). No amount and no key: what is missing, and where it is set. The platform is never named, the screen
 * serves them all.
 */
export const SOURCE_REFUSAL_TEXTS: Readonly<Record<PayRulesSourceRefusal, string>> = {
  platform_without_net:
    'La plateforme de ce compte ne donne pas de net : sa paie se lit dans les rapports validés.',
  model_unlinked:
    'Aucun modèle de la plateforme n’est relié à ce compte : relie son modèle dans Réglages › Ventes, sinon ses ventes ne comptent nulle part.',
  check_missing:
    'Les ventes de cette plateforme n’ont jamais été vérifiées : lance la vérification de fiabilité dans Réglages › Ventes, sur une quinzaine entière déjà finie.',
  check_not_clean:
    'La dernière vérification de fiabilité ne peut pas porter la bascule : il en faut une sur une quinzaine entière, avec l’export, où tout concorde et où aucune note ne reste à régler. Refais-la dans Réglages › Ventes.',
  check_not_before:
    'La dernière vérification porte sur une quinzaine qui ne finit pas avant ces règles : fais-les partir d’une quinzaine plus tardive, ou vérifie une quinzaine qui finit avant elles.',
};

/** What a refusal says: the exact reason of a refused « Ventes relevées » when the server gives one, else its code. */
export function refusalText(refusal: Extract<ReportRefusal, { kind: 'refused' }>): string {
  if (refusal.code === 'pay_rules_source_conflict' && refusal.sourceReason !== null) {
    return SOURCE_REFUSAL_TEXTS[refusal.sourceReason];
  }
  return REPORT_ERRORS[refusal.code];
}

/** The refusals after which what the screen shows is stale: read it again. */
export const READ_AGAIN: ReadonlySet<ReportRefusalCode> = new Set<ReportRefusalCode>([
  'shift_not_found',
  'shift_report_not_found',
  'shift_report_conflict',
  'shift_report_exists_conflict',
  'shift_report_changed_conflict',
  'shift_report_validated_conflict',
  'shift_report_currency_conflict',
  'platform_account_not_found',
  'pay_rules_conflict',
  'pay_rules_period_conflict',
]);

/**
 * The currency a typed amount names, by its symbol or its code (« 50 € », « $50 », « 50 USD »), `null` when it names
 * none: `parseAmount` drops them, so a « 50 € » on an account in dollars is caught here rather than read as $50.
 */
export function currencyTyped(text: string): Currency | null {
  if (/€|EUR/iu.test(text)) return 'EUR';
  if (/\$|USD/iu.test(text)) return 'USD';
  return null;
}

/** « en euros », « en dollars »: the currency an account declares in, in a sentence. */
export const CURRENCY_WORDS: Readonly<Record<Currency, string>> = { EUR: 'en euros', USD: 'en dollars' };

/**
 * A report against what its platform read during the shift (ADR 0073), said by the screens: the server compares and
 * decides, this only says it. A correction, or an account whose platform's sales are not read, has no check.
 */

/** Why a report is not compared (§ 7), to its member or to the agency, who can link what is missing. */
export function uncheckedText(reason: ShiftReportCheckReason, platform: string, agency: boolean): string {
  switch (reason) {
    case 'feed_off':
      return `Les ventes de ${platform} ne sont pas lues en ce moment : rien n’est comparé, la relecture se fait comme avant.`;
    case 'model_unlinked':
      return agency
        ? `Ce compte n’est relié à aucun modèle de ${platform} : relie-le dans Réglages › Ventes pour comparer ses rapports.`
        : `Ce compte n’est pas encore comparé aux ventes de ${platform} : l’agence relit ton rapport.`;
    case 'chatter_unlinked':
      return agency
        ? `Ce membre n’est relié à aucun chatteur de ${platform} : relie-le dans Réglages › Ventes pour comparer ses rapports.`
        : `Ton compte de chatteur sur ${platform} n’est pas encore relié : l’agence relit ton rapport.`;
  }
}

/**
 * Whether a person's validation waits for its member (§ 5): a complete check out of the threshold or above the
 * platform, neither explained nor past its delay. Correcting the amount sends a new version, compared again.
 */
export function gapWaits(report: ShiftReport, now: Date): boolean {
  const { check } = report;
  return (
    check?.state === 'complete' &&
    check.verdict === 'gap' &&
    report.explanation === null &&
    check.explainBy !== null &&
    now.getTime() < Date.parse(check.explainBy)
  );
}

/** A report with a gap, whatever became of it: what the agency counts per member and fortnight (§ 5). */
export const hasGap = (report: ShiftReport): boolean =>
  report.check?.state === 'complete' && report.check.verdict === 'gap';

/**
 * A sent report the reader decides now (ADR 0073, recette « attaque ça » of 06/11): one they may review, whose gap no
 * longer waits for its member, and that the automatic check will not validate within five minutes. What the Dashboard
 * and the tab Équipe › Rapports count, so that nothing stays in the queue unseen.
 */
export function awaitsDecision(report: ShiftReport, now: Date): boolean {
  if (report.status !== 'submitted' || !report.canReview || gapWaits(report, now)) return false;
  return !(report.check?.state === 'complete' && report.check.verdict === 'within');
}

/** « 1 % ou 5,00 € » : the threshold as Réglages and the screens say it (§ 3). */
export const thresholdText = (threshold: ReportGapThreshold, currency: Currency = 'EUR'): string =>
  `${percentText(threshold.bps)} ou ${amountText(threshold.minor, currency)}`;

/** The chip of a report whose gap waits for its member (§ 5), wherever its member sees it: amber, what to do. */
export const GAP_TO_EXPLAIN = 'Écart · À expliquer';
