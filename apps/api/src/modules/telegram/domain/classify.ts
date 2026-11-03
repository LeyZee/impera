import {
  payPeriodLastDay,
  CUSTOM_ALERT_TOPIC,
  SYSTEM_ALERT_LABELS,
  SYSTEM_ALERT_TOPICS,
  type AlertRef,
  type AutomaticMissing,
  type ContractorDocumentKind,
  type HandoffCause,
  type InvoiceNotIssuedReason,
  type InvoicePdfPlace,
  type PayoutBlock,
  type PayPeriod,
  type Platform,
  type SaleSeller,
  type SaleType,
  type SecurityAlertPayload,
  type SystemAlertCode,
  type UserRole,
  type TelegramTopic,
} from '@nirvana/contracts';

import { saleAmount } from './sales';
import type { Notice, Outcome, Signal } from './signals';

/**
 * The classification table (ADR 0020 §2, CLAUDE.md rule 3): which event becomes which message, in code. An event
 * missing from here produces nothing.
 */

/**
 * The event types the module reads. Mirrored by the trigger `domain_events_telegram_scan`, recreated by each
 * migration that changes the list (a test compares them); types that do not exist yet in the contract are listed so
 * that their producers light their tab up without a new migration.
 */
export const SCANNED_EVENT_TYPES = [
  'handoff_requested',
  'budget_threshold_crossed',
  'session_state_changed',
  'kill_switch_toggled',
  'takeover_started',
  'takeover_ended',
  'sale_detected',
  'alert_triggered',
  'validation_requested',
  'validation_resolved',
  'automatic_closed',
  'send_failed',
  'backup_overdue',
  'exchange_rate_overdue',
  'invoice_not_issued',
  'invoice_pdf_conflict',
  'invoice_pdf_missing',
  'invoice_contested',
  'contractor_document_expiring',
  'invoice_due_soon',
  'invoice_overdue',
  'security_alert',
] as const;

const URGENT_CAUSES: ReadonlySet<HandoffCause> = new Set([
  'minor',
  'non_consent',
  'distress',
  'meeting',
  'manipulation',
]);

const CAUSE_TEXT: Readonly<Record<HandoffCause, string>> = {
  minor: 'Possible mineur dans la conversation.',
  non_consent: 'Possible contenu sans consentement.',
  distress: 'Le fan semble en détresse.',
  meeting: 'Le fan insiste pour une rencontre.',
  manipulation: 'Le fan tente de manipuler l’agent.',
  guard: 'Une réponse a été bloquée par une garde.',
  budget: 'Le plafond IA du jour est atteint.',
  keyword: 'Un mot surveillé a été écrit.',
  llm_unavailable: 'Le modèle ne répond plus.',
  other: 'L’agent ne sait pas répondre.',
  custom_alert: 'Une alerte personnalisée a sonné.',
  identity_doubt: 'Le fan doute de parler vraiment à la créatrice.',
  persona_inactive: 'La créatrice n’a pas de persona active : l’agent n’écrit rien.',
};

/**
 * A handoff one of her alerts caused goes to that alert's topic (P4-01), the one Réglages › Alertes shows: the
 * contract's table, read here and by the screen. Any other cause goes to the important groups.
 */
const ALERT_CAUSE_TOPIC: Readonly<Partial<Record<HandoffCause, TelegramTopic>>> = {
  keyword: SYSTEM_ALERT_TOPICS.keyword,
  identity_doubt: SYSTEM_ALERT_TOPICS.identity_doubt,
  custom_alert: CUSTOM_ALERT_TOPIC,
};

/** What an alert that does not pause the agent says: the alert, never the fan's words. */
const SYSTEM_ALERT_TEXT: Readonly<Record<SystemAlertCode, string>> = {
  keyword: CAUSE_TEXT.keyword,
  service_request:
    'Le fan demande un service (contenu sur mesure, appel, cam, vocal) : un humain peut le lui vendre.',
  identity_doubt: CAUSE_TEXT.identity_doubt,
};

/** An alert of hers is named, as Suivi › Historique des alertes names it; the system's by their label there. */
export type AlertNameOf = (alert: AlertRef & { kind: 'custom' }) => string | null;

const noNames: AlertNameOf = () => null;

const alertTitle = (alert: AlertRef, nameOf: AlertNameOf): string =>
  alert.kind === 'system' ? SYSTEM_ALERT_LABELS[alert.code] : (nameOf(alert) ?? 'Alerte personnalisée');

/** Her alert by its name, written by the agency, never the fan's words; without a name read, the generic line. */
function customAlertText(alert: AlertRef & { kind: 'custom' }, nameOf: AlertNameOf): string {
  const name = nameOf(alert);
  return name === null ? CAUSE_TEXT.custom_alert : `Le message du fan correspond à l’alerte « ${name} ».`;
}

/** A seller who is a member is named by the name the team shows (CRM-04 lot b); `null` when it was not read. */
export type MemberNameOf = (memberId: string) => string | null;

const noMembers: MemberNameOf = () => null;

/** The kinds of sales as the team reads them; the platform's own words stay out. */
const SALE_TYPE_TEXT: Readonly<Record<SaleType, string>> = {
  subscription: 'Abonnement',
  renewal: 'Renouvellement',
  ppv: 'PPV',
  mass_dm: 'Mass DM',
  tip: 'Pourboire',
  payment_link: 'Lien de paiement',
  boudoir: 'Boudoir',
  paid_message: 'Message payant',
  other: 'Autre vente',
};

/** Who sold, in four cases (ADR 0050 § 5): a member by name, the agent, a chatter nobody linked yet, nobody. */
function sellerText(seller: SaleSeller, memberNameOf: MemberNameOf): string {
  switch (seller.kind) {
    case 'member': {
      const name = memberNameOf(seller.memberId);
      return name === null ? 'vendue par un chatteur' : `vendue par ${name}`;
    }
    case 'agent':
      return 'vendue par l’agent';
    case 'unlinked':
      return 'chatteur non relié';
    case 'none':
      return 'sans chatteur';
  }
}

const alertTopic = (alert: AlertRef): TelegramTopic =>
  alert.kind === 'custom' ? CUSTOM_ALERT_TOPIC : SYSTEM_ALERT_TOPICS[alert.code];

const KILL_REASON_MAX = 200;

const euros = (minor: number): string =>
  `${(minor / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

/** « 74,5 % » for a rate, always to the tenth; « 80 % » for a target, the tenth only when it has one. */
const percent = (value: number, minimumFractionDigits: 0 | 1): string =>
  `${value.toLocaleString('fr-FR', { minimumFractionDigits, maximumFractionDigits: 1 })} %`;

/** Why Automatique closed, in the owner's words; the figures are the server's, the thresholds too. */
function missingText(missing: AutomaticMissing): string {
  switch (missing.kind) {
    case 'active_persona':
      return 'elle n’a pas de persona active';
    case 'live_rate':
      return missing.value === null
        ? `le taux en réel n’est pas encore mesuré (objectif : ${percent(missing.target, 0)})`
        : `le taux en réel est à ${percent(missing.value, 1)} (objectif : ${percent(missing.target, 0)})`;
    case 'decided_drafts':
      return `${String(missing.value)} brouillons décidés sur les ${String(missing.target)} demandés`;
    case 'blind_test':
      return 'le test à l’aveugle de cette version de la voix n’est pas validé';
  }
}

/** « le 26 oct. à 03:04 », in Paris time: the export's schedule is Paris time too (ADR 0028 § 1). */
const parisMoment = (at: Date): string => {
  const day = at.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' });
  const time = at.toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `le ${day} à ${time}`;
};

/** « le 24 oct. », for a day as the ECB writes it (`2026-10-24`): a calendar day, no time zone to apply. */
const calendarDay = (day: string): string =>
  `le ${new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' })}`;

/** « la quinzaine du 16 au 31 oct. »: calendar days, no time zone to apply. */
const periodText = (period: PayPeriod): string => {
  const last = payPeriodLastDay(period);
  const month = new Date(`${last}T12:00:00Z`).toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    month: 'short',
  });
  const first = period.endsWith('-01') ? '1er' : '16';
  return `la quinzaine du ${first} au ${String(Number(last.slice(8)))} ${month}`;
};

/** Why a document was not issued, as the owner settles it; the contractor is never named in Telegram. */
const INVOICE_NOT_ISSUED_TEXT: Record<InvoiceNotIssuedReason, string> = {
  no_mandate: 'le prestataire n’a pas accepté de mandat de facturation',
  no_regime: 'aucun régime de facturation n’était attribué au prestataire à la date de la facture',
  regime_not_validated:
    'le régime de facturation du prestataire n’était pas validé par le comptable à la date de la facture',
  regime_country_mismatch: 'le régime de facturation du prestataire n’est pas celui du pays de sa fiche',
  identity_incomplete: 'le dossier prestataire est incomplet pour son régime de facturation',
  identity_unverified: 'le dossier prestataire n’est pas encore vérifié',
  tax_residence_missing:
    'le prestataire n’a pas d’attestation de résidence fiscale de cette année au dossier',
  tax_residence_unverified: 'l’attestation de résidence fiscale du prestataire attend ta vérification',
  prefix_missing: 'le prestataire n’a pas de préfixe de facture',
  agency_missing: 'les réglages de facturation de l’agence ne sont pas remplis',
  no_invoice_to_credit: 'aucune facture ne peut prendre l’avoir entier, à voir avec le comptable',
};

/** Where a document's PDF lies (ADR 0037): Hetzner first, the copy at a second provider; named as the owner knows them. */
const PDF_PLACE_NAMES: Record<InvoicePdfPlace, string> = { primary: 'Hetzner', ovhcloud: 'OVHcloud' };

const pdfPlaceText = (place: InvoicePdfPlace): string =>
  place === 'primary' ? `chez ${PDF_PLACE_NAMES.primary}` : `chez ${PDF_PLACE_NAMES[place]} (la copie)`;

/**
 * What a conflict means by stage and place, as #335 raises it: the render found another file at Hetzner; the copy found
 * the first file missing or altered (`primary`) or a copy not the expected one, other bytes or another lock (a copy
 * provider); a download found the file of that place missing or altered and did not serve it.
 */
function pdfConflictText(signal: Signal & { kind: 'invoice_pdf_conflict' }): string {
  const { number, place } = signal;
  switch (signal.stage) {
    case 'render':
      return `Le PDF du document ${number} n’a pas été enregistré : ${pdfPlaceText(place)}, sa place est déjà prise par un autre fichier. Rien n’a été remplacé ; le document reste émis, mais ne se télécharge pas encore. À vérifier.`;
    case 'copy':
      return place === 'primary'
        ? `Le PDF du document ${number} manque chez ${PDF_PLACE_NAMES.primary} ou ne correspond plus à son empreinte : il n’a pas été copié, et aucune copie n’existe encore ; il ne se télécharge plus. À vérifier.`
        : `La copie du PDF du document ${number} chez ${PDF_PLACE_NAMES[place]} n’est pas celle attendue (autre fichier ou autre verrou) : rien n’a été remplacé, la copie n’est pas enregistrée. Le PDF chez ${PDF_PLACE_NAMES.primary} n’a pas été touché. À vérifier.`;
    case 'download':
      return `Au téléchargement, le PDF du document ${number} ${pdfPlaceText(place)} manquait ou ne correspondait pas à son empreinte : ce fichier n’a pas été servi, rien n’a été remplacé. À vérifier.`;
  }
}

const PAY_LINK = { label: 'Ouvrir la Paie', path: '/paie' };

/** « 31 décembre 2026 »: a calendar day, no time zone to apply. */
const longDay = (day: string): string => {
  const date = new Date(`${day}T12:00:00Z`);
  const month = date.toLocaleDateString('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const number = date.getUTCDate();
  return `${number === 1 ? '1er' : String(number)} ${month}`;
};

/** Why the transfer that will pay an invoice is blocked (ADR 0041 § 4), as the Paie says it. */
const payoutBlockText = (block: PayoutBlock): string => {
  switch (block.reason) {
    case 'documents_not_issued':
      return 'une facture ou un avoir qu’il paie n’est pas encore émis';
    case 'tax_residence_missing':
      return `l’attestation de résidence fiscale ${block.year ?? ''} du prestataire est absente`;
    case 'tax_residence_unverified':
      return `l’attestation de résidence fiscale ${block.year ?? ''} du prestataire attend ta vérification`;
  }
};

/**
 * An invoice's due date (EQ-06 lot 8): its number and due date, worded to stay true whatever day it is read; when the
 * transfer is blocked, why, and what passing the due date costs (L441-10: late-payment penalties and the 40 €
 * indemnity, mentions printed on every invoice). Never its amount: no figure of pay goes to Telegram.
 */
const invoiceDueText = (signal: Extract<Signal, { kind: 'invoice_due' }>): string => {
  const day = longDay(signal.dueOn);
  const block =
    signal.payoutBlock === null ? '' : ` Son versement est bloqué : ${payoutBlockText(signal.payoutBlock)}.`;
  const costs = 'des pénalités de retard et l’indemnité forfaitaire de 40 € peuvent être réclamées';
  if (signal.overdue) {
    return `La facture ${signal.number} d’un prestataire a passé son échéance du ${day} sans être réglée : ${costs}.${block}`;
  }
  return `La facture ${signal.number} d’un prestataire arrive à échéance le ${day}.${block}${
    signal.payoutBlock === null ? '' : ` S’il dépasse l’échéance, ${costs}.`
  }`;
};

/**
 * What a contractor's document expiring means (EQ-06 lot 5c-2, glossary « Pièce du prestataire »): without the tax
 * residence certificate of the next year, no transfer of that year is recorded under a treaty regime (ADR 0041 § 5),
 * the invoices leaving all the same; without a valid URSSAF certificate, an invoice leaves with a warning. Worded to
 * stay true after the last day: the reminder can come late. The contractor is never named in Telegram: the link opens
 * their file.
 */
const contractorDocumentText = (document: ContractorDocumentKind, lastDay: string): string => {
  switch (document) {
    case 'tax_residence': {
      // Its last day is always 31 December: it covers the transfers of its year, and those of January wait for the next.
      const next = String(Number(lastDay.slice(0, 4)) + 1);
      return `L’attestation de résidence fiscale d’un prestataire couvre l’année ${lastDay.slice(0, 4)}, et aucune plus récente n’est au dossier. Sans celle de ${next}, ses versements à partir du 1er janvier ${next} seront bloqués.`;
    }
    case 'urssaf_vigilance':
      return `L’attestation de vigilance URSSAF d’un prestataire a pour dernier jour le ${longDay(lastDay)}, et aucune plus récente n’est au dossier. Échue, ses factures partent avec un avertissement.`;
  }
};

const conversationLink = (conversationId: string | null): { label: string; path: string } => ({
  label: 'Ouvrir la conversation',
  path: conversationId === null ? '/suivi' : `/suivi?conversation=${conversationId}`,
});

function scopeLabel(scope: Signal & { kind: 'kill_switch' }): string {
  switch (scope.scope) {
    case 'global':
      return 'pour toutes les créatrices';
    case 'creator':
      return 'pour cette créatrice';
    case 'conversation':
      return 'pour une conversation';
  }
}

/** `nameOf` names her alerts (P4-01); without it, a message says « une alerte personnalisée ». */
const ROLE_TEXT: Readonly<Record<UserRole, string>> = {
  owner: 'le compte propriétaire',
  operator: 'un compte de l’équipe',
  creator: 'le compte d’une créatrice',
};

const accountText = (role: UserRole | null): string => (role === null ? 'un compte' : ROLE_TEXT[role]);

const PLATFORM_NAMES: Readonly<Record<Platform, string>> = {
  reveal: 'Reveal',
  onlyfans: 'OnlyFans',
  instagram: 'Instagram',
  nirvana: 'Nirvana',
};

// Réglages › Sécurité (SEC-04): the owner's sessions, and each account's, where he closes them.
const SECURITY_LINK = { label: 'Ouvrir la sécurité', path: '/reglages/securite' };

/**
 * A security alert (ADR 0046 § 8): the act, the account's role and its network, written by the code; never a name,
 * never a full address (the payload holds none), never the ids it carries.
 */
function securityNotice(alert: SecurityAlertPayload): Pick<Notice, 'body' | 'link'> {
  switch (alert.reason) {
    case 'new_device_sign_in':
      return {
        body: `Connexion ${alert.role === 'owner' ? 'au compte propriétaire' : `à ${accountText(alert.role)}`} depuis un appareil qui n’était pas de confiance${alert.network === null ? '' : ` (réseau ${alert.network})`}. Si ce n’est pas le propriétaire, ferme ses sessions et change son mot de passe.`,
        link: SECURITY_LINK,
      };
    case 'sign_in_refusals':
      return {
        body: `${String(alert.refusals)} refus de mot de passe, de code ou de clé d’accès en ${String(alert.windowMinutes)} minutes sur ${accountText(alert.role)}${alert.network === null ? '' : ` (dernier réseau ${alert.network})`} : quelqu’un essaie peut-être d’y entrer.`,
        link: SECURITY_LINK,
      };
    case 'second_factor_reset':
      return {
        body: `Deuxième facteur remis à zéro sur ${accountText(alert.role)}, ${alert.via === 'ops' ? 'depuis le serveur' : 'par un lien de réinitialisation'} : ses sessions et ses appareils de confiance sont fermés.`,
        link: SECURITY_LINK,
      };
    case 'passkey_added':
      return {
        body: `Clé d’accès (Face ID, empreinte) ajoutée sur ${accountText(alert.role)}${alert.network === null ? '' : ` (réseau ${alert.network})`}. Si personne ne l’a fait, retire ses clés et ferme ses sessions.`,
        link: SECURITY_LINK,
      };
    case 'passkey_new_sign_in':
      return {
        body: `Connexion au compte propriétaire avec une clé d’accès jamais utilisée${alert.network === null ? '' : ` (réseau ${alert.network})`}. Si ce n’est pas le propriétaire, retire ses clés et ferme ses sessions.`,
        link: SECURITY_LINK,
      };
    case 'persona_activated':
      return {
        body: `Une autre version de la persona est maintenant active (${alert.version}).`,
        link: { label: 'Ouvrir les créatrices', path: '/creatrices' },
      };
    case 'automatic_enabled':
      return {
        body:
          alert.scope === 'creator'
            ? 'Mode Automatique allumé : l’agent envoie seul sur toutes ses conversations.'
            : 'Mode Automatique allumé sur une conversation : l’agent y envoie seul.',
        link: { label: 'Ouvrir le mode de l’agent', path: '/reglages/mode' },
      };
    case 'platform_session_replaced':
      return {
        body: `La session ${PLATFORM_NAMES[alert.platform]} de l’agent a été remplacée par une autre. Si personne de l’agence ne l’a fait, vérifie le compte branché.`,
        link: { label: 'Ouvrir les Réglages', path: '/reglages' },
      };
  }
}

export function classify(
  signal: Signal,
  nameOf: AlertNameOf = noNames,
  memberNameOf: MemberNameOf = noMembers,
): Outcome | null {
  switch (signal.kind) {
    case 'handoff': {
      const isUrgent = signal.cause !== null && URGENT_CAUSES.has(signal.cause);
      const causeTopic = signal.cause === null || isUrgent ? undefined : ALERT_CAUSE_TOPIC[signal.cause];
      const cause =
        signal.cause === null
          ? 'L’agent passe la main.'
          : signal.cause === 'custom_alert' && signal.alert?.kind === 'custom'
            ? customAlertText(signal.alert, nameOf)
            : CAUSE_TEXT[signal.cause];
      return {
        kind: 'notice',
        topic: isUrgent ? 'urgent' : (causeTopic ?? 'important'),
        // A fan paused by one of her alerts waits for a human: without a group for its topic, the important ones.
        ...(causeTopic !== undefined && causeTopic !== 'important' && { fallbackTopic: 'important' }),
        threadKey: signal.conversationId === null ? null : `conversation:${signal.conversationId}`,
        title: isUrgent ? 'URGENT' : 'Important',
        body: `${cause} Il n’écrit plus à ce fan et attend un humain.`,
        link: conversationLink(signal.conversationId),
      };
    }
    // The agent goes on: nothing to close, and no fallback, it only lets a human know.
    case 'alert': {
      const topic = alertTopic(signal.alert);
      return {
        kind: 'notice',
        topic,
        threadKey: null,
        title: alertTitle(signal.alert, nameOf),
        body: `${signal.alert.kind === 'custom' ? customAlertText(signal.alert, nameOf) : SYSTEM_ALERT_TEXT[signal.alert.code]} L’agent continue de lui répondre.`,
        link: conversationLink(signal.conversationId),
      };
    }
    // Same thread as a handoff: a takeover or a hand-back closes it.
    case 'send_failed':
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: signal.conversationId === null ? null : `conversation:${signal.conversationId}`,
        title: 'Important',
        body: 'Un message de l’agent n’a pas pu partir. Il n’écrit plus à ce fan et attend un humain.',
        link: conversationLink(signal.conversationId),
      };
    case 'takeover':
      return signal.conversationId === null
        ? null
        : {
            kind: 'closure',
            threadKey: `conversation:${signal.conversationId}`,
            mode: 'edit',
            text: 'Pris en main',
            userId: signal.userId,
          };
    // After a handoff the conversation is already the humans': giving it back is how the alert gets closed.
    case 'release':
      return signal.conversationId === null
        ? null
        : {
            kind: 'closure',
            threadKey: `conversation:${signal.conversationId}`,
            mode: 'edit',
            text: 'Rendu à l’agent',
            userId: signal.userId,
          };
    case 'budget':
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: null,
        title: 'Important',
        body:
          signal.threshold === 'reached'
            ? `Plafond IA atteint (${euros(signal.capMinor)}) : plus de génération jusqu’à minuit, les chatteurs reprennent.`
            : `Plafond IA : ${euros(signal.spentMinor)} sur ${euros(signal.capMinor)} aujourd’hui.`,
        link: { label: 'Voir les modèles IA', path: '/reglages/modeles-ia' },
      };
    case 'session_expired':
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: `session:${signal.platformAccountId}`,
        title: 'Important',
        body: 'La session Reveal a expiré : l’agent ne lit plus les messages.',
        link: { label: 'Reconnecter la session', path: '/reglages' },
      };
    case 'session_back':
      return {
        kind: 'closure',
        threadKey: `session:${signal.platformAccountId}`,
        mode: 'reply',
        text: 'Résolu : la session est revenue.',
        userId: null,
      };
    case 'kill_switch': {
      const threadKey = `kill:${signal.scope}:${signal.scopeId ?? 'global'}`;
      if (!signal.active) {
        return {
          kind: 'closure',
          threadKey,
          mode: 'reply',
          text: 'Résolu : l’agent est relancé.',
          userId: null,
        };
      }
      const reason = signal.reason.trim().slice(0, KILL_REASON_MAX);
      return {
        kind: 'notice',
        topic: 'important',
        threadKey,
        title: 'Important',
        body: `Agent arrêté ${scopeLabel(signal)}${reason === '' ? '.' : ` : ${reason}`}`,
        link: { label: 'Ouvrir le CRM', path: '/' },
      };
    }
    // Important, not urgent: the base itself runs, only its copy outside Neon is missing (Neon's PITR still holds).
    case 'backup_overdue':
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: null,
        title: 'Important',
        body:
          signal.lastSucceededAt === null
            ? 'Aucune sauvegarde de la base n’a encore réussi : la copie chiffrée hors Neon n’existe pas.'
            : `Pas de sauvegarde de la base depuis ${parisMoment(signal.lastSucceededAt)} : la copie chiffrée hors Neon a plus de 26 h.`,
        link: { label: 'Ouvrir le Dashboard', path: '/' },
      };
    // Important, not urgent: nothing is paid on a wrong rate, a closing without a recent one is refused (ADR 0033).
    case 'exchange_rate_overdue':
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: null,
        title: 'Important',
        body:
          signal.lastRateDay === null
            ? `Aucun taux ${signal.currency} de la BCE n’est encore arrivé : une quinzaine payée en ${signal.currency} ne peut pas être clôturée.`
            : `Pas de nouveau taux ${signal.currency} de la BCE depuis ${calendarDay(signal.lastRateDay)} : une quinzaine qui finit sans taux récent ne pourra pas être clôturée.`,
        link: { label: 'Ouvrir le Dashboard', path: '/' },
      };
    // Important, not urgent: the statement stays validated and nothing is paid wrong, a document is only missing.
    case 'invoice_not_issued':
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: null,
        title: 'Important',
        body: `${signal.document === 'invoice' ? 'La facture d’un relevé validé de' : 'Un avoir dû par'} ${periodText(signal.period)} n’a pas été ${signal.document === 'invoice' ? 'émise' : 'émis'} : ${INVOICE_NOT_ISSUED_TEXT[signal.reason]}. Le relevé reste validé.`,
        link: { label: 'Ouvrir la quinzaine', path: `/paie/quinzaine?quinzaine=${signal.period}` },
      };
    // Important, not urgent: nothing was replaced and nothing altered was served; the owner looks into it.
    case 'invoice_pdf_conflict':
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: null,
        title: 'Important',
        body: pdfConflictText(signal),
        link: PAY_LINK,
      };
    // Important, not urgent: the document stays issued, only its file (or its copy) is missing.
    case 'invoice_pdf_missing':
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: null,
        title: 'Important',
        body:
          signal.place === 'primary'
            ? `Le document ${signal.number} n’a toujours pas de PDF après plusieurs essais : il reste émis, mais ne se télécharge pas encore. À vérifier.`
            : `Le PDF du document ${signal.number} n’a pas pu être copié chez ${PDF_PLACE_NAMES[signal.place]} après plusieurs essais. Le PDF chez ${PDF_PLACE_NAMES.primary} n’a pas été touché. À vérifier.`,
        link: PAY_LINK,
      };
    // Important, not urgent: only the owner settles a contest, upheld or refused (ADR 0039); the reason is read in Nirvana.
    case 'invoice_contested':
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: null,
        title: 'Important',
        body: `${signal.document === 'invoice' ? `La facture ${signal.number} est contestée` : `L’avoir ${signal.number} est contesté`} par son prestataire. Le motif est dans la Paie, où la contestation est à juger fondée ou à refuser.`,
        link: PAY_LINK,
      };
    // Coming due, important; overdue, urgent (ADR 0020 §2, « rouge facture » of Charles, 02/11): the penalties run. Without
    // a group for the urgent, the important ones still hear of it.
    case 'invoice_due':
      return {
        kind: 'notice',
        topic: signal.overdue ? 'urgent' : 'important',
        ...(signal.overdue && { fallbackTopic: 'important' }),
        threadKey: null,
        title: signal.overdue ? 'URGENT' : 'Important',
        body: invoiceDueText(signal),
        link: { label: 'Ouvrir sa fiche', path: `/equipe/membres?membre=${signal.memberId}` },
      };
    // Important, not urgent: the owner asks the contractor for the new document before it is needed.
    case 'contractor_document_expiring':
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: null,
        title: 'Important',
        body: contractorDocumentText(signal.document, signal.lastDay),
        link: { label: 'Ouvrir sa fiche', path: `/equipe/membres?membre=${signal.memberId}` },
      };
    case 'automatic_closed': {
      // Important, not urgent: no fan is at risk, the agent just asks a human to approve again (ADR 0019).
      const reasons = signal.missing.map(missingText);
      const count = `${String(signal.conversations)} conversation${signal.conversations === 1 ? '' : 's'}`;
      return {
        kind: 'notice',
        topic: 'important',
        threadKey: null,
        title: 'Important',
        body: `Automatique refermé : l’agent est repassé en copilote sur ${count}. ${reasons.length === 1 ? 'Raison' : 'Raisons'} : ${reasons.join(' ; ')}.`,
        link: { label: 'Ouvrir le Dashboard', path: '/' },
      };
    }
    case 'sale':
      // Silent, in its own topic (ADR 0020 §2); a refund never rings live, it is in the evening digest (CRM-04).
      return {
        kind: 'notice',
        topic: 'sale',
        threadKey: null,
        title: 'Vente',
        body: `${SALE_TYPE_TEXT[signal.saleType]} · ${saleAmount(signal.grossInclVatMinor, signal.currency)} · ${sellerText(signal.seller, memberNameOf)}`,
        link: null,
      };
    // Urgent (ADR 0046 § 8), with the important groups for a fallback: an agency without an urgent group still hears.
    case 'security_alert':
      return {
        kind: 'notice',
        topic: 'urgent',
        fallbackTopic: 'important',
        threadKey: null,
        title: 'URGENT',
        ...securityNotice(signal.alert),
      };
  }
}
