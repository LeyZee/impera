import {
  CREATOR_MESSAGE_ANSWERED_CONFLICT,
  CREATOR_MESSAGE_KIND_WORDS,
  type ToAgencyMessage,
  type ToAgencyMessageKind,
} from '@impera/contracts';

/*
 * « Écrire à l'agence » in words (trous béants n° 13): her last messages, each with its answer or « En attente », the
 * kind she chose said as she chose it. Pure.
 */

/** Her card lists this many of her latest messages: the rest is history, not a task. */
export const MINE_SHOWN = 3;

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** « 4 nov. »: when she wrote, in the reader's own calendar. */
export const writtenOn = (instant: string): string => DAY.format(new Date(instant));

export const kindWords = (kind: ToAgencyMessageKind): string => CREATOR_MESSAGE_KIND_WORDS[kind];

export interface MessageLine {
  readonly id: string;
  readonly kindKey: ToAgencyMessageKind;
  readonly kind: string;
  readonly body: string;
  readonly on: string;
  /** The agency's answer, `null` while it waits. */
  readonly answer: string | null;
}

export function messageLines(messages: readonly ToAgencyMessage[], shown = MINE_SHOWN): MessageLine[] {
  return messages.slice(0, shown).map((message) => ({
    id: message.id,
    kindKey: message.kind,
    kind: kindWords(message.kind),
    body: message.body,
    on: writtenOn(message.createdAt),
    answer: message.answer,
  }));
}

/** What a refused answer says: answered already elsewhere, or not this reader's to answer. */
export function answerRefusal(code: string): string {
  return code === CREATOR_MESSAGE_ANSWERED_CONFLICT
    ? 'Ce message a déjà sa réponse : elle est partie telle quelle.'
    : 'Ta réponse n’a pas été prise. Réessaie dans un moment.';
}
