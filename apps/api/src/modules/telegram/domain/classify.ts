import {
  payPeriodLastDay,
  CUSTOM_ALERT_TOPIC,
  SYSTEM_ALERT_LABELS,
  SYSTEM_ALERT_TOPICS,
  type AlertRef,
  type AutomaticMissing,
  type HandoffCause,
  type InvoiceNotIssuedReason,
  type PayPeriod,
  type SystemAlertCode,
  type TelegramTopic,
} from '@nirvana/contracts';

import type { Outcome, Signal } from './signals';

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
  identity_incomplete: 'le dossier prestataire est incomplet pour son régime de facturation',
  prefix_missing: 'le prestataire n’a pas de préfixe de facture',
  agency_missing: 'les réglages de facturation de l’agence ne sont pas remplis',
  no_invoice_to_credit: 'aucune facture ne peut prendre l’avoir entier, à voir avec le comptable',
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
export function classify(signal: Signal, nameOf: AlertNameOf = noNames): Outcome | null {
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
  }
}
