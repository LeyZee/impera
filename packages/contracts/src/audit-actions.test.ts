import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { describeAuditEntry, type AuditNames } from './audit';
import { AUDIT_ACTION_FAMILIES, AUDIT_ACTIONS, frenchDay, frenchMoney, frenchPercent } from './audit-actions';

/**
 * What never reaches the journal's screen or its export (EQ-18): a secret, a token, a password, a fan's words, a
 * document's content, an address (IP, e-mail, URL) or any free text. Every details schema is walked: a field whose name
 * says one of these is refused, and every text it keeps must be one of the bounded formats below.
 */
const FORBIDDEN_WORDS = new Set([
  'secret',
  'secrets',
  'token',
  'tokens',
  'password',
  'passphrase',
  'credential',
  'credentials',
  'key',
  'keys',
  'fingerprint',
  'hash',
  'sha',
  'sha256',
  'ip',
  'address',
  'email',
  'url',
  'uri',
  'iban',
  'reference',
  'content',
  'body',
  'text',
  'message',
  'messages',
  'note',
  'notes',
  'phrase',
  'keywords',
  'prompt',
  'caption',
  'comment',
  'explanation',
  'name',
  'bytes',
  'file',
]);
const ALLOWED_TEXT_FORMATS = new Set([
  'uuid',
  'date',
  'datetime',
  'audit_code',
  'audit_field',
  'audit_version',
  'audit_zone',
  'audit_document_number',
  'audit_prefix',
  'audit_country',
  'audit_currency',
]);

/** A field's name in lowercase words: `contestedInvoiceId` → contested, invoice, id. */
const wordsOf = (field: string): string[] =>
  field
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[\s_.-]+/u)
    .map((word) => word.toLowerCase());

/** A field's schema, as Zod types it once an object is narrowed by `instanceof`. */
function zodOf(value: unknown): z.core.$ZodType {
  if (value instanceof z.core.$ZodType) return value;
  throw new Error('not a Zod schema');
}

/** Every refusal in a schema, by its path. */
function refusals(schema: z.core.$ZodType, path: string): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape).flatMap(([field, inner]) => {
      const here = `${path}.${field}`;
      const named = wordsOf(field).filter((word) => FORBIDDEN_WORDS.has(word));
      return [...named.map((word) => `${here}: « ${word} »`), ...refusals(zodOf(inner), here)];
    });
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable)
    return refusals(schema.unwrap(), path);
  if (schema instanceof z.ZodArray) return refusals(schema.element, `${path}[]`);
  if (schema instanceof z.ZodStringFormat)
    return ALLOWED_TEXT_FORMATS.has(schema._zod.def.format)
      ? []
      : [`${path}: format ${schema._zod.def.format}`];
  if (
    schema instanceof z.ZodNumber ||
    schema instanceof z.ZodBoolean ||
    schema instanceof z.ZodEnum ||
    schema instanceof z.ZodLiteral
  )
    return [];
  // A plain string, a record, `unknown`: a free text or keys nobody chose could pass.
  return [`${path}: ${schema.constructor.name}`];
}

const schemas = (): [string, z.ZodType][] => [
  ...Object.entries(AUDIT_ACTIONS).map(([name, definition]): [string, z.ZodType] => [
    name,
    definition.details,
  ]),
  ...AUDIT_ACTION_FAMILIES.map((family): [string, z.ZodType] => [
    `${family.prefix}*`,
    family.definition('fan_card').details,
  ]),
];

describe('what an entry of the journal never shows (EQ-18)', () => {
  it('walks every details schema: no forbidden field, no free text', () => {
    expect(schemas().length).toBeGreaterThan(150);
    expect(schemas().flatMap(([name, schema]) => refusals(schema, name))).toEqual([]);
  });

  it('refuses what the walk is there to catch', () => {
    expect(refusals(z.object({ apiKey: z.string() }), 'x')).toEqual([
      'x.apiKey: « key »',
      'x.apiKey: ZodString',
    ]);
    expect(refusals(z.object({ fanMessage: z.uuid() }), 'x')).toEqual(['x.fanMessage: « message »']);
    expect(refusals(z.object({ ip: z.ipv4() }), 'x')).toEqual(['x.ip: « ip »', 'x.ip: format ipv4']);
    expect(refusals(z.object({ meta: z.record(z.string(), z.uuid()) }), 'x')).toEqual(['x.meta: ZodRecord']);
    expect(refusals(z.object({ list: z.array(z.object({ body: z.boolean() })) }), 'x')).toEqual([
      'x.list[].body: « body »',
    ]);
  });

  it('drops the fields some writers store but the journal never shows', () => {
    const shown = (action: string, details: object) => {
      const definition = AUDIT_ACTIONS[action];
      if (definition === undefined) throw new Error(`no definition for ${action}`);
      return Object.keys(definition.details.parse(details));
    };
    // The key's fingerprint, the webhook's address, the PDF's key and digest, a contest's or a kill switch's words.
    expect(shown('provider_key.connected', { provider: 'xai', fingerprint: 'abcd…wxyz' })).toEqual([
      'provider',
    ]);
    expect(
      shown('sales_feed_key.replaced', { platform: 'reveal', fingerprint: 'f', capabilities: [] }),
    ).toEqual(['platform']);
    expect(
      shown('sales_feed_webhook.registered', {
        platform: 'reveal',
        platformWebhookId: 'wh_1',
        url: 'https://api.example.test/hook',
      }),
    ).toEqual(['platform']);
    expect(
      shown('invoice.issue', { number: 'NORA-2026-0001', statementId: ID, key: 'invoices/x.pdf' }).sort(),
    ).toEqual(['number', 'statementId']);
    expect(shown('invoice.pdf_store', { key: 'k', sha256: 'a'.repeat(64), retainUntil: AT })).toEqual([
      'retainUntil',
    ]);
    expect(shown('invoice.contest', { number: 'NORA-2026-0001', reason: 'Le montant est faux' })).toEqual([
      'number',
    ]);
    expect(shown('kill_switch.on', { scope: 'global', reason: 'Incident chez le fournisseur' })).toEqual([
      'scope',
    ]);
    expect(
      shown('custom_alert.create', {
        name: 'Remboursement',
        phrase: 'il demande un remboursement',
        keywords: ['rembourse'],
      }),
    ).toEqual([]);
    expect(shown('blind_test.record', { voicePrompt: 'v12', voiceModel: 'm', ratePerMille: 625 })).toEqual([
      'ratePerMille',
    ]);
    expect(shown('auth.session_closed', { sessionId: 'abc' })).toEqual([]);
    expect(
      shown('pay_sale_decision.create', { period: '2026-11-01', outcome: 'exclude', note: 'n' }),
    ).toEqual(['period', 'outcome']);
  });
});

const ID = '0195f0c0-0000-7000-8000-0000000000aa';
const NORA = '0195f0c0-0000-7000-8000-0000000000b1';
const ANNA = '0195f0c0-0000-7000-8000-0000000000c1';
const AT = '2036-11-20T10:00:00.000Z';
const names: AuditNames = { members: new Map([[NORA, 'Nora']]), creators: new Map([[ANNA, 'Anna']]) };

/** One money entry as its writer stores it, and its sentence. */
interface MoneyCase {
  readonly action: string;
  readonly entity: string;
  readonly entityId: string | null;
  readonly details: object;
  readonly label: string;
  readonly link?: { readonly kind: string; readonly id: string } | null;
}

/** Every writing of money of EQ-01 and EQ-04 to EQ-06, as stored (the writers' details copied as they are). */
const MONEY: readonly MoneyCase[] = [
  {
    action: 'commission_rate.create',
    entity: 'team_member',
    entityId: NORA,
    details: { effectiveFrom: '2026-11-01', fromPreset: false },
    label: 'a changé le taux de Nora à partir du 1er novembre 2026',
    link: { kind: 'member', id: NORA },
  },
  {
    action: 'commission_preset.create',
    entity: 'commission_preset',
    entityId: ID,
    details: { effectiveFrom: '2026-11-16' },
    label: 'a créé un préréglage de commission à partir du 16 novembre 2026',
    link: null,
  },
  {
    action: 'creator_agency_rate.create',
    entity: 'creator_agency_rate',
    entityId: ID,
    details: { creatorId: ANNA, fromDay: '2026-11-01', agencyBps: 1250 },
    label: 'a mis la part de l’agence sur Anna à 12,5 % à partir du 1er novembre 2026',
    link: { kind: 'creator', id: ANNA },
  },
  {
    action: 'account_pay_rules.create',
    entity: 'account_pay_rules',
    entityId: ID,
    details: {
      platformAccountId: ID,
      fromPeriod: '2026-11-16',
      currency: 'EUR',
      vatBps: 2000,
      platformFeeBps: 2000,
      earningsSource: 'net',
    },
    label: 'a changé les règles de paie d’un compte à partir de la quinzaine du 16 au 30 novembre 2026',
  },
  {
    action: 'commission_statement.validate',
    entity: 'commission_statement',
    entityId: ID,
    details: { period: '2026-11-01', revision: 2, carriedMinor: 0 },
    label: 'a validé un relevé de la quinzaine du 1er au 15 novembre 2026',
    link: { kind: 'statement', id: ID },
  },
  {
    action: 'commission_statement.validate',
    entity: 'commission_statement',
    entityId: ID,
    details: { period: '2026-02-16', revision: 1, carriedMinor: 4250 },
    label: 'a validé un relevé de la quinzaine du 16 au 28 février 2026 (42,50 € reportés)',
    link: { kind: 'statement', id: ID },
  },
  {
    action: 'commission_statement.pay',
    entity: 'commission_statement',
    entityId: ID,
    details: {
      period: '2026-11-01',
      revision: 2,
      paidOn: '2026-11-18',
      method: 'worldremit',
      sentMinor: 123456,
      certificateDocumentId: null,
    },
    label:
      'a payé un relevé de la quinzaine du 1er au 15 novembre 2026 : 1 234,56 € envoyés le 18 novembre 2026',
    link: { kind: 'statement', id: ID },
  },
  {
    action: 'commission_statement.certificate_locked',
    entity: 'commission_statement',
    entityId: ID,
    details: { documentId: ID, retainUntil: AT },
    label: 'a verrouillé l’attestation d’un versement jusqu’au 20 novembre 2036',
    link: { kind: 'statement', id: ID },
  },
  {
    action: 'pay_period.close',
    entity: 'pay_period',
    entityId: '2026-10-16',
    details: { reports: 12, sales: 40, held: 1 },
    label: 'a clôturé la quinzaine du 16 au 31 octobre 2026',
  },
  {
    action: 'bonus.create',
    entity: 'bonus',
    entityId: ID,
    details: { period: '2026-11-01' },
    label: 'a accordé une prime pour la quinzaine du 1er au 15 novembre 2026',
  },
  {
    action: 'bonus.cancel',
    entity: 'bonus',
    entityId: ID,
    details: { period: '2026-11-01' },
    label: 'a annulé une prime de la quinzaine du 1er au 15 novembre 2026',
  },
  {
    action: 'penalty.create',
    entity: 'penalty',
    entityId: ID,
    details: { fromPeriod: '2026-11-01', toPeriod: '2026-11-01' },
    label: 'a posé une pénalité pour la quinzaine du 1er au 15 novembre 2026',
  },
  {
    action: 'penalty.create',
    entity: 'penalty',
    entityId: ID,
    details: { fromPeriod: '2026-11-01', toPeriod: '2026-12-16' },
    label: 'a posé une pénalité du 1er novembre 2026 au 31 décembre 2026',
  },
  {
    action: 'penalty.cancel',
    entity: 'penalty',
    entityId: ID,
    details: { cancelledFrom: '2026-11-16' },
    label: 'a annulé une pénalité à partir de la quinzaine du 16 au 30 novembre 2026',
  },
  {
    action: 'pay_adjustment.create',
    entity: 'pay_adjustment',
    entityId: ID,
    details: { period: '2026-11-16' },
    label: 'a ajouté une correction de paie pour la quinzaine du 16 au 30 novembre 2026',
    link: null,
  },
  {
    action: 'pay_adjustment.create',
    entity: 'pay_adjustment',
    entityId: ID,
    details: { period: '2026-11-16', contestedInvoiceId: NORA },
    label:
      'a ajouté une correction de paie pour la quinzaine du 16 au 30 novembre 2026 (contestation d’une facture)',
    link: { kind: 'invoice', id: NORA },
  },
  {
    action: 'bonus_tier_set.create',
    entity: 'bonus_tier_set',
    entityId: ID,
    details: { fromPeriod: '2026-12-01' },
    label: 'a changé les paliers de prime à partir de la quinzaine du 1er au 15 décembre 2026',
  },
  {
    action: 'collective_goal.create',
    entity: 'collective_goal',
    entityId: ID,
    details: { period: '2026-12-01' },
    label: 'a fixé l’objectif collectif de la quinzaine du 1er au 15 décembre 2026',
  },
  {
    action: 'payout_minimum.create',
    entity: 'payout_minimum',
    entityId: ID,
    details: { fromPeriod: '2026-12-01', minimumPayoutMinor: 5000 },
    label: 'a mis le minimum de versement à 50,00 € à partir de la quinzaine du 1er au 15 décembre 2026',
  },
  {
    action: 'payroll_settings.update',
    entity: 'payroll_settings',
    entityId: '1',
    details: { payoutDelayBusinessDays: { from: 3, to: 5 } },
    label: 'a changé le délai de versement de 3 à 5 jours ouvrés',
  },
  {
    action: 'payroll_settings.update',
    entity: 'payroll_settings',
    entityId: '1',
    details: { payoutDelayBusinessDays: { from: null, to: 1 } },
    label: 'a mis le délai de versement à 1 jour ouvré',
  },
  {
    action: 'pay_sale_decision.create',
    entity: 'pay_sale_decision',
    entityId: ID,
    details: { period: '2026-11-01', outcome: 'give', revision: 1, recipientMemberId: NORA, shareBp: 6000 },
    label: 'a donné une vente à Nora pour 60 % (quinzaine du 1er au 15 novembre 2026)',
    link: { kind: 'member', id: NORA },
  },
  {
    action: 'pay_sale_decision.create',
    entity: 'pay_sale_decision',
    entityId: ID,
    details: { period: '2026-11-01', outcome: 'exclude', revision: 1, excludeReason: 'agent_decisive' },
    label: 'a exclu une vente de la paie (quinzaine du 1er au 15 novembre 2026)',
  },
  {
    action: 'pay_sale_decision.create',
    entity: 'pay_sale_decision',
    entityId: ID,
    details: { period: '2026-11-01', outcome: 'withdraw', revision: 1 },
    label: 'a retiré une vente de la paie (quinzaine du 1er au 15 novembre 2026)',
  },
  {
    action: 'pay_sale_decision.create',
    entity: 'pay_sale_decision',
    entityId: ID,
    details: { period: '2026-11-01', outcome: 'count', revision: 1 },
    label: 'a compté une vente dans la paie (quinzaine du 1er au 15 novembre 2026)',
  },
  {
    action: 'pay_sale_signal.create',
    entity: 'pay_sale_signal',
    entityId: ID,
    details: { period: '2026-11-01', kind: 'missing', revision: 1 },
    label: 'a signalé une vente (quinzaine du 1er au 15 novembre 2026)',
  },
  {
    action: 'invoice.issue',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0001', statementId: NORA, key: 'invoices/2026/x.pdf' },
    label: 'a émis la facture NORA-2026-0001',
    link: { kind: 'invoice', id: ID },
  },
  {
    action: 'invoice.issue',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0002', statementId: NORA, key: 'k', reissuedInvoiceId: ANNA },
    label: 'a émis la facture rectificative NORA-2026-0002',
    link: { kind: 'invoice', id: ID },
  },
  {
    action: 'credit_note.issue',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0003', statementId: NORA, key: 'k' },
    label: 'a émis l’avoir NORA-2026-0003',
    link: { kind: 'invoice', id: ID },
  },
  {
    action: 'invoice.not_issued',
    entity: 'commission_statement',
    entityId: ID,
    details: { document: 'invoice', reason: 'identity_unverified', amountMinor: 12000 },
    label: 'a laissé une facture de 120,00 € HT en attente : dossier non vérifié',
    link: { kind: 'statement', id: ID },
  },
  {
    action: 'invoice.paid',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0001', statementId: NORA },
    label: 'a soldé la facture NORA-2026-0001 par un versement',
    link: { kind: 'invoice', id: ID },
  },
  {
    action: 'credit_note.imputed',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0003', statementId: NORA },
    label: 'a imputé l’avoir NORA-2026-0003',
  },
  {
    action: 'invoice.compensated',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0001', statementId: NORA },
    label: 'a compensé la facture NORA-2026-0001',
  },
  {
    action: 'credit_note.compensated',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0003', statementId: NORA },
    label: 'a compensé l’avoir NORA-2026-0003',
  },
  {
    action: 'invoice.accept',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0001' },
    label: 'a accepté la facture NORA-2026-0001',
  },
  {
    action: 'invoice.contest',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0001', reason: 'Il manque une vente du 3' },
    label: 'a contesté la facture NORA-2026-0001',
  },
  {
    action: 'invoice.contest_uphold',
    entity: 'invoice',
    entityId: ID,
    details: {
      number: 'NORA-2026-0001',
      reason: 'ok',
      correction: 'adjust',
      adjustmentIds: [ID],
      period: '2026-11-16',
    },
    label: 'a donné raison à la contestation de la facture NORA-2026-0001',
  },
  {
    action: 'invoice.contest_refuse',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0001', reason: 'La vente est hors période' },
    label: 'a refusé la contestation de la facture NORA-2026-0001',
  },
  {
    action: 'invoice.lapse',
    entity: 'invoice',
    entityId: ID,
    details: { number: 'NORA-2026-0001' },
    label: 'a accepté tacitement la facture NORA-2026-0001',
  },
  {
    action: 'invoice.contest_alert',
    entity: 'invoice',
    entityId: ID,
    details: { invoiceId: ID, memberId: NORA, number: 'NORA-2026-0003', document: 'credit_note' },
    label: 'a signalé la contestation de l’avoir NORA-2026-0003',
  },
  {
    action: 'invoice.due_alert',
    entity: 'invoice',
    entityId: ID,
    details: {
      memberId: NORA,
      alert: 'invoice_due_soon',
      dueOn: '2026-12-03',
      today: '2026-11-30',
      payoutBlock: null,
    },
    label: 'a signalé l’échéance d’une facture de Nora au 3 décembre 2026',
    link: { kind: 'invoice', id: ID },
  },
  {
    action: 'invoice.pdf_store',
    entity: 'invoice',
    entityId: ID,
    details: { key: 'invoices/x.pdf', sha256: 'a'.repeat(64), retainUntil: AT },
    label: 'a conservé le PDF d’une facture jusqu’au 20 novembre 2036',
  },
  {
    action: 'invoice.pdf_copy',
    entity: 'invoice',
    entityId: ID,
    details: { provider: 'scaleway', key: 'k', sha256: 'b'.repeat(64) },
    label: 'a copié le PDF d’une facture',
  },
  {
    action: 'invoice.pdf_conflict',
    entity: 'invoice',
    entityId: ID,
    details: { invoiceId: ID, stage: 'copy' },
    label: 'a trouvé un PDF de facture différent de l’original',
  },
  {
    action: 'invoice.pdf_missing',
    entity: 'invoice',
    entityId: ID,
    details: { invoiceId: ID, stage: 'copy' },
    label: 'a trouvé un PDF de facture manquant',
  },
  {
    action: 'billing_settings.update',
    entity: 'billing_settings',
    entityId: '1',
    details: { changed: ['agency.legalName', 'reminderDays'] },
    label: 'a modifié les réglages de facturation (2 champs)',
  },
  {
    action: 'billing_settings.accounts',
    entity: 'billing_settings',
    entityId: '1',
    details: { changed: ['bankAccount'] },
    label: 'a modifié les comptes du journal (1 champ)',
  },
  {
    action: 'agency_logo.add',
    entity: 'agency_logo',
    entityId: 'c'.repeat(64),
    details: { width: 400, height: 120, byteLength: 20_000 },
    label: 'a ajouté le logo de l’agence',
  },
  {
    action: 'contractor_profile.create',
    entity: 'contractor_profile',
    entityId: NORA,
    details: { changed: ['legalName'], checkCleared: false },
    label: 'a rempli le dossier de prestataire de Nora',
    link: { kind: 'member', id: NORA },
  },
  {
    action: 'contractor_profile.update',
    entity: 'contractor_profile',
    entityId: NORA,
    details: { changed: ['address', 'legalName'], checkCleared: true },
    label: 'a modifié le dossier de prestataire de Nora (2 champs), vérification à refaire',
    link: { kind: 'member', id: NORA },
  },
  {
    action: 'contractor_profile.verify',
    entity: 'contractor_profile',
    entityId: NORA,
    details: {},
    label: 'a vérifié le dossier de prestataire de Nora',
  },
  {
    action: 'contractor_profile.prefix',
    entity: 'contractor_profile',
    entityId: NORA,
    details: { from: 'NOR', to: 'NORA' },
    label: 'a changé le préfixe de facture de Nora de NOR à NORA',
  },
  {
    action: 'contractor_profile.prefix',
    entity: 'contractor_profile',
    entityId: NORA,
    details: { from: null, to: 'NORA' },
    label: 'a donné le préfixe de facture NORA à Nora',
  },
  {
    action: 'contract_text.add',
    entity: 'contract_text',
    entityId: ID,
    details: { kind: 'billing_mandate', version: 2, sha256: 'd'.repeat(64), contestDelayDays: 15 },
    label: 'a publié la version 2 du mandat de facturation',
  },
  {
    action: 'contract.accept',
    entity: 'contract_acceptance',
    entityId: ID,
    details: { kind: 'service_contract', version: 1, sha256: 'e'.repeat(64) },
    label: 'a accepté la version 1 du contrat de prestation',
  },
  {
    action: 'billing_regime.create',
    entity: 'billing_regime',
    entityId: ID,
    details: {
      countries: ['FR', 'BE'],
      vatTreatment: 'franchise',
      withholding: null,
      documents: [],
      mentions: 2,
    },
    label: 'a créé un régime de facturation (FR, BE)',
  },
  {
    action: 'billing_regime.validate',
    entity: 'billing_regime',
    entityId: ID,
    details: { validatedOn: '2026-11-02' },
    label: 'a validé un régime de facturation le 2 novembre 2026',
  },
  {
    action: 'contractor_regime.assign',
    entity: 'contractor_regime',
    entityId: ID,
    details: { memberId: NORA, regimeId: ID, from: '2026-11-16' },
    label: 'a appliqué un régime de facturation à Nora à partir du 16 novembre 2026',
    link: { kind: 'member', id: NORA },
  },
  {
    action: 'contractor_document.add',
    entity: 'contractor_document',
    entityId: ID,
    details: {
      memberId: NORA,
      kind: 'tax_residence',
      issuedOn: '2026-01-10',
      validUntil: null,
      mediaType: 'application/pdf',
      sha256: 'f'.repeat(64),
    },
    label: 'a déposé une pièce du dossier de Nora',
    link: { kind: 'member', id: NORA },
  },
  {
    action: 'contractor_document.review',
    entity: 'contractor_document',
    entityId: ID,
    details: { memberId: NORA, decision: 'refused', retainUntil: null },
    label: 'a refusé une pièce du dossier de Nora',
    link: { kind: 'member', id: NORA },
  },
  {
    action: 'contractor_document.review',
    entity: 'contractor_document',
    entityId: ID,
    details: { memberId: NORA, decision: 'accepted', retainUntil: AT },
    label: 'a accepté une pièce du dossier de Nora',
  },
  {
    action: 'contractor_document.purge',
    entity: 'contractor_document',
    entityId: ID,
    details: { memberId: NORA, outcome: 'erased' },
    label: 'a effacé le fichier d’une pièce refusée de Nora',
  },
  {
    action: 'contractor_document.remind',
    entity: 'contractor_document',
    entityId: ID,
    details: { memberId: NORA, kind: 'tax_residence', lastDay: '2026-12-31', today: '2026-12-01' },
    label: 'a rappelé une pièce à renouveler du dossier de Nora',
  },
  {
    action: 'accounting_journal.export',
    entity: 'accounting_journal',
    entityId: '2026-10-01/2026-10-31',
    details: { from: '2026-10-01', to: '2026-10-31', contractors: 4 },
    label: 'a exporté le journal comptable du 1er octobre 2026 au 31 octobre 2026',
  },
  {
    action: 'accounting_das2.export',
    entity: 'accounting_das2',
    entityId: '2026',
    details: { year: 2026, beneficiaries: 3 },
    label: 'a exporté le récapitulatif DAS2 de 2026',
  },
  {
    action: 'accounting_archive.export',
    entity: 'accounting_archive',
    entityId: '2026-01-01/2026-06-30',
    details: { from: '2026-01-01', to: '2026-06-30', documents: 18 },
    label: 'a exporté l’archive des factures du 1er janvier 2026 au 30 juin 2026',
  },
];

describe('the sentences of money (EQ-18: each writing of EQ-01 and EQ-04 to EQ-06)', () => {
  it.each(MONEY.map((c) => [`${c.action} ${JSON.stringify(c.details).slice(0, 60)}`, c] as const))(
    '%s',
    (_title, c) => {
      const described = describeAuditEntry(c, names);
      expect(described.category).toBe('money');
      expect(described.label).toBe(c.label);
      if (c.link !== undefined) expect(described.link).toEqual(c.link);
    },
  );

  it('has a rendering test for every action of money in the registry', () => {
    const money = Object.entries(AUDIT_ACTIONS)
      .filter(([, definition]) => definition.category === 'money')
      .map(([name]) => name)
      .sort();
    expect([...new Set(MONEY.map((c) => c.action))].sort()).toEqual(money);
  });

  it('says the names it could not read without them', () => {
    const described = describeAuditEntry(
      {
        action: 'commission_rate.create',
        entity: 'team_member',
        entityId: ANNA,
        details: { effectiveFrom: '2026-11-01' },
      },
      { members: new Map(), creators: new Map() },
    );
    expect(described.label).toBe('a changé le taux d’un membre à partir du 1er novembre 2026');
  });
});

describe('French renderings', () => {
  it('writes days, percentages and euros as the agency reads them', () => {
    expect(frenchDay('2026-11-01')).toBe('1er novembre 2026');
    expect(frenchDay('2026-08-15T22:00:00.000Z')).toBe('15 août 2026');
    expect(frenchPercent(1000)).toBe('10 %');
    expect(frenchPercent(1250)).toBe('12,5 %');
    expect(frenchPercent(333)).toBe('3,33 %');
    expect(frenchMoney(5)).toBe('0,05 €');
    expect(frenchMoney(1_234_567)).toBe('12 345,67 €');
    expect(frenchMoney(2500, 'USD')).toBe('25,00 $US');
  });
});
