import type { ToTalk } from '@impera/contracts';

/**
 * « Ensuite », at the foot of the panel (maquette v4, 27/11): the fan of hers who waits the longest for an answer, past
 * two minutes, other than the one open, in the order of « À qui parler maintenant » (payers first, then newcomers). The
 * chatter juggling conversations sees who is next without leaving this one.
 */

/** Under this wait nobody is « next »: the chatter is answering in his rhythm. */
const NEXT_AFTER_MINUTES = 2;

export interface NextFan {
  readonly name: string;
  readonly waitingMinutes: number;
  /** How many others wait past two minutes behind him. */
  readonly more: number;
}

export function nextFanOf(toTalk: ToTalk, openConversationId: string | null): NextFan | null {
  const waiting = [...toTalk.waiting, ...toTalk.newcomers].filter(
    (fan) =>
      fan.conversationId !== openConversationId &&
      fan.waitingMinutes !== null &&
      fan.waitingMinutes >= NEXT_AFTER_MINUTES,
  );
  const [first, ...rest] = waiting;
  if (first?.waitingMinutes == null) return null;
  return { name: first.fanDisplayName, waitingMinutes: first.waitingMinutes, more: rest.length };
}

/** « attend depuis 4 min », « attend depuis 1 h 12 ». */
export function waitWords(minutes: number): string {
  if (minutes < 60) return `attend depuis ${String(minutes)}\u00a0min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `attend depuis ${String(hours)}\u00a0h${rest === 0 ? '' : `\u00a0${String(rest).padStart(2, '0')}`}`;
}
