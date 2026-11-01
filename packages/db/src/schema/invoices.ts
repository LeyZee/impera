import {
  CONTRACT_TEXT_KINDS,
  CONTRACT_TEXT_MAX,
  CONTEST_DELAY_MAX_DAYS,
  CONTRACTOR_DOCUMENT_KINDS,
  DOCUMENT_REMINDER_MAX_DAYS,
  INVOICE_DOCUMENT_MENTIONS_MAX,
  INVOICE_DUE_MAX_DAYS,
  INVOICE_DUE_MIN_DAYS,
  INVOICE_EVENT_KINDS,
  INVOICE_KINDS,
  INVOICE_LINE_DETAIL_MAX,
  INVOICE_LINE_KINDS,
  INVOICE_LINE_LABEL_MAX,
  INVOICE_MENTIONS_MAX,
  INVOICE_PREFIX_PATTERN,
  INVOICE_REASON_MAX,
  LEGAL_NAME_MAX,
  PAY_AMOUNT_MAX_MINOR,
  PAYMENT_TERMS_MAX,
  POSTAL_ADDRESS_MAX,
  REGIME_NAME_MAX,
  STORAGE_KEY_MAX,
  TAX_ID_MAX,
  BILLING_EMAIL_MAX,
  VAT_TREATMENTS,
  WITHHOLDINGS,
} from '@nirvana/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, id, timestampTz, updatedAt } from './columns';
import { commissionStatements, payPeriods } from './payroll';
import { teamMembers } from './team';

/**
 * Contractors' invoices (EQ-06, ADR 0023 § Factures, ADR 0036). Agency tables, without `creator_id`: read inside
 * `withMember`, by the owner and an active manager (scope `owner` | `agency`, ADR 0023 § Données et RLS), and by the
 * member for his own file, documents, acceptances and invoices. Written by the owner or by the jobs (`nirvana_admin`);
 * the contractor writes only his file, his documents, his acceptances and his answer to an invoice. An issued invoice
 * never changes nor goes, nor its lines, its events or its PDF: its state is its events (the migration's triggers
 * refuse any change to every role, and the application has no `UPDATE` on them). Files (documents, PDFs) are a
 * `storage_key` in the object storage with their SHA-256 (ADR 0028, ADR 0030), never bytes here.
 */

const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const readsTeam: SQL = sql`${currentScope} in ('owner', 'agency')`;
const isOwner: SQL = sql`${currentScope} = 'owner'`;
const anyMember: SQL = sql`${currentScope} is not null`;

/** The member of the row is the signed-in account. */
const isMine = (memberId: PgColumn | SQL): SQL =>
  sql`exists (select 1 from team_members m where m.id = ${memberId} and m.user_id = ${currentUser})`;

/** The owner and an active manager read every row; a member reads his own. */
const memberRead = (memberId: PgColumn): ReturnType<typeof pgPolicy> =>
  pgPolicy('member_read', { for: 'select', using: sql`${readsTeam} or ${isMine(memberId)}` });

/** The owner writes for a contractor, never on a row of his own if he is a member too. */
const ownerFor = (memberId: PgColumn | SQL): SQL => sql`${isOwner} and not ${isMine(memberId)}`;

const num = (value: number): SQL => sql.raw(String(value));
const textBetween = (column: PgColumn, max: number): SQL =>
  sql`char_length(${column}) between 1 and ${num(max)}`;
const sha256Check = (column: PgColumn): SQL => sql`${column} ~ '^[0-9a-f]{64}$'`;
const kinds = (values: readonly string[]): SQL =>
  sql.raw(`array[${values.map((value) => `'${value}'`).join(', ')}]::text[]`);

/**
 * One row at most (`id = 1`): the agency's identity and payment terms on each invoice, the delays, the journal's
 * accounts.
 */
export const billingSettings = pgTable(
  'billing_settings',
  {
    id: smallint('id').primaryKey(),
    agency: jsonb('agency').notNull(),
    paymentTerms: text('payment_terms').notNull(),
    dueDays: smallint('due_days').notNull(),
    documentReminderDays: smallint('document_reminder_days').notNull(),
    accounts: jsonb('accounts').notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('billing_settings_single_check', sql`${t.id} = 1`),
    check(
      'billing_settings_json_check',
      sql`jsonb_typeof(${t.agency}) = 'object' and jsonb_typeof(${t.accounts}) = 'object'`,
    ),
    check('billing_settings_payment_terms_check', textBetween(t.paymentTerms, PAYMENT_TERMS_MAX)),
    check(
      'billing_settings_delays_check',
      sql`${t.dueDays} between ${num(INVOICE_DUE_MIN_DAYS)} and ${num(INVOICE_DUE_MAX_DAYS)} and ${t.documentReminderDays} between 1 and ${num(DOCUMENT_REMINDER_MAX_DAYS)}`,
    ),
    pgPolicy('team_read', { for: 'select', using: readsTeam }),
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
 * A billing regime for one or more countries, as the owner sets it. Added only: its text never changes (a new text is
 * a new regime, assigned from a day on), and the accountant's validation is a row of `billing_regime_validations`.
 */
export const billingRegimes = pgTable(
  'billing_regimes',
  {
    id: id(),
    name: text('name').notNull(),
    countries: text('countries').array().notNull(),
    vatTreatment: text('vat_treatment').notNull(),
    vatRateBps: integer('vat_rate_bps'),
    withholding: text('withholding').notNull(),
    mentions: text('mentions').array().notNull(),
    documents: text('documents').array().notNull(),
    taxIdRequired: boolean('tax_id_required').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('billing_regimes_name_check', textBetween(t.name, REGIME_NAME_MAX)),
    check(
      'billing_regimes_countries_check',
      sql`cardinality(${t.countries}) >= 1 and array_to_string(${t.countries}, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'`,
    ),
    enumCheck('billing_regimes', t.vatTreatment, VAT_TREATMENTS),
    check(
      'billing_regimes_vat_check',
      sql`(${t.vatTreatment} = 'exempt') = (${t.vatRateBps} is null) and (${t.vatRateBps} is null or ${t.vatRateBps} between 0 and 10000)`,
    ),
    enumCheck('billing_regimes', t.withholding, WITHHOLDINGS),
    check(
      'billing_regimes_mentions_check',
      sql`cardinality(${t.mentions}) <= ${num(INVOICE_MENTIONS_MAX)} and array_position(${t.mentions}, null) is null`,
    ),
    check('billing_regimes_documents_check', sql`${t.documents} <@ ${kinds(CONTRACTOR_DOCUMENT_KINDS)}`),
    pgPolicy('team_read', { for: 'select', using: anyMember }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.createdBy} = ${currentUser}`,
    }),
  ],
);

/**
 * The accountant validated this regime on this day, as the owner records it: once per regime, added only. A regime
 * without it, or validated after the day of issue, issues nothing (lot 1, `issueDecision`).
 */
export const billingRegimeValidations = pgTable(
  'billing_regime_validations',
  {
    regimeId: uuid('regime_id')
      .primaryKey()
      .references(() => billingRegimes.id),
    validatedOn: date('validated_on').notNull(),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => user.id),
    recordedAt: timestampTz('recorded_at').notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('team_read', { for: 'select', using: anyMember }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.recordedBy} = ${currentUser}`,
    }),
  ],
);

/** A contractor's regime from a day on, added only, each later than the last: a regime never goes back. */
export const contractorRegimes = pgTable(
  'contractor_regimes',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    regimeId: uuid('regime_id')
      .notNull()
      .references(() => billingRegimes.id),
    effectiveFrom: date('effective_from').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('contractor_regimes_member_from_unique').on(t.memberId, t.effectiveFrom),
    memberRead(t.memberId),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.createdBy} = ${currentUser}`,
    }),
  ],
);

/**
 * A contractor's file: the identity his invoices print. He fills it himself, the owner may too; only the owner checks
 * it and sets the prefix, and a change of identity clears the check (the migration's trigger). The country is his
 * member record's. Kept ten years with his invoices: never deleted.
 */
export const contractorProfiles = pgTable(
  'contractor_profiles',
  {
    memberId: uuid('member_id')
      .primaryKey()
      .references(() => teamMembers.id),
    legalName: text('legal_name').notNull(),
    address: text('address').notNull(),
    taxId: text('tax_id'),
    email: text('email').notNull(),
    invoicePrefix: text('invoice_prefix').unique('contractor_profiles_prefix_unique'),
    verifiedAt: timestampTz('verified_at'),
    verifiedBy: text('verified_by').references(() => user.id),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'contractor_profiles_texts_check',
      sql`${textBetween(t.legalName, LEGAL_NAME_MAX)} and ${textBetween(t.address, POSTAL_ADDRESS_MAX)} and (${t.taxId} is null or ${textBetween(t.taxId, TAX_ID_MAX)}) and ${textBetween(t.email, BILLING_EMAIL_MAX)}`,
    ),
    check(
      'contractor_profiles_prefix_check',
      sql`${t.invoicePrefix} is null or ${t.invoicePrefix} ~ ${sql.raw(`'${INVOICE_PREFIX_PATTERN}'`)}`,
    ),
    check('contractor_profiles_verified_check', sql`(${t.verifiedAt} is null) = (${t.verifiedBy} is null)`),
    memberRead(t.memberId),
    pgPolicy('member_insert', {
      for: 'insert',
      withCheck: sql`(${isMine(t.memberId)} or ${isOwner}) and ${t.updatedBy} = ${currentUser} and ${t.verifiedAt} is null`,
    }),
    pgPolicy('member_update', {
      for: 'update',
      using: sql`${isMine(t.memberId)} or ${isOwner}`,
      withCheck: sql`(${isMine(t.memberId)} or ${isOwner}) and ${t.updatedBy} = ${currentUser}`,
    }),
  ],
);

/** A dated document of the regime, added only: a new one never replaces the old, kept with the invoices it covered. */
export const contractorDocuments = pgTable(
  'contractor_documents',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    kind: text('kind').notNull(),
    issuedOn: date('issued_on').notNull(),
    validUntil: date('valid_until'),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('contractor_documents', t.kind, CONTRACTOR_DOCUMENT_KINDS),
    check(
      'contractor_documents_dates_check',
      sql`${t.validUntil} is null or ${t.validUntil} > ${t.issuedOn}`,
    ),
    check(
      'contractor_documents_file_check',
      sql`${textBetween(t.storageKey, STORAGE_KEY_MAX)} and ${sha256Check(t.sha256)}`,
    ),
    index('contractor_documents_member_idx').on(t.memberId, t.kind),
    memberRead(t.memberId),
    pgPolicy('member_insert', {
      for: 'insert',
      withCheck: sql`(${isMine(t.memberId)} or ${isOwner}) and ${t.createdBy} = ${currentUser}`,
    }),
  ],
);

/**
 * A version of the service contract or of the billing mandate: the agency's text as its accountant validated it,
 * never written by a session. Each version is the next of its kind; the mandate fixes the delay to contest. Its
 * SHA-256 is the base's (the migration's trigger), so an acceptance proves the exact text.
 */
export const contractTexts = pgTable(
  'contract_texts',
  {
    id: id(),
    kind: text('kind').notNull(),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    sha256: text('sha256').notNull(),
    contestDelayDays: smallint('contest_delay_days'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('contract_texts_kind_version_unique').on(t.kind, t.version),
    enumCheck('contract_texts', t.kind, CONTRACT_TEXT_KINDS),
    check(
      'contract_texts_body_check',
      sql`${t.version} >= 1 and ${textBetween(t.body, CONTRACT_TEXT_MAX)} and ${sha256Check(t.sha256)}`,
    ),
    check(
      'contract_texts_delay_check',
      sql`(${t.kind} = 'billing_mandate') = (${t.contestDelayDays} is not null) and (${t.contestDelayDays} is null or ${t.contestDelayDays} between 1 and ${num(CONTEST_DELAY_MAX_DAYS)})`,
    ),
    pgPolicy('team_read', { for: 'select', using: anyMember }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.createdBy} = ${currentUser}`,
    }),
  ],
);

/** A contractor accepted this version, himself, at this instant; the text's SHA-256 is copied as proof. Added only. */
export const contractAcceptances = pgTable(
  'contract_acceptances',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    textId: uuid('text_id')
      .notNull()
      .references(() => contractTexts.id),
    textSha256: text('text_sha256').notNull(),
    acceptedBy: text('accepted_by')
      .notNull()
      .references(() => user.id),
    acceptedAt: createdAt(),
  },
  (t) => [
    unique('contract_acceptances_member_text_unique').on(t.memberId, t.textId),
    check('contract_acceptances_sha_check', sha256Check(t.textSha256)),
    memberRead(t.memberId),
    pgPolicy('member_accept', {
      for: 'insert',
      withCheck: sql`${isMine(t.memberId)} and ${t.acceptedBy} = ${currentUser}`,
    }),
  ],
);

/**
 * The last number given to a contractor in a year, invoices and credit notes alike: locked `FOR UPDATE` by the
 * transaction that issues, which takes the next one (never a Postgres sequence, which leaves holes).
 */
export const invoiceCounters = pgTable(
  'invoice_counters',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    year: smallint('year').notNull(),
    lastSequence: integer('last_sequence').notNull(),
  },
  (t) => [
    primaryKey({ name: 'invoice_counters_pkey', columns: [t.memberId, t.year] }),
    check('invoice_counters_values_check', sql`${t.year} between 2000 and 9999 and ${t.lastSequence} >= 1`),
    pgPolicy('team_read', { for: 'select', using: readsTeam }),
    pgPolicy('owner_insert', { for: 'insert', withCheck: ownerFor(t.memberId) }),
    pgPolicy('owner_next', { for: 'update', using: ownerFor(t.memberId), withCheck: ownerFor(t.memberId) }),
  ],
);

const amountMax = num(PAY_AMOUNT_MAX_MINOR);

/**
 * A self-billed invoice or a credit note, frozen at its issue: the parties, the regime, the mentions and the lines are
 * copied in, and its number follows the contractor's counter, without hole nor repeat. An invoice bills one validated
 * statement of its period, at most one per statement, under the contractor's regime of its day of issue and once he
 * has accepted a billing mandate; it is written with its lines and its event `issued`. A credit note cites an invoice of the same contractor, keeps
 * its period (the service it corrects) and its regime, and never takes more than what is left of it; its statement,
 * when it has one, is the later one whose validation owes it (ADR 0036). The row never changes afterwards: its
 * acceptance is its events (`invoice_events`), its PDF a row of `invoice_pdfs` (lot 4).
 */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    kind: text('kind').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    statementId: uuid('statement_id').references(() => commissionStatements.id),
    creditedInvoiceId: uuid('credited_invoice_id'),
    period: date('period')
      .notNull()
      .references(() => payPeriods.period),
    prefix: text('prefix').notNull(),
    year: smallint('year').notNull(),
    sequence: integer('sequence').notNull(),
    number: text('number').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    issuedAt: timestampTz('issued_at').notNull().defaultNow(),
    issuedOn: date('issued_on').notNull(),
    issuedBy: text('issued_by').references(() => user.id),
    dueOn: date('due_on').notNull(),
    contractor: jsonb('contractor').notNull(),
    agency: jsonb('agency').notNull(),
    regimeId: uuid('regime_id')
      .notNull()
      .references(() => billingRegimes.id),
    regime: jsonb('regime').notNull(),
    mentions: text('mentions').array().notNull(),
    exclVatMinor: integer('excl_vat_minor').notNull(),
    vatMinor: integer('vat_minor').notNull(),
    inclVatMinor: integer('incl_vat_minor').notNull(),
    selfAssessedVatMinor: integer('self_assessed_vat_minor').notNull(),
    acceptanceDeadline: timestampTz('acceptance_deadline').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('invoices_number_unique').on(t.number),
    unique('invoices_sequence_unique').on(t.memberId, t.year, t.sequence),
    unique('invoices_idempotency_unique').on(t.idempotencyKey),
    uniqueIndex('invoices_statement_unique')
      .on(t.statementId)
      .where(sql`${t.kind} = 'invoice'`),
    index('invoices_member_period_idx').on(t.memberId, t.period),
    index('invoices_credited_idx').on(t.creditedInvoiceId),
    foreignKey({
      name: 'invoices_credited_invoice_id_invoices_id_fk',
      columns: [t.creditedInvoiceId],
      foreignColumns: [t.id],
    }),
    enumCheck('invoices', t.kind, INVOICE_KINDS),
    check(
      'invoices_document_check',
      sql`(${t.kind} = 'invoice' and ${t.statementId} is not null and ${t.creditedInvoiceId} is null and ${t.exclVatMinor} between 1 and ${amountMax}) or (${t.kind} = 'credit_note' and ${t.creditedInvoiceId} is not null and ${t.exclVatMinor} between -${amountMax} and -1)`,
    ),
    check(
      'invoices_number_check',
      sql`${t.prefix} ~ ${sql.raw(`'${INVOICE_PREFIX_PATTERN}'`)} and ${t.year} between 2000 and 9999 and ${t.sequence} >= 1 and ${t.number} = ${t.prefix} || '-' || ${t.year} || '-' || lpad(${t.sequence}::text, greatest(4, char_length(${t.sequence}::text)), '0') and ${t.year} = extract(year from ${t.issuedOn})`,
    ),
    check('invoices_key_check', sql`char_length(${t.idempotencyKey}) between 1 and 200`),
    check(
      'invoices_totals_check',
      sql`${t.inclVatMinor} = ${t.exclVatMinor} + ${t.vatMinor} and abs(${t.vatMinor}) <= abs(${t.exclVatMinor}) and abs(${t.selfAssessedVatMinor}) <= abs(${t.exclVatMinor})`,
    ),
    check(
      'invoices_copies_check',
      sql`jsonb_typeof(${t.contractor}) = 'object' and jsonb_typeof(${t.agency}) = 'object' and jsonb_typeof(${t.regime}) = 'object' and cardinality(${t.mentions}) <= ${num(INVOICE_DOCUMENT_MENTIONS_MAX)} and array_position(${t.mentions}, null) is null`,
    ),
    check(
      'invoices_dates_check',
      sql`${t.dueOn} >= ${t.issuedOn} and ${t.acceptanceDeadline} > ${t.issuedAt}`,
    ),
    memberRead(t.memberId),
    pgPolicy('owner_issue', {
      for: 'insert',
      withCheck: sql`${ownerFor(t.memberId)} and ${t.issuedBy} = ${currentUser}`,
    }),
  ],
);

/** The visible invoice a line or an event belongs to: the policy of `invoices` applies inside the subquery. */
const ofInvoice = (invoiceId: PgColumn, also: SQL): SQL =>
  sql`exists (select 1 from invoices i where i.id = ${invoiceId} and ${also})`;

/** A line of an invoice, written with it in its transaction and never after (the migration's trigger). */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    position: smallint('position').notNull(),
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    detail: text('detail'),
    amountMinor: integer('amount_minor').notNull(),
  },
  (t) => [
    primaryKey({ name: 'invoice_lines_pkey', columns: [t.invoiceId, t.position] }),
    enumCheck('invoice_lines', t.kind, INVOICE_LINE_KINDS),
    check(
      'invoice_lines_values_check',
      sql`${t.position} >= 1 and ${textBetween(t.label, INVOICE_LINE_LABEL_MAX)} and (${t.detail} is null or ${textBetween(t.detail, INVOICE_LINE_DETAIL_MAX)}) and ${t.amountMinor} between -${amountMax} and ${amountMax}`,
    ),
    pgPolicy('member_read', { for: 'select', using: ofInvoice(t.invoiceId, sql`true`) }),
    pgPolicy('owner_issue', {
      for: 'insert',
      withCheck: ofInvoice(t.invoiceId, ownerFor(sql`i.member_id`)),
    }),
  ],
);

/**
 * A dated step of an invoice or a credit note, added only: its acceptance is its events (Bilan, lot 2). The contractor
 * accepts or contests his own; the owner credits, refuses a contest, records a payment and issues; the jobs issue and
 * record a tacit acceptance (`lapsed`). One answer and one end of a contest at most, one `issued`, one payment per
 * statement (the migration's trigger checks each step against the ones before it). A credit note is never credited
 * nor paid; a payment names a paid statement of the invoice's period or of a later one.
 */
export const invoiceEvents = pgTable(
  'invoice_events',
  {
    id: id(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    kind: text('kind').notNull(),
    reason: text('reason'),
    statementId: uuid('statement_id').references(() => commissionStatements.id),
    by: text('by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('invoice_events_invoice_idx').on(t.invoiceId),
    uniqueIndex('invoice_events_issued_unique')
      .on(t.invoiceId)
      .where(sql`${t.kind} = 'issued'`),
    uniqueIndex('invoice_events_answer_unique')
      .on(t.invoiceId)
      .where(sql`${t.kind} in ('accepted', 'contested', 'lapsed')`),
    uniqueIndex('invoice_events_contest_end_unique')
      .on(t.invoiceId)
      .where(sql`${t.kind} in ('credited', 'contest_refused')`),
    uniqueIndex('invoice_events_paid_unique')
      .on(t.invoiceId, t.statementId)
      .where(sql`${t.kind} = 'paid'`),
    enumCheck('invoice_events', t.kind, INVOICE_EVENT_KINDS),
    check(
      'invoice_events_values_check',
      sql`(${t.kind} = 'paid') = (${t.statementId} is not null) and (${t.reason} is null or ${textBetween(t.reason, INVOICE_REASON_MAX)}) and (${t.kind} not in ('contested', 'contest_refused') or ${t.reason} is not null)`,
    ),
    pgPolicy('member_read', { for: 'select', using: ofInvoice(t.invoiceId, sql`true`) }),
    pgPolicy('member_answer', {
      for: 'insert',
      withCheck: sql`${t.kind} in ('accepted', 'contested') and ${t.by} = ${currentUser} and ${ofInvoice(t.invoiceId, isMine(sql`i.member_id`))}`,
    }),
    pgPolicy('owner_step', {
      for: 'insert',
      withCheck: sql`${t.kind} in ('issued', 'credited', 'contest_refused', 'paid') and ${t.by} = ${currentUser} and ${ofInvoice(t.invoiceId, ownerFor(sql`i.member_id`))}`,
    }),
  ],
);

/**
 * The PDF of an invoice, rendered once by the job from the frozen data and served as is afterwards (lot 4, ADR 0037):
 * its `storage_key` in the bucket kept ten years and its SHA-256. Written by the job alone, once; read like its invoice.
 */
export const invoicePdfs = pgTable(
  'invoice_pdfs',
  {
    invoiceId: uuid('invoice_id')
      .primaryKey()
      .references(() => invoices.id),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'invoice_pdfs_file_check',
      sql`${textBetween(t.storageKey, STORAGE_KEY_MAX)} and ${sha256Check(t.sha256)}`,
    ),
    pgPolicy('member_read', { for: 'select', using: ofInvoice(t.invoiceId, sql`true`) }),
  ],
);
