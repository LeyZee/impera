import {
  CARRY_OVER_RANK_MAX,
  carryOverRank,
  collectiveGoalLastDay,
  nextPayPeriod,
  PAY_TARGET_MAX_MINOR,
  payPeriodLastDay,
  payPeriodNotBegun,
  payPeriodOfDay,
  PayPeriodSchema,
  penaltyApplies,
  positiveCarryRankIn,
  type BonusTier,
  type CollectiveGoal,
  type CollectiveTier,
  type CommissionStatement,
  type CommissionStatementLine,
  type Currency,
  type ExchangeRate,
  type ForeignCurrency,
  type PaymentMethod,
  type PayPeriodBlock,
  type PayPeriod,
  type PayPeriodSummary,
  type PayPeriodWindow,
  type PayrollEntries,
  type PayrollPeriod,
  type Platform,
  type TeamMember,
} from '@nirvana/contracts';

import type { PayRefusal, PayRefusalCode } from './api';

import { memberOf } from '@/lib/utils';
import {
  amountText,
  followingPeriod,
  parseAmount,
  percentText,
  periodLine,
  signedAmountText,
} from '@/reports/model';
import { platformName } from '@/scheduling/model';
import { clockAt, dayOf, daysFrom, longDay, withFirstOfMonth } from '@/scheduling/time';

/**
 * Pay without React (EQ-05): what a statement and a period say, how the money runs from the sales to what is paid,
 * the forecast of a period, and what each refusal of the server means. The server computes; this only says it.
 */

const NBSP = '\u00a0';
const DAY_MS = 86_400_000;

/** A rate in basis points with its sign always said, attached: « +12 % », « −10 % ». */
export const signedPercentText = (bps: number): string =>
  `${bps > 0 ? '+' : bps < 0 ? '−' : ''}${percentText(Math.abs(bps))}`;

const DAY_SHORT_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const WEEKDAY_DAY_SHORT_MONTH = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const RATE = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const CURRENCY_UNITS: Readonly<Record<Currency, string>> = { EUR: '€', USD: '$' };

/** The euros one unit of `currency` was worth: « 1 $ = 0,9217 € ». */
export const rateText = (rateMicros: number, currency: Currency): string =>
  `1${NBSP}${CURRENCY_UNITS[currency]} = ${RATE.format(rateMicros / 1_000_000)}${NBSP}€`;

/** The change from `before` to `now`, in basis points; `null` when there is nothing to compare with. */
export function changeBps(now: number, before: number | null): number | null {
  if (before === null || before <= 0) return null;
  return Math.round(((now - before) * 10_000) / before);
}

/** A statement's marks: what stage it is at, and a carry-over, the one amber mark; red for a period pay cannot compute. */
export type PayTone = 'neutral' | 'wait' | 'ok' | 'warn';
export interface PayChip {
  readonly label: string;
  readonly tone: PayTone;
}

/**
 * Where a statement is: running, to validate, validated with money still to send (waiting), or done — paid, or
 * validated with nothing to send. Never « Brouillon », the word of the agent's replies (glossary).
 */
export function statementStage(statement: CommissionStatement, ended: boolean): PayChip {
  if (!ended) return { label: 'En cours', tone: 'neutral' };
  if (statement.status === 'paid') return { label: 'Payé', tone: 'ok' };
  if (statement.status === 'validated')
    return { label: 'Validé', tone: statement.payableMinor > 0 ? 'wait' : 'ok' };
  return { label: 'À valider', tone: 'neutral' };
}

/**
 * A carry-over, the one amber mark: « Reporté » once the statement is validated, never before — until then it is only
 * under the minimum (or under zero), and its total may still change.
 */
function carryChip(statement: CommissionStatement): PayChip | null {
  if (statement.carryOverOutMinor === 0) return null;
  if (statement.status !== 'draft') return { label: 'Reporté', tone: 'warn' };
  return { label: statement.totalMinor < 0 ? 'Sous zéro' : 'Sous le minimum', tone: 'warn' };
}

export function statementChips(statement: CommissionStatement, ended: boolean): PayChip[] {
  const carry = carryChip(statement);
  return [statementStage(statement, ended), ...(carry === null ? [] : [carry])];
}

/**
 * A row's marks in a list of the period: its stage is left out when every row shares it and it says nothing the
 * period does not (« En cours », « À valider »); what differs stays (Validé, Payé, Sous le minimum, Reporté).
 */
export function rowChips(statement: CommissionStatement, ended: boolean, sameStage: boolean): PayChip[] {
  const chips = statementChips(statement, ended);
  const stage = statementStage(statement, ended).label;
  return sameStage && (stage === 'En cours' || stage === 'À valider') ? chips.slice(1) : chips;
}

/** Whether every statement of a period is at the same stage. */
export const sameStageOf = (statements: readonly CommissionStatement[], ended: boolean): boolean =>
  new Set(statements.map((one) => statementStage(one, ended).label)).size <= 1;

/**
 * What a statement's amount is, under it in its row: so far, to pay, paid on a day, or nothing to pay. A draft's says it
 * waits for its validation, unless every row is a draft and the period's head says it once.
 */
export function amountWhat(statement: CommissionStatement, ended: boolean, sameStage = false): string {
  if (!ended) return 'à ce jour';
  if (statement.payment !== null) return `versé le ${dayShortMonth(statement.payment.paidOn)}`;
  if (statement.payableMinor === 0) return 'rien à verser';
  return statement.status === 'draft' && !sameStage ? 'à verser, une fois validé' : 'à verser';
}

/** A carry-over under a row's amount: its total and where it goes, conditional until the statement is validated. */
export function carryWhat(statement: CommissionStatement): string | null {
  if (statement.carryOverOutMinor === 0) return null;
  const total = `total ${amountText(statement.totalMinor, 'EUR')}`;
  return statement.status === 'draft' ? `${total} → irait en report` : `${total} → reporté`;
}

/** A period as the list of periods sums it, read from the period itself. */
export function summaryOf(period: PayrollPeriod): Omit<PayPeriodSummary, 'window'> {
  const count = (keep: (statement: CommissionStatement) => boolean): number =>
    period.statements.filter(keep).length;
  const sum = (pick: (statement: CommissionStatement) => number): number =>
    period.statements.reduce((total, statement) => total + pick(statement), 0);
  return {
    ended: period.ended,
    closedAt: period.closing?.closedAt ?? null,
    closedBy: period.closing?.closedBy ?? null,
    blocked: period.blocked,
    statements: {
      draft: count((one) => one.status === 'draft'),
      validated: count((one) => one.status === 'validated'),
      paid: count((one) => one.status === 'paid'),
      carried: count((one) => one.carryOverOutMinor !== 0 && one.status !== 'draft'),
    },
    netMinor: sum((one) => one.netMinor),
    payableMinor: sum((one) => one.payableMinor),
    validatedPayableMinor: sum((one) => (one.status === 'draft' ? 0 : one.payableMinor)),
    carriedMinor: sum((one) => (one.status === 'draft' ? 0 : one.carryOverOutMinor)),
    paidMinor: sum((one) => one.payment?.sentMinor ?? 0),
  };
}

/** Where a period is: running, to validate, validated with money still to send, or paid. */
export type PeriodPhase = 'running' | 'to_validate' | 'to_pay' | 'paid';

export function phaseOf(summary: Omit<PayPeriodSummary, 'window'>): PeriodPhase {
  if (!summary.ended) return 'running';
  if (summary.statements.draft > 0) return 'to_validate';
  return summary.payableMinor > summary.paidMinor ? 'to_pay' : 'paid';
}

export function phaseChip(summary: Omit<PayPeriodSummary, 'window'>): PayChip {
  // Whatever its stage, a period pay could not compute says that first: its figures are out of date.
  if (summary.blocked !== null) return { label: 'Calcul bloqué', tone: 'warn' };
  switch (phaseOf(summary)) {
    case 'running':
      return { label: 'En cours', tone: 'neutral' };
    case 'to_validate':
      return { label: summary.closedAt === null ? 'Finie : à valider' : 'Close : à valider', tone: 'wait' };
    case 'to_pay':
      return { label: 'Close : à verser', tone: 'wait' };
    case 'paid':
      return { label: 'Payée', tone: 'ok' };
  }
}

/**
 * The one amount a period shows in the list: what is paid, or what is left to pay. Only a validation makes an amount
 * owed: once one is, « reste à envoyer » is `validatedPayableMinor − paidMinor`, the figure Quinzaine shows (#295).
 */
export function periodAmount(summary: Omit<PayPeriodSummary, 'window'>): { minor: number; what: string } {
  if (summary.blocked !== null)
    return { minor: summary.payableMinor - summary.paidMinor, what: 'au dernier calcul, plus à jour' };
  switch (phaseOf(summary)) {
    case 'running':
      return { minor: summary.payableMinor, what: 'à verser à ce jour' };
    case 'to_validate': {
      // What is owed and what waits for a validation stay apart, never added: when nothing owed is left to send, the
      // row says what the statements still to validate would pay rather than « 0,00 € ».
      const owed = summary.validatedPayableMinor - summary.paidMinor;
      return summary.statements.validated + summary.statements.paid === 0 || owed === 0
        ? { minor: summary.payableMinor - summary.validatedPayableMinor, what: 'à verser une fois validé' }
        : { minor: owed, what: 'reste à envoyer, validation en cours' };
    }
    case 'to_pay':
      return { minor: summary.validatedPayableMinor - summary.paidMinor, what: 'reste à envoyer' };
    case 'paid':
      return { minor: summary.paidMinor, what: 'versé' };
  }
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count > 1 ? many : one}`;

/** « 3 payés, 1 validé · 1 reporté »: a period's statements, counted. */
export function countsLine(statements: PayPeriodSummary['statements']): string {
  const parts = [
    statements.paid > 0 ? plural(statements.paid, 'payé', 'payés') : null,
    statements.validated > 0 ? plural(statements.validated, 'validé', 'validés') : null,
    statements.draft > 0 ? `${String(statements.draft)} à valider` : null,
  ].filter((part) => part !== null);
  const carried = statements.carried > 0 ? ` · ${plural(statements.carried, 'reporté', 'reportés')}` : '';
  return `${parts.join(', ')}${carried}`;
}

/** The day a period's validation opens: its end, the first day of the next one, in the agency's zone. */
export const opensOn = (window: PayPeriodWindow): string => dayOf(window.endsAt, window.timeZone);

/** « dim. 1er nov. », « lun. 2 nov. »: a day, short, the first of the month written as French writes it. */
export const dayMonthText = (day: string): string =>
  withFirstOfMonth(WEEKDAY_DAY_SHORT_MONTH.formatToParts(new Date(`${day}T12:00:00Z`)));

/** « lun. 2 nov. », the day of an instant in the agency's zone, short. */
export const dayAt = (instant: string, timeZone: string): string => dayMonthText(dayOf(instant, timeZone));

/** « à 8 h 12 » today, « le ven. 16 oct. à 8 h 12 » another day: when a statement was computed. */
export function computedText(instant: string, timeZone: string, now: Date): string {
  const at = `à ${clockAt(instant, timeZone)}`;
  return dayOf(instant, timeZone) === dayOf(now, timeZone) ? at : `le ${dayAt(instant, timeZone)} ${at}`;
}

/**
 * The countries of the CFA franc, West (UEMOA) and Central (CEMAC): both are pegged at the same parity. Only there does
 * an amount in FCFA say what a member receives.
 */
const CFA_FRANC_COUNTRIES: ReadonlySet<string> = new Set([
  ...'BJ BF CI GW ML NE SN TG'.split(' '), // UEMOA
  ...'CM CF CG GA GQ TD'.split(' '), // CEMAC
]);

/** Whether a member living in `country` is paid in CFA francs, so that the FCFA guide is worth showing them. */
export const inCfaFrancZone = (country: string): boolean => CFA_FRANC_COUNTRIES.has(country);

/** The fixed parity of the CFA franc: 1 € = 655,957 FCFA. */
const FCFA_PER_EURO = 655.957;
const WHOLE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/**
 * « ≈ 705 173 FCFA, avant frais WorldRemit »: an amount in euros at the CFA franc's fixed parity. A guide for a member
 * of the CFA franc zone (`inCfaFrancZone`), never an amount to pay: the euro stays the one currency pay computes in
 * (ADR 0011).
 */
export const fcfaText = (minor: number): string =>
  `≈${NBSP}${WHOLE.format(Math.round((minor * FCFA_PER_EURO) / 100))}${NBSP}FCFA, avant frais WorldRemit`;

/** « lundi 2 novembre à 10 h 41 ». */
export const momentAt = (instant: string, timeZone: string): string =>
  `${longDay(dayOf(instant, timeZone))} à ${clockAt(instant, timeZone)}`;

/** Who did something on pay, by account: oneself, a member of the team, or else the owner, the one account out of it. */
export function whoName(
  userId: string,
  me: { readonly id: string; readonly name: string },
  members: readonly Pick<TeamMember, 'userId' | 'displayName'>[],
): string {
  if (userId === me.id) return me.name;
  return members.find((member) => member.userId === userId)?.displayName ?? 'le propriétaire';
}

/**
 * The net a statement counts from reports of an earlier period, closed when they came (EQ-04): each line's share of
 * its gross that is late, of its net. They are not the period's own pace.
 */
export function lateNetOf(statements: readonly CommissionStatement[]): number {
  let late = 0;
  for (const line of statements.flatMap((statement) => statement.lines)) {
    const lateGross = line.lateReports.reduce((total, report) => total + report.grossMinor, 0);
    if (lateGross !== 0 && line.grossMinor !== 0)
      late += Math.round((line.netMinor * lateGross) / line.grossMinor);
  }
  return late;
}

/**
 * The team's net at the end of the period, at the pace of the time gone by in the agency's zone: what late reports
 * brought is counted once, not as pace. The net itself once the period has ended; `null` before a first full day,
 * when there is no pace to speak of.
 */
export function forecastNet(
  netMinor: number,
  lateNetMinor: number,
  window: Pick<PayPeriodWindow, 'startsAt' | 'endsAt'>,
  now: Date,
): number | null {
  const starts = new Date(window.startsAt).getTime();
  const ends = new Date(window.endsAt).getTime();
  const gone = now.getTime() - starts;
  if (now.getTime() >= ends) return netMinor;
  if (gone < DAY_MS) return null;
  return Math.round(((netMinor - lateNetMinor) * (ends - starts)) / gone) + lateNetMinor;
}

/** Days left in a period, today included: « encore 3 jours ». */
export const daysLeft = (window: PayPeriodWindow, now: Date): number =>
  daysFrom(dayOf(now, window.timeZone), opensOn(window));

/** One step of the money of an account: what it is, how it was reached, and how much. */
export interface FlowStep {
  readonly label: string;
  readonly op: string;
  readonly amount: string;
}

/** From the sales of an account to the commission, step by step, as the engine computed them. */
export function flowOf(
  line: CommissionStatementLine,
  commissionBps: number,
  platform: Platform | null,
  you: boolean,
): FlowStep[] {
  const reports = plural(line.shiftReportIds.length, 'rapport', 'rapports');
  const steps: FlowStep[] = [
    { label: 'Ventes', op: reports, amount: amountText(line.grossMinor, line.currency) },
  ];
  if (line.currency !== 'EUR')
    steps.push({
      label: 'En euros',
      op: rateText(line.rateMicros, line.currency),
      amount: amountText(line.grossEurMinor, 'EUR'),
    });
  steps.push({
    label: 'Hors TVA',
    op: line.vatBps === 0 ? 'sans TVA' : `TVA ${percentText(line.vatBps)}`,
    amount: amountText(line.exclVatMinor, 'EUR'),
  });
  const where = platform === null ? 'la plateforme' : platformName(platform);
  steps.push({
    label: `Net ${/^[AEIOUY]/iu.test(where) ? 'd’' : 'de '}${where}`,
    op: `${where} ${percentText(line.platformFeeBps)}`,
    amount: amountText(line.netMinor, 'EUR'),
  });
  steps.push({
    label: you ? 'Ta commission' : 'Sa commission',
    op: percentText(commissionBps),
    amount: amountText(line.commissionMinor, 'EUR'),
  });
  return steps;
}

/** One row of a statement's totals. */
export interface TotalRow {
  readonly label: string;
  readonly note: string | null;
  readonly amount: string;
  readonly kind: 'line' | 'minus' | 'total' | 'carry' | 'pay';
}

/**
 * What a statement adds up to after the commissions: team share, tier, goal, bonuses, penalties (asked and kept),
 * carry-overs, adjustments, the total, what is carried to the next period, and what is paid. `you` speaks to the
 * member; a paid statement speaks in the past.
 */
export function totalsOf(statement: CommissionStatement, you: boolean, payLabelOf?: string): TotalRow[] {
  const rows: TotalRow[] = [
    { label: 'Commission', note: null, amount: amountText(statement.commissionMinor, 'EUR'), kind: 'line' },
  ];
  const signed = (minor: number): string => signedAmountText(minor, 'EUR');
  if (statement.teamShare !== null)
    rows.push({
      label: 'Part d’équipe',
      note: `${percentText(statement.teamShare.bps)} du net des autres membres (${amountText(statement.teamShare.baseNetMinor, 'EUR')})`,
      amount: signed(statement.teamShare.amountMinor),
      kind: 'line',
    });
  if (statement.tierBonus !== null)
    rows.push({
      label: `Palier ${statement.tierBonus.label}`,
      note: `${amountText(statement.tierBonus.thresholdMinor, 'EUR')} de net atteints`,
      amount: signed(statement.tierBonus.bonusMinor),
      kind: 'line',
    });
  if (statement.collectiveBonusMinor > 0) {
    const reached = statement.team?.collective?.reachedBps ?? null;
    rows.push({
      label: 'Objectif collectif',
      note:
        reached === null
          ? null
          : `l’équipe a atteint ${String(Math.floor(reached / 100))}${NBSP}% de l’objectif`,
      amount: signed(statement.collectiveBonusMinor),
      kind: 'line',
    });
  }
  for (const bonus of statement.bonuses)
    rows.push({
      label: 'Prime',
      note: `« ${bonus.reason} »`,
      amount: signed(bonus.amountMinor),
      kind: 'line',
    });
  if (statement.penaltiesMinor > 0 || statement.penaltiesRequestedMinor > 0) {
    const reasons = statement.penalties.map((penalty) => `« ${penalty.reason} »`).join(' · ');
    const capped =
      statement.penaltiesMinor < statement.penaltiesRequestedMinor
        ? `${amountText(statement.penaltiesRequestedMinor, 'EUR')} demandés, plafonnés à ${you ? 'ta' : 'sa'} part plus ${you ? 'tes' : 'ses'} primes : le reste (${amountText(statement.penaltiesRequestedMinor - statement.penaltiesMinor, 'EUR')}) est abandonné, il n’est pas reporté`
        : null;
    const note = [reasons, capped].filter((part) => part !== null && part !== '').join(' · ');
    rows.push({
      label: 'Malus',
      note: note === '' ? null : note,
      amount: signed(-statement.penaltiesMinor),
      kind: 'minus',
    });
  }
  if (statement.carryOversInMinor !== 0)
    rows.push({
      label: 'Report de la quinzaine d’avant',
      note: 'reporté ici, sans avoir été versé',
      amount: signed(statement.carryOversInMinor),
      kind: 'line',
    });
  for (const adjustment of statement.adjustments)
    rows.push({
      label: 'Ajustement',
      note: `« ${adjustment.reason} »`,
      amount: signed(adjustment.amountMinor),
      kind: adjustment.amountMinor < 0 ? 'minus' : 'line',
    });

  const paid = statement.status === 'paid';
  const payLabel =
    payLabelOf ?? (you ? (paid ? 'Ce que tu as touché' : 'Ce que tu touches') : paid ? 'Versé' : 'À verser');
  if (statement.carryOverOutMinor === 0) {
    rows.push({
      label: payLabel,
      note: null,
      amount: amountText(statement.payableMinor, 'EUR'),
      kind: 'total',
    });
    return rows;
  }
  rows.push({ label: 'Total', note: null, amount: amountText(statement.totalMinor, 'EUR'), kind: 'total' });
  rows.push({
    // Carried only once validated: until then, what would go on the next period if it were validated as it is.
    label:
      statement.status === 'draft' ? 'Irait sur la quinzaine suivante' : 'Reporté sur la quinzaine suivante',
    note:
      statement.totalMinor < 0
        ? 'un total sous zéro se reporte'
        : `sous le minimum de versement de ${amountText(statement.rules.minimumPayoutMinor, 'EUR')}`,
    amount: signed(-statement.carryOverOutMinor),
    kind: 'carry',
  });
  rows.push({ label: payLabel, note: null, amount: amountText(statement.payableMinor, 'EUR'), kind: 'pay' });
  return rows;
}

/** What a refusal may need: a member's name by their id, and the statement the gesture was on, when there is one. */
export interface RefusalNames {
  readonly memberName: (memberId: string) => string | null;
  readonly statement?: Pick<CommissionStatement, 'memberId' | 'window'> &
    Partial<Pick<CommissionStatement, 'status'>>;
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** What a refusal of pay says, in the screens' words (EQ-05, « Refus de l'API »). */
export function payRefusalText(refusal: PayRefusal, names: RefusalNames): string {
  if (refusal.kind === 'failed') return 'Le serveur ne répond pas : rien n’a été enregistré.';
  const { details } = refusal;
  const named = PayPeriodSchema.safeParse(details.period);
  const period = named.success ? periodLine(named.data) : null;
  const memberId = details.memberId ?? names.statement?.memberId;
  const member = memberId === undefined ? null : names.memberName(memberId);
  switch (refusal.code) {
    case 'commission_statement_changed_conflict':
      return 'Ce relevé a changé depuis que tu l’as ouvert. Relis la nouvelle version avant de valider.';
    case 'commission_statement_status_conflict':
      // Paying a statement shown validated: only a payment moves it on (the screen reads it again, silent once paid).
      return names.statement?.status === 'validated'
        ? 'Ce relevé n’est plus à payer : il a déjà été marqué payé.'
        : 'Ce relevé n’est pas encore validé.';
    case 'commission_statement_open_conflict':
      return names.statement === undefined
        ? 'La quinzaine n’est pas finie : elle se valide le lendemain de son dernier jour.'
        : `La quinzaine n’est pas finie : elle se valide à partir du ${longDay(opensOn(names.statement.window))}.`;
    case 'commission_statement_order_conflict':
      return period === null
        ? `Un relevé plus ancien ${member === null ? 'de ce membre' : `de ${member}`} attend sa validation.`
        : `Valide d’abord le relevé ${member === null ? '' : `de ${member} `}${period}.`;
    case 'pay_period_order_conflict':
      return period === null
        ? 'Une quinzaine plus ancienne attend sa validation.'
        : `Valide d’abord la quinzaine ${period}.`;
    case 'pay_period_reports_pending_conflict':
      return `${countOf(details.count, 'rapport de la quinzaine attend', 'rapports de la quinzaine attendent')} leur relecture.`;
    case 'pay_period_not_computed_conflict':
      return 'La paie n’a pas encore calculé cette quinzaine : réessaie dans quelques minutes.';
    case 'pay_period_reports_unread_conflict':
      return `${countOf(details.count, 'rapport est', 'rapports sont')} sur des créatrices que tu ne suis pas : le propriétaire valide cette quinzaine.`;
    case 'pay_period_closed_conflict':
      return period === null
        ? 'Cette quinzaine est déjà validée.'
        : `La quinzaine ${period} est déjà validée.`;
    case 'penalty_cancel_conflict':
      return 'Ce malus porte sur des quinzaines toutes validées : passe par un ajustement.';
    case 'exchange_rate_missing_conflict':
      return 'Le taux du dollar de la BCE manque pour la fin de la quinzaine. Il arrive chaque jour ouvré vers 16 h.';
    case 'commission_rate_missing_conflict':
      return `${member ?? 'Un membre'} n’a pas de taux de commission en vigueur.`;
    case 'payroll_own_forbidden':
      return 'Personne ne décide de sa propre paie : un autre s’en charge.';
    case 'payroll_forbidden':
      return 'Seul le propriétaire peut le faire.';
    case 'bonus_conflict':
    case 'penalty_conflict':
    case 'pay_adjustment_conflict':
    case 'bonus_tier_set_conflict':
    case 'collective_goal_conflict':
    case 'payout_minimum_conflict':
      return 'Cette saisie existe déjà avec d’autres valeurs : recharge la page.';
    case 'pay_rule_started_invalid':
      return period === null
        ? 'Cette quinzaine a commencé : une règle de paie part d’une quinzaine qui n’a pas commencé.'
        : `La quinzaine ${period} a commencé : une règle de paie part d’une quinzaine qui n’a pas commencé.`;
    case 'collective_goal_late_invalid':
      return named.success
        ? `L’objectif de la quinzaine ${periodLine(named.data)} se posait au plus tard le ${longDay(collectiveGoalLastDay(named.data))}.`
        : 'L’objectif d’une quinzaine se pose au plus tard son 3e jour.';
    case 'payment_in_future_unprocessable':
      return 'Le paiement ne peut pas être daté après aujourd’hui.';
    case 'payment_before_period_unprocessable':
      return named.success
        ? `Le paiement ne peut pas être daté avant le début de la quinzaine (${longDay(named.data)}).`
        : 'Le paiement ne peut pas être daté avant le début de la quinzaine.';
    case 'payment_amount_unprocessable':
      return details.payableMinor === undefined
        ? 'Le montant envoyé doit être celui à verser.'
        : `Le montant envoyé doit être celui à verser : ${amountText(details.payableMinor, 'EUR')}.`;
    case 'payroll_entries_too_many_unprocessable':
      return 'Trop de saisies sur cette quinzaine pour les lister ici.';
    case 'team_member_not_found':
      return 'Ce membre n’est plus dans l’équipe : la page est relue.';
    case 'commission_statement_not_found':
      return 'Ce relevé n’existe plus : la page est relue.';
    case 'bonus_not_found':
    case 'penalty_not_found':
      return 'Cette saisie n’existe plus : la page est relue.';
    case 'cursor_invalid':
      return 'La liste a changé : elle est relue depuis le début.';
    case 'role_forbidden':
      return 'Ton rôle ne permet pas ce geste.';
    case 'request_invalid':
      return 'Ces valeurs ne conviennent pas : vérifie le formulaire.';
  }
}

const CURRENCY_OF: Readonly<Record<ForeignCurrency, string>> = { USD: 'du dollar' };

/** « Théo », « Théo et Léa », « Théo, Léa et Iris ». */
const namesText = (names: readonly string[]): string =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} et ${names.at(-1) ?? ''}`;

/**
 * What a blocked period says (recette du 28/10, Équipe G1): what stops pay from computing it, what lifts it, and that
 * the figures shown are those of its last computation that passed, out of date. Only the owner sets a rate: anyone
 * else is told who does. `since` in the agency's zone, when it is known.
 */
export function blockedText(
  block: PayPeriodBlock,
  reader: { readonly owner: boolean; readonly memberName: (memberId: string) => string },
  zone: string | null,
): { readonly title: string; readonly text: string } {
  const since = zone === null ? '' : ` Bloqué depuis le ${momentAt(block.since, zone)}.`;
  const stale =
    'D’ici là, les chiffres ci-dessous sont ceux du dernier calcul réussi : ils ne sont plus à jour.';
  if (block.code === 'exchange_rate_missing_conflict')
    return {
      title: `Le calcul est bloqué : le taux ${CURRENCY_OF[block.currency]} de la BCE manque pour cette quinzaine.`,
      text: `Il arrive chaque jour ouvré vers 16 h, et le calcul reprendra seul ; s’il tarde plus de deux jours ouvrés, une alerte le dit. ${stale}${since}`,
    };
  // Since #290 a member's first rate starts on arrival and nothing is planned before it: only rows written before that
  // fix land here. No gesture of the screen lifts them (a validated report never changes, a rate never goes back).
  const names = block.memberIds.map((id) => reader.memberName(id));
  const many = names.length > 1;
  const who =
    names.length === 0 ? 'un membre de l’équipe n’a' : `${namesText(names)} ${many ? 'n’ont' : 'n’a'}`;
  const reports =
    names.length === 0
      ? 'Un rapport validé d’un membre tombe sur une quinzaine où son taux n’a pas encore commencé.'
      : many
        ? `Des rapports validés de ${namesText(names)} tombent sur une quinzaine où leur taux n’a pas encore commencé.`
        : `Un rapport validé de ${names[0] ?? ''} tombe sur une quinzaine où son taux n’a pas encore commencé.`;
  return {
    title: `Le calcul est bloqué : ${who} pas de taux pour cette quinzaine.`,
    text: `${reports} ${
      reader.owner
        ? 'C’est une donnée d’avant le correctif du 28/10, qui ne peut plus se produire. Aucun geste de l’écran ne la corrige, puisqu’un rapport validé ne change pas et qu’un taux ne part jamais en arrière : elle se corrige dans la base, puis le calcul reprend seul.'
        : 'Le propriétaire est prévenu ; le calcul reprendra seul une fois la donnée corrigée.'
    } ${stale}${since}`,
  };
}

/**
 * What a member reads of a blocked period on Commissions, in the second person: their statement is out of date, the
 * owner is told, and what lifts it. Never a colleague's name: the server gives a member only themselves among the
 * members without a rate, so a list that is not empty is theirs.
 */
export function myBlockedText(
  block: PayPeriodBlock,
  hasStatement = true,
): { readonly title: string; readonly text: string } {
  const stale = hasStatement ? 'Le montant ci-dessous est celui du dernier calcul réussi.' : '';
  const title = hasStatement
    ? 'Ton relevé n’est plus à jour : le calcul de la quinzaine est bloqué.'
    : 'Ton relevé n’est pas encore calculé : le calcul de la quinzaine est bloqué.';
  if (block.code === 'exchange_rate_missing_conflict')
    return {
      title,
      text: `Le taux ${CURRENCY_OF[block.currency]} de la BCE manque pour cette quinzaine ; le calcul reprendra seul dès qu’il arrive. ${stale}`.trimEnd(),
    };
  const who =
    block.memberIds.length > 0
      ? 'Un de tes rapports validés tombe sur une quinzaine où ton taux n’a pas encore commencé.'
      : 'Il manque un taux de commission dans l’équipe pour cette quinzaine.';
  return {
    title,
    text: `${who} Le propriétaire est prévenu dans sa paie ; le calcul reprendra seul une fois réglé. ${stale}`.trimEnd(),
  };
}

const countOf = (count: number | undefined, one: string, many: string): string =>
  count === undefined ? `Des ${lowerFirst(many)}` : `${String(count)} ${count > 1 ? many : one}`;

/** The rows of a period's statements as a spreadsheet reads them, `;` between cells, as French spreadsheets expect. */
export function statementsCsv(
  period: PayrollPeriod,
  memberName: (memberId: string) => string,
  accountName: (platformAccountId: string) => string,
): string {
  const euros = (minor: number): string => (minor / 100).toFixed(2).replace('.', ',');
  // A name typed in Nirvana is never read as a formula by the spreadsheet that opens the file: a leading `=`, `+`, `-`,
  // `@`, tab or carriage return gets a `'` (OWASP, CSV injection). Amounts are written here, their minus sign kept.
  const words = (text: string): string => (/^[=+\-@\t\r]/u.test(text) ? `'${text}` : text);
  const cell = (text: string): string => (/[";\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
  const rows: string[][] = [
    [
      'Membre',
      'Compte',
      'Devise',
      'Ventes',
      'Ventes en euros',
      'Hors TVA',
      'Net',
      'Commission',
      'Primes',
      'Malus',
      'Reports reçus',
      'Ajustements',
      'Total',
      'Reporté',
      'À verser',
      'Statut',
    ],
  ];
  const STATUS = { draft: 'À valider', validated: 'Validé', paid: 'Payé' } as const;
  for (const statement of period.statements) {
    const name = words(memberName(statement.memberId));
    for (const line of statement.lines)
      rows.push([
        name,
        words(accountName(line.platformAccountId)),
        line.currency,
        euros(line.grossMinor),
        euros(line.grossEurMinor),
        euros(line.exclVatMinor),
        euros(line.netMinor),
        euros(line.commissionMinor),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
    rows.push([
      name,
      'Total du relevé',
      'EUR',
      '',
      '',
      '',
      euros(statement.netMinor),
      euros(statement.commissionMinor),
      euros(statement.bonusesMinor),
      euros(-statement.penaltiesMinor),
      euros(statement.carryOversInMinor),
      euros(statement.adjustmentsMinor),
      euros(statement.totalMinor),
      euros(statement.carryOverOutMinor),
      euros(statement.payableMinor),
      STATUS[statement.status],
    ]);
  }
  return `${rows.map((row) => row.map(cell).join(';')).join('\r\n')}\r\n`;
}

/**
 * Paie's address: the period Quinzaine shows when one was chosen, from Historique or its arrows, and the member whose
 * statement opens on it, from his record in Équipe (EQ-11).
 */
export interface PaySearch {
  readonly quinzaine?: PayPeriod;
  readonly membre?: string;
}

/** Anything else in the address is ignored: a broken link opens the period to validate, or the one under way. */
export function parsePaySearch(search: Record<string, unknown>): PaySearch {
  const parsed = PayPeriodSchema.safeParse(search['quinzaine']);
  return { ...(parsed.success ? { quinzaine: parsed.data } : {}), ...memberOf(search) };
}

/**
 * The period Quinzaine opens on: the oldest of the first page that has ended with something left to do — a statement
 * to validate, or for the owner money still to send — since periods close in order (ADR 0032); otherwise the one
 * under way.
 */
export function periodToOpen(
  summaries: readonly Pick<
    PayPeriodSummary,
    'window' | 'ended' | 'statements' | 'payableMinor' | 'paidMinor'
  >[],
  current: PayPeriod,
  paying: boolean,
): PayPeriod {
  const waiting = summaries.filter(
    (summary) =>
      summary.ended && (summary.statements.draft > 0 || (paying && summary.payableMinor > summary.paidMinor)),
  );
  return waiting.at(-1)?.window.period ?? current;
}

/**
 * How old a rate may be on a period's last day for its closing to freeze it, as the server checks it
 * (`assertFreshRates`): a hint for the notice, the server's refusal stays the rule.
 */
const RATE_MAX_AGE_DAYS = 4;

/**
 * Whether the dollar's rate is missing to close `period`: it has ended, is not closed yet, counts sales in dollars,
 * and no rate read on its last day or the four before is known, from its drafts or from the latest the job read.
 */
export function rateMissing(period: PayrollPeriod, latest: ExchangeRate | null): boolean {
  if (!period.ended || period.closing !== null) return false;
  if (!period.statements.some((statement) => statement.lines.some((line) => line.currency !== 'EUR')))
    return false;
  const lastDay = payPeriodLastDay(period.period);
  const known = [
    ...period.statements.flatMap((statement) => statement.rules.exchangeRates),
    ...(latest === null ? [] : [latest]),
  ].filter((rate) => rate.day <= lastDay);
  const freshest = known.reduce<string | null>(
    (day, rate) => (day === null || rate.day > day ? rate.day : day),
    null,
  );
  return freshest === null || daysFrom(freshest, lastDay) > RATE_MAX_AGE_DAYS;
}

/**
 * The working days (Monday to Friday) strictly between the day of the last rate read and `today`: the rates that should
 * have come since and did not. Today's is not counted, it may come at 16 h.
 */
export function missedRateDays(lastRead: string, today: string): number {
  let missed = 0;
  for (let day = new Date(`${lastRead}T12:00:00Z`); ;) {
    day = new Date(day.getTime() + DAY_MS);
    if (day.toISOString().slice(0, 10) >= today) return missed;
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) missed += 1;
  }
}

/**
 * The rate is overdue after more than two working days without one, as the server says (`isRateOverdue`, payroll
 * domain, `exchange_rate_overdue`): the ECB may stay shut two working days in a row (Good Friday, Easter Monday).
 */
export const rateOverdue = (lastRead: string, today: string): boolean => missedRateDays(lastRead, today) > 2;

/** The refusals that concern the whole period: the validation of the others stops there, the notice says it. */
const PERIOD_REFUSALS: ReadonlySet<PayRefusalCode> = new Set<PayRefusalCode>([
  'pay_period_reports_pending_conflict',
  'pay_period_reports_unread_conflict',
  'pay_period_order_conflict',
  'pay_period_closed_conflict',
  'exchange_rate_missing_conflict',
  'commission_statement_open_conflict',
  'payroll_forbidden',
  'role_forbidden',
]);

/** Whether a refusal stops a batch of validations: one of the period's, or a server that does not answer. */
export const stopsThePeriod = (refusal: PayRefusal): boolean =>
  refusal.kind === 'failed' || PERIOD_REFUSALS.has(refusal.code);

/** The statements a reader may validate now, in the order given: drafts of an ended period, never their own. */
export const validatable = (period: Pick<PayrollPeriod, 'ended' | 'statements'>): CommissionStatement[] =>
  period.ended
    ? period.statements.filter((statement) => statement.status === 'draft' && statement.canValidate)
    : [];

/** What a member's row says after their net: their rate or team share, their tier, their penalty. */
export function memberFacts(statement: CommissionStatement): string[] {
  const facts = [`commission ${percentText(statement.rules.commissionRateBps)}`];
  if (statement.teamShare !== null) facts.push(`part d’équipe ${percentText(statement.teamShare.bps)}`);
  if (statement.tierBonus !== null) facts.push(`palier ${statement.tierBonus.label}`);
  if (statement.penaltiesMinor > 0) facts.push(`malus ${signedAmountText(-statement.penaltiesMinor, 'EUR')}`);
  return facts;
}

/**
 * Said after a positive carry-over that is the second in a row, or nothing: the next period pays that amount, under
 * the minimum too, so that the invoice it waits for is paid before its due date (ADR 0038). In the mood of the
 * sentence before: done once validated, certain once the period has ended, conditional while it runs.
 */
function secondCarry(statement: CommissionStatement, ended: boolean): string {
  if (statement.carryOverOutMinor <= 0) return '';
  if (carryOverRank(statement.carryOversIn, statement.carryOverOutMinor) !== CARRY_OVER_RANK_MAX) return '';
  if (statement.status !== 'draft')
    return ' Deuxième report de suite : la quinzaine suivante versera ce montant, même sous le minimum.';
  return ended
    ? ' Ce sera le deuxième report de suite : la quinzaine suivante versera ce montant, même sous le minimum.'
    : ' Ce serait le deuxième report de suite : la quinzaine suivante verserait ce montant, même sous le minimum.';
}

/**
 * Why a total under the minimum is paid, or `null`: the amount coming in was carried twice in a row already (ADR
 * 0038). Without this sentence, a payment under the minimum would read as a mistake. A member's final statement pays
 * everything because they leave (EQ-14), not for this reason: it gets none. Before its validation the payment is
 * certain all the same (over the minimum, it is paid anyway), hence the future.
 */
function paidAfterTwoCarries(statement: CommissionStatement, ended: boolean): string | null {
  const { totalMinor, rules } = statement;
  if (rules.final || totalMinor <= 0 || totalMinor >= rules.minimumPayoutMinor) return null;
  if (positiveCarryRankIn(statement.carryOversIn) < CARRY_OVER_RANK_MAX) return null;
  const draft = statement.status === 'draft';
  const soFar = draft && !ended ? ' à ce jour' : '';
  return `Sous le minimum de ${amountText(rules.minimumPayoutMinor, 'EUR')}${soFar}, mais le montant qui entre a déjà été reporté deux fois : la quinzaine ${draft ? 'versera' : 'verse'} tout quand même, pour que la facture qui attend soit payée avant son échéance.`;
}

/**
 * The sentence of a statement that carries its total over, or pays it under the minimum after two carry-overs, or
 * `null`: said as done once validated, as what would happen before — so far while the period runs, at its validation
 * once it has ended.
 */
export function carryLine(statement: CommissionStatement, ended: boolean): string | null {
  if (statement.carryOverOutMinor === 0) return paidAfterTwoCarries(statement, ended);
  const second = secondCarry(statement, ended);
  if (statement.status === 'draft') {
    const soFar = ended ? '' : ' à ce jour';
    const when = ended
      ? 'iront sur la quinzaine suivante une fois le relevé validé'
      : 'iraient sur la quinzaine suivante, si la quinzaine finit ainsi';
    return statement.totalMinor < 0
      ? `Total sous zéro${soFar} : ${signedAmountText(statement.carryOverOutMinor, 'EUR')} ${when}.`
      : `Sous le minimum de ${amountText(statement.rules.minimumPayoutMinor, 'EUR')}${soFar} : ${amountText(statement.carryOverOutMinor, 'EUR')} ${when}.${second}`;
  }
  if (statement.totalMinor < 0)
    return `Total sous zéro : ${signedAmountText(statement.carryOverOutMinor, 'EUR')} reportés sur la quinzaine suivante.`;
  return `Sous le minimum de ${amountText(statement.rules.minimumPayoutMinor, 'EUR')} : ${amountText(statement.carryOverOutMinor, 'EUR')} reportés sur la quinzaine suivante.${second}`;
}

/** One part of a split: a name, its net, and its share of the whole in basis points. */
export interface Share {
  readonly name: string;
  readonly minor: number;
  readonly bps: number;
}

/** The parts a split shows at most, as many as it has colours (docs/design, « Couleur »): past them, « Autres ». */
export const SPLIT_PARTS = 4;

/**
 * A period's net split by `keyOf` (a creator, a platform), the largest first, at most `SPLIT_PARTS` parts, the
 * smallest gathered in « Autres »; nothing when there is no net.
 */
export function salesSplit(
  statements: readonly CommissionStatement[],
  keyOf: (line: CommissionStatementLine) => string,
): Share[] {
  const sums = new Map<string, number>();
  for (const line of statements.flatMap((statement) => statement.lines))
    sums.set(keyOf(line), (sums.get(keyOf(line)) ?? 0) + line.netMinor);
  const total = [...sums.values()].reduce((sum, minor) => sum + Math.max(minor, 0), 0);
  if (total <= 0) return [];
  const shares = [...sums]
    .filter(([, minor]) => minor > 0)
    .map(([name, minor]) => ({ name, minor, bps: Math.round((minor * 10_000) / total) }))
    .toSorted((a, b) => b.minor - a.minor || a.name.localeCompare(b.name, 'fr'));
  if (shares.length <= SPLIT_PARTS) return shares;
  const rest = shares.slice(SPLIT_PARTS - 1);
  const minor = rest.reduce((sum, share) => sum + share.minor, 0);
  return [
    ...shares.slice(0, SPLIT_PARTS - 1),
    { name: 'Autres', minor, bps: Math.round((minor * 10_000) / total) },
  ];
}

/** How far the team's net is towards its target, in basis points, floored as the engine floors it. */
export const reachedBpsOf = (netMinor: number, targetMinor: number): number =>
  Math.max(0, Math.floor((netMinor * 10_000) / targetMinor));

/** The highest tier a reached share gives, or `null`. */
export function tierAt(tiers: readonly CollectiveTier[], reachedBps: number): CollectiveTier | null {
  return tiers.reduce<CollectiveTier | null>(
    (best, tier) =>
      tier.reachedBps <= reachedBps && (best === null || tier.reachedBps > best.reachedBps) ? tier : best,
    null,
  );
}

/** The span of a goal's gauge: past its highest tier, so the last tier is never at the very end. */
export const goalSpanBps = (goal: Pick<CollectiveGoal, 'tiers'>): number =>
  Math.max(13_000, ...goal.tiers.map((tier) => tier.reachedBps + 2_000));

/** A share of the gauge's span, in percent for CSS, capped at its end. */
export const gaugePercent = (bps: number, spanBps: number): number =>
  Math.round(Math.min(Math.max(bps / spanBps, 0), 1) * 1_000) / 10;

/** « 3f9c…a41e »: a statement's fingerprint, short. */
export const shortHash = (hash: string): string => `${hash.slice(0, 4)}…${hash.slice(-4)}`;

/** What an entry of Primes et malus is, in the screens' words: never « sanction ». */
export type EntryKind = 'bonus' | 'fixed' | 'percent' | 'adjustment';
export const ENTRY_KIND_LABELS: Readonly<Record<EntryKind, string>> = {
  bonus: 'Prime',
  fixed: 'Malus',
  percent: 'Malus en pourcentage',
  adjustment: 'Ajustement',
};

/** An entry of a period as Primes et malus lists it, whatever its kind. */
export interface EntryRow {
  readonly id: string;
  readonly kind: EntryKind;
  readonly memberId: string;
  /** Its amount with its sign: « +30,00 € », « −15,00 € », « −10 % ». */
  readonly amount: string;
  readonly reason: string;
  readonly createdBy: string | null;
  readonly createdAt: string;
  /** Struck through: it does not count in this period (cancelled, or a penalty cancelled from here or before). */
  readonly struck: boolean;
  readonly cancellation: {
    readonly at: string;
    readonly by: string | null;
    /** A penalty's: the first period it stopped counting in. */
    readonly from: PayPeriod | null;
  } | null;
  /** A penalty over several periods: its first and last. */
  readonly span: { readonly from: PayPeriod; readonly to: PayPeriod } | null;
  /** The statement an adjustment corrects. */
  readonly corrects: string | null;
  /** A bonus or a penalty nobody cancelled: it may be, while a period it counts in is open. */
  readonly cancellable: boolean;
}

/** A period's entries as one list, the newest first, as the server gives each kind. */
export function entryRows(entries: PayrollEntries): EntryRow[] {
  const bonuses = entries.bonuses.map((bonus): EntryRow => ({
    id: bonus.id,
    kind: 'bonus',
    memberId: bonus.memberId,
    amount: signedAmountText(bonus.amountMinor, 'EUR'),
    reason: bonus.reason,
    createdBy: bonus.createdBy,
    createdAt: bonus.createdAt,
    struck: bonus.cancellation !== null,
    cancellation:
      bonus.cancellation === null
        ? null
        : { at: bonus.cancellation.cancelledAt, by: bonus.cancellation.cancelledBy, from: null },
    span: null,
    corrects: null,
    cancellable: bonus.cancellation === null,
  }));
  const penalties = entries.penalties.map((penalty): EntryRow => ({
    id: penalty.id,
    kind: penalty.amount.kind,
    memberId: penalty.memberId,
    amount:
      penalty.amount.kind === 'fixed'
        ? signedAmountText(-penalty.amount.amountMinor, 'EUR')
        : signedPercentText(-penalty.amount.bps),
    reason: penalty.reason,
    createdBy: penalty.createdBy,
    createdAt: penalty.createdAt,
    struck: !penaltyApplies(penalty, entries.period),
    cancellation:
      penalty.cancellation === null
        ? null
        : {
            at: penalty.cancellation.cancelledAt,
            by: penalty.cancellation.cancelledBy,
            from: penalty.cancellation.cancelledFrom,
          },
    span: penalty.fromPeriod === penalty.toPeriod ? null : { from: penalty.fromPeriod, to: penalty.toPeriod },
    corrects: null,
    cancellable: penalty.cancellation === null,
  }));
  const adjustments = entries.adjustments.map((adjustment): EntryRow => ({
    id: adjustment.id,
    kind: 'adjustment',
    memberId: adjustment.memberId,
    amount: signedAmountText(adjustment.amountMinor, 'EUR'),
    reason: adjustment.reason,
    createdBy: adjustment.createdBy,
    createdAt: adjustment.createdAt,
    struck: false,
    cancellation: null,
    span: null,
    corrects: adjustment.correctsStatementId,
    cancellable: false,
  }));
  return [...bonuses, ...penalties, ...adjustments].toSorted((a, b) =>
    a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt),
  );
}

/**
 * What a penalty really takes in the period, read in the member's statement of it: « de son net, soit −100,00 € » for
 * a percent, « retenu −23,34 € (plafonné) » when the cap let less through. A statement sums its penalties: an amount
 * is said for one only when it is the statement's only penalty; `null` when there is nothing more to say.
 */
export function penaltyTaken(
  row: Pick<EntryRow, 'id' | 'kind' | 'struck'>,
  statement:
    | {
        readonly penalties: readonly { readonly id: string }[];
        readonly penaltiesMinor: number;
        readonly penaltiesRequestedMinor: number;
      }
    | undefined,
): string | null {
  if ((row.kind !== 'fixed' && row.kind !== 'percent') || row.struck) return null;
  const only = statement?.penalties.length === 1 && statement.penalties[0]?.id === row.id;
  const parts: string[] = [];
  if (row.kind === 'percent')
    parts.push(
      only ? `de son net, soit ${signedAmountText(-statement.penaltiesRequestedMinor, 'EUR')}` : 'de son net',
    );
  if (statement !== undefined && statement.penaltiesMinor < statement.penaltiesRequestedMinor)
    parts.push(
      only
        ? `retenu ${signedAmountText(-statement.penaltiesMinor, 'EUR')} (plafonné)`
        : `malus plafonnés : ${signedAmountText(-statement.penaltiesMinor, 'EUR')} retenus en tout`,
    );
  return parts.length === 0 ? null : parts.join(' · ');
}

/** « 1er nov. », « 15 déc. »: a day of a span of periods. */
export function dayShortMonth(day: string): string {
  return withFirstOfMonth(DAY_SHORT_MONTH.formatToParts(new Date(`${day}T12:00:00Z`)));
}

/** The periods from `from` to `to`, both included. */
export function periodsBetween(from: PayPeriod, to: PayPeriod): PayPeriod[] {
  const periods: PayPeriod[] = [];
  for (let period = from; period <= to; period = followingPeriod(period)) periods.push(period);
  return periods;
}

/** « sur 3 quinzaines, du 1er nov. au 15 déc. »: a penalty over several periods. */
export const spanText = (span: { readonly from: PayPeriod; readonly to: PayPeriod }): string =>
  `sur ${String(periodsBetween(span.from, span.to).length)} quinzaines, du ${dayShortMonth(span.from)} au ${dayShortMonth(payPeriodLastDay(span.to))}`;

/** Who made an entry and when, or who cancelled it: « par Charles le lun. 9 nov. », « annulé par Charles le … ». */
export function entryByText(
  row: Pick<EntryRow, 'createdBy' | 'createdAt' | 'cancellation'>,
  period: PayPeriod,
  who: (userId: string) => string,
  timeZone: string,
): string {
  const by = (userId: string | null): string => (userId === null ? '' : ` par ${who(userId)}`);
  const made = `${by(row.createdBy).trim()} le ${dayAt(row.createdAt, timeZone)}`;
  const { cancellation } = row;
  if (cancellation === null) return made;
  const cancelled = `annulé${by(cancellation.by)} le ${dayAt(cancellation.at, timeZone)}`;
  if (cancellation.from !== null && cancellation.from > period)
    return `${made} · ${cancelled}, à partir de la quinzaine ${periodLine(cancellation.from)} : il compte encore ici`;
  return cancelled;
}

/**
 * The periods `GET /v1/payroll/periods` says hold drafts before the team's first open one: where a member's next
 * statement to validate may be. The rest of the first page is enough: periods close in order (ADR 0032).
 */
export function draftPeriodsBefore(
  summaries: readonly Pick<PayPeriodSummary, 'window' | 'closedAt' | 'statements'>[],
  current: PayPeriod,
): { readonly teamFirstOpen: PayPeriod; readonly drafts: readonly PayPeriod[] } {
  const lastClosed = summaries.find((summary) => summary.closedAt !== null)?.window.period ?? null;
  const teamFirstOpen = lastClosed === null ? current : followingPeriod(lastClosed);
  const drafts = summaries
    .filter((summary) => summary.statements.draft > 0 && summary.window.period < teamFirstOpen)
    .map((summary) => summary.window.period)
    .toSorted();
  return { teamFirstOpen, drafts };
}

/**
 * The member's first period open to an entry, as the server chooses it for an adjustment (`adjustmentPeriod`): their
 * earliest draft before the team's first open period, or else that one; never before they joined, nor at or before
 * `after` (a statement of theirs already validated). `undefined` while a period it needs is still being read.
 */
export function firstOpenPeriod({
  memberId,
  joinedOn,
  after,
  teamFirstOpen,
  drafts,
  read,
}: {
  memberId: string;
  joinedOn: string;
  after: PayPeriod | null;
  teamFirstOpen: PayPeriod;
  drafts: readonly PayPeriod[];
  read: (period: PayPeriod) => Pick<PayrollPeriod, 'statements'> | undefined;
}): PayPeriod | undefined {
  let found = teamFirstOpen;
  for (const period of drafts) {
    if (after !== null && period <= after) continue;
    const data = read(period);
    if (data === undefined) return undefined;
    if (data.statements.some((one) => one.memberId === memberId && one.status === 'draft')) {
      found = period;
      break;
    }
  }
  const floors = [payPeriodOfDay(joinedOn), ...(after === null ? [] : [followingPeriod(after)])];
  return floors.reduce((latest, floor) => (floor > latest ? floor : latest), found);
}

/** A target typed in euros: up to the ceiling of a goal or a tier, not the slip guard of an entry. */
export const parseTarget = (text: string): number | null => parseAmount(text, false, PAY_TARGET_MAX_MINOR);

/** A goal's tiers in their order, the lowest first. */
export const goalTiersInOrder = (tiers: readonly CollectiveTier[]): CollectiveTier[] =>
  tiers.toSorted((a, b) => a.reachedBps - b.reachedBps);

/** Individual tiers in their order, the lowest threshold first. */
export const bonusTiersInOrder = (tiers: readonly BonusTier[]): BonusTier[] =>
  tiers.toSorted((a, b) => a.thresholdMinor - b.thresholdMinor);

/** The team's net in a period: the sum of its members' nets, managers' sales included. */
export const teamNetOf = (statements: readonly Pick<CommissionStatement, 'netMinor'>[]): number =>
  statements.reduce((sum, one) => sum + one.netMinor, 0);

/**
 * How far the team is towards the period's goal, in basis points: as the engine saw it in the statements (frozen once
 * the period is closed), else from the team's net.
 */
export function goalReachedBps(
  period: Pick<PayrollPeriod, 'statements'>,
  goal: Pick<CollectiveGoal, 'targetMinor'>,
): number {
  const seen = period.statements.map((one) => one.team?.collective ?? null).find((one) => one !== null);
  return seen?.reachedBps ?? reachedBpsOf(teamNetOf(period.statements), goal.targetMinor);
}

const WHOLE_EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  signDisplay: 'exceptZero',
  maximumFractionDigits: 0,
});

/** « +10 € », « +12,50 € »: a tier's bonus under the gauge, without cents when it has none. */
export const tickAmountText = (minor: number): string =>
  minor % 100 === 0 ? WHOLE_EUROS.format(minor / 100).replace('-', '−') : signedAmountText(minor, 'EUR');

/** A period as its member reads it in Commissions: their words, never the agency's « à valider ». */
export function memberPhaseChip(summary: Omit<PayPeriodSummary, 'window'>): PayChip {
  if (summary.blocked !== null) return { label: 'Plus à jour', tone: 'warn' };
  switch (phaseOf(summary)) {
    case 'running':
      return { label: 'En cours', tone: 'neutral' };
    case 'to_validate':
      return { label: 'En validation', tone: 'wait' };
    case 'to_pay':
      // Validated, the money not sent yet: the tone of waiting, as on Quinzaine's rows (statementStage).
      return { label: 'Validé', tone: 'wait' };
    case 'paid':
      // Validated with nothing to send: the total went on the next period.
      return summary.paidMinor === 0 && summary.statements.carried > 0
        ? { label: 'Reporté', tone: 'warn' }
        : { label: 'Payé', tone: 'ok' };
  }
}

/** The one amount of a period in « Mes relevés »: what was paid, or what is still to come. */
export function memberPeriodAmount(summary: Omit<PayPeriodSummary, 'window'>): {
  minor: number;
  what: string;
} {
  if (summary.blocked !== null)
    return { minor: summary.payableMinor - summary.paidMinor, what: 'au dernier calcul' };
  switch (phaseOf(summary)) {
    case 'running':
      return { minor: summary.payableMinor, what: 'à ce jour' };
    case 'to_validate':
      // Not validated yet, so not owed: what the period would pay, as Quinzaine says it (« à verser une fois validé »).
      return {
        minor: summary.payableMinor - summary.validatedPayableMinor,
        what: 'à toucher une fois validé',
      };
    case 'to_pay':
      return { minor: summary.validatedPayableMinor - summary.paidMinor, what: 'à toucher' };
    case 'paid':
      return { minor: summary.paidMinor, what: 'touché' };
  }
}

/**
 * The period Commissions opens on: the oldest that has ended with money still to come, then the one under way once
 * it has a statement, else the last one ended, paid, so that a new period starts on what the last one brought.
 */
export function heroPeriodOf(
  summaries: readonly Pick<
    PayPeriodSummary,
    'window' | 'ended' | 'statements' | 'payableMinor' | 'paidMinor'
  >[],
  current: PayPeriod,
): PayPeriod {
  const waiting = periodToOpen(summaries, current, true);
  if (waiting !== current || summaries.some((summary) => summary.window.period === current)) return waiting;
  return summaries.find((summary) => summary.ended)?.window.period ?? current;
}

/** What a member's statement says of itself: its stage beside the chip, what the amount is, and how it came. */
export interface MyStatementWords {
  readonly since: string;
  readonly label: string;
  readonly notes: readonly string[];
}

/**
 * How a statement was paid, as a sentence goes on: « Payé le 17 novembre par WorldRemit » (a closed list,
 * `PAYMENT_METHODS`: the chatters are paid by WorldRemit only).
 */
export const PAID_BY: Readonly<Record<PaymentMethod, string>> = {
  worldremit: ' par WorldRemit',
};

/**
 * The words around a member's own statement: computed, being validated, validated or paid, in the second person and
 * in the past once paid. Never a date of payment to come: the agency pays after it validates.
 */
export function myStatementWords(
  statement: CommissionStatement,
  ended: boolean,
  now: Date,
  /** PAIE-32: the usual delay the owner announced, `null` when none. */
  payoutDelayBusinessDays: number | null = null,
): MyStatementWords {
  const zone = statement.window.timeZone;
  const delay =
    payoutDelayBusinessDays === null
      ? null
      : `En général, le versement part ${payoutDelayText(payoutDelayBusinessDays)}.`;
  const carry = myCarryLine(statement, ended);
  const withCarry = (notes: string[]): string[] => (carry === null ? notes : [...notes, carry]);
  const { payment } = statement;
  if (payment !== null)
    return {
      since: `le ${dayMonthText(payment.paidOn)}`,
      label: 'Ce que tu as touché',
      notes: withCarry([
        `Payé le ${longDay(payment.paidOn)}${PAID_BY[payment.method]}${payment.reference === null ? '' : `, référence ${payment.reference}`}.`,
      ]),
    };
  if (statement.validatedAt !== null)
    return {
      since: `le ${dayAt(statement.validatedAt, zone)}`,
      label: statement.payableMinor === 0 ? 'Ce que tu touches' : 'Ce que tu vas toucher',
      notes: withCarry([
        statement.payableMinor === 0
          ? `Validé le ${momentAt(statement.validatedAt, zone)}.`
          : `Validé le ${momentAt(statement.validatedAt, zone)}. ${delay ?? 'Le versement suit.'}`,
      ]),
    };
  const computed = computedText(statement.computedAt, zone, now);
  if (!ended)
    return {
      since: `validation par l’agence à partir du ${dayMonthText(opensOn(statement.window))}`,
      label: 'Ce que tu touches à ce jour',
      notes: withCarry([
        `Calculé ${computed} sur tes rapports validés. ${delay ?? 'Le versement suit la validation de la quinzaine.'}`,
      ]),
    };
  return {
    since: `depuis le ${dayMonthText(opensOn(statement.window))}`,
    label: 'Ce que tu vas toucher',
    notes: withCarry([
      `Calculé ${computed} sur tes rapports validés. L’agence valide, puis le versement suit${
        payoutDelayBusinessDays === null ? '' : `, en général ${payoutDelayText(payoutDelayBusinessDays)}`
      }.`,
    ]),
  };
}

/** A member's carry-over, said as what it is while the period runs: what would go on the next one if it ended now. */
function myCarryLine(statement: CommissionStatement, ended: boolean): string | null {
  if (ended || statement.carryOverOutMinor === 0) return carryLine(statement, ended);
  if (statement.totalMinor < 0)
    return `Ton total est sous zéro à ce jour : si la quinzaine finit ainsi, ${signedAmountText(statement.carryOverOutMinor, 'EUR')} iront sur la suivante.`;
  return `Sous le minimum de ${amountText(statement.rules.minimumPayoutMinor, 'EUR')} à ce jour : si la quinzaine finit ainsi, ${amountText(statement.carryOverOutMinor, 'EUR')} iront sur la suivante.${secondCarry(statement, ended)}`;
}

/** Where a net stands among the tiers: the highest reached, its threshold included, and the next one. */
export function tierProgress(
  netMinor: number,
  tiers: readonly BonusTier[],
): { readonly reached: BonusTier | null; readonly next: BonusTier | null } {
  const ordered = bonusTiersInOrder(tiers);
  return {
    reached: ordered.findLast((tier) => tier.thresholdMinor <= netMinor) ?? null,
    next: ordered.find((tier) => tier.thresholdMinor > netMinor) ?? null,
  };
}

/** The account that brings a statement the most net: the one its member's sales go through the most. */
export const mainLine = (lines: readonly CommissionStatementLine[]): CommissionStatementLine | null =>
  lines.reduce<CommissionStatementLine | null>(
    (best, line) => (best === null || line.netMinor > best.netMinor ? line : best),
    null,
  );

/**
 * The sales, in the account's currency, that bring `netMinor` more of net on `line`'s account: back through the
 * platform's fee, the VAT and the rate, rounded up to the unit. A guide for the member, never a figure pay uses.
 */
export function salesFor(
  netMinor: number,
  line: Pick<CommissionStatementLine, 'vatBps' | 'platformFeeBps' | 'rateMicros'>,
): number {
  const keep = 10_000 - line.platformFeeBps;
  if (netMinor <= 0 || keep <= 0) return 0;
  const euros = (netMinor * (10_000 + line.vatBps)) / keep;
  return Math.ceil((euros * 1_000_000) / line.rateMicros / 100) * 100;
}

/** « 330 € », « 1 234,50 € »: an amount without its cents when it has none. */
export const roundAmountText = (minor: number, currency: Currency): string =>
  minor % 100 === 0 ? amountText(minor, currency).replace(/,00(?=\s)/u, '') : amountText(minor, currency);

/**
 * The periods a team rule (tiers, the payout minimum) may start with (PAIE-22): not begun on `today` in the agency's
 * zone, today's own only on its first day, as a commission rate; `count` of them in order.
 */
export function rulePeriods(today: string, count: number): PayPeriod[] {
  const current = payPeriodOfDay(today);
  const periods: PayPeriod[] = [];
  for (
    let one = payPeriodNotBegun(current, today) ? current : nextPayPeriod(current);
    periods.length < count;
    one = nextPayPeriod(one)
  )
    periods.push(one);
  return periods;
}

/** « 3 jours ouvrés après la validation » (PAIE-32): the delay the owner announced, in words. */
export function payoutDelayText(businessDays: number): string {
  return `${String(businessDays)} jour${businessDays > 1 ? 's' : ''} ouvré${businessDays > 1 ? 's' : ''} après la validation`;
}
