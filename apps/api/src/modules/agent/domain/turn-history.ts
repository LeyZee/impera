import { normalise } from '@impera/contracts';

import { gapNotes, timingLines } from './elapsed';
import { asksPrice, previousTurnsOf, sumsMinorOf, type GuardContext } from './guards';
import type { Relationship } from './meeting';
import { isOpener } from './origin';
import { askedRefundLately } from './refund';
import { describeSituation, type Situation } from './situation';

/** A turn of the conversation as a turn reads it (`ConversationTurn` of the models' gateway, structurally). */
export interface HistoryTurn {
  readonly from: 'fan' | 'creator';
  readonly text: string;
  readonly at?: Date;
  readonly originNote?: string;
}

const HOUR_MS = 3_600_000;

/** How long they have talked, in hours, on her clock's now. */
export function knownHoursOf(situation: Pick<Situation, 'now' | 'relationshipStartedAt'>): number {
  return (situation.now.getTime() - situation.relationshipStartedAt.getTime()) / HOUR_MS;
}

/** Where they are, as the meeting tiers read it: how long they have talked, and whether he paid her. */
export function relationshipOf(
  situation: Pick<Situation, 'now' | 'relationshipStartedAt' | 'spentCents'>,
): Relationship {
  return {
    knownHours: (situation.now.getTime() - situation.relationshipStartedAt.getTime()) / HOUR_MS,
    hasBought: situation.spentCents > 0,
  };
}

/**
 * What her guards read the draft against (P3-13): a draft carries a media only through the step of her script that
 * leaves with it (ADR 0098), and her last turns are in the history.
 */
export function guardContextOf(
  history: readonly HistoryTurn[],
  hasMedia = false,
  allowedPriceMinor?: number,
  /**
   * Whether they flirt now, his meeting tier when her settings let code compute it (Charles 26/11), and whether his
   * desire map holds humiliation (Charles 27/11).
   */
  about: Pick<GuardContext, 'flirting' | 'meetingTier' | 'humiliationWanted'> = {},
): GuardContext {
  const lastTurn = history.at(-1);
  const hisSinceHer = history
    .slice(history.findLastIndex((turn) => turn.from === 'creator') + 1)
    .filter((turn) => turn.from === 'fan');
  return {
    hasMedia,
    ...(allowedPriceMinor !== undefined && { allowedPriceMinor }),
    ...(about.flirting !== undefined && { flirting: about.flirting }),
    ...(about.meetingTier !== undefined && { meetingTier: about.meetingTier }),
    previousTurns: previousTurnsOf(
      history.map((turn) => ({ fromFan: turn.from === 'fan', text: turn.text })),
    ),
    sentBefore: history.filter((turn) => turn.from === 'creator').map((turn) => turn.text),
    // The sums he wrote since her last answer: she may say one back without agreeing to it (Charles 27/11).
    fanAmountsMinor: hisSinceHer.flatMap((turn) => sumsMinorOf(turn.text)),
    // He just asked a price: a sum she writes now is a price of hers (Sécurité, #1043).
    fanAskedPrice: hisSinceHer.some((turn) => asksPrice(turn.text)),
    // His last message: her yes to a concrete meeting he proposes is a `meeting_promise` (Charles 27/11).
    ...(lastTurn?.from === 'fan' && { fanLastMessage: lastTurn.text }),
    // He asked for a refund lately: she may say it is done on Reveal (ADR 0158 § 48, avenant du 27/11).
    fanAskedRefund: askedRefundLately(
      history.map((turn) => ({ fromFan: turn.from === 'fan', text: turn.text })),
    ),
    // His desire map holds humiliation: « petit garçon » said to him is his game (Charles 27/11).
    ...(about.humiliationWanted === true && { humiliationWanted: true }),
  };
}

export const datedOf = (turn: HistoryTurn): { readonly fromFan: boolean; readonly at?: Date } => ({
  fromFan: turn.from === 'fan',
  ...(turn.at !== undefined && { at: turn.at }),
});

/** « Le moment », with what code reads of the last exchanges' times (audit du naturel, A2). */
export function describeMoment(situation: Situation, history: readonly HistoryTurn[]): string {
  // Her messages an automation wrote (ADR 0110 § 3): said once here, never as a bracket in her own turn.
  const automated = new Set(
    history.flatMap((turn) =>
      turn.from === 'creator' && turn.originNote !== undefined ? [turn.originNote] : [],
    ),
  );
  return [
    describeSituation(situation),
    ...timingLines(history.map(datedOf), situation.now),
    ...automated,
  ].join('\n');
}

/** Each message of his after a silence carries the time that passed, written by code on her clock. */
export function withTimeNotes<T extends HistoryTurn>(history: readonly T[], timeZone: string): readonly T[] {
  const notes = gapNotes(history.map(datedOf), timeZone);
  return history.map((turn, index) => {
    const timeNote = notes[index];
    return timeNote === null || timeNote === undefined ? turn : { ...turn, timeNote };
  });
}

/** His messages before the ones she is answering: the history without its last run of fan turns. */
export function earlierFanTexts(history: readonly HistoryTurn[]): string[] {
  let end = history.length;
  while (end > 0 && history[end - 1]?.from === 'fan') end -= 1;
  return history
    .slice(0, end)
    .filter((turn) => turn.from === 'fan' && !isOpener(turn))
    .map((turn) => turn.text);
}

// She asked his age already in this conversation: « t'as quel âge ? », « tu as quel âge », « et ton âge ? ».
const ASKED_AGE = /\b(?:quel age|ton age|age as[- ]tu|age t'?as)\b/u;

/** She asked his age already: she never asks it twice in a conversation (audit du 16/11, C2). */
export function askedHisAge(history: readonly HistoryTurn[]): boolean {
  return history.some((turn) => turn.from === 'creator' && ASKED_AGE.test(normalise(turn.text)));
}

/** Her answers since a moment: since the run ended for the refusal's next move, since it started for the gauge. */
export function herAnswersSince(history: readonly HistoryTurn[], since: Date | null): number {
  if (since === null) return 0;
  return history.filter((turn) => turn.from === 'creator' && turn.at !== undefined && turn.at >= since)
    .length;
}

/** When he wrote: the times of his messages, those that carry one. */
export function hisMessagesAt(history: readonly HistoryTurn[]): Date[] {
  return history.flatMap((turn) => (turn.from === 'fan' && turn.at !== undefined ? [turn.at] : []));
}

/** Her turns and his as the pace reads them, her automated opener left out. */
export function paceTurnsOf(history: readonly HistoryTurn[]): (readonly string[])[] {
  return previousTurnsOf(
    history
      .filter((turn) => !isOpener(turn))
      .map((turn) => ({ fromFan: turn.from === 'fan', text: turn.text })),
  );
}
