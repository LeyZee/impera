import { z } from 'zod';

import { payPeriodLastDay, PayPeriodSchema } from './pay-periods';

/**
 * The audit journal's vocabulary (EQ-18 lot a): for each `action` the code writes in `audit_log`, the schema of the
 * `details` it may show, its category and its sentence in French. A schema keeps only the fields it names (Zod strips
 * the rest), and every text it keeps is a short code, an identifier, a day or an instant: never a secret, a token, a
 * password, a fan's words, a document's content, an address or a free text (`audit-actions.test.ts` walks them all).
 * What a writer stores beyond that stays in the base and never reaches the screen or the export.
 */

/** The four filters of Réglages › Journal: money first (taux, relevés, factures, avoirs, paiements, primes). */
export const AUDIT_CATEGORIES = ['money', 'team', 'access', 'agent'] as const;
export const AuditCategorySchema = z.enum(AUDIT_CATEGORIES);
export type AuditCategory = z.infer<typeof AuditCategorySchema>;

/** The objects an entry may open on the screen. */
export const AUDIT_LINK_KINDS = ['statement', 'invoice', 'member', 'creator', 'shift'] as const;
export const AuditLinkSchema = z.object({ kind: z.enum(AUDIT_LINK_KINDS), id: z.uuid() });
export type AuditLink = z.infer<typeof AuditLinkSchema>;

/** The names an entry's sentence may say, read by the server for the page it serves. */
export interface AuditLabelContext {
  /** The entry's `entity_id`, as written. */
  readonly entityId: string | null;
  /** A member's display name by his record's id, or « un membre ». */
  readonly member: (id: string | null | undefined) => string;
  /** A creator's display name by her id, or « une créatrice ». */
  readonly creator: (id: string | null | undefined) => string;
}

/** What one action knows how to show. */
export interface AuditActionDefinition {
  readonly category: AuditCategory;
  /** The fields shown, and nothing else (walked by the test of forbidden fields). */
  readonly details: z.ZodObject;
  /** The sentence and the link, or `null` when the stored details do not parse: the entry then shows its action. */
  readonly describe: (
    details: unknown,
    context: AuditLabelContext,
  ) => { readonly label: string; readonly link: AuditLink | null } | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Texts allowed in details: bounded codes, never a free text. Each is a named string format, so that the test of
// forbidden fields tells them from a plain string.

/** A code of the vocabulary (`creator`, `worldremit`, `reveal`, `tax_residence_missing`). */
const code = z.stringFormat('audit_code', /^[a-z0-9_]{1,64}$/u);
/** A field's name, as `team_member.update` and `billing_settings.update` list them (`displayName`, `agency.siret`). */
const fieldName = z.stringFormat('audit_field', /^[A-Za-z0-9_.]{1,64}$/u);
/** A version as the persona and the scripts number them (`0.4.0`). */
const version = z.stringFormat('audit_version', /^[0-9A-Za-z.+-]{1,32}$/u);
/** An IANA zone (`Europe/Paris`). */
const zone = z.stringFormat('audit_zone', /^[A-Za-z_]{1,32}(\/[A-Za-z0-9_+-]{1,32}){0,2}$/u);
/** An invoice's or a credit note's number (`NORA-2026-0001`). */
const documentNumber = z.stringFormat('audit_document_number', /^[A-Z0-9]{2,8}-[0-9]{4}-[0-9]{4,8}$/u);
/** An invoice prefix (`NORA`). */
const prefix = z.stringFormat('audit_prefix', /^[A-Z0-9]{2,8}$/u);
/** A country, ISO 3166-1 alpha-2. */
const country = z.stringFormat('audit_country', /^[A-Z]{2}$/u);
/** A currency, ISO 4217. */
const currency = z.stringFormat('audit_currency', /^[A-Z]{3}$/u);
const id = z.uuid();
const day = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const period = PayPeriodSchema;
const count = z.number().int().min(0);
const minor = z.number().int();

// ---------------------------------------------------------------------------------------------------------------------
// French renderings.

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

/** The day of the month, « 1er » for the first. */
function dateOf(value: string): string {
  const number = Number(value.slice(8, 10));
  return number === 1 ? '1er' : String(number);
}

/** `2026-11-01` (or an instant, read on its UTC day) → « 1er novembre 2026 ». */
export function frenchDay(value: string): string {
  const month = Number(value.slice(5, 7));
  return `${dateOf(value)} ${MONTHS[month - 1] ?? String(month)} ${value.slice(0, 4)}`;
}

/** A period by its days, within one month: « du 1er au 15 novembre 2026 ». */
function frenchPeriod(value: z.infer<typeof PayPeriodSchema>): string {
  return `du ${dateOf(value)} au ${frenchDay(payPeriodLastDay(value))}`;
}

const NBSP = ' ';

/** Basis points as a French percentage: 1250 → « 12,5 % ». */
export function frenchPercent(bps: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(bps / 100)}${NBSP}%`;
}

/** Cents as French money: 123456, EUR → « 1 234,56 € ». */
export function frenchMoney(amountMinor: number, currencyCode = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currencyCode }).format(
    amountMinor / 100,
  );
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n > 1 ? many : one}`;

const PLATFORMS: Readonly<Record<string, string>> = {
  reveal: 'Reveal',
  onlyfans: 'OnlyFans',
  fansly: 'Fansly',
};
const platformName = (value: string): string => PLATFORMS[value] ?? value;

const TEAM_ROLE_NAMES: Readonly<Record<string, string>> = { chatter: 'chatteur', manager: 'manager' };
const STATUS_NAMES: Readonly<Record<string, string>> = {
  active: 'actif',
  on_leave: 'en congé',
  sick: 'malade',
  travelling: 'en voyage',
  suspended: 'suspendu',
  left: 'parti',
};
const CONTRACT_NAMES: Readonly<Record<string, string>> = {
  service_contract: 'du contrat de prestation',
  billing_mandate: 'du mandat de facturation',
};
const NOT_ISSUED_REASONS: Readonly<Record<string, string>> = {
  mandate_unpublished: 'aucun mandat publié',
  no_mandate: 'mandat non accepté',
  no_regime: 'aucun régime',
  regime_not_validated: 'régime non validé',
  regime_country_mismatch: 'régime d’un autre pays',
  identity_incomplete: 'dossier incomplet',
  identity_unverified: 'dossier non vérifié',
  tax_residence_missing: 'attestation de résidence manquante',
  tax_residence_unverified: 'attestation de résidence à vérifier',
  prefix_missing: 'préfixe manquant',
  agency_missing: 'réglages de l’agence manquants',
  no_invoice_to_credit: 'aucune facture à créditer',
};

const documentName = (kind: string | undefined, number: string | undefined): string =>
  `${kind === 'credit_note' ? 'l’avoir' : 'la facture'}${number === undefined ? '' : ` ${number}`}`;

// ---------------------------------------------------------------------------------------------------------------------
// The registry.

/** Builds one definition: the sentence and the link read the parsed details only. */
function action<S extends z.ZodObject>(
  category: AuditCategory,
  details: S,
  label: (details: z.output<S>, context: AuditLabelContext) => string,
  link?: (details: z.output<S>, context: AuditLabelContext) => AuditLink | null,
): AuditActionDefinition {
  return {
    category,
    details,
    describe: (raw, context) => {
      const parsed = details.safeParse(raw ?? {});
      if (!parsed.success) return null;
      // « de un membre » when a name is unknown: French elides it.
      const said = label(parsed.data, context).replace(/\bde (une?) /gu, 'd’$1 ');
      return { label: said, link: link?.(parsed.data, context) ?? null };
    },
  };
}

const none = z.object({});
const memberLink = (memberId: string | null | undefined): AuditLink | null =>
  memberId === null || memberId === undefined ? null : { kind: 'member', id: memberId };
const creatorLink = (creatorId: string | null | undefined): AuditLink | null =>
  creatorId === null || creatorId === undefined ? null : { kind: 'creator', id: creatorId };

const access = (label: string) => action('access', none, () => label);
const team = (label: string) => action('team', none, () => label);
const agent = (label: string) => action('agent', none, () => label);

const sessionsRevoked = z.object({ scope: code.optional(), revoked: count.optional() });
const linkFor = z.object({ memberId: id.optional(), creatorId: id.optional() });
const forWhom = (d: z.infer<typeof linkFor>, c: AuditLabelContext): string =>
  d.memberId !== undefined
    ? ` pour ${c.member(d.memberId)}`
    : d.creatorId !== undefined
      ? ` pour ${c.creator(d.creatorId)}`
      : '';
const providerKey = z.object({ provider: code });
const platformOnly = z.object({ platform: code });
const rewritten = z.object({ rewritten: count.optional() });
const ofCreator = (d: { readonly creatorId?: string | undefined }, c: AuditLabelContext): string =>
  d.creatorId === undefined ? '' : ` de ${c.creator(d.creatorId)}`;
const reportVersion = z.object({ version: count.optional() });
const salesModel = z.object({ platform: code, creatorId: id.optional() });
const chatterLink = z.object({ platform: code, memberId: id.nullable().optional() });
const numbered = z.object({ number: documentNumber.optional() });
const acceptance = z.object({ number: documentNumber.optional(), correction: code.optional() });
const settlement = z.object({ number: documentNumber.optional(), statementId: id.optional() });
const issued = z.object({
  number: documentNumber,
  statementId: id.optional(),
  reissuedInvoiceId: id.optional(),
});
const contractorDocument = z.object({ memberId: id, kind: code.optional(), decision: code.optional() });
const exportRange = z.object({ from: day, to: day });
const changedFields = z.object({ changed: z.array(fieldName).optional() });
const fieldsCount = (changed: readonly string[] | undefined): string =>
  changed === undefined ? '' : ` (${plural(changed.length, 'champ', 'champs')})`;
const persona = z.object({ creatorId: id, version: version.optional() });
const versionOf = (value: string | undefined): string =>
  value === undefined ? 'une version' : `la version ${value}`;
const scriptOf = z.object({ creatorId: id.optional() });
const statementEvent = z.object({ period, revision: count.optional() });

/** Every action the code writes in `audit_log` (EQ-18), by name. */
export const AUDIT_ACTIONS: Readonly<Record<string, AuditActionDefinition>> = {
  // ---- Accès: sign-ins, second factor, sessions, links, keys, exports of the journal.
  'auth.login': access('a ouvert une session'),
  'auth.sign_in_refused': access('a saisi un mot de passe refusé'),
  'auth.code_refused': access('a saisi un code refusé'),
  'auth.passkey_refused': access('a présenté une clé d’accès refusée'),
  'auth.reauthentication_refused': access('a échoué à confirmer son identité'),
  'auth.second_factor_enabled': access('a activé la double authentification'),
  'auth.reauthenticated': action(
    'access',
    z.object({ via: code.optional() }),
    (d) => `a confirmé son identité${d.via === 'passkey' ? ' avec une clé d’accès' : ''}`,
  ),
  'auth.second_factor_reset': action(
    'access',
    z.object({ hadSecondFactor: z.boolean().optional() }),
    () => 'a remis à zéro la double authentification d’un compte depuis le serveur',
  ),
  'auth.sessions_revoked': action('access', sessionsRevoked, (d) => {
    const n = d.revoked === undefined ? '' : ` (${plural(d.revoked, 'session', 'sessions')})`;
    if (d.scope === 'others') return `a fermé ses autres sessions${n}`;
    if (d.scope === 'all') return `a fermé toutes les sessions${n}`;
    return `a fermé les sessions d’un compte${n}`;
  }),
  'auth.session_closed': access('a fermé une de ses sessions'),
  'auth.backup_codes_regenerated': access('a régénéré ses codes de secours'),
  'auth.passkey_added': access('a ajouté une clé d’accès'),
  'auth.passkey_removed': access('a retiré une clé d’accès'),
  'auth.passkeys_removed': action(
    'access',
    z.object({ removed: count }),
    (d) => `a retiré les clés d’accès d’un compte (${String(d.removed)})`,
  ),
  'user.role_changed': action(
    'access',
    z.object({ role: code }),
    (d) => `a donné le rôle ${d.role === 'owner' ? 'propriétaire' : d.role} à un compte`,
  ),
  'invitation_link.create': action(
    'access',
    linkFor.extend({ purpose: code }),
    (d, c) =>
      `a créé un lien ${d.purpose === 'reset' ? 'de nouveau mot de passe' : 'd’invitation'}${forWhom(d, c)}`,
    (d) => memberLink(d.memberId) ?? creatorLink(d.creatorId),
  ),
  'invitation_link.revoke': action(
    'access',
    linkFor.extend({ reason: code.optional() }),
    (d, c) =>
      `a révoqué un lien d’invitation${forWhom(d, c)}${d.reason === 'creator_archived' ? ' (créatrice archivée)' : ''}`,
    (d) => memberLink(d.memberId) ?? creatorLink(d.creatorId),
  ),
  'invitation_link.redeem': action('access', z.object({ purpose: code }), (d) =>
    d.purpose === 'reset'
      ? 'a choisi un nouveau mot de passe par son lien'
      : 'a utilisé son lien d’invitation',
  ),
  'creator_account.create': action(
    'access',
    z.object({ creatorId: id }),
    (d, c) => `a créé le compte de ${c.creator(d.creatorId)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'creator_account.email': action(
    'access',
    z.object({ creatorId: id }),
    (d, c) => `a changé l’adresse du compte de ${c.creator(d.creatorId)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'password_reset.request': access('a demandé un lien de nouveau mot de passe'),
  'password_reset.send': access('a envoyé un lien de nouveau mot de passe'),
  'password_reset.redeem': access('a choisi un nouveau mot de passe par un lien'),
  'calendar_link.create': access('a créé un lien d’agenda'),
  'calendar_link.revoke': access('a révoqué un lien d’agenda'),
  'calendar_link.choose': action('access', z.object({ withShifts: z.boolean() }), (d) =>
    d.withShifts ? 'a mis ses shifts dans son agenda' : 'a retiré ses shifts de son agenda',
  ),
  'extension_link.create': access('a lié l’extension à un navigateur'),
  'extension_link.revoke': access('a délié l’extension d’un navigateur'),
  'telegram_private_link.code': access('a demandé un code de liaison Telegram'),
  'telegram_private_link.link': access('a lié son compte Telegram'),
  'telegram_private_link.remove': access('a délié son compte Telegram'),
  'mcp_grant.create': access('a ouvert un accès MCP'),
  'mcp_grant.revoke': access('a révoqué un accès MCP'),
  'provider_key.connected': action('access', providerKey, (d) => `a branché la clé de ${d.provider}`),
  'provider_key.replaced': action('access', providerKey, (d) => `a remplacé la clé de ${d.provider}`),
  'provider_key.disconnected': action('access', providerKey, (d) => `a débranché la clé de ${d.provider}`),
  'provider_key.reencrypted': action(
    'access',
    rewritten,
    (d) =>
      `a rechiffré les clés des fournisseurs${d.rewritten === undefined ? '' : ` (${String(d.rewritten)})`}`,
  ),
  'link_service_key.connected': access('a branché la clé du service de redirection'),
  'link_service_key.replaced': access('a remplacé la clé du service de redirection'),
  'link_service_key.disconnected': access('a débranché la clé du service de redirection'),
  'link_service_key.reencrypted': access('a rechiffré la clé du service de redirection'),
  'sales_feed_key.connected': action(
    'access',
    platformOnly,
    (d) => `a branché la clé du flux de ventes de ${platformName(d.platform)}`,
  ),
  'sales_feed_key.replaced': action(
    'access',
    platformOnly,
    (d) => `a remplacé la clé du flux de ventes de ${platformName(d.platform)}`,
  ),
  'sales_feed_key.disconnected': action(
    'access',
    platformOnly,
    (d) => `a débranché la clé du flux de ventes de ${platformName(d.platform)}`,
  ),
  'sales_feed_key.reencrypted': action(
    'access',
    rewritten,
    (d) =>
      `a rechiffré les clés des flux de ventes${d.rewritten === undefined ? '' : ` (${String(d.rewritten)})`}`,
  ),
  'sales_feed_webhook.registered': action(
    'access',
    platformOnly,
    (d) => `a enregistré le webhook des ventes de ${platformName(d.platform)}`,
  ),
  'sales_feed_webhook.removed': action(
    'access',
    platformOnly,
    (d) => `a retiré le webhook des ventes de ${platformName(d.platform)}`,
  ),
  'connector.session_stored': access('a enregistré une session de plateforme'),
  'connector.session_refused': access('a présenté une session de plateforme refusée'),
  'connector.session_released': access('a libéré une session de plateforme'),
  'connector.sessions_reencrypted': action(
    'access',
    rewritten,
    (d) =>
      `a rechiffré les sessions de plateforme${d.rewritten === undefined ? '' : ` (${String(d.rewritten)})`}`,
  ),
  'telegram_token.reencrypted': action(
    'access',
    rewritten,
    (d) =>
      `a rechiffré les jetons des bots Telegram${d.rewritten === undefined ? '' : ` (${String(d.rewritten)})`}`,
  ),
  'backup.request': access('a demandé une sauvegarde'),
  'restore_test.record': action(
    'access',
    z.object({ rowCountMismatches: count }),
    (d) =>
      `a enregistré un test de restauration (${d.rowCountMismatches === 0 ? 'aucun écart' : plural(d.rowCountMismatches, 'écart', 'écarts')})`,
  ),
  'conversation.open': action(
    'access',
    z.object({ creatorId: id }),
    (d, c) => `a ouvert une conversation de ${c.creator(d.creatorId)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'media.opened': access('a ouvert un média'),
  'audit.export': action(
    'access',
    z.object({ rows: count }),
    (d) => `a exporté le journal (${plural(d.rows, 'ligne', 'lignes')})`,
  ),

  // ---- Équipe: members, roles, planning, reports, the platforms' chatters and models, creators.
  'team_member.create': action(
    'team',
    z.object({ teamRole: code }),
    (d, c) => `a ajouté ${c.member(c.entityId)} à l’équipe (${TEAM_ROLE_NAMES[d.teamRole] ?? d.teamRole})`,
  ),
  'team_member.invite': action(
    'team',
    z.object({ teamRole: code, platform: code.optional() }),
    (d, c) =>
      `a invité ${c.member(c.entityId)}${d.platform === undefined ? '' : ` depuis ${platformName(d.platform)}`} (${TEAM_ROLE_NAMES[d.teamRole] ?? d.teamRole})`,
  ),
  'team_member.update': action(
    'team',
    z.object({ fields: z.array(fieldName).optional() }),
    (d, c) => `a modifié la fiche de ${c.member(c.entityId)}${fieldsCount(d.fields)}`,
  ),
  'team_member.status_change': action(
    'team',
    z.object({ from: code, to: code }),
    (d, c) =>
      `a passé ${c.member(c.entityId)} de « ${STATUS_NAMES[d.from] ?? d.from} » à « ${STATUS_NAMES[d.to] ?? d.to} »`,
  ),
  'team_member.time_zone_follow': action(
    'team',
    z.object({ from: zone.nullable().optional(), to: zone }),
    (d) => `a suivi le fuseau de son téléphone : ${d.to}`,
  ),
  'team_member_note.create': action('team', none, (_d, c) => `a ajouté une note sur ${c.member(c.entityId)}`),
  'team_role.create': action(
    'team',
    z.object({ teamRole: code, effectiveFrom: day }),
    (d, c) =>
      `a changé le rôle de ${c.member(c.entityId)} en ${TEAM_ROLE_NAMES[d.teamRole] ?? d.teamRole} à partir du ${frenchDay(d.effectiveFrom)}`,
  ),
  'shift.create': team('a créé un shift'),
  'shift.update': team('a modifié un shift'),
  'shift.cancel': team('a annulé un shift'),
  'shift_template.create': action(
    'team',
    z.object({ shiftsMade: count.optional() }),
    (d) =>
      `a créé un modèle de shifts${d.shiftsMade === undefined ? '' : ` (${plural(d.shiftsMade, 'shift', 'shifts')})`}`,
  ),
  'shift_template.end': action(
    'team',
    z.object({ shiftsCancelled: count.optional() }),
    (d) =>
      `a arrêté un modèle de shifts${d.shiftsCancelled === undefined ? '' : ` (${plural(d.shiftsCancelled, 'shift annulé', 'shifts annulés')})`}`,
  ),
  'scheduling_settings.update': team('a modifié les réglages du planning'),
  'scheduling_settings.report_gap': team('a modifié le seuil d’écart des rapports'),
  'scheduling_slot_version.create': action(
    'team',
    z.object({ effectiveAt: instant }),
    (d) => `a changé les créneaux à partir du ${frenchDay(d.effectiveAt)}`,
  ),
  'scheduling_slot_version.withdraw': team('a retiré un changement de créneaux'),
  'leave_request.create': team('a demandé un congé'),
  'leave_request.approve': team('a accepté une demande de congé'),
  'leave_request.refuse': team('a refusé une demande de congé'),
  'leave_request.withdraw': team('a retiré sa demande de congé'),
  'leave_request.cancel': team('a annulé un congé'),
  'shift_swap.propose': team('a proposé un échange de shift'),
  'shift_swap.decline': team('a décliné un échange de shift'),
  'shift_swap.accept': team('a accepté un échange de shift'),
  'shift_swap.withdraw': team('a retiré un échange de shift'),
  'shift_swap.revert': team('a annulé un échange de shift'),
  'shift_report.create': action(
    'team',
    z.object({ period }),
    (d) => `a rendu un rapport de shift (quinzaine ${frenchPeriod(d.period)})`,
  ),
  'shift_report.correct': action(
    'team',
    z.object({ period }),
    (d) => `a corrigé un rapport de shift (quinzaine ${frenchPeriod(d.period)})`,
  ),
  'shift_report.update': action('team', reportVersion, () => 'a modifié un rapport de shift'),
  'shift_report.resubmit': action('team', reportVersion, () => 'a renvoyé un rapport de shift refusé'),
  'shift_report.validate': action('team', reportVersion, () => 'a validé un rapport de shift'),
  'shift_report.reject': action('team', reportVersion, () => 'a refusé un rapport de shift'),
  'shift_report.auto_validate': action(
    'team',
    reportVersion,
    () => 'a validé un rapport de shift sans écart, de lui-même',
  ),
  'shift_feedback.create': action(
    'team',
    z.object({ period }),
    (d) => `a donné un retour sur un shift (quinzaine ${frenchPeriod(d.period)})`,
  ),
  'shift_incident.seen': action('team', z.object({ period }), () => 'a vu un incident de fin de shift'),
  'shift_incident.resolved': action(
    'team',
    z.object({ period }),
    () => 'a réglé un incident de fin de shift',
  ),
  'sales_feed.chatter_linked': action(
    'team',
    chatterLink,
    (d, c) =>
      `a lié un chatteur de ${platformName(d.platform)}${d.memberId === null || d.memberId === undefined ? '' : ` à ${c.member(d.memberId)}`}`,
    (d) => memberLink(d.memberId),
  ),
  'sales_feed.chatter_unlinked': action(
    'team',
    chatterLink,
    (d) => `a délié un chatteur de ${platformName(d.platform)}`,
  ),
  'sales_feed.chatter_dismissed': action(
    'team',
    platformOnly,
    (d) => `a écarté un chatteur de ${platformName(d.platform)}`,
  ),
  'sales_feed.chatter_restored': action(
    'team',
    platformOnly,
    (d) => `a réintégré un chatteur de ${platformName(d.platform)}`,
  ),
  'sales_feed.model_imported': action(
    'team',
    salesModel,
    (d, c) =>
      `a importé un modèle de ${platformName(d.platform)}${d.creatorId === undefined ? '' : ` pour ${c.creator(d.creatorId)}`}`,
    (d) => creatorLink(d.creatorId),
  ),
  'sales_feed.model_dismissed': action(
    'team',
    platformOnly,
    (d) => `a écarté un modèle de ${platformName(d.platform)}`,
  ),
  'sales_feed.model_restored': action(
    'team',
    platformOnly,
    (d) => `a réintégré un modèle de ${platformName(d.platform)}`,
  ),
  'sales_feed.model_linked': action(
    'team',
    z.object({ platform: code, auto: z.boolean().optional() }),
    (d) =>
      `a lié un modèle de ${platformName(d.platform)} à un compte${d.auto === true ? ', de lui-même' : ''}`,
  ),
  'sales_feed.model_unlinked': action(
    'team',
    platformOnly,
    (d) => `a délié un modèle de ${platformName(d.platform)} de son compte`,
  ),
  'creator.create': action('team', none, (_d, c) => `a ajouté la créatrice ${c.creator(c.entityId)}`),
  'creator.archive': action('team', none, (_d, c) => `a archivé la créatrice ${c.creator(c.entityId)}`),
  'creator.restore': action('team', none, (_d, c) => `a restauré la créatrice ${c.creator(c.entityId)}`),
  'creator.rename': action('team', none, (_d, c) => `a renommé la créatrice ${c.creator(c.entityId)}`),
  'creator.timezone': action(
    'team',
    z.object({ from: zone.nullable().optional(), to: zone }),
    (d, c) => `a mis ${c.creator(c.entityId)} sur le fuseau ${d.to}`,
  ),

  // ---- Agent: its hours, its switches, the conversations taken, the persona, the alerts, the content and scripts.
  'creator.agent_hours': action(
    'agent',
    none,
    (_d, c) => `a changé les heures de l’agent de ${c.creator(c.entityId)}`,
  ),
  'creator.agent_hour_exception': action(
    'agent',
    z.object({ date: day, ranges: z.array(z.object({})).nullable() }),
    (d, c) =>
      d.ranges === null
        ? `a retiré l’exception aux heures de l’agent de ${c.creator(c.entityId)} le ${frenchDay(d.date)}`
        : `a posé une exception aux heures de l’agent de ${c.creator(c.entityId)} le ${frenchDay(d.date)}`,
  ),
  'creator.copilot_switches': action(
    'agent',
    none,
    (_d, c) => `a changé les réglages du copilote de ${c.creator(c.entityId)}`,
  ),
  'creator.fan_tiers': action(
    'agent',
    none,
    (_d, c) => `a changé les paliers de dépense des fans de ${c.creator(c.entityId)}`,
  ),
  'automatic.on': agent('a allumé l’Automatique'),
  'conversation.takeover': agent('a pris la main sur une conversation'),
  'conversation.release': agent('a rendu une conversation à l’agent'),
  // ADR 0168 § 3: the language she writes to him in, set by a person (the language only, never a word of his).
  'fan.language_set': action(
    'agent',
    z.object({ language: code }),
    (d) => `a fixé la langue d’un fan (${d.language})`,
  ),
  'draft.placed': action(
    'agent',
    z.object({ edited: z.boolean().optional() }),
    (d) => `a placé un brouillon dans la plateforme${d.edited === true ? ' après l’avoir modifié' : ''}`,
  ),
  'blind_test.record': action(
    'agent',
    z.object({ ratePerMille: count }),
    (d) => `a enregistré un test à l’aveugle (${frenchPercent(d.ratePerMille * 10)})`,
  ),
  'kill_switch.on': action(
    'agent',
    z.object({ scope: code, until: instant.optional() }),
    (d, c) =>
      `a arrêté l’agent${d.scope === 'creator' ? ` pour ${c.creator(c.entityId)}` : d.scope === 'global' ? ' partout' : ''}${d.until === undefined ? '' : ` jusqu’au ${frenchDay(d.until)}`}`,
    (d, c) => (d.scope === 'creator' ? creatorLink(z.uuid().safeParse(c.entityId).data) : null),
  ),
  'kill_switch.off': action(
    'agent',
    z.object({ scope: code }),
    (d, c) =>
      `a relancé l’agent${d.scope === 'creator' ? ` pour ${c.creator(c.entityId)}` : d.scope === 'global' ? ' partout' : ''}`,
    (d, c) => (d.scope === 'creator' ? creatorLink(z.uuid().safeParse(c.entityId).data) : null),
  ),
  'persona_version.create': action(
    'agent',
    persona,
    (d, c) => `a enregistré ${versionOf(d.version)} de la persona de ${c.creator(d.creatorId)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'persona_version.activate': action(
    'agent',
    persona,
    (d, c) => `a activé ${versionOf(d.version)} de la persona de ${c.creator(d.creatorId)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'persona_correction.done': action(
    'agent',
    z.object({ creatorId: id }),
    (d, c) => `a corrigé la persona de ${c.creator(d.creatorId)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'agency_style.create': action(
    'agent',
    z.object({ version: z.int().positive() }),
    (d) => `a enregistré la version ${String(d.version)} du style de base de l’agence`,
  ),
  'agency_style.activate': action(
    'agent',
    z.object({ version: z.int().positive() }),
    (d) => `a activé la version ${String(d.version)} du style de base de l’agence`,
  ),
  'custom_alert.create': agent('a créé une alerte personnalisée'),
  'custom_alert.update': agent('a modifié une alerte personnalisée'),
  'custom_alert.archive': agent('a archivé une alerte personnalisée'),
  'system_alert.update': agent('a modifié une alerte du système'),
  'creator_alert_route.update': action(
    'agent',
    none,
    (_d, c) => `a changé l’envoi d’une alerte de ${c.creator(c.entityId)}`,
  ),
  'telegram_channel.save': action(
    'agent',
    none,
    (_d, c) => `a enregistré le canal Telegram de ${c.creator(c.entityId)}`,
  ),
  'telegram_chat.remove': agent('a retiré un groupe Telegram'),
  'telegram_settings.save': agent('a modifié l’envoi des ventes sur Telegram'),
  'content_drop.submit_script': agent('a déposé un script'),
  'content_drop.withdraw': agent('a retiré un dépôt'),
  'content_drop.export_confirmed': agent('a confirmé l’export d’un dépôt'),
  'content_drop.correct_category': agent('a corrigé la catégorie d’un dépôt'),
  'media_description.validated': agent('a validé des descriptions de médias'),
  'media_description.corrected': agent('a corrigé une description de média'),
  'media_description.retried': agent('a relancé la description d’un média'),
  'media_description.written': agent('a écrit la description d’un média'),
  'script_summary.corrected': agent('a corrigé le résumé d’un script'),
  'script_summary.validated': agent('a validé le résumé d’un script'),
  'media.thumbnails_erased': action(
    'agent',
    z.object({ count }),
    (d, c) => `a effacé ${plural(d.count, 'vignette', 'vignettes')} de ${c.creator(c.entityId)}`,
  ),
  'platform_script.branches_set': action(
    'agent',
    scriptOf,
    (d, c) => `a nommé les branches d’un script${ofCreator(d, c)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'script_cadence.update': action(
    'agent',
    z.object({ days: count }),
    (d, c) =>
      `a réglé la cadence des scripts de ${c.creator(c.entityId)} (${plural(d.days, 'jour', 'jours')})`,
  ),
  'script_structure.create': agent('a créé une structure de script'),
  'script_structure.update': agent('a modifié une structure de script'),
  'script_structure.archive': agent('a archivé une structure de script'),
  'script_structure.freeze': agent('a figé une structure de script'),
  'script_queue.update': action(
    'agent',
    none,
    (_d, c) => `a changé la file des structures de ${c.creator(c.entityId)}`,
  ),
  'script_identity.validated': action(
    'agent',
    scriptOf,
    (d, c) => `a validé l’identité d’un script${ofCreator(d, c)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'script_identity.corrected': action(
    'agent',
    scriptOf,
    (d, c) => `a corrigé l’identité d’un script${ofCreator(d, c)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'prepared_script.created': action(
    'agent',
    scriptOf,
    (d, c) => `a préparé un script${ofCreator(d, c)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'prepared_script.saved': action(
    'agent',
    scriptOf,
    (d, c) => `a modifié un script préparé${ofCreator(d, c)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'prepared_script.state_changed': action(
    'agent',
    scriptOf,
    (d, c) => `a changé l’état d’un script préparé${ofCreator(d, c)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'prepared_script.matched': action(
    'agent',
    scriptOf,
    (d, c) => `a reconnu un script préparé dans la plateforme${ofCreator(d, c)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'redirect_link.create': agent('a créé un lien de redirection'),
  'redirect_link.update': agent('a modifié un lien de redirection'),
  'ai_budget.update': action(
    'agent',
    z.object({ after: z.object({ dailyCapMinor: minor.nullable() }).optional() }),
    (d) =>
      d.after === undefined || d.after.dailyCapMinor === null
        ? 'a changé le plafond de dépense de l’IA'
        : `a mis le plafond de dépense de l’IA à ${frenchMoney(d.after.dailyCapMinor)} par jour`,
  ),
  'ai_credit.add': action(
    'agent',
    z.object({ provider: code, amountMinor: minor, currency }),
    (d) => `a ajouté un crédit de ${frenchMoney(d.amountMinor, d.currency)} chez ${d.provider}`,
  ),
  'ai_credit.remove': action(
    'agent',
    z.object({ provider: code, amountMinor: minor, currency }),
    (d) => `a retiré un crédit de ${frenchMoney(d.amountMinor, d.currency)} chez ${d.provider}`,
  ),

  // ---- Argent (EQ-01, EQ-04 to EQ-06): rates, statements, payments, bonuses, penalties, invoices, credit notes, the
  // contractors' files and the accountant's exports.
  'commission_rate.create': action(
    'money',
    z.object({ effectiveFrom: day, fromPreset: z.boolean().optional() }),
    (d, c) =>
      `a changé le taux de ${c.member(c.entityId)} à partir du ${frenchDay(d.effectiveFrom)}${d.fromPreset === true ? ' (préréglage)' : ''}`,
  ),
  'commission_preset.create': action(
    'money',
    z.object({ effectiveFrom: day }),
    (d) => `a créé un préréglage de commission à partir du ${frenchDay(d.effectiveFrom)}`,
  ),
  'creator_agency_rate.create': action(
    'money',
    z.object({ creatorId: id, fromDay: day, agencyBps: count }),
    (d, c) =>
      `a mis la part de l’agence sur ${c.creator(d.creatorId)} à ${frenchPercent(d.agencyBps)} à partir du ${frenchDay(d.fromDay)}`,
    (d) => creatorLink(d.creatorId),
  ),
  'account_pay_rules.create': action(
    'money',
    z.object({ fromPeriod: period }),
    (d) => `a changé les règles de paie d’un compte à partir de la quinzaine ${frenchPeriod(d.fromPeriod)}`,
  ),
  'commission_statement.validate': action(
    'money',
    statementEvent.extend({ carriedMinor: minor.optional() }),
    (d) =>
      `a validé un relevé de la quinzaine ${frenchPeriod(d.period)}${d.carriedMinor !== undefined && d.carriedMinor > 0 ? ` (${frenchMoney(d.carriedMinor)} reportés)` : ''}`,
  ),
  'commission_statement.pay': action(
    'money',
    statementEvent.extend({ paidOn: day, sentMinor: minor, method: code.optional() }),
    (d) =>
      `a payé un relevé de la quinzaine ${frenchPeriod(d.period)} : ${frenchMoney(d.sentMinor)} envoyés le ${frenchDay(d.paidOn)}`,
  ),
  'commission_statement.certificate_locked': action(
    'money',
    z.object({ retainUntil: instant }),
    (d) => `a verrouillé l’attestation d’un versement jusqu’au ${frenchDay(d.retainUntil)}`,
  ),
  'pay_period.close': action('money', none, (_d, c) => {
    const closed = PayPeriodSchema.safeParse(c.entityId);
    return closed.success ? `a clôturé la quinzaine ${frenchPeriod(closed.data)}` : 'a clôturé une quinzaine';
  }),
  'bonus.create': action(
    'money',
    z.object({ period }),
    (d) => `a accordé une prime pour la quinzaine ${frenchPeriod(d.period)}`,
  ),
  'bonus.cancel': action(
    'money',
    z.object({ period }),
    (d) => `a annulé une prime de la quinzaine ${frenchPeriod(d.period)}`,
  ),
  'penalty.create': action('money', z.object({ fromPeriod: period, toPeriod: period }), (d) =>
    d.fromPeriod === d.toPeriod
      ? `a posé une pénalité pour la quinzaine ${frenchPeriod(d.fromPeriod)}`
      : `a posé une pénalité du ${frenchDay(d.fromPeriod)} au ${frenchDay(payPeriodLastDay(d.toPeriod))}`,
  ),
  'penalty.cancel': action(
    'money',
    z.object({ cancelledFrom: period }),
    (d) => `a annulé une pénalité à partir de la quinzaine ${frenchPeriod(d.cancelledFrom)}`,
  ),
  'pay_adjustment.create': action(
    'money',
    z.object({ period, contestedInvoiceId: id.optional() }),
    (d) =>
      `a ajouté une correction de paie pour la quinzaine ${frenchPeriod(d.period)}${d.contestedInvoiceId === undefined ? '' : ' (contestation d’une facture)'}`,
    (d) => (d.contestedInvoiceId === undefined ? null : { kind: 'invoice', id: d.contestedInvoiceId }),
  ),
  'bonus_tier_set.create': action(
    'money',
    z.object({ fromPeriod: period }),
    (d) => `a changé les paliers de prime à partir de la quinzaine ${frenchPeriod(d.fromPeriod)}`,
  ),
  'collective_goal.create': action(
    'money',
    z.object({ period }),
    (d) => `a fixé l’objectif collectif de la quinzaine ${frenchPeriod(d.period)}`,
  ),
  'payout_minimum.create': action(
    'money',
    z.object({ fromPeriod: period, minimumPayoutMinor: minor }),
    (d) =>
      `a mis le minimum de versement à ${frenchMoney(d.minimumPayoutMinor)} à partir de la quinzaine ${frenchPeriod(d.fromPeriod)}`,
  ),
  'payroll_settings.update': action(
    'money',
    z.object({ payoutDelayBusinessDays: z.object({ from: count.nullable(), to: count }) }),
    (d) =>
      d.payoutDelayBusinessDays.from === null
        ? `a mis le délai de versement à ${plural(d.payoutDelayBusinessDays.to, 'jour ouvré', 'jours ouvrés')}`
        : `a changé le délai de versement de ${String(d.payoutDelayBusinessDays.from)} à ${plural(d.payoutDelayBusinessDays.to, 'jour ouvré', 'jours ouvrés')}`,
  ),
  'pay_sale_decision.create': action(
    'money',
    z.object({ period, outcome: code, recipientMemberId: id.optional(), shareBp: count.optional() }),
    (d, c) => {
      const when = ` (quinzaine ${frenchPeriod(d.period)})`;
      if (d.outcome === 'give')
        return `a donné une vente à ${c.member(d.recipientMemberId)}${d.shareBp === undefined ? '' : ` pour ${frenchPercent(d.shareBp)}`}${when}`;
      if (d.outcome === 'exclude') return `a exclu une vente de la paie${when}`;
      if (d.outcome === 'withdraw') return `a retiré une vente de la paie${when}`;
      return `a compté une vente dans la paie${when}`;
    },
    (d) => memberLink(d.recipientMemberId),
  ),
  'pay_sale_signal.create': action(
    'money',
    z.object({ period }),
    (d) => `a signalé une vente (quinzaine ${frenchPeriod(d.period)})`,
  ),
  'sale_claim.create': action(
    'money',
    z.object({ period }),
    (d) => `a dit avoir été décisif sur une vente (quinzaine ${frenchPeriod(d.period)})`,
  ),
  'sale_claim.answer': action(
    'money',
    z.object({ period, outcome: code, memberId: id }),
    (d, c) => {
      const who = c.member(d.memberId);
      if (d.outcome === 'withdrawn')
        return `a retiré son signalement d’une vente décisive (quinzaine ${frenchPeriod(d.period)})`;
      if (d.outcome === 'settled')
        return `a réglé le signalement de vente de ${who} (quinzaine ${frenchPeriod(d.period)})`;
      return `n’a pas retenu le signalement de vente de ${who} (quinzaine ${frenchPeriod(d.period)})`;
    },
    (d) => memberLink(d.memberId),
  ),
  'invoice.issue': action('money', issued, (d) =>
    d.reissuedInvoiceId === undefined
      ? `a émis la facture ${d.number}`
      : `a émis la facture rectificative ${d.number}`,
  ),
  'credit_note.issue': action('money', issued, (d) => `a émis l’avoir ${d.number}`),
  'invoice.not_issued': action(
    'money',
    z.object({ document: code.optional(), reason: code, amountMinor: minor.optional() }),
    (d) =>
      `a laissé ${d.document === 'credit_note' ? 'un avoir' : 'une facture'}${d.amountMinor === undefined ? '' : ` de ${frenchMoney(d.amountMinor)} HT`} en attente : ${NOT_ISSUED_REASONS[d.reason] ?? d.reason}`,
  ),
  'invoice.paid': action(
    'money',
    settlement,
    (d) => `a soldé ${documentName('invoice', d.number)} par un versement`,
  ),
  'credit_note.imputed': action(
    'money',
    settlement,
    (d) => `a imputé ${documentName('credit_note', d.number)}`,
  ),
  'invoice.compensated': action(
    'money',
    settlement,
    (d) => `a compensé ${documentName('invoice', d.number)}`,
  ),
  'credit_note.compensated': action(
    'money',
    settlement,
    (d) => `a compensé ${documentName('credit_note', d.number)}`,
  ),
  'invoice.accept': action('money', numbered, (d) => `a accepté ${documentName('invoice', d.number)}`),
  'invoice.contest': action('money', numbered, (d) => `a contesté ${documentName('invoice', d.number)}`),
  'invoice.contest_uphold': action(
    'money',
    acceptance,
    (d) => `a donné raison à la contestation de ${documentName('invoice', d.number)}`,
  ),
  'invoice.contest_refuse': action(
    'money',
    acceptance,
    (d) => `a refusé la contestation de ${documentName('invoice', d.number)}`,
  ),
  'invoice.lapse': action(
    'money',
    numbered,
    (d) => `a accepté tacitement ${documentName('invoice', d.number)}`,
  ),
  'invoice.contest_alert': action(
    'money',
    z.object({ number: documentNumber.optional(), document: code.optional() }),
    (d) => `a signalé la contestation de ${documentName(d.document, d.number)}`,
  ),
  'invoice.due_alert': action(
    'money',
    z.object({ memberId: id.optional(), dueOn: day }),
    (d, c) =>
      `a signalé l’échéance d’une facture${d.memberId === undefined ? '' : ` de ${c.member(d.memberId)}`} au ${frenchDay(d.dueOn)}`,
  ),
  'invoice.pdf_store': action(
    'money',
    z.object({ retainUntil: instant }),
    (d) => `a conservé le PDF d’une facture jusqu’au ${frenchDay(d.retainUntil)}`,
  ),
  'invoice.pdf_copy': action('money', none, () => 'a copié le PDF d’une facture'),
  'invoice.pdf_conflict': action('money', none, () => 'a trouvé un PDF de facture différent de l’original'),
  'invoice.pdf_missing': action('money', none, () => 'a trouvé un PDF de facture manquant'),
  'billing_settings.update': action(
    'money',
    changedFields,
    (d) => `a modifié les réglages de facturation${fieldsCount(d.changed)}`,
  ),
  'billing_settings.accounts': action(
    'money',
    changedFields,
    (d) => `a modifié les comptes du journal${fieldsCount(d.changed)}`,
  ),
  'agency_logo.add': action('money', none, () => 'a ajouté le logo de l’agence'),
  'contractor_profile.create': action(
    'money',
    none,
    (_d, c) => `a rempli le dossier de prestataire de ${c.member(c.entityId)}`,
  ),
  'contractor_profile.update': action(
    'money',
    changedFields.extend({ checkCleared: z.boolean().optional() }),
    (d, c) =>
      `a modifié le dossier de prestataire de ${c.member(c.entityId)}${fieldsCount(d.changed)}${d.checkCleared === true ? ', vérification à refaire' : ''}`,
  ),
  'contractor_profile.verify': action(
    'money',
    none,
    (_d, c) => `a vérifié le dossier de prestataire de ${c.member(c.entityId)}`,
  ),
  'contractor_profile.prefix': action('money', z.object({ from: prefix.nullable(), to: prefix }), (d, c) =>
    d.from === null
      ? `a donné le préfixe de facture ${d.to} à ${c.member(c.entityId)}`
      : `a changé le préfixe de facture de ${c.member(c.entityId)} de ${d.from} à ${d.to}`,
  ),
  'contract_text.add': action(
    'money',
    z.object({ kind: code, version: count }),
    (d) => `a publié la version ${String(d.version)} ${CONTRACT_NAMES[d.kind] ?? `du texte ${d.kind}`}`,
  ),
  'contract.accept': action(
    'money',
    z.object({ kind: code, version: count }),
    (d) => `a accepté la version ${String(d.version)} ${CONTRACT_NAMES[d.kind] ?? `du texte ${d.kind}`}`,
  ),
  'billing_regime.create': action(
    'money',
    z.object({ countries: z.array(country) }),
    (d) => `a créé un régime de facturation (${d.countries.join(', ')})`,
  ),
  'billing_regime.validate': action(
    'money',
    z.object({ validatedOn: day }),
    (d) => `a validé un régime de facturation le ${frenchDay(d.validatedOn)}`,
  ),
  'contractor_regime.assign': action(
    'money',
    z.object({ memberId: id, from: day }),
    (d, c) =>
      `a appliqué un régime de facturation à ${c.member(d.memberId)} à partir du ${frenchDay(d.from)}`,
    (d) => memberLink(d.memberId),
  ),
  'contractor_document.add': action(
    'money',
    contractorDocument,
    (d, c) => `a déposé une pièce du dossier de ${c.member(d.memberId)}`,
    (d) => memberLink(d.memberId),
  ),
  'contractor_document.review': action(
    'money',
    contractorDocument,
    (d, c) =>
      `a ${d.decision === 'refused' ? 'refusé' : 'accepté'} une pièce du dossier de ${c.member(d.memberId)}`,
    (d) => memberLink(d.memberId),
  ),
  'contractor_document.purge': action(
    'money',
    contractorDocument,
    (d, c) => `a effacé le fichier d’une pièce refusée de ${c.member(d.memberId)}`,
    (d) => memberLink(d.memberId),
  ),
  'contractor_document.remind': action(
    'money',
    contractorDocument,
    (d, c) => `a rappelé une pièce à renouveler du dossier de ${c.member(d.memberId)}`,
    (d) => memberLink(d.memberId),
  ),
  'accounting_journal.export': action(
    'money',
    exportRange,
    (d) => `a exporté le journal comptable du ${frenchDay(d.from)} au ${frenchDay(d.to)}`,
  ),
  'accounting_das2.export': action(
    'money',
    z.object({ year: z.number().int().min(2000).max(2999) }),
    (d) => `a exporté le récapitulatif DAS2 de ${String(d.year)}`,
  ),
  'accounting_archive.export': action(
    'money',
    exportRange,
    (d) => `a exporté l’archive des factures du ${frenchDay(d.from)} au ${frenchDay(d.to)}`,
  ),
};

/**
 * The actions named by a prefix, whose last part the writer chooses: an MCP tool (`mcp.<tool>`, ADR 0026 § 8), the
 * name of the catalogue or `tool_unknown`, never the name an agent gave.
 */
export const AUDIT_ACTION_FAMILIES: readonly {
  readonly prefix: string;
  readonly definition: (rest: string) => AuditActionDefinition;
}[] = [
  {
    prefix: 'mcp.',
    definition: (tool) =>
      action(
        'access',
        z.object({ outcome: code.optional(), creatorId: id.nullable().optional() }),
        (d, c) => {
          const name =
            /^[a-z0-9_]{1,64}$/u.test(tool) && tool !== 'tool_unknown'
              ? `l’outil ${tool}`
              : 'un outil inconnu';
          const refused = d.outcome !== undefined && d.outcome !== 'ok' ? ' (refusé)' : '';
          const of =
            d.creatorId === null || d.creatorId === undefined ? '' : ` pour ${c.creator(d.creatorId)}`;
          return `a appelé ${name} par MCP${of}${refused}`;
        },
      ),
  },
];

/**
 * The category of an action nobody has described yet, by its first word: a writer of money is never filed with the
 * others because the registry has not caught up with it (the retention of lot c reads this category).
 */
export const AUDIT_CATEGORY_PREFIXES: readonly {
  readonly prefix: string;
  readonly category: AuditCategory;
}[] = [
  { prefix: 'invoice', category: 'money' },
  { prefix: 'credit_note', category: 'money' },
  { prefix: 'commission', category: 'money' },
  { prefix: 'pay', category: 'money' },
  { prefix: 'bonus', category: 'money' },
  { prefix: 'penalty', category: 'money' },
  { prefix: 'contract', category: 'money' },
  { prefix: 'billing', category: 'money' },
  { prefix: 'accounting', category: 'money' },
  { prefix: 'auth.', category: 'access' },
  { prefix: 'mcp', category: 'access' },
];

/** The category of any action, known or not: the registry, its families, then its first word, then `team`. */
export const AUDIT_DEFAULT_CATEGORY: AuditCategory = 'team';
