import {
  ApiErrorSchema,
  type AlertTrigger,
  GuardCodeSchema,
  SYSTEM_ALERT_LABELS,
  type ConnectorErrorCode,
  type ConversationDetail,
  type ConversationEventView,
  type DashboardTodo,
  type DraftView,
  type MessageView,
} from '@nirvana/contracts';
import { z } from 'zod';

import { euros } from './flags-model';

import { CAUSE_LABELS } from '@/agent/causes';
import { GUARD_LABELS } from '@/agent/guards';
import { addDays, clockAt, dayOf, weekdayOf } from '@/scheduling/time';

/*
 * The reader of Suivi in words: the thread in reading order, the agent's notes where it stopped or a human stepped
 * in, and why a decision on a draft did not go through. Pure functions: the screen only lays them out.
 */

/** A line of « À traiter », in the words of the todo the server computed. */
export function todoLabel(todo: DashboardTodo): string {
  if (todo.kind === 'awaiting_approval') return 'Brouillon à valider';
  if (todo.kind === 'send_failed') return 'Envoi échoué';
  if (todo.kind === 'unanswered') return 'Sans réponse';
  return CAUSE_LABELS[todo.kind];
}

export type ThreadItem =
  | {
      readonly kind: 'message';
      readonly id: string;
      readonly from: 'fan' | 'creator';
      /** Outbound only: written by a person (in Reveal), not by the agent. */
      readonly byHuman: boolean;
      readonly text: string;
      /** Its media: what kind, and what it shows once the media module described it (SUIVI-26). */
      readonly media: readonly { readonly label: string; readonly description: string | null }[];
      /** A paid media: its price, and whether he bought it. */
      readonly ppv: { readonly price: string; readonly isPaid: boolean } | null;
    }
  | { readonly kind: 'note'; readonly id: string; readonly text: string };

/** A media named by its kind in the thread: « Photo », not « Média ». */
const MEDIA_LABELS: Readonly<Record<MessageView['media'][number]['kind'], string>> = {
  image: 'Photo',
  video: 'Vidéo',
  audio: 'Audio',
};

const withReason = (text: string, reason: string | undefined): string =>
  reason === undefined ? text : `${text} : ${reason}`;

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

/** When her slot opens, from the day the note is written: « à 9 h », « demain à 9 h », « lundi à 9 h ». */
function openingWords(until: string, written: string, timeZone: string): string {
  const day = dayOf(until, timeZone);
  const clock = `à ${clockAt(until, timeZone)}`;
  const from = dayOf(written, timeZone);
  if (day === from) return clock;
  if (day === addDays(from, 1)) return `demain ${clock}`;
  return `${WEEKDAYS[weekdayOf(day) - 1] ?? ''} ${clock}`;
}

/** The codes a send keeps: a refusal of the write guard, no connector, or the connector's own failure. */
type SendFailureCode =
  'connector_writes_disabled' | 'connector_unavailable' | `connector_${ConnectorErrorCode}`;

/**
 * Why a send failed for good, from the code the send job keeps (`send_failed.payload.error`): what a person can act
 * on. A code this screen does not know is left out, never shown raw.
 */
const SEND_FAILURES: Readonly<Record<SendFailureCode, string>> = {
  connector_writes_disabled: 'l’envoi est désactivé pour ce compte Reveal',
  connector_unavailable: 'aucun connecteur n’est branché pour cette plateforme',
  connector_session_expired: 'la session Reveal a expiré',
  connector_rate_limited: 'Reveal a limité les envois',
  connector_not_found: 'Reveal ne trouve plus cette conversation',
  connector_transient: 'Reveal n’a pas répondu',
  connector_fatal: 'Reveal a refusé le message',
};

const isSendFailureCode = (code: string): code is SendFailureCode => Object.hasOwn(SEND_FAILURES, code);

/**
 * An alert that went off and let the agent go on: which one, and her word when a word set it off. The event names her
 * own alert by its id only: the thread calls it « Alerte personnalisée », the history gives its name.
 */
function alertNote(trigger: AlertTrigger): string {
  const name =
    trigger.alert.kind === 'custom'
      ? 'Alerte personnalisée'
      : `Alerte « ${SYSTEM_ALERT_LABELS[trigger.alert.code]} »`;
  const word = trigger.keyword === undefined ? '' : ` (mot « ${trigger.keyword} »)`;
  return `${name}${word} : l’agent continue`;
}

/** The note an event leaves in the thread, or null for the events the messages already show. */
function noteOf(event: ConversationEventView, timeZone: string): string | null {
  if (event.type === 'handoff_requested')
    return withReason(`L’agent passe la main (${CAUSE_LABELS[event.payload.cause]})`, event.payload.reason);
  if (event.type === 'takeover_started') return withReason('Un humain reprend la main', event.payload.reason);
  if (event.type === 'alert_triggered') return alertNote(event.payload.trigger);
  if (event.type === 'takeover_ended') return 'La main revient à l’agent';
  if (event.type === 'draft_rejected') return withReason('Brouillon refusé', event.payload.reason);
  if (event.type === 'draft_expired') return withReason('Brouillon abandonné', event.payload.reason);
  if (event.type === 'send_failed' && event.payload.isFinal === true)
    return withReason(
      'L’envoi a échoué, rien n’est parti',
      event.payload.error === undefined || !isSendFailureCode(event.payload.error)
        ? undefined
        : SEND_FAILURES[event.payload.error],
    );
  if (event.type === 'reply_skipped')
    return event.payload.reason === 'llm_unavailable'
      ? 'Aucune IA n’a répondu : pas de brouillon pour ce message'
      : 'L’agent n’a rien à répondre à ce message';
  if (event.type === 'reply_deferred')
    return `Hors de ses heures : la réponse attend l’ouverture de son créneau, ${openingWords(event.payload.until, event.createdAt, timeZone)}`;
  return null;
}

/** The reader's own clock: times in the thread read as everywhere on its screen. */
const viewerZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Messages and notes in reading order, oldest first; the API pages both newest first. Every message he writes out of
 * her hours puts the answer off to the same opening: one note says it, not one per message.
 */
export function threadOf(
  read: {
    readonly messages: readonly MessageView[];
    readonly events: readonly ConversationEventView[];
  },
  timeZone: string = viewerZone(),
): ThreadItem[] {
  const timed: { readonly at: number; readonly item: ThreadItem }[] = [];
  for (const message of read.messages) {
    timed.push({
      at: Date.parse(message.platformCreatedAt),
      item: {
        kind: 'message',
        id: message.id,
        from: message.direction === 'inbound' ? 'fan' : 'creator',
        byHuman: message.direction === 'outbound' && message.author === 'human',
        text: message.text,
        media: message.media.map((m) => ({ label: MEDIA_LABELS[m.kind], description: m.description })),
        ppv:
          message.priceMinor === null ? null : { price: euros(message.priceMinor), isPaid: message.isPaid },
      },
    });
  }
  const openings = new Map<string, number>();
  for (const event of read.events) {
    if (event.type !== 'reply_deferred') continue;
    const first = openings.get(event.payload.until);
    if (first === undefined || event.seq < first) openings.set(event.payload.until, event.seq);
  }
  for (const event of read.events) {
    if (event.type === 'reply_deferred' && openings.get(event.payload.until) !== event.seq) continue;
    const text = noteOf(event, timeZone);
    if (text !== null)
      timed.push({
        at: Date.parse(event.createdAt),
        item: { kind: 'note', id: `e${String(event.seq)}`, text },
      });
  }
  // Stable: a message and a note at the same instant keep the message first.
  return timed.sort((a, b) => a.at - b.at).map((t) => t.item);
}

/**
 * Why a human has the hand, from the latest change of hand (events come newest first): the agent's handoff, or a
 * person who took it. A handoff the hand was given back for since is no longer the reason.
 */
export function whyHuman(read: { readonly events: readonly ConversationEventView[] }): string | null {
  const event = read.events.find(
    (e) => e.type === 'handoff_requested' || e.type === 'takeover_started' || e.type === 'takeover_ended',
  );
  if (event?.type === 'handoff_requested') return noteOf(event, viewerZone());
  if (event?.type === 'takeover_started')
    return withReason('Un humain a repris la main', event.payload.reason);
  return null;
}

/** The drafts sent, the one that failed for good, and the state, as the reader shows them. */
export interface DraftsRead {
  readonly state: ConversationDetail['state'];
  /** Approved or edited, on their way. */
  readonly sending: readonly DraftView[];
  /** What did not leave, to send again in Reveal. */
  readonly failed: DraftView | null;
}

/**
 * The detail and the events are two reads: a send that failed for good between them shows in the events while the
 * detail still says « Envoi en cours ». The final failure wins, so that one screen never says both.
 */
export function draftsOf(read: {
  readonly detail: Pick<ConversationDetail, 'state' | 'openDrafts' | 'failedDraft'>;
  readonly events: readonly ConversationEventView[];
}): DraftsRead {
  const { detail } = read;
  const failedIds = new Set(
    read.events.flatMap((e) =>
      e.type === 'send_failed' && e.payload.isFinal === true ? [e.payload.draftId] : [],
    ),
  );
  const sentOrSending = detail.openDrafts.filter((draft) => draft.status !== 'pending');
  const sending = sentOrSending.filter((draft) => !failedIds.has(draft.id));
  const failedNow = sentOrSending.find((draft) => failedIds.has(draft.id));
  const failed = detail.failedDraft ?? failedNow ?? null;
  const state =
    failedNow !== undefined && sending.length === 0 && detail.state === 'sending' ? 'error' : detail.state;
  return { state, sending, failed };
}

/** The codes a refusal names; one this screen does not know yet is left out, never shown raw. */
const GuardsSchema = z.object({ guards: z.array(z.string()) });

/** Why an approval, a refusal or a takeover did not go through: the draft stays as it was, the sentence says why. */
export function decisionError(status: number, body: unknown): string {
  const error = ApiErrorSchema.safeParse(body);
  const code = error.success ? error.data.error.code : null;
  if (code === 'draft_unprocessable') {
    const guards = GuardsSchema.safeParse(error.success ? error.data.error.details : null);
    const found = guards.success
      ? guards.data.guards.flatMap((raw) => {
          const guard = GuardCodeSchema.safeParse(raw);
          return guard.success ? [GUARD_LABELS[guard.data]] : [];
        })
      : [];
    return found.length === 0
      ? 'Ce message ne peut pas partir : une garde le bloque. Retouche-le ou refuse-le.'
      : `Ce message ne peut pas partir : ${[...new Set(found)].join(', ')}. Retouche-le ou refuse-le.`;
  }
  if (code === 'persona_inactive_unprocessable')
    return 'Ce message ne peut pas partir : cette créatrice n’a pas de persona active. Active une version dans Créatrices › Persona.';
  if (code === 'kill_switch_conflict')
    return 'L’arrêt est actif : rien ne part tant qu’il n’est pas levé sur le Dashboard.';
  if (code === 'session_expired_conflict')
    return 'La session Reveal a expiré : rien ne part tant qu’elle n’est pas reconnectée depuis l’extension.';
  if (code === 'draft_conflict' || code === 'transition_conflict')
    return 'La conversation a changé entre-temps : ce brouillon n’attend plus de décision.';
  if (status === 400)
    return 'Ce message ne peut pas partir tel quel : une bulle est vide ou trop longue (2 000 caractères au plus, 10 bulles au plus).';
  if (status === 401) return 'Ta session a expiré : reconnecte-toi.';
  // The owner sees everything and a creator has no button: a 403 is a chatter whose shift or handover closed.
  if (status === 403)
    return 'Cette conversation n’est plus ouverte pour toi (shift terminé ou passation rendue).';
  if (status === 404) return 'Cette conversation ou ce brouillon n’existe plus.';
  return 'Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.';
}

/**
 * The decision came too late: the draft was decided elsewhere, the conversation moved on or is gone. What shows is
 * out of date, and the reader reads it again at once.
 */
export function isOutdated(status: number, body: unknown): boolean {
  const error = ApiErrorSchema.safeParse(body);
  const code = error.success ? error.data.error.code : null;
  return code === 'draft_conflict' || code === 'transition_conflict' || status === 404;
}
