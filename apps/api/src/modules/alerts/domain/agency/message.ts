import { PUSH_BODY_MAX, PUSH_TITLE_MAX, type PushMessage } from '@impera/contracts';

import type { Notice, Signal } from './signals';

/**
 * What each agency alert is about, as the lock screen and « Tes notifications » show it: a few words, never a figure
 * nor a name. The body says the rest.
 */
const SUBJECTS: Readonly<Record<Signal['kind'], string>> = {
  handoff: 'L’agent attend un humain',
  budget: 'Plafond IA',
  kill_switch: 'Agent arrêté',
  send_failed: 'Message bloqué',
  ai_credits_low: 'Crédits IA',
  ai_quota_exhausted: 'Quota IA épuisé',
  backup_overdue: 'Sauvegarde en retard',
  exchange_rate_overdue: 'Taux de change manquant',
  invoice_not_issued: 'Document non émis',
  invoice_pdf_conflict: 'PDF de facture en conflit',
  invoice_pdf_missing: 'PDF de facture manquant',
  invoice_contested: 'Document contesté',
  invoice_due: 'Facture à régler',
  contractor_document_expiring: 'Document à renouveler',
  automatic_closed: 'Automatique refermé',
  security_alert: 'Sécurité',
  sales_feed_model: 'Ventes à vérifier',
  sales_feed_mismatch: 'Ventes à vérifier',
  connection_down: 'Service en panne',
  connection_back: 'Service rétabli',
  agency_share_mismatch: 'Part de l’agence',
  agency_share_changed: 'Part de l’agence',
};

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** The push of an agency alert: « Urgent · » first when it rings at night, her name when it is about her. */
export function agencyMessage(signal: Signal, notice: Notice, creatorName: string | null): PushMessage {
  const subject = SUBJECTS[signal.kind];
  const title = [notice.topic === 'urgent' ? 'Urgent' : null, creatorName, subject]
    .filter((part) => part !== null)
    .join(' · ');
  return {
    title: cut(title, PUSH_TITLE_MAX),
    body: cut(notice.body, PUSH_BODY_MAX),
    url: notice.link?.path ?? '/',
  };
}

/** A safety relay rings again every 5 minutes while nobody took the conversation (decision of Charles, 27/11). */
const SAFETY_REMINDER_EVERY_MS = 5 * 60_000;
/** Then stops: after an hour, the Dashboard and the history hold it, the phone stops ringing (12 reminders). */
const SAFETY_REMINDERS_MAX = 12;

/**
 * Which reminder of a safety relay is due at `now`, counted from 1, or null: none before 5 minutes, none past the
 * last. A run that misses a slot rings the current one only.
 */
export function safetyReminderDue(raisedAt: Date, now: Date): number | null {
  const slot = Math.floor((now.getTime() - raisedAt.getTime()) / SAFETY_REMINDER_EVERY_MS);
  return slot >= 1 && slot <= SAFETY_REMINDERS_MAX ? slot : null;
}

/** The reminder's push: the same alert, said to be still waiting, without the fan nor what he wrote. */
export function safetyReminderMessage(
  creatorName: string | null,
  conversationId: string | null,
  reminder: number,
): PushMessage {
  const minutes = reminder * (SAFETY_REMINDER_EVERY_MS / 60_000);
  return {
    title: cut(
      [creatorName, 'Relais de sécurité', 'personne ne l’a pris'].filter((part) => part !== null).join(' · '),
      PUSH_TITLE_MAX,
    ),
    body: `L’IA a passé la main il y a ${String(minutes)} min et personne n’a repris la conversation.`,
    url: conversationId === null ? '/suivi' : `/suivi?conversation=${conversationId}`,
  };
}
