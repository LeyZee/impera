import {
  CARRY_OVER_RANK_MAX,
  COMMISSION_STATEMENT_STATUSES,
  CurrencySchema,
  EARNINGS_BASES,
  EARNINGS_SOURCES,
  ForeignCurrencySchema,
  PAY_AMOUNT_MAX_MINOR,
  PAY_PERIOD_BLOCK_CODES,
  PAY_TARGET_MAX_MINOR,
  PAYMENT_METHODS,
  PAYMENT_REFERENCE_MAX,
  PAYOUT_DELAY_MAX_BUSINESS_DAYS,
  PENALTY_KINDS,
  PlatformSchema,
  SALE_HELD_REASONS,
  SaleDecisionOutcomeSchema,
  SaleEventSchema,
  SaleSignalKindSchema,
} from '@nirvana/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  type PgColumn,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, id, timestampTz, updatedAt } from './columns';
import { shiftReports } from './scheduling';
import { teamMembers } from './team';
import { creators, platformAccounts } from './tenancy';

/**
 * Pay (ADR 0023 § Paie). The rules of an account carry `creator_id`: read inside `withTenantMember` of that creator,
 * by the owner and an active manager, and by a member who has a shift on the account (the currency of their reports).
 * Added only, by the owner alone: neither the policies nor the grants of the migration let a row change.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const readsTeam: SQL = sql`${currentScope} in ('owner', 'agency')`;
const isOwner: SQL = sql`${currentScope} = 'owner'`;
const anyMember: SQL = sql`${currentScope} is not null`;

/** The member of the row is the signed-in account. */
const isMine = (memberId: PgColumn | SQL): SQL =>
  sql`exists (select 1 from team_members m where m.id = ${memberId} and m.user_id = ${currentUser})`;

/** A period: the first or the sixteenth of a month. */
const periodCheck = (name: string, period: PgColumn): ReturnType<typeof check> =>
  check(name, sql`extract(day from ${period}) in (1, 16)`);

const amountMax = sql.raw(String(PAY_AMOUNT_MAX_MINOR));
const referenceMax = sql.raw(String(PAYMENT_REFERENCE_MAX));
const targetMax = sql.raw(String(PAY_TARGET_MAX_MINOR));
const payoutDelayMax = sql.raw(String(PAYOUT_DELAY_MAX_BUSINESS_DAYS));
const carryOverRankMax = sql.raw(String(CARRY_OVER_RANK_MAX));

/**
 * An account's pay rules from `from_period` on (contracts `pay-rules.ts`, EQ-03): one per account and period at most,
 * whole basis points, a period's first day.
 */
export const accountPayRules = pgTable(
  'account_pay_rules',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id').notNull(),
    fromPeriod: date('from_period').notNull(),
    currency: text('currency').notNull(),
    vatBps: integer('vat_bps').notNull(),
    platformFeeBps: integer('platform_fee_bps').notNull(),
    earningsSource: text('earnings_source').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'account_pay_rules_account_creator_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    unique('account_pay_rules_account_period_unique').on(t.platformAccountId, t.fromPeriod),
    check('account_pay_rules_period_check', sql`extract(day from ${t.fromPeriod}) in (1, 16)`),
    check(
      'account_pay_rules_bps_check',
      sql`${t.vatBps} between 0 and 10000 and ${t.platformFeeBps} between 0 and 10000`,
    ),
    enumCheck('account_pay_rules', t.currency, CurrencySchema.options),
    enumCheck('account_pay_rules', t.earningsSource, EARNINGS_SOURCES),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and (${currentScope} in ('owner', 'agency') or exists (select 1 from shifts s join team_members m on m.id = s.member_id where s.platform_account_id = ${t.platformAccountId} and m.user_id = ${currentUser}))`,
    }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${currentScope} = 'owner' and ${t.createdBy} = ${currentUser}`,
    }),
  ],
);

/*
 * Commission statements (EQ-04, contracts `payroll.ts`). Out of the creators' RLS (no `creator_id`): a member reads
 * their own rows, the scope `owner` | `agency` of `withMember` reads every row. Statements and their lines are written
 * by the recalculation job (`withAdmin`); the application validates a draft (owner, active manager, never their own)
 * and marks a validated one paid (owner only). Triggers of the migration keep the past for every role: a validated
 * statement never changes but to `paid`, lines, adjustments, carry-overs, tiers, goals and rates are added only, and
 * nothing is written for a period a validated statement has closed.
 */

/** A period as pay first wrote it: its instants in the agency's zone of that day. Written by the job. */
export const payPeriods = pgTable(
  'pay_periods',
  {
    period: date('period').primaryKey(),
    startsAt: timestampTz('starts_at').notNull(),
    endsAt: timestampTz('ends_at').notNull(),
    timeZone: text('time_zone').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    periodCheck('pay_periods_period_check', t.period),
    check('pay_periods_window_check', sql`${t.endsAt} > ${t.startsAt}`),
    pgPolicy('team_read', { for: 'select', using: anyMember }),
  ],
);

/** Euros for one unit of a currency, in millionths, read by the rate job (`withAdmin`) once a day. */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    currency: text('currency').notNull(),
    day: date('day').notNull(),
    rateMicros: bigint('rate_micros', { mode: 'number' }).notNull(),
    source: text('source').notNull(),
    fetchedAt: timestampTz('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'exchange_rates_pkey', columns: [t.currency, t.day] }),
    enumCheck('exchange_rates', t.currency, ForeignCurrencySchema.options),
    check('exchange_rates_rate_check', sql`${t.rateMicros} > 0`),
    check('exchange_rates_source_check', sql`char_length(${t.source}) between 1 and 100`),
    pgPolicy('team_read', { for: 'select', using: anyMember }),
  ],
);

/** One row at most (`id = 1`): no row means the contracts' defaults (`DEFAULT_MINIMUM_PAYOUT_MINOR`). */
export const payrollSettings = pgTable(
  'payroll_settings',
  {
    id: smallint('id').primaryKey(),
    minimumPayoutMinor: integer('minimum_payout_minor').notNull(),
    /** PAIE-32: business days between validation and payout, as announced to the team; null announces none. */
    payoutDelayBusinessDays: smallint('payout_delay_business_days'),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('payroll_settings_single_check', sql`${t.id} = 1`),
    check('payroll_settings_minimum_check', sql`${t.minimumPayoutMinor} between 0 and ${amountMax}`),
    check(
      'payroll_settings_payout_delay_check',
      sql`${t.payoutDelayBusinessDays} is null or ${t.payoutDelayBusinessDays} between 1 and ${payoutDelayMax}`,
    ),
    pgPolicy('team_read', { for: 'select', using: anyMember }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.updatedBy} = ${currentUser}`,
    }),
    pgPolicy('owner_update', {
      for: 'update',
      using: isOwner,
      withCheck: sql`${isOwner} and ${t.updatedBy} = ${currentUser}`,
    }),
  ],
);

/**
 * The payout minimum from a period on (PAIE-22), added only, from a period that has not begun; the newest of the latest
 * period at or before a period is in force, `payroll_settings` before any.
 */
export const payoutMinimums = pgTable(
  'payout_minimums',
  {
    id: id(),
    fromPeriod: date('from_period').notNull(),
    minimumPayoutMinor: integer('minimum_payout_minor').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    periodCheck('payout_minimums_period_check', t.fromPeriod),
    check('payout_minimums_minimum_check', sql`${t.minimumPayoutMinor} between 0 and ${amountMax}`),
    index('payout_minimums_period_idx').on(t.fromPeriod),
    pgPolicy('team_read', { for: 'select', using: anyMember }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.createdBy} = ${currentUser}`,
    }),
  ],
);

/** The individual tiers from a period on; the newest of the latest period at or before a period is in force. */
export const bonusTierSets = pgTable(
  'bonus_tier_sets',
  {
    id: id(),
    fromPeriod: date('from_period').notNull(),
    tiers: jsonb('tiers').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    periodCheck('bonus_tier_sets_period_check', t.fromPeriod),
    check('bonus_tier_sets_tiers_check', sql`jsonb_typeof(${t.tiers}) = 'array'`),
    index('bonus_tier_sets_period_idx').on(t.fromPeriod),
    pgPolicy('team_read', { for: 'select', using: anyMember }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.createdBy} = ${currentUser}`,
    }),
  ],
);

/** The team's goal for a period; its newest row is in force, none when it has no tier. */
export const collectiveGoals = pgTable(
  'collective_goals',
  {
    id: id(),
    period: date('period').notNull(),
    targetMinor: bigint('target_minor', { mode: 'number' }).notNull(),
    tiers: jsonb('tiers').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    periodCheck('collective_goals_period_check', t.period),
    check('collective_goals_target_check', sql`${t.targetMinor} between 1 and ${targetMax}`),
    check('collective_goals_tiers_check', sql`jsonb_typeof(${t.tiers}) = 'array'`),
    index('collective_goals_period_idx').on(t.period),
    pgPolicy('team_read', { for: 'select', using: anyMember }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.createdBy} = ${currentUser}`,
    }),
  ],
);

/** Who reads a member's pay row: the member, and the scope `owner` | `agency`. */
const memberRead = (memberId: PgColumn): ReturnType<typeof pgPolicy> =>
  pgPolicy('member_read', { for: 'select', using: sql`${readsTeam} or ${isMine(memberId)}` });

/** Written by the owner or an active manager, never for themselves. */
const agencyWrites = (memberId: PgColumn, by: PgColumn): SQL =>
  sql`${readsTeam} and ${by} = ${currentUser} and not ${isMine(memberId)}`;

/** A manual bonus for a member and a period, cancelled (never deleted) while the period is open for the member. */
export const bonuses = pgTable(
  'bonuses',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    period: date('period').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    reason: text('reason').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    cancelledAt: timestampTz('cancelled_at'),
    cancelledBy: text('cancelled_by').references(() => user.id),
  },
  (t) => [
    periodCheck('bonuses_period_check', t.period),
    check('bonuses_amount_check', sql`${t.amountMinor} between 1 and ${amountMax}`),
    check('bonuses_reason_check', sql`char_length(${t.reason}) between 1 and 500`),
    check('bonuses_cancellation_check', sql`(${t.cancelledAt} is null) = (${t.cancelledBy} is null)`),
    index('bonuses_member_period_idx').on(t.memberId, t.period),
    memberRead(t.memberId),
    pgPolicy('agency_insert', {
      for: 'insert',
      withCheck: sql`${agencyWrites(t.memberId, t.createdBy)} and ${t.cancelledAt} is null`,
    }),
    pgPolicy('agency_cancel', {
      for: 'update',
      using: sql`${readsTeam} and not ${isMine(t.memberId)} and ${t.cancelledAt} is null`,
      withCheck: agencyWrites(t.memberId, t.cancelledBy),
    }),
  ],
);

/** A penalty over one or more periods, fixed or a percent of the member's net; cancelled from a period on. */
export const penalties = pgTable(
  'penalties',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    fromPeriod: date('from_period').notNull(),
    toPeriod: date('to_period').notNull(),
    kind: text('kind').notNull(),
    amountMinor: integer('amount_minor'),
    bps: integer('bps'),
    reason: text('reason').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    cancelledAt: timestampTz('cancelled_at'),
    cancelledBy: text('cancelled_by').references(() => user.id),
    cancelledFrom: date('cancelled_from'),
  },
  (t) => [
    periodCheck('penalties_from_period_check', t.fromPeriod),
    periodCheck('penalties_to_period_check', t.toPeriod),
    check('penalties_periods_check', sql`${t.toPeriod} >= ${t.fromPeriod}`),
    enumCheck('penalties', t.kind, PENALTY_KINDS),
    check(
      'penalties_amount_check',
      sql`case when ${t.kind} = 'fixed' then ${t.amountMinor} between 1 and ${amountMax} and ${t.bps} is null else ${t.bps} between 1 and 10000 and ${t.amountMinor} is null end`,
    ),
    check('penalties_reason_check', sql`char_length(${t.reason}) between 1 and 500`),
    check(
      'penalties_cancellation_check',
      sql`(${t.cancelledAt} is null) = (${t.cancelledBy} is null) and (${t.cancelledAt} is null) = (${t.cancelledFrom} is null) and (${t.cancelledFrom} is null or (extract(day from ${t.cancelledFrom}) in (1, 16) and ${t.cancelledFrom} between ${t.fromPeriod} and ${t.toPeriod}))`,
    ),
    index('penalties_member_period_idx').on(t.memberId, t.fromPeriod),
    memberRead(t.memberId),
    pgPolicy('agency_insert', {
      for: 'insert',
      withCheck: sql`${agencyWrites(t.memberId, t.createdBy)} and ${t.cancelledAt} is null`,
    }),
    pgPolicy('agency_cancel', {
      for: 'update',
      using: sql`${readsTeam} and not ${isMine(t.memberId)} and ${t.cancelledAt} is null`,
      withCheck: agencyWrites(t.memberId, t.cancelledBy),
    }),
  ],
);

/**
 * A member's statement for a period: one per member and period, its amounts as the engine gave them, the rules and
 * rates it used (`rules`), what it counted (`counted`: bonuses, penalties, carry-overs, adjustments) and the team's
 * figures. `revision` grows at each recalculation that changes it. Once paid, how (ADR 0023 § Factures): the day of the
 * transfer, the method, its reference (a transfer's, never an IBAN) and what was sent.
 */
export const commissionStatements = pgTable(
  'commission_statements',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    period: date('period')
      .notNull()
      .references(() => payPeriods.period),
    status: text('status').notNull(),
    revision: integer('revision').notNull(),
    engineVersion: text('engine_version').notNull(),
    inputsHash: text('inputs_hash').notNull(),
    netMinor: integer('net_minor').notNull(),
    commissionMinor: integer('commission_minor').notNull(),
    teamShareBaseMinor: bigint('team_share_base_minor', { mode: 'number' }),
    teamShareBps: integer('team_share_bps'),
    teamShareMinor: integer('team_share_minor'),
    tierBonus: jsonb('tier_bonus'),
    collectiveBonusMinor: integer('collective_bonus_minor').notNull(),
    bonusesMinor: integer('bonuses_minor').notNull(),
    penaltiesRequestedMinor: integer('penalties_requested_minor').notNull(),
    penaltiesMinor: integer('penalties_minor').notNull(),
    carryOversInMinor: integer('carry_overs_in_minor').notNull(),
    adjustmentsMinor: integer('adjustments_minor').notNull(),
    totalMinor: integer('total_minor').notNull(),
    carryOverOutMinor: integer('carry_over_out_minor').notNull(),
    payableMinor: integer('payable_minor').notNull(),
    teamNetMinor: bigint('team_net_minor', { mode: 'number' }).notNull(),
    collective: jsonb('collective'),
    rules: jsonb('rules').notNull(),
    counted: jsonb('counted').notNull(),
    computedAt: timestampTz('computed_at').notNull(),
    validatedAt: timestampTz('validated_at'),
    validatedBy: text('validated_by').references(() => user.id),
    paidAt: timestampTz('paid_at'),
    paidBy: text('paid_by').references(() => user.id),
    paidOn: date('paid_on'),
    paymentMethod: text('payment_method'),
    paymentReference: text('payment_reference'),
    sentMinor: integer('sent_minor'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('commission_statements_member_period_unique').on(t.memberId, t.period),
    enumCheck('commission_statements', t.status, COMMISSION_STATEMENT_STATUSES),
    check('commission_statements_revision_check', sql`${t.revision} >= 1`),
    check('commission_statements_engine_check', sql`${t.engineVersion} ~ '^nirvana-[0-9]+$'`),
    check('commission_statements_hash_check', sql`${t.inputsHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'commission_statements_amounts_check',
      sql`${t.payableMinor} >= 0 and ${t.payableMinor} = ${t.totalMinor} - ${t.carryOverOutMinor} and ${t.penaltiesMinor} between 0 and greatest(${t.penaltiesRequestedMinor}, 0)`,
    ),
    check(
      'commission_statements_team_share_check',
      sql`(${t.teamShareBps} is null) = (${t.teamShareMinor} is null) and (${t.teamShareBps} is null) = (${t.teamShareBaseMinor} is null) and (${t.teamShareBps} is null or ${t.teamShareBps} between 0 and 10000)`,
    ),
    check(
      'commission_statements_state_check',
      sql`(${t.validatedAt} is null) = (${t.validatedBy} is null) and (${t.paidAt} is null) = (${t.paidBy} is null) and (${t.status} = 'draft') = (${t.validatedAt} is null) and (${t.status} = 'paid') = (${t.paidAt} is not null)`,
    ),
    enumCheck('commission_statements', t.paymentMethod, PAYMENT_METHODS),
    check(
      'commission_statements_payment_check',
      sql`(${t.status} = 'paid') = (${t.paidOn} is not null) and (${t.paidOn} is null) = (${t.paymentMethod} is null) and (${t.paidOn} is null) = (${t.sentMinor} is null) and (${t.paymentReference} is null or (${t.paidOn} is not null and char_length(${t.paymentReference}) between 1 and ${referenceMax})) and (${t.sentMinor} is null or ${t.sentMinor} between 1 and ${amountMax})`,
    ),
    index('commission_statements_period_idx').on(t.period),
    memberRead(t.memberId),
    pgPolicy('agency_validate', {
      for: 'update',
      using: sql`${readsTeam} and ${t.status} = 'draft' and not ${isMine(t.memberId)}`,
      withCheck: sql`${readsTeam} and ${t.status} = 'validated' and ${t.validatedBy} = ${currentUser} and not ${isMine(t.memberId)}`,
    }),
    pgPolicy('owner_pay', {
      for: 'update',
      using: sql`${isOwner} and ${t.status} = 'validated'`,
      withCheck: sql`${isOwner} and ${t.status} = 'paid' and ${t.paidBy} = ${currentUser}`,
    }),
  ],
);

/**
 * One account of a statement's revision, each step of Imperium's chain; added only, by the job. `base` says where its
 * gross comes from (ADR 0050 § 8): `gross_chain`, its reports under the chain of ADR 0023; `platform_net`, the
 * platform's net of the sales it counts (`sales`, CRM-03), without VAT nor the platform's commission to take off.
 */
export const commissionStatementLines = pgTable(
  'commission_statement_lines',
  {
    id: id(),
    statementId: uuid('statement_id')
      .notNull()
      .references(() => commissionStatements.id),
    revision: integer('revision').notNull(),
    platformAccountId: uuid('platform_account_id')
      .notNull()
      .references(() => platformAccounts.id),
    currency: text('currency').notNull(),
    vatBps: integer('vat_bps').notNull(),
    platformFeeBps: integer('platform_fee_bps').notNull(),
    rateMicros: bigint('rate_micros', { mode: 'number' }).notNull(),
    grossMinor: integer('gross_minor').notNull(),
    grossEurMinor: integer('gross_eur_minor').notNull(),
    exclVatMinor: integer('excl_vat_minor').notNull(),
    netMinor: integer('net_minor').notNull(),
    commissionMinor: integer('commission_minor').notNull(),
    shiftReportIds: uuid('shift_report_ids').array().notNull(),
    lateReports: jsonb('late_reports').notNull(),
    base: text('base').notNull().default('gross_chain'),
    sales: jsonb('sales')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    unique('commission_statement_lines_rules_unique').on(
      t.statementId,
      t.revision,
      t.platformAccountId,
      t.currency,
      t.vatBps,
      t.platformFeeBps,
      t.base,
    ),
    enumCheck('commission_statement_lines', t.currency, CurrencySchema.options),
    enumCheck('commission_statement_lines', t.base, EARNINGS_BASES),
    check(
      'commission_statement_lines_sales_check',
      sql`jsonb_typeof(${t.sales}) = 'array' and (${t.base} = 'platform_net' or ${t.sales} = '[]'::jsonb) and (${t.base} = 'gross_chain' or (${t.vatBps} = 0 and ${t.platformFeeBps} = 0 and cardinality(${t.shiftReportIds}) = 0 and ${t.lateReports} = '[]'::jsonb))`,
    ),
    check(
      'commission_statement_lines_rules_check',
      sql`${t.revision} >= 1 and ${t.rateMicros} > 0 and ${t.vatBps} between 0 and 10000 and ${t.platformFeeBps} between 0 and 10000`,
    ),
    check('commission_statement_lines_late_check', sql`jsonb_typeof(${t.lateReports}) = 'array'`),
    pgPolicy('member_read', {
      for: 'select',
      using: sql`exists (select 1 from commission_statements s where s.id = ${t.statementId} and (${readsTeam} or ${isMine(sql`s.member_id`)}))`,
    }),
  ],
);

/**
 * A correction landed on the member's first open period; added only. `contested_invoice_id` names the document whose
 * upheld contest it corrects (ADR 0039 § 3, migration 0050): of its member, correcting its period, written in the
 * transaction of the `contest_upheld` it goes with. Its foreign key to `invoices` is the migration's: `invoices.ts`
 * imports this file, and the schema keeps no cycle.
 */
export const payAdjustments = pgTable(
  'pay_adjustments',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    period: date('period').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    reason: text('reason').notNull(),
    correctsStatementId: uuid('corrects_statement_id').references(() => commissionStatements.id),
    contestedInvoiceId: uuid('contested_invoice_id'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    periodCheck('pay_adjustments_period_check', t.period),
    // A correction of a contest corrects the document's period: it always names the statement.
    check(
      'pay_adjustments_contest_check',
      sql`${t.contestedInvoiceId} is null or ${t.correctsStatementId} is not null`,
    ),
    index('pay_adjustments_contested_idx').on(t.contestedInvoiceId),
    check(
      'pay_adjustments_amount_check',
      sql`${t.amountMinor} between -${amountMax} and ${amountMax} and ${t.amountMinor} <> 0`,
    ),
    check('pay_adjustments_reason_check', sql`char_length(${t.reason}) between 1 and 500`),
    index('pay_adjustments_member_period_idx').on(t.memberId, t.period),
    memberRead(t.memberId),
    pgPolicy('agency_insert', { for: 'insert', withCheck: agencyWrites(t.memberId, t.createdBy) }),
  ],
);

/**
 * What a validated statement carried to the next period: one per member and period it comes from, added only. `rank`:
 * how many times in a row a positive amount has been carried, this one included, 2 at most (ADR 0038); always 1 for a
 * negative one. `keep_carry_over` checks it against the member's carry-over before (migration 0043).
 */
export const carryOvers = pgTable(
  'carry_overs',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    fromPeriod: date('from_period').notNull(),
    toPeriod: date('to_period').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    rank: smallint('rank').notNull().default(1),
    statementId: uuid('statement_id')
      .notNull()
      .unique()
      .references(() => commissionStatements.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('carry_overs_member_period_unique').on(t.memberId, t.fromPeriod),
    check(
      'carry_overs_rank_check',
      sql`${t.rank} between 1 and ${carryOverRankMax} and (${t.rank} = 1 or ${t.amountMinor} > 0)`,
    ),
    periodCheck('carry_overs_from_period_check', t.fromPeriod),
    periodCheck('carry_overs_to_period_check', t.toPeriod),
    check('carry_overs_periods_check', sql`${t.toPeriod} > ${t.fromPeriod}`),
    check('carry_overs_amount_check', sql`${t.amountMinor} <> 0`),
    index('carry_overs_member_to_idx').on(t.memberId, t.toPeriod),
    memberRead(t.memberId),
    pgPolicy('agency_insert', {
      for: 'insert',
      withCheck: sql`${readsTeam} and not ${isMine(t.memberId)}`,
    }),
  ],
);

/*
 * The closing of a period for the whole team (ADR 0032, migration 0029): the first validation of one of its
 * statements writes it, with the registry of the reports it counted, in its own transaction. Added only, for every
 * role; written by the owner or an active manager, read by every member.
 */

/**
 * A period closed for the team: its team net and collective goal as reached, and the exchange rates of its last day,
 * frozen for every statement of the period.
 */
export const payPeriodClosings = pgTable(
  'pay_period_closings',
  {
    period: date('period')
      .primaryKey()
      .references(() => payPeriods.period),
    teamNetMinor: bigint('team_net_minor', { mode: 'number' }).notNull(),
    collective: jsonb('collective'),
    exchangeRates: jsonb('exchange_rates').notNull(),
    closedBy: text('closed_by')
      .notNull()
      .references(() => user.id),
    closedAt: timestampTz('closed_at').notNull().defaultNow(),
  },
  (t) => [
    periodCheck('pay_period_closings_period_check', t.period),
    check('pay_period_closings_rates_check', sql`jsonb_typeof(${t.exchangeRates}) = 'array'`),
    pgPolicy('team_read', { for: 'select', using: anyMember }),
    pgPolicy('agency_insert', {
      for: 'insert',
      withCheck: sql`${readsTeam} and ${t.closedBy} = ${currentUser}`,
    }),
  ],
);

/** The registry of counted reports: a report is counted once, in the period of the closing that wrote it. */
export const payPeriodReports = pgTable(
  'pay_period_reports',
  {
    shiftReportId: uuid('shift_report_id')
      .primaryKey()
      .references(() => shiftReports.id),
    period: date('period')
      .notNull()
      .references(() => payPeriodClosings.period),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('pay_period_reports_period_member_idx').on(t.period, t.memberId),
    memberRead(t.memberId),
    pgPolicy('agency_insert', { for: 'insert', withCheck: readsTeam }),
  ],
);

/**
 * The registry of counted sales (CRM-03, ADR 0050 §§ 5 and 7, on the model of `pay_period_reports`): a line of the
 * platform's register is counted once, in the period of the closing that wrote it, for the member and the link's
 * version that closing saw. It keeps what a statement takes from the line (account, currency, signed net, the sale's
 * period), so that a closed period counts it again without reading the register.
 */
export const payPeriodSales = pgTable(
  'pay_period_sales',
  {
    platform: text('platform').notNull(),
    platformSaleId: text('platform_sale_id').notNull(),
    event: text('event').notNull(),
    period: date('period')
      .notNull()
      .references(() => payPeriodClosings.period),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    linkVersion: text('link_version').notNull(),
    platformAccountId: uuid('platform_account_id')
      .notNull()
      .references(() => platformAccounts.id),
    currency: text('currency').notNull(),
    netMinor: integer('net_minor').notNull(),
    salePeriod: date('sale_period').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'pay_period_sales_pkey', columns: [t.platform, t.platformSaleId, t.event] }),
    index('pay_period_sales_period_member_idx').on(t.period, t.memberId),
    enumCheck('pay_period_sales', t.platform, PlatformSchema.options),
    enumCheck('pay_period_sales', t.event, SaleEventSchema.options),
    enumCheck('pay_period_sales', t.currency, CurrencySchema.options),
    periodCheck('pay_period_sales_sale_period_check', t.salePeriod),
    check(
      'pay_period_sales_net_check',
      sql`${t.salePeriod} <= ${t.period} and ((${t.event} = 'sale' and ${t.netMinor} >= 0) or (${t.event} = 'refund' and ${t.netMinor} <= 0))`,
    ),
    memberRead(t.memberId),
    pgPolicy('agency_insert', { for: 'insert', withCheck: readsTeam }),
  ],
);

/**
 * The sales a closing left held (CRM-03 lot b3, ADR 0050 § 5, ADR 0032): a line of the platform's register that the
 * closing would have taken but that counted for nobody (`reason`, contracts `SaleHeldReason`). Written once, by the
 * first closing that left it, never changed. The team's first open period reads these lines again, by their sale, until
 * a closing counts them: a decision, a new link or a shift entered after the closing still brings them in.
 */
export const payPeriodHeldSales = pgTable(
  'pay_period_held_sales',
  {
    platform: text('platform').notNull(),
    platformSaleId: text('platform_sale_id').notNull(),
    event: text('event').notNull(),
    period: date('period')
      .notNull()
      .references(() => payPeriodClosings.period),
    platformAccountId: uuid('platform_account_id')
      .notNull()
      .references(() => platformAccounts.id),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'pay_period_held_sales_pkey', columns: [t.platform, t.platformSaleId, t.event] }),
    enumCheck('pay_period_held_sales', t.platform, PlatformSchema.options),
    enumCheck('pay_period_held_sales', t.event, SaleEventSchema.options),
    enumCheck('pay_period_held_sales', t.reason, SALE_HELD_REASONS),
    pgPolicy('agency_read', { for: 'select', using: readsTeam }),
    pgPolicy('agency_insert', { for: 'insert', withCheck: readsTeam }),
  ],
);

/**
 * The validator's decisions on sales (CRM-03 lot b3, ADR 0050 § 5): a sale counts for the member its chatter is linked
 * to (`count`), or for nobody (`exclude`), its refunds with it; `withdraw` takes back the decision in force. Added
 * only, numbered per sale from 1 without a gap: the latest counts, while the chatter's link keeps `link_version`
 * (`null` for a chatter not linked or none). Written by the owner or an active manager, never on a sale of their own
 * chatter (`author_member_id`, the member linked then), never on a sale a closing counted. The team's first open
 * period reads every decided sale no closing counted again, so that a decision can be taken back or lapse.
 */
export const paySaleDecisions = pgTable(
  'pay_sale_decisions',
  {
    id: id(),
    platform: text('platform').notNull(),
    platformSaleId: text('platform_sale_id').notNull(),
    revision: integer('revision').notNull(),
    platformAccountId: uuid('platform_account_id')
      .notNull()
      .references(() => platformAccounts.id),
    outcome: text('outcome').notNull(),
    reason: text('reason'),
    authorMemberId: uuid('author_member_id').references(() => teamMembers.id),
    linkVersion: text('link_version'),
    note: text('note'),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('pay_sale_decisions_revision_unique').on(t.platform, t.platformSaleId, t.revision),
    enumCheck('pay_sale_decisions', t.platform, PlatformSchema.options),
    enumCheck('pay_sale_decisions', t.outcome, SaleDecisionOutcomeSchema.options),
    check(
      'pay_sale_decisions_reason_check',
      sql`${t.reason} is null or ${t.reason} in (${sql.raw(SALE_HELD_REASONS.map((one) => `'${one}'`).join(', '))})`,
    ),
    check('pay_sale_decisions_revision_check', sql`${t.revision} >= 1`),
    check(
      'pay_sale_decisions_note_check',
      sql`${t.note} is null or char_length(${t.note}) between 1 and 500`,
    ),
    check(
      'pay_sale_decisions_count_check',
      sql`${t.outcome} <> 'count' or (${t.authorMemberId} is not null and ${t.linkVersion} is not null and ${t.reason} in ('off_shift', 'status_unknown'))`,
    ),
    check('pay_sale_decisions_link_check', sql`(${t.authorMemberId} is null) = (${t.linkVersion} is null)`),
    pgPolicy('member_read', {
      for: 'select',
      using: sql`${readsTeam} or (${t.authorMemberId} is not null and ${isMine(t.authorMemberId)})`,
    }),
    pgPolicy('agency_insert', {
      for: 'insert',
      withCheck: sql`${readsTeam} and ${t.decidedBy} = ${currentUser} and (${t.authorMemberId} is null or not ${isMine(t.authorMemberId)})`,
    }),
  ],
);

/**
 * A member's signals on lines of their own statement (CRM-03 lot b4c, ADR 0050 § 5): « ce n'est pas ma vente »
 * (`signal`), or its withdrawal (`withdraw`). Added only, numbered per line, member and period from 1: the latest counts,
 * a withdrawal never first nor after another. Each keeps what the line was on the member's statement then (account,
 * currency, signed net, instant), which the trigger checks, so that the member still reads it once the line has left.
 * Written by the member alone on their own statement of a period no closing closed, on a line no closing counted; read
 * by the member, the owner and an active manager. A signal changes no amount: the validator decides.
 */
export const paySaleSignals = pgTable(
  'pay_sale_signals',
  {
    id: id(),
    platform: text('platform').notNull(),
    platformSaleId: text('platform_sale_id').notNull(),
    event: text('event').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    period: date('period')
      .notNull()
      .references(() => payPeriods.period),
    revision: integer('revision').notNull(),
    kind: text('kind').notNull(),
    platformAccountId: uuid('platform_account_id')
      .notNull()
      .references(() => platformAccounts.id),
    currency: text('currency').notNull(),
    netMinor: integer('net_minor').notNull(),
    occurredAt: timestampTz('occurred_at'),
    note: text('note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('pay_sale_signals_revision_unique').on(
      t.platform,
      t.platformSaleId,
      t.event,
      t.memberId,
      t.period,
      t.revision,
    ),
    index('pay_sale_signals_period_member_idx').on(t.period, t.memberId),
    enumCheck('pay_sale_signals', t.platform, PlatformSchema.options),
    enumCheck('pay_sale_signals', t.event, SaleEventSchema.options),
    enumCheck('pay_sale_signals', t.kind, SaleSignalKindSchema.options),
    enumCheck('pay_sale_signals', t.currency, CurrencySchema.options),
    periodCheck('pay_sale_signals_period_check', t.period),
    check('pay_sale_signals_revision_check', sql`${t.revision} >= 1`),
    check('pay_sale_signals_note_check', sql`${t.note} is null or char_length(${t.note}) between 1 and 500`),
    check(
      'pay_sale_signals_net_check',
      sql`(${t.event} = 'sale' and ${t.netMinor} >= 0) or (${t.event} = 'refund' and ${t.netMinor} <= 0)`,
    ),
    memberRead(t.memberId),
    pgPolicy('member_insert', {
      for: 'insert',
      withCheck: sql`${isMine(t.memberId)} and ${t.createdBy} = ${currentUser}`,
    }),
  ],
);

/**
 * Why pay's job could not compute a period at its last try (EQ-04, recette du 28/10, Équipe G1): a member it pays
 * without a commission rate (`member_ids`, every one of them), or a currency without a usable rate (`currency`). One
 * row per period at most, written by the job (`withAdmin`) under `payroll.close` in the transaction of the computation
 * that failed, and deleted by the next one that passes: what it says is the state of the period now, not a history (the
 * job's log keeps that). `since` stays while the same reason holds. Read like `pay_periods`, by any member; what a
 * member reads of it is narrowed by the application (only themselves among `member_ids`).
 */
export const payPeriodBlocks = pgTable(
  'pay_period_blocks',
  {
    period: date('period')
      .primaryKey()
      .references(() => payPeriods.period),
    code: text('code').notNull(),
    memberIds: uuid('member_ids').array(),
    currency: text('currency'),
    since: timestampTz('since').notNull(),
  },
  (t) => [
    periodCheck('pay_period_blocks_period_check', t.period),
    enumCheck('pay_period_blocks', t.code, PAY_PERIOD_BLOCK_CODES),
    enumCheck('pay_period_blocks', t.currency, ForeignCurrencySchema.options),
    check(
      'pay_period_blocks_reason_check',
      sql`(${t.code} = 'commission_rate_missing_conflict' and cardinality(${t.memberIds}) > 0 and ${t.currency} is null) or (${t.code} = 'exchange_rate_missing_conflict' and ${t.memberIds} is null and ${t.currency} is not null)`,
    ),
    pgPolicy('team_read', { for: 'select', using: anyMember }),
  ],
);
