import {
  BonusIdSchema,
  CarryOverIdSchema,
  CommissionStatementIdSchema,
  newId,
  PayAdjustmentIdSchema,
  PayPeriodSchema,
  PayrollEntriesSchema,
  PenaltyIdSchema,
  PlatformAccountIdSchema,
  ShiftReportIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type CarryOver,
  type CommissionStatement,
  type CommissionStatementLine,
  type PayPeriod,
  type PayPeriodSummary,
  type PayrollPeriod,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  amountWhat,
  blockedText,
  carryLine,
  carryWhat,
  changeBps,
  computedText,
  countsLine,
  dayMonthText,
  dayShortMonth,
  draftPeriodsBefore,
  entryByText,
  entryRows,
  fcfaText,
  firstOpenPeriod,
  flowOf,
  forecastNet,
  gaugePercent,
  goalReachedBps,
  goalSpanBps,
  heroPeriodOf,
  lateNetOf,
  mainLine,
  memberFacts,
  memberPeriodAmount,
  memberPhaseChip,
  missedRateDays,
  rateOverdue,
  myBlockedText,
  myStatementWords,
  parsePaySearch,
  parseTarget,
  payRefusalText,
  payoutDelayText,
  penaltyTaken,
  periodAmount,
  periodToOpen,
  phaseChip,
  rateMissing,
  rateText,
  reachedBpsOf,
  roundAmountText,
  rulePeriods,
  rowChips,
  salesFor,
  salesSplit,
  sameStageOf,
  signedPercentText,
  spanText,
  statementChips,
  statementsCsv,
  stopsThePeriod,
  summaryOf,
  tickAmountText,
  tierAt,
  tierProgress,
  totalsOf,
  validatable,
  whoName,
} from './model';

const NBSP = '\u00a0';
const NNBSP = '\u202f';
const plain = (text: string): string => text.replaceAll(NBSP, ' ').replaceAll(NNBSP, ' ');

const PERIOD = PayPeriodSchema.parse('2026-11-01');
const WINDOW = {
  period: PERIOD,
  startsAt: '2026-10-31T23:00:00.000Z',
  endsAt: '2026-11-15T23:00:00.000Z',
  timeZone: 'Europe/Paris',
};
const ACCOUNT = newId(PlatformAccountIdSchema);

const line = (patch: Partial<CommissionStatementLine> = {}): CommissionStatementLine => ({
  platformAccountId: ACCOUNT,
  currency: 'EUR',
  vatBps: 2_000,
  platformFeeBps: 1_500,
  rateMicros: 1_000_000,
  grossMinor: 12_000,
  grossEurMinor: 12_000,
  exclVatMinor: 10_000,
  netMinor: 8_500,
  commissionMinor: 2_125,
  shiftReportIds: [newId(ShiftReportIdSchema), newId(ShiftReportIdSchema)],
  lateReports: [],
  ...patch,
});

const statement = (patch: Partial<CommissionStatement> = {}): CommissionStatement => ({
  id: newId(CommissionStatementIdSchema),
  memberId: newId(TeamMemberIdSchema),
  window: WINDOW,
  status: 'draft',
  revision: 1,
  engineVersion: 'nirvana-1',
  inputsHash: 'a'.repeat(64),
  lines: [line()],
  netMinor: 8_500,
  commissionMinor: 2_125,
  teamShare: null,
  tierBonus: null,
  collectiveBonusMinor: 0,
  bonuses: [],
  penalties: [],
  carryOversIn: [],
  adjustments: [],
  bonusesMinor: 0,
  penaltiesRequestedMinor: 0,
  penaltiesMinor: 0,
  carryOversInMinor: 0,
  adjustmentsMinor: 0,
  totalMinor: 2_125,
  carryOverOutMinor: 0,
  payableMinor: 2_125,
  team: null,
  rules: {
    commissionRateBps: 2_500,
    teamShareBps: null,
    bonusTiers: [],
    collectiveGoal: null,
    minimumPayoutMinor: 1_500,
    exchangeRates: [],
    final: false,
  },
  canValidate: true,
  computedAt: '2026-11-02T09:07:00.000Z',
  validatedAt: null,
  validatedBy: null,
  paidAt: null,
  paidBy: null,
  payment: null,
  ...patch,
});

const summary = (
  patch: Partial<Omit<PayPeriodSummary, 'window'>> = {},
): Omit<PayPeriodSummary, 'window'> => ({
  ended: true,
  closedAt: null,
  closedBy: null,
  blocked: null,
  statements: { draft: 0, validated: 0, paid: 0, carried: 0 },
  netMinor: 100_000,
  payableMinor: 30_000,
  validatedPayableMinor: 0,
  carriedMinor: 0,
  paidMinor: 0,
  ...patch,
});

describe('the forecast of a period', () => {
  const day = (n: number, hours = 0) =>
    new Date(new Date(WINDOW.startsAt).getTime() + (n * 24 + hours) * 3_600_000);

  it('says nothing before a first full day, then follows the pace of the time gone by', () => {
    expect(forecastNet(5_000, 0, WINDOW, day(0, 20))).toBeNull();
    // Five days of fifteen gone: three times what is made.
    expect(forecastNet(100_000, 0, WINDOW, day(5))).toBe(300_000);
  });

  it('forecasts nothing for an empty period', () => {
    expect(forecastNet(0, 0, WINDOW, day(7))).toBe(0);
  });

  it('is the net itself once the period has ended', () => {
    expect(forecastNet(123_456, 20_000, WINDOW, day(15))).toBe(123_456);
    expect(forecastNet(123_456, 0, WINDOW, day(20))).toBe(123_456);
  });

  it('counts a report validated late once, never as pace', () => {
    // 100 € of the period's own after five days, and 30 € that came from an earlier, closed period.
    expect(forecastNet(13_000, 3_000, WINDOW, day(5))).toBe(33_000);
  });

  it('reads the late share of each line from its gross, onto its net', () => {
    const late = line({
      grossMinor: 10_000,
      netMinor: 8_000,
      lateReports: [
        {
          shiftReportId: newId(ShiftReportIdSchema),
          period: PayPeriodSchema.parse('2026-10-16'),
          grossMinor: 2_500,
        },
      ],
    });
    expect(lateNetOf([statement({ lines: [late, line()] })])).toBe(2_000);
    expect(lateNetOf([])).toBe(0);
  });
});

describe('a statement’s marks', () => {
  it('says its stage, and a carry-over as the one amber mark', () => {
    expect(statementChips(statement(), false)).toEqual([{ label: 'En cours', tone: 'neutral' }]);
    // Never « Brouillon », the word of the agent's replies.
    expect(statementChips(statement(), true)).toEqual([{ label: 'À valider', tone: 'neutral' }]);
    // Not carried before it is validated: only under the minimum, or under zero, so far.
    expect(statementChips(statement({ carryOverOutMinor: 1_200, totalMinor: 1_200 }), true)).toEqual([
      { label: 'À valider', tone: 'neutral' },
      { label: 'Sous le minimum', tone: 'warn' },
    ]);
    expect(statementChips(statement({ carryOverOutMinor: -800, totalMinor: -800 }), false)).toEqual([
      { label: 'En cours', tone: 'neutral' },
      { label: 'Sous zéro', tone: 'warn' },
    ]);
    expect(
      statementChips(statement({ status: 'validated', carryOverOutMinor: 1_200, payableMinor: 0 }), true),
    ).toEqual([
      { label: 'Validé', tone: 'ok' },
      { label: 'Reporté', tone: 'warn' },
    ]);
    // Validated with money to send waits; paid is done: two tones.
    expect(statementChips(statement({ status: 'validated' }), true)).toEqual([
      { label: 'Validé', tone: 'wait' },
    ]);
    expect(statementChips(statement({ status: 'paid' }), true)).toEqual([{ label: 'Payé', tone: 'ok' }]);
  });

  it('leaves out of a row the stage every row shares, and says what its amount is', () => {
    const draft = statement();
    expect(sameStageOf([draft, statement()], true)).toBe(true);
    expect(sameStageOf([draft, statement({ status: 'validated' })], true)).toBe(false);
    expect(rowChips(draft, true, true)).toEqual([]);
    expect(rowChips(draft, true, false)).toEqual([{ label: 'À valider', tone: 'neutral' }]);
    expect(rowChips(statement({ status: 'paid' }), true, true)).toEqual([{ label: 'Payé', tone: 'ok' }]);
    expect(amountWhat(draft, false)).toBe('à ce jour');
    expect(amountWhat(draft, true)).toBe('à verser, une fois validé');
    expect(amountWhat(draft, true, true)).toBe('à verser');
    expect(amountWhat(statement({ status: 'validated' }), true)).toBe('à verser');
    expect(amountWhat(statement({ status: 'validated', payableMinor: 0 }), true)).toBe('rien à verser');
    expect(
      amountWhat(
        statement({
          status: 'paid',
          payment: { paidOn: '2026-11-01', method: 'worldremit', reference: null, sentMinor: 2_125 },
        }),
        true,
      ),
    ).toBe('versé le 1er nov.');
    const under = { totalMinor: 900, carryOverOutMinor: 900, payableMinor: 0 };
    expect(plain(carryWhat(statement(under)) ?? '')).toBe('total 9,00 € → irait en report');
    expect(plain(carryWhat(statement({ ...under, status: 'validated' })) ?? '')).toBe(
      'total 9,00 € → reporté',
    );
    expect(carryWhat(draft)).toBeNull();
  });
});

describe('a period in the list', () => {
  it('shows where it is, and one amount: what is paid or what is left to pay', () => {
    const running = summary({ ended: false, statements: { draft: 4, validated: 0, paid: 0, carried: 0 } });
    expect([phaseChip(running).label, periodAmount(running)]).toEqual([
      'En cours',
      { minor: 30_000, what: 'à verser à ce jour' },
    ]);
    const ended = summary({ statements: { draft: 4, validated: 0, paid: 0, carried: 1 } });
    expect(phaseChip(ended)).toEqual({ label: 'Finie : à valider', tone: 'wait' });
    // Half validated: what is left to send counts the validated statements only, as Quinzaine does (#295).
    const closed = summary({
      closedAt: '2026-11-02T09:41:00.000Z',
      statements: { draft: 1, validated: 2, paid: 1, carried: 1 },
      validatedPayableMinor: 25_000,
      paidMinor: 10_000,
    });
    expect([phaseChip(closed).label, periodAmount(closed)]).toEqual([
      'Close : à valider',
      { minor: 15_000, what: 'reste à envoyer, validation en cours' },
    ]);
    expect(periodAmount(ended).what).toBe('à verser une fois validé');
    // Everything validated is paid, one statement still waits: what it would pay, never « 0,00 € reste à envoyer ».
    const waiting = summary({
      statements: { draft: 1, validated: 0, paid: 2, carried: 0 },
      payableMinor: 30_000,
      validatedPayableMinor: 20_000,
      paidMinor: 20_000,
    });
    expect(periodAmount(waiting)).toEqual({ minor: 10_000, what: 'à verser une fois validé' });
    const toPay = summary({
      statements: { draft: 0, validated: 2, paid: 1, carried: 0 },
      validatedPayableMinor: 30_000,
      paidMinor: 10_000,
    });
    expect(periodAmount(toPay)).toEqual({ minor: 20_000, what: 'reste à envoyer' });
    const paid = summary({ statements: { draft: 0, validated: 1, paid: 3, carried: 1 }, paidMinor: 30_000 });
    expect([phaseChip(paid), periodAmount(paid)]).toEqual([
      { label: 'Payée', tone: 'ok' },
      { minor: 30_000, what: 'versé' },
    ]);
    expect(countsLine(paid.statements)).toBe('3 payés, 1 validé · 1 reporté');
  });

  it('says first that pay could not compute it, and that its amount is out of date', () => {
    const blocked = summary({
      statements: { draft: 4, validated: 0, paid: 0, carried: 0 },
      blocked: { code: 'exchange_rate_missing_conflict', currency: 'USD', since: '2026-11-02T09:41:00.000Z' },
    });
    expect([phaseChip(blocked), periodAmount(blocked)]).toEqual([
      { label: 'Calcul bloqué', tone: 'warn' },
      { minor: 30_000, what: 'au dernier calcul, plus à jour' },
    ]);
  });

  it('sums a period read whole as the list does', () => {
    const period: PayrollPeriod = {
      period: PERIOD,
      window: WINDOW,
      ended: true,
      beforeFirstClosing: false,
      blocked: null,
      closing: null,
      statements: [
        statement({
          status: 'paid',
          payment: { paidOn: '2026-11-02', method: 'worldremit', reference: null, sentMinor: 2_125 },
        }),
        statement({ carryOverOutMinor: 900, payableMinor: 0 }),
        statement({ status: 'validated', carryOverOutMinor: 700, payableMinor: 0 }),
      ],
      bonusTiers: null,
      collectiveGoal: null,
      settings: { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: null },
    };
    // The draft under the minimum would carry its total, but only the validated one did.
    expect(summaryOf(period)).toMatchObject({
      statements: { draft: 1, validated: 1, paid: 1, carried: 1 },
      netMinor: 25_500,
      payableMinor: 2_125,
      validatedPayableMinor: 2_125,
      carriedMinor: 700,
      paidMinor: 2_125,
    });
  });
});

describe('the money of a statement', () => {
  it('runs from the sales to the commission, through the euros for a dollar account', () => {
    const dollars = line({
      currency: 'USD',
      vatBps: 0,
      platformFeeBps: 2_000,
      rateMicros: 921_659,
      grossMinor: 20_000,
      grossEurMinor: 18_433,
      exclVatMinor: 18_433,
      netMinor: 14_746,
      commissionMinor: 3_687,
    });
    expect(
      flowOf(dollars, 2_500, 'onlyfans', true).map((step) =>
        plain(`${step.label} | ${step.op} | ${step.amount}`),
      ),
    ).toEqual([
      'Ventes | 2 rapports | 200,00 $US',
      'En euros | 1 $ = 0,9217 € | 184,33 €',
      'Hors TVA | sans TVA | 184,33 €',
      'Net d’OnlyFans | OnlyFans 20 % | 147,46 €',
      'Ta commission | 25 % | 36,87 €',
    ]);
  });

  it('adds up to what is paid, a carry-over said before it, a capped penalty with what it asked', () => {
    const carried = statement({
      penalties: [
        {
          id: newId(PenaltyIdSchema),
          memberId: newId(TeamMemberIdSchema),
          fromPeriod: PERIOD,
          toPeriod: PERIOD,
          amount: { kind: 'fixed', amountMinor: 3_000 },
          reason: 'Retard.',
          createdBy: null,
          createdAt: '2026-11-03T10:00:00.000Z',
          cancellation: null,
        },
      ],
      penaltiesRequestedMinor: 3_000,
      penaltiesMinor: 2_125,
      totalMinor: 0,
      carryOverOutMinor: 0,
      payableMinor: 0,
    });
    expect(
      totalsOf(carried, true).map((row) => plain(`${row.label} | ${row.note ?? ''} | ${row.amount}`)),
    ).toEqual([
      'Commission |  | 21,25 €',
      'Malus | « Retard. » · 30,00 € demandés, plafonnés à ta part plus tes primes : le reste (8,75 €) est abandonné, il n’est pas reporté | −21,25 €',
      'Ce que tu touches |  | 0,00 €',
    ]);

    const under = statement({
      status: 'validated',
      totalMinor: 1_200,
      carryOverOutMinor: 1_200,
      payableMinor: 0,
    });
    expect(
      totalsOf(under, false).map((row) => plain(`${row.label} | ${row.note ?? ''} | ${row.kind}`)),
    ).toEqual([
      'Commission |  | line',
      'Total |  | total',
      'Reporté sur la quinzaine suivante | sous le minimum de versement de 15,00 € | carry',
      'À verser |  | pay',
    ]);
    expect(totalsOf(statement({ status: 'paid' }), true).at(-1)?.label).toBe('Ce que tu as touché');
    // Before its validation, a carry-over is only what would go on the next period.
    expect(
      totalsOf(statement({ totalMinor: 1_200, carryOverOutMinor: 1_200, payableMinor: 0 }), false).find(
        (row) => row.kind === 'carry',
      )?.label,
    ).toBe('Irait sur la quinzaine suivante');
    // The screen's own name for what is paid, so that one amount has one name.
    expect(totalsOf(statement(), true, 'Ce que tu vas toucher').at(-1)?.label).toBe('Ce que tu vas toucher');
  });
});

describe('words', () => {
  it('signs a percentage and a rate as French writes them', () => {
    expect(plain(signedPercentText(1_200))).toBe('+12 %');
    expect(plain(signedPercentText(-1_000))).toBe('−10 %');
    expect(plain(rateText(920_000, 'USD'))).toBe('1 $ = 0,9200 €');
    expect([changeBps(112, 100), changeBps(90, 100), changeBps(5, 0), changeBps(5, null)]).toEqual([
      1_200,
      -1_000,
      null,
      null,
    ]);
  });

  it('names who did something: oneself, a member, or else the owner', () => {
    const me = { id: newId(UserIdSchema), name: 'Charles' };
    const iris = { userId: newId(UserIdSchema), displayName: 'Iris' };
    expect(whoName(me.id, me, [iris])).toBe('Charles');
    expect(whoName(iris.userId, me, [iris])).toBe('Iris');
    expect(whoName(newId(UserIdSchema), me, [])).toBe('le propriétaire');
  });

  it('says each refusal with what it carries', () => {
    const names = { memberName: () => 'Basile' };
    expect(
      payRefusalText(
        { kind: 'refused', code: 'pay_rule_started_invalid', details: { period: '2026-11-01' } },
        names,
      ),
    ).toBe(
      'La quinzaine du 1er au 15 novembre a commencé : une règle de paie part d’une quinzaine qui n’a pas commencé.',
    );
    expect(
      payRefusalText(
        { kind: 'refused', code: 'collective_goal_late_invalid', details: { period: '2026-11-16' } },
        names,
      ),
    ).toBe('L’objectif de la quinzaine du 16 au 30 novembre se posait au plus tard le mercredi 18 novembre.');
    expect(
      payRefusalText(
        { kind: 'refused', code: 'pay_period_order_conflict', details: { period: '2026-10-16' } },
        names,
      ),
    ).toBe('Valide d’abord la quinzaine du 16 au 31 octobre.');
    const theirs = { ...names, statement: { memberId: newId(TeamMemberIdSchema), window: WINDOW } };
    expect(
      payRefusalText(
        { kind: 'refused', code: 'commission_statement_order_conflict', details: { period: '2026-10-16' } },
        theirs,
      ),
    ).toBe('Valide d’abord le relevé de Basile du 16 au 31 octobre.');
    expect(
      payRefusalText({ kind: 'refused', code: 'commission_statement_open_conflict', details: {} }, theirs),
    ).toBe('La quinzaine n’est pas finie : elle se valide à partir du lundi 16 novembre.');
    const status = { kind: 'refused', code: 'commission_statement_status_conflict', details: {} } as const;
    expect(payRefusalText(status, names)).toBe('Ce relevé n’est pas encore validé.');
    expect(
      payRefusalText(status, { ...names, statement: { ...theirs.statement, status: 'validated' } }),
    ).toBe('Ce relevé n’est plus à payer : il a déjà été marqué payé.');
    expect(
      plain(
        payRefusalText(
          { kind: 'refused', code: 'payment_amount_unprocessable', details: { payableMinor: 28_840 } },
          names,
        ),
      ),
    ).toBe('Le montant envoyé doit être celui à verser : 288,40 €.');
    expect(
      payRefusalText(
        { kind: 'refused', code: 'commission_rate_missing_conflict', details: { memberId: 'x' } },
        names,
      ),
    ).toBe('Basile n’a pas de taux de commission en vigueur.');
    expect(
      payRefusalText(
        { kind: 'refused', code: 'pay_period_reports_pending_conflict', details: { count: 2 } },
        names,
      ),
    ).toBe('2 rapports de la quinzaine attendent leur relecture.');
    expect(
      payRefusalText(
        { kind: 'refused', code: 'payment_before_period_unprocessable', details: { period: '2026-10-16' } },
        names,
      ),
    ).toBe('Le paiement ne peut pas être daté avant le début de la quinzaine (vendredi 16 octobre).');
    expect(
      payRefusalText({ kind: 'refused', code: 'pay_period_not_computed_conflict', details: {} }, names),
    ).toBe('La paie n’a pas encore calculé cette quinzaine : réessaie dans quelques minutes.');
    // Every form says it, the payment, the goals and the settings included, none of which has a reason.
    expect(payRefusalText({ kind: 'refused', code: 'request_invalid', details: {} }, names)).toBe(
      'Ces valeurs ne conviennent pas : vérifie le formulaire.',
    );
    expect(payRefusalText({ kind: 'failed' }, names)).toBe(
      'Le serveur ne répond pas : rien n’a été enregistré.',
    );
  });
});

describe('the export of a period', () => {
  it('writes each account and each statement’s total, decimals with a comma, quoted where needed', () => {
    const period: PayrollPeriod = {
      period: PERIOD,
      window: WINDOW,
      ended: true,
      beforeFirstClosing: false,
      blocked: null,
      closing: null,
      statements: [statement()],
      bonusTiers: null,
      collectiveGoal: null,
      settings: { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: null },
    };
    const csv = statementsCsv(
      period,
      () => 'Théo',
      () => 'Nora Vidal; @nora',
    );
    const [head, account, total] = csv.trimEnd().split('\r\n');
    expect(head?.split(';').slice(0, 3)).toEqual(['Membre', 'Compte', 'Devise']);
    expect(account).toBe('Théo;"Nora Vidal; @nora";EUR;120,00;120,00;100,00;85,00;21,25;;;;;;;;');
    expect(total).toBe(
      'Théo;Total du relevé;EUR;;;;85,00;21,25;0,00;0,00;0,00;0,00;21,25;0,00;21,25;À valider',
    );
  });

  it('never lets a name start a formula, and keeps the minus sign of an amount', () => {
    const period: PayrollPeriod = {
      period: PERIOD,
      window: WINDOW,
      ended: true,
      beforeFirstClosing: false,
      blocked: null,
      closing: null,
      statements: [statement({ penaltiesMinor: 500 })],
      bonusTiers: null,
      collectiveGoal: null,
      settings: { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: null },
    };
    const lines = (name: string) =>
      statementsCsv(
        period,
        () => name,
        () => name,
      ).split('\r\n');
    for (const [typed, written] of [
      ['=HYPERLINK("https://exemple.test")', '"\'=HYPERLINK(""https://exemple.test"")"'],
      ['+33 6 00', "'+33 6 00"],
      ['-Théo', "'-Théo"],
      ['@nora', "'@nora"],
      ['\tTab', "'\tTab"],
      ['Théo = Lou', 'Théo = Lou'],
    ] as const) {
      const [, account, total] = lines(typed);
      expect(account?.startsWith(`${written};${written};EUR;`), typed).toBe(true);
      expect(total?.split(';').slice(0, 2), typed).toEqual([written, 'Total du relevé']);
      // The penalties' column, an amount: its minus sign is the amount's, never a formula to neutralize.
      expect(total?.split(';')[9], typed).toBe('-5,00');
    }
    // A carriage return is neutralized, and quoted with the name, so the line stays one.
    expect(lines('\rRetour')[1]?.startsWith(`"'\rRetour";"'\rRetour";EUR;`)).toBe(true);
  });
});

describe('what Quinzaine opens on, and what it lets validate', () => {
  const at = (period: string, ended: boolean, draft: number, payableMinor = 0) => ({
    window: { ...WINDOW, period: PayPeriodSchema.parse(period) },
    ended,
    statements: { draft, validated: 0, paid: 0, carried: 0 },
    payableMinor,
    paidMinor: 0,
  });

  it('opens the oldest ended period with something left to do, else the one under way', () => {
    const current = PayPeriodSchema.parse('2026-11-16');
    const list = [at('2026-11-16', false, 3), at('2026-11-01', true, 2), at('2026-10-16', true, 1)];
    expect(periodToOpen(list, current, false)).toBe('2026-10-16');
    expect(periodToOpen([at('2026-11-16', false, 3), at('2026-11-01', true, 0)], current, true)).toBe(
      current,
    );
    // Validated, money still to send: the owner's to do, not a manager's.
    const unpaid = [at('2026-11-16', false, 3), at('2026-11-01', true, 0, 30_000)];
    expect(periodToOpen(unpaid, current, true)).toBe('2026-11-01');
    expect(periodToOpen(unpaid, current, false)).toBe(current);
    expect(parsePaySearch({ quinzaine: '2026-10-16', autre: 1 })).toEqual({ quinzaine: '2026-10-16' });
    expect(parsePaySearch({ quinzaine: '2026-10-17' })).toEqual({});
    // « Son relevé » from a member's record (EQ-11).
    const theo = '0199f2a0-0000-7000-8000-0000000000a1';
    expect(parsePaySearch({ membre: theo })).toEqual({ membre: theo });
    expect(parsePaySearch({ membre: 'Théo' })).toEqual({});
  });

  it('lets the reader validate the drafts of an ended period that are not theirs', () => {
    const mine = statement({ canValidate: false });
    const theirs = statement();
    const done = statement({ status: 'validated', canValidate: false });
    expect(validatable({ ended: true, statements: [mine, theirs, done] })).toEqual([theirs]);
    expect(validatable({ ended: false, statements: [theirs] })).toEqual([]);
  });

  it('stops a batch on a refusal of the whole period, or a server that does not answer', () => {
    expect(stopsThePeriod({ kind: 'failed' })).toBe(true);
    expect(
      stopsThePeriod({ kind: 'refused', code: 'pay_period_reports_pending_conflict', details: {} }),
    ).toBe(true);
    expect(
      stopsThePeriod({ kind: 'refused', code: 'commission_statement_changed_conflict', details: {} }),
    ).toBe(false);
    expect(stopsThePeriod({ kind: 'refused', code: 'commission_rate_missing_conflict', details: {} })).toBe(
      false,
    );
  });
});

describe('the dollar’s rate before a closing', () => {
  const OCT2 = PayPeriodSchema.parse('2026-10-16');
  const rate = (day: string) => ({
    currency: 'USD' as const,
    day,
    rateMicros: 920_000,
    source: 'BCE, taux de référence',
    fetchedAt: `${day}T15:05:00.000Z`,
  });
  const period = (
    rates: readonly ReturnType<typeof rate>[],
    patch: Partial<PayrollPeriod> = {},
  ): PayrollPeriod => ({
    period: OCT2,
    window: { ...WINDOW, period: OCT2 },
    ended: true,
    beforeFirstClosing: false,
    blocked: null,
    closing: null,
    statements: [
      statement({
        lines: [line({ currency: 'USD' })],
        rules: { ...statement().rules, exchangeRates: [...rates] },
      }),
    ],
    bonusTiers: null,
    collectiveGoal: null,
    settings: { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: null },
    ...patch,
  });

  it('is missing when no rate of the last day or the four before is known', () => {
    expect(rateMissing(period([rate('2026-10-30')]), null)).toBe(false);
    expect(rateMissing(period([rate('2026-10-27')]), null)).toBe(false);
    expect(rateMissing(period([rate('2026-10-26')]), null)).toBe(true);
    expect(rateMissing(period([]), null)).toBe(true);
    // The latest the job read counts when it is of the period; one read after its end tells nothing of it.
    expect(rateMissing(period([rate('2026-10-20')]), rate('2026-10-30'))).toBe(false);
    expect(rateMissing(period([rate('2026-10-20')]), rate('2026-11-02'))).toBe(true);
  });

  it('is never missing for a period in euros, one under way, or one already closed', () => {
    const euros = period([]);
    expect(rateMissing({ ...euros, statements: [statement()] }, null)).toBe(false);
    expect(rateMissing(period([], { ended: false }), null)).toBe(false);
    expect(
      rateMissing(
        period([], {
          closing: {
            period: OCT2,
            exchangeRates: null,
            closedBy: null,
            closedAt: '2026-11-02T09:41:00.000Z',
          },
        }),
        null,
      ),
    ).toBe(false);
  });
});

describe('a member’s row', () => {
  it('says the rate or the team share, the tier and the penalty, signed', () => {
    expect(
      memberFacts(
        statement({
          tierBonus: { thresholdMinor: 100_000, bonusMinor: 5_000, label: 'Or' },
          penaltiesMinor: 1_500,
        }),
      ).map(plain),
    ).toEqual(['commission 25 %', 'palier Or', 'malus −15,00 €']);
    expect(
      memberFacts(statement({ teamShare: { baseNetMinor: 100_000, bps: 1_000, amountMinor: 10_000 } })).map(
        plain,
      ),
    ).toEqual(['commission 25 %', 'part d’équipe 10 %']);
  });

  it('says a carry-over in one sentence, under the minimum or under zero', () => {
    expect(carryLine(statement(), true)).toBeNull();
    const under = { totalMinor: 1_200, carryOverOutMinor: 1_200, payableMinor: 0 };
    const negative = { totalMinor: -800, carryOverOutMinor: -800, payableMinor: 0 };
    expect(plain(carryLine(statement({ ...under, status: 'validated' }), true) ?? '')).toBe(
      'Sous le minimum de 15,00 € : 12,00 € reportés sur la quinzaine suivante.',
    );
    expect(plain(carryLine(statement({ ...negative, status: 'validated' }), true) ?? '')).toBe(
      'Total sous zéro : −8,00 € reportés sur la quinzaine suivante.',
    );
    // Not carried yet before its validation: what would be, so far while it runs.
    expect(plain(carryLine(statement(under), true) ?? '')).toBe(
      'Sous le minimum de 15,00 € : 12,00 € iront sur la quinzaine suivante une fois le relevé validé.',
    );
    expect(plain(carryLine(statement(under), false) ?? '')).toBe(
      'Sous le minimum de 15,00 € à ce jour : 12,00 € iraient sur la quinzaine suivante, si la quinzaine finit ainsi.',
    );
    expect(plain(carryLine(statement(negative), false) ?? '')).toBe(
      'Total sous zéro à ce jour : −8,00 € iraient sur la quinzaine suivante, si la quinzaine finit ainsi.',
    );
  });

  it('says a second carry-over in a row, then why the next period pays under the minimum (ADR 0038)', () => {
    const carriedIn = (amountMinor: number, rank: number): CarryOver => ({
      id: newId(CarryOverIdSchema),
      memberId: newId(TeamMemberIdSchema),
      fromPeriod: PayPeriodSchema.parse('2026-10-16'),
      toPeriod: PERIOD,
      amountMinor,
      rank,
      statementId: newId(CommissionStatementIdSchema),
      createdAt: '2026-11-02T09:00:00.000Z',
    });
    const once = [carriedIn(900, 1)];
    const second = { carryOversIn: once, totalMinor: 1_300, carryOverOutMinor: 1_300, payableMinor: 0 };
    expect(plain(carryLine(statement({ ...second, status: 'validated' }), true) ?? '')).toBe(
      'Sous le minimum de 15,00 € : 13,00 € reportés sur la quinzaine suivante. Deuxième report de suite : la quinzaine suivante versera ce montant, même sous le minimum.',
    );
    // In the mood of the sentence before: certain once the period has ended, conditional while it runs.
    expect(plain(carryLine(statement(second), true) ?? '')).toBe(
      'Sous le minimum de 15,00 € : 13,00 € iront sur la quinzaine suivante une fois le relevé validé. Ce sera le deuxième report de suite : la quinzaine suivante versera ce montant, même sous le minimum.',
    );
    expect(plain(carryLine(statement(second), false) ?? '')).toBe(
      'Sous le minimum de 15,00 € à ce jour : 13,00 € iraient sur la quinzaine suivante, si la quinzaine finit ainsi. Ce serait le deuxième report de suite : la quinzaine suivante verserait ce montant, même sous le minimum.',
    );
    // After a negative carry-over, the count starts again: a first carry-over, said plainly.
    const afterNegative = { ...second, carryOversIn: [carriedIn(-500, 1)] };
    expect(plain(carryLine(statement({ ...afterNegative, status: 'validated' }), true) ?? '')).toBe(
      'Sous le minimum de 15,00 € : 13,00 € reportés sur la quinzaine suivante.',
    );
    // Carried twice: paid under the minimum, and said why; only the amount coming in was carried.
    const twice = [carriedIn(1_300, 2)];
    const paid = { carryOversIn: twice, totalMinor: 1_400, carryOverOutMinor: 0, payableMinor: 1_400 };
    expect(plain(carryLine(statement({ ...paid, status: 'validated' }), true) ?? '')).toBe(
      'Sous le minimum de 15,00 €, mais le montant qui entre a déjà été reporté deux fois : la quinzaine verse tout quand même, pour que la facture qui attend soit payée avant son échéance.',
    );
    expect(plain(carryLine(statement(paid), false) ?? '')).toBe(
      'Sous le minimum de 15,00 € à ce jour, mais le montant qui entre a déjà été reporté deux fois : la quinzaine versera tout quand même, pour que la facture qui attend soit payée avant son échéance.',
    );
    // A final statement pays everything because the member leaves (EQ-14): not for this reason, so no word of it.
    const leaving = statement({ ...paid, status: 'validated' });
    expect(carryLine({ ...leaving, rules: { ...leaving.rules, final: true } }, true)).toBeNull();
    // Over the minimum, the payment needs no word.
    expect(carryLine(statement({ ...paid, totalMinor: 2_000, payableMinor: 2_000 }), true)).toBeNull();
  });
});

describe('the figures of a period', () => {
  it('splits the net by creator, the largest first, in shares that add up', () => {
    const other = newId(PlatformAccountIdSchema);
    const split = salesSplit(
      [statement({ lines: [line(), line({ platformAccountId: other, netMinor: 25_500 })] })],
      (one) => (one.platformAccountId === other ? 'Léa' : 'Nora'),
    );
    expect(split).toEqual([
      { name: 'Léa', minor: 25_500, bps: 7_500 },
      { name: 'Nora', minor: 8_500, bps: 2_500 },
    ]);
    expect(salesSplit([], () => 'Nora')).toEqual([]);
  });

  it('keeps four parts at most, as many as a split has colours, the smallest gathered in « Autres »', () => {
    const accounts = ['Nora', 'Léa', 'Iris', 'Mia', 'Zoé'].map((name, index) => ({
      name,
      id: newId(PlatformAccountIdSchema),
      netMinor: (5 - index) * 1_000,
    }));
    const byId = new Map(accounts.map((account) => [account.id, account.name]));
    const lines = accounts.map((account) =>
      line({ platformAccountId: account.id, netMinor: account.netMinor }),
    );
    const split = salesSplit([statement({ lines })], (one) => byId.get(one.platformAccountId) ?? '');
    expect(split).toEqual([
      { name: 'Nora', minor: 5_000, bps: 3_333 },
      { name: 'Léa', minor: 4_000, bps: 2_667 },
      { name: 'Iris', minor: 3_000, bps: 2_000 },
      { name: 'Autres', minor: 3_000, bps: 2_000 },
    ]);
    expect(
      salesSplit([statement({ lines: lines.slice(0, 4) })], (one) => byId.get(one.platformAccountId) ?? ''),
    ).toHaveLength(4);
  });

  it('places the goal: reached share floored, the tier reached, a gauge past the last tier', () => {
    const tiers = [
      { reachedBps: 8_000, bonusMinor: 1_000 },
      { reachedBps: 10_000, bonusMinor: 2_500 },
    ];
    expect(reachedBpsOf(99_999, 100_000)).toBe(9_999);
    expect(tierAt(tiers, 9_999)).toEqual(tiers[0]);
    expect(tierAt(tiers, 7_999)).toBeNull();
    expect(goalSpanBps({ tiers })).toBe(13_000);
    expect(goalSpanBps({ tiers: [{ reachedBps: 15_000, bonusMinor: 1 }] })).toBe(17_000);
    expect([gaugePercent(6_500, 13_000), gaugePercent(20_000, 13_000), gaugePercent(-5, 13_000)]).toEqual([
      50, 100, 0,
    ]);
  });
});

describe('Primes et malus', () => {
  const OWNER = newId(UserIdSchema);
  const MEMBER = newId(TeamMemberIdSchema);
  const NEXT = PayPeriodSchema.parse('2026-11-16');
  const LAST = PayPeriodSchema.parse('2026-12-16');
  const made = (day: number) => ({ createdBy: OWNER, createdAt: `2026-11-0${String(day)}T10:00:00.000Z` });
  const entries = PayrollEntriesSchema.parse({
    period: PERIOD,
    bonuses: [
      {
        id: newId(BonusIdSchema),
        memberId: MEMBER,
        period: PERIOD,
        amountMinor: 3_000,
        reason: 'Formation',
        ...made(9),
        cancellation: null,
      },
    ],
    penalties: [
      {
        id: newId(PenaltyIdSchema),
        memberId: MEMBER,
        fromPeriod: PERIOD,
        toPeriod: LAST,
        amount: { kind: 'percent', bps: 1_000 },
        reason: 'Relances',
        ...made(5),
        cancellation: { cancelledAt: '2026-11-20T10:00:00.000Z', cancelledBy: OWNER, cancelledFrom: NEXT },
      },
      {
        id: newId(PenaltyIdSchema),
        memberId: MEMBER,
        fromPeriod: PERIOD,
        toPeriod: PERIOD,
        amount: { kind: 'fixed', amountMinor: 1_500 },
        reason: 'Retard',
        ...made(4),
        cancellation: { cancelledAt: '2026-11-06T10:00:00.000Z', cancelledBy: OWNER, cancelledFrom: PERIOD },
      },
    ],
    adjustments: [
      {
        id: newId(PayAdjustmentIdSchema),
        memberId: MEMBER,
        period: PERIOD,
        amountMinor: -1_240,
        reason: 'Doublon',
        correctsStatementId: null,
        ...made(3),
      },
    ],
  });

  it('signs every amount, and strikes through what no longer counts in the period', () => {
    const rows = entryRows(entries);
    expect(rows.map((row) => [row.kind, plain(row.amount), row.struck, row.cancellable])).toEqual([
      ['bonus', '+30,00 €', false, true],
      ['percent', '−10 %', false, false],
      ['fixed', '−15,00 €', true, false],
      ['adjustment', '−12,40 €', false, false],
    ]);
    expect(rows[1]?.span).toEqual({ from: PERIOD, to: LAST });
  });

  it('says who made an entry, who cancelled it, and a penalty that still counts here', () => {
    const [, spread, cancelled] = entryRows(entries);
    if (spread === undefined || cancelled === undefined) throw new Error('rows');
    const who = (): string => 'Charles';
    expect(entryByText(cancelled, PERIOD, who, 'Europe/Paris')).toBe('annulé par Charles le ven. 6 nov.');
    expect(entryByText(spread, PERIOD, who, 'Europe/Paris')).toBe(
      'par Charles le jeu. 5 nov. · annulé par Charles le ven. 20 nov., à partir de la quinzaine du 16 au 30 novembre : il compte encore ici',
    );
    expect(spread.span === null ? '' : spanText(spread.span)).toBe(
      'sur 4 quinzaines, du 1er nov. au 31 déc.',
    );
  });

  it('finds where an entry goes: the member’s earliest draft in a closed period, else the team’s first open one', () => {
    const OCT2 = PayPeriodSchema.parse('2026-10-16');
    const summary = (period: PayPeriod, closed: boolean, draft: number) => ({
      window: { ...WINDOW, period },
      closedAt: closed ? '2026-11-02T08:41:00.000Z' : null,
      statements: { draft, validated: 0, paid: 0, carried: 0 },
    });
    const known = draftPeriodsBefore([summary(PERIOD, false, 3), summary(OCT2, true, 1)], PERIOD);
    expect(known).toEqual({ teamFirstOpen: PERIOD, drafts: [OCT2] });
    const read = (statuses: Partial<Record<PayPeriod, 'draft' | 'validated'>>) => (period: PayPeriod) => {
      const status = statuses[period];
      return status === undefined ? undefined : { statements: [statement({ memberId: MEMBER, status })] };
    };
    const base = { memberId: MEMBER, joinedOn: '2026-09-01', after: null, ...known };
    expect(firstOpenPeriod({ ...base, read: read({ [OCT2]: 'draft' }) })).toBe(OCT2);
    expect(firstOpenPeriod({ ...base, read: read({ [OCT2]: 'validated' }) })).toBe(PERIOD);
    // Still being read: nothing said yet.
    expect(firstOpenPeriod({ ...base, read: read({}) })).toBeUndefined();
    // Never at or before a statement already validated, never before the member joined.
    expect(firstOpenPeriod({ ...base, after: OCT2, read: read({}) })).toBe(PERIOD);
    expect(firstOpenPeriod({ ...base, joinedOn: '2026-11-20', read: read({ [OCT2]: 'draft' }) })).toBe(NEXT);
    // No closing yet: the period under way, or an ended one where the member still has a draft.
    expect(draftPeriodsBefore([summary(OCT2, false, 2)], PERIOD)).toEqual({
      teamFirstOpen: PERIOD,
      drafts: [OCT2],
    });
  });
});

describe('goals and tiers', () => {
  it('starts a pay rule with a period that has not begun (PAIE-22)', () => {
    // The 1st itself has not begun yet as a rule's start: the period of that day is offered.
    expect(rulePeriods('2026-11-01', 2)).toEqual(['2026-11-01', '2026-11-16']);
    expect(rulePeriods('2026-11-02', 2)).toEqual(['2026-11-16', '2026-12-01']);
    expect(rulePeriods('2026-12-31', 2)).toEqual(['2027-01-01', '2027-01-16']);
  });

  it('reads a target up to its own ceiling, beyond an entry’s slip guard', () => {
    expect(parseTarget('150 000')).toBe(15_000_000);
    expect(parseTarget('1000000')).toBe(100_000_000);
    expect(parseTarget('1000000,01')).toBeNull();
  });

  it('puts a tier’s bonus under the gauge without cents when it has none', () => {
    expect(plain(tickAmountText(1_000))).toBe('+10 €');
    expect(plain(tickAmountText(1_250))).toBe('+12,50 €');
  });

  it('takes the share reached as the engine froze it, else from the team’s net', () => {
    const goal = { targetMinor: 100_000 };
    expect(
      goalReachedBps(
        { statements: [statement({ netMinor: 30_000 }), statement({ netMinor: 20_000 })] },
        goal,
      ),
    ).toBe(5_000);
    const frozen = statement({
      netMinor: 30_000,
      team: { netMinor: 85_000, collective: { reachedBps: 8_500, tier: null } },
    });
    expect(goalReachedBps({ statements: [frozen] }, goal)).toBe(8_500);
  });
});

describe('Commissions, as the member reads them', () => {
  const OCT2 = PayPeriodSchema.parse('2026-10-16');
  const at = (
    period: PayPeriod,
    patch: Partial<Omit<PayPeriodSummary, 'window'>> = {},
  ): PayPeriodSummary => ({
    ...summary(patch),
    window: { ...WINDOW, period },
  });
  const counts = (draft: number, validated: number, paid: number, carried = 0) => ({
    draft,
    validated,
    paid,
    carried,
  });

  it('names each stage in the member’s words, and a carry-over with nothing sent as such', () => {
    const chip = (patch: Partial<Omit<PayPeriodSummary, 'window'>>) => memberPhaseChip(summary(patch));
    expect(chip({ ended: false })).toEqual({ label: 'En cours', tone: 'neutral' });
    expect(chip({ statements: counts(1, 0, 0), payableMinor: 2_125 })).toEqual({
      label: 'En validation',
      tone: 'wait',
    });
    expect(chip({ statements: counts(0, 1, 0), payableMinor: 2_125 })).toEqual({
      label: 'Validé',
      tone: 'wait',
    });
    expect(chip({ statements: counts(0, 0, 1), payableMinor: 2_125, paidMinor: 2_125 })).toEqual({
      label: 'Payé',
      tone: 'ok',
    });
    expect(chip({ statements: counts(0, 1, 0, 1), payableMinor: 0 })).toEqual({
      label: 'Reporté',
      tone: 'warn',
    });
  });

  it('gives each period one amount: so far, still to come, or touched', () => {
    expect(memberPeriodAmount(summary({ ended: false, payableMinor: 2_125 }))).toEqual({
      minor: 2_125,
      what: 'à ce jour',
    });
    // Not validated, so not owed yet (#295).
    expect(memberPeriodAmount(summary({ statements: counts(1, 0, 0), payableMinor: 2_125 }))).toEqual({
      minor: 2_125,
      what: 'à toucher une fois validé',
    });
    expect(
      memberPeriodAmount(summary({ statements: counts(0, 0, 1), payableMinor: 2_125, paidMinor: 2_125 })),
    ).toEqual({ minor: 2_125, what: 'touché' });
    // Validated, not sent yet: what is owed (#295).
    expect(
      memberPeriodAmount(
        summary({ statements: counts(0, 1, 0), payableMinor: 2_125, validatedPayableMinor: 2_125 }),
      ),
    ).toEqual({ minor: 2_125, what: 'à toucher' });
  });

  it('opens on the money on its way, then on the period under way, else on what the last one brought', () => {
    const running = at(PERIOD, { ended: false, payableMinor: 2_125 });
    const waiting = at(OCT2, { statements: counts(1, 0, 0), payableMinor: 2_125 });
    const unpaid = at(OCT2, { statements: counts(0, 1, 0), payableMinor: 2_125 });
    const paid = at(OCT2, { statements: counts(0, 0, 1), payableMinor: 2_125, paidMinor: 2_125 });
    expect(heroPeriodOf([running, waiting], PERIOD)).toBe(OCT2);
    expect(heroPeriodOf([running, unpaid], PERIOD)).toBe(OCT2);
    expect(heroPeriodOf([running, paid], PERIOD)).toBe(PERIOD);
    // A new period without a statement yet: the last one, paid.
    expect(heroPeriodOf([paid], PERIOD)).toBe(OCT2);
    expect(heroPeriodOf([], PERIOD)).toBe(PERIOD);
  });

  it('says a statement as it runs, is validated, then paid, never with a date of payment to come', () => {
    const sameDay = new Date('2026-11-02T15:00:00Z');
    const words = (one: CommissionStatement, ended: boolean, now = sameDay) => {
      const said = myStatementWords(one, ended, now);
      return { since: plain(said.since), label: said.label, notes: said.notes.map(plain) };
    };
    expect(words(statement(), false)).toEqual({
      since: 'validation par l’agence à partir du lun. 16 nov.',
      label: 'Ce que tu touches à ce jour',
      notes: ['Calculé à 10 h 07 sur tes rapports validés. Le versement suit la validation de la quinzaine.'],
    });
    expect(words(statement(), false, new Date('2026-11-05T10:00:00Z')).notes[0]).toBe(
      'Calculé le lun. 2 nov. à 10 h 07 sur tes rapports validés. Le versement suit la validation de la quinzaine.',
    );
    // Under the minimum while it runs: what would go on the next period, not a carry-over yet.
    expect(
      words(statement({ totalMinor: 1_200, carryOverOutMinor: 1_200, payableMinor: 0 }), false).notes[1],
    ).toBe(
      'Sous le minimum de 15,00 € à ce jour : si la quinzaine finit ainsi, 12,00 € iront sur la suivante.',
    );
    expect(words(statement(), true)).toMatchObject({
      since: 'depuis le lun. 16 nov.',
      label: 'Ce que tu vas toucher',
    });
    const validated = statement({ status: 'validated', validatedAt: '2026-11-16T09:41:00.000Z' });
    expect(words(validated, true)).toEqual({
      since: 'le lun. 16 nov.',
      label: 'Ce que tu vas toucher',
      notes: ['Validé le lundi 16 novembre à 10 h 41. Le versement suit.'],
    });
    const carried = statement({
      status: 'validated',
      validatedAt: '2026-11-16T09:41:00.000Z',
      totalMinor: 1_200,
      carryOverOutMinor: 1_200,
      payableMinor: 0,
    });
    expect(words(carried, true)).toEqual({
      since: 'le lun. 16 nov.',
      label: 'Ce que tu touches',
      notes: [
        'Validé le lundi 16 novembre à 10 h 41.',
        'Sous le minimum de 15,00 € : 12,00 € reportés sur la quinzaine suivante.',
      ],
    });
    const payment = {
      paidOn: '2026-11-17',
      method: 'worldremit',
      reference: 'WR-2611-0412',
      sentMinor: 2_125,
    } as const;
    const paid = statement({ ...validated, status: 'paid', payment });
    expect(words(paid, true)).toEqual({
      since: 'le mar. 17 nov.',
      label: 'Ce que tu as touché',
      notes: ['Payé le mardi 17 novembre par WorldRemit, référence WR-2611-0412.'],
    });
    const bare = statement({ ...paid, payment: { ...payment, reference: null } });
    expect(words(bare, true).notes).toEqual(['Payé le mardi 17 novembre par WorldRemit.']);
  });

  it('says the payout delay the owner announced, never one of its own (PAIE-32)', () => {
    const sameDay = new Date('2026-11-02T15:00:00Z');
    const notes = (one: CommissionStatement, ended: boolean, delay: number | null) =>
      myStatementWords(one, ended, sameDay, delay).notes.map(plain);
    expect(notes(statement(), false, 3)).toEqual([
      'Calculé à 10 h 07 sur tes rapports validés. En général, le versement part 3 jours ouvrés après la validation.',
    ]);
    expect(notes(statement(), true, 1)).toEqual([
      'Calculé à 10 h 07 sur tes rapports validés. L’agence valide, puis le versement suit, en général 1 jour ouvré après la validation.',
    ]);
    const validated = statement({ status: 'validated', validatedAt: '2026-11-16T09:41:00.000Z' });
    expect(notes(validated, true, 3)).toEqual([
      'Validé le lundi 16 novembre à 10 h 41. En général, le versement part 3 jours ouvrés après la validation.',
    ]);
    // Nothing to pay: no delay to announce.
    expect(notes(statement({ ...validated, payableMinor: 0 }), true, 3)).toEqual([
      'Validé le lundi 16 novembre à 10 h 41.',
    ]);
    expect(payoutDelayText(2)).toBe('2 jours ouvrés après la validation');
  });

  it('finds the tier reached, its threshold included, and the next one', () => {
    const tiers = [
      { label: 'Argent', thresholdMinor: 100_000, bonusMinor: 2_500 },
      { label: 'Bronze', thresholdMinor: 50_000, bonusMinor: 1_000 },
    ];
    const [argent, bronze] = tiers;
    expect(tierProgress(30_000, tiers)).toEqual({ reached: null, next: bronze });
    expect(tierProgress(50_000, tiers)).toEqual({ reached: bronze, next: argent });
    expect(tierProgress(120_000, tiers)).toEqual({ reached: argent, next: null });
    expect(tierProgress(0, [])).toEqual({ reached: null, next: null });
  });

  it('turns net to reach into sales on the account that brings the most, rounded up to the unit', () => {
    const other = newId(PlatformAccountIdSchema);
    const big = line({ platformAccountId: other, netMinor: 9_000 });
    expect(mainLine([line(), big])).toBe(big);
    expect(mainLine([])).toBeNull();
    // 150 € of net: back through 15 % of fee and 20 % of VAT, 211,77 € of sales, so 212 €.
    expect(salesFor(15_000, line())).toBe(21_200);
    // In dollars at 1 $ = 0,92 €: 230,18 $, so 231 $.
    expect(salesFor(15_000, line({ currency: 'USD', rateMicros: 920_000 }))).toBe(23_100);
    expect(salesFor(0, line())).toBe(0);
    expect(plain(roundAmountText(21_200, 'EUR'))).toBe('212 €');
    expect(plain(roundAmountText(123_400, 'EUR'))).toBe('1 234 €');
    expect(plain(roundAmountText(21_250, 'EUR'))).toBe('212,50 €');
    expect(plain(roundAmountText(23_100, 'USD'))).toMatch(/^231 \$|^\$231$/u);
  });
});

describe('the words of pay', () => {
  it('writes the first of the month « 1er », and a computation’s day when it is not today', () => {
    expect(plain(dayMonthText('2026-11-01'))).toBe('dim. 1er nov.');
    expect(plain(dayMonthText('2026-11-11'))).toBe('mer. 11 nov.');
    expect(plain(dayShortMonth('2026-11-01'))).toBe('1er nov.');
    expect(plain(dayShortMonth('2026-11-15'))).toBe('15 nov.');
    const at = '2026-10-16T06:12:00.000Z';
    expect(plain(computedText(at, 'Europe/Paris', new Date('2026-10-16T15:00:00Z')))).toBe('à 8 h 12');
    expect(plain(computedText(at, 'Europe/Paris', new Date('2026-10-29T15:00:00Z')))).toBe(
      'le ven. 16 oct. à 8 h 12',
    );
  });

  it('says an amount in CFA francs at the fixed parity, as a guide only', () => {
    expect(plain(fcfaText(107_503))).toBe('≈ 705 173 FCFA, avant frais WorldRemit');
  });

  it('counts the working days a rate should have come since the last one read', () => {
    // Thursday 8 October, today Thursday 29: the 14 working days in between.
    expect(missedRateDays('2026-10-08', '2026-10-29')).toBe(14);
    // Friday's rate, today Monday: the weekend has none, and Monday's may still come.
    expect(missedRateDays('2026-10-23', '2026-10-26')).toBe(0);
    expect(missedRateDays('2026-10-27', '2026-10-29')).toBe(1);
  });

  it('calls a rate overdue only past two working days without one, as the server does', () => {
    // Thursday 25 March 2027, today Tuesday 30: Good Friday and Easter Monday shut the ECB, nothing is broken.
    expect(rateOverdue('2027-03-25', '2027-03-30')).toBe(false);
    // Today Wednesday 31: three working days without a rate.
    expect(rateOverdue('2027-03-25', '2027-03-31')).toBe(true);
  });

  it('says what a penalty really takes, read in the member’s statement', () => {
    const id = newId(PenaltyIdSchema);
    const percent = { id, kind: 'percent', struck: false } as const;
    const fixed = { ...percent, kind: 'fixed' } as const;
    const taken = (requested: number, kept: number, ids: readonly string[] = [id]) => ({
      penalties: ids.map((one) => ({ id: one })),
      penaltiesRequestedMinor: requested,
      penaltiesMinor: kept,
    });
    expect(plain(penaltyTaken(percent, taken(10_000, 10_000)) ?? '')).toBe('de son net, soit −100,00 €');
    expect(plain(penaltyTaken(fixed, taken(6_000, 2_334)) ?? '')).toBe('retenu −23,34 € (plafonné)');
    expect(penaltyTaken(fixed, taken(6_000, 6_000))).toBeNull();
    // Two penalties in one statement: the amount of each is not known apart.
    expect(plain(penaltyTaken(fixed, taken(6_000, 2_334, [id, newId(PenaltyIdSchema)])) ?? '')).toBe(
      'malus plafonnés : −23,34 € retenus en tout',
    );
    expect(penaltyTaken(percent, undefined)).toBe('de son net');
    expect(penaltyTaken({ ...percent, struck: true }, taken(10_000, 10_000))).toBeNull();
    expect(penaltyTaken({ ...percent, kind: 'bonus' }, taken(10_000, 10_000))).toBeNull();
  });
});

describe('a blocked period (recette du 28/10, Équipe G1)', () => {
  const [theo, lea] = [newId(TeamMemberIdSchema), newId(TeamMemberIdSchema)];
  const memberName = (id: string): string => (id === theo ? 'Théo' : id === lea ? 'Léa' : 'Un membre');
  const since = '2025-05-02T08:30:00.000Z';
  const rate = { code: 'commission_rate_missing_conflict' as const, memberIds: [theo], since };

  it('says who lacks a rate, that no gesture of the screen lifts it, and that the figures are out of date', () => {
    const owner = blockedText(rate, { owner: true, memberName }, 'Europe/Paris');
    expect(owner.title).toBe('Le calcul est bloqué : Théo n’a pas de taux pour cette quinzaine.');
    expect(plain(owner.text)).toBe(
      'Un rapport validé de Théo tombe sur une quinzaine où son taux n’a pas encore commencé. C’est une donnée d’avant le correctif du 28/10, qui ne peut plus se produire. Aucun geste de l’écran ne la corrige, puisqu’un rapport validé ne change pas et qu’un taux ne part jamais en arrière : elle se corrige dans la base, puis le calcul reprend seul. D’ici là, les chiffres ci-dessous sont ceux du dernier calcul réussi : ils ne sont plus à jour. Bloqué depuis le vendredi 2 mai à 10 h 30.',
    );
    const two = blockedText({ ...rate, memberIds: [theo, lea] }, { owner: true, memberName }, null);
    expect(two.title).toBe('Le calcul est bloqué : Théo et Léa n’ont pas de taux pour cette quinzaine.');
    expect(two.text).toMatch(
      /^Des rapports validés de Théo et Léa tombent sur une quinzaine où leur taux n’a pas encore commencé\./u,
    );
    expect(two.text).not.toMatch(/Ajoute/u);
    expect(two.text).not.toMatch(/Bloqué depuis/u);
  });

  it('tells a manager the owner is told, and a member nobody’s name', () => {
    expect(blockedText(rate, { owner: false, memberName }, null).text).toMatch(
      /^Un rapport validé de Théo tombe .*\. Le propriétaire est prévenu ; le calcul reprendra seul une fois la donnée corrigée\./u,
    );
    expect(blockedText({ ...rate, memberIds: [] }, { owner: false, memberName }, null).title).toBe(
      'Le calcul est bloqué : un membre de l’équipe n’a pas de taux pour cette quinzaine.',
    );
  });

  it('says which rate of the ECB is missing', () => {
    const block = { code: 'exchange_rate_missing_conflict' as const, currency: 'USD' as const, since };
    const said = blockedText(block, { owner: true, memberName }, null);
    expect(said.title).toBe(
      'Le calcul est bloqué : le taux du dollar de la BCE manque pour cette quinzaine.',
    );
    expect(said.text).toMatch(/le calcul reprendra seul/u);
  });
});

describe('a blocked period, as the member reads it', () => {
  const since = '2025-05-02T08:30:00.000Z';

  it('says their statement is out of date, who is told, and no colleague by name', () => {
    const mine = myBlockedText({
      code: 'commission_rate_missing_conflict',
      memberIds: [newId(TeamMemberIdSchema)],
      since,
    });
    expect(mine.title).toBe('Ton relevé n’est plus à jour : le calcul de la quinzaine est bloqué.');
    expect(mine.text).toMatch(
      /^Un de tes rapports validés tombe sur une quinzaine où ton taux n’a pas encore commencé\. Le propriétaire est prévenu/u,
    );
    expect(myBlockedText({ code: 'commission_rate_missing_conflict', memberIds: [], since }).text).toMatch(
      /^Il manque un taux de commission dans l’équipe/u,
    );
    expect(myBlockedText({ code: 'exchange_rate_missing_conflict', currency: 'USD', since }).text).toMatch(
      /^Le taux du dollar de la BCE manque/u,
    );
    // Their own report blocks the period before any statement: no amount to call out of date.
    const none = myBlockedText({ code: 'commission_rate_missing_conflict', memberIds: [], since }, false);
    expect(none.title).toBe('Ton relevé n’est pas encore calculé : le calcul de la quinzaine est bloqué.');
    expect(none.text).toBe(
      'Il manque un taux de commission dans l’équipe pour cette quinzaine. Le propriétaire est prévenu dans sa paie ; le calcul reprendra seul une fois réglé.',
    );
  });

  it('marks the period « Plus à jour » in the member’s list, its amount that of the last computation', () => {
    const blocked = summary({
      blocked: { code: 'exchange_rate_missing_conflict', currency: 'USD', since },
    });
    expect(memberPhaseChip(blocked)).toEqual({ label: 'Plus à jour', tone: 'warn' });
    expect(memberPeriodAmount(blocked)).toEqual({ minor: 30_000, what: 'au dernier calcul' });
  });
});
