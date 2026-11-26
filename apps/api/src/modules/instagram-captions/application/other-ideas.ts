import { DECISION_ANSWERS_MIN, type DecisionAnswer } from '@impera/contracts';

import { CaptionWritingFailed } from '../domain/errors';
import type { OtherCaptionsDeps } from '../domain/ports';
import { captionAnswers, dropOfSubject, hintWords, unseen } from '../domain/proposals';

import { captionsFor } from './propose';

/** What she asks of other captions, as the decision card hands it over. */
export interface OtherCaptionsAsk {
  readonly creatorId: string;
  /** How the decision was named when it was asked (`drop:<id>`). */
  readonly subject: string;
  /** The captions she reads now. */
  readonly shown: readonly { readonly text: string | null }[];
  readonly wish: { readonly hints: readonly string[]; readonly note: string };
}

/**
 * « D'autres idées » on a caption card (ADR 0164 § 9): three other captions for the same Reel, from the hints she
 * touched and her own line, both read by the model as data. The same guards as the first proposal, one rewrite at
 * most, never a caption she already reads. `unavailable` when nothing can be proposed for now (the Reel is gone, no
 * active persona, the day's budget, every model failing, fewer than a choice left): her request is then not spent.
 */
export async function otherCaptions(
  deps: OtherCaptionsDeps,
  ask: OtherCaptionsAsk,
): Promise<DecisionAnswer[] | 'unavailable'> {
  const hints = hintWords(ask.wish.hints);
  const dropId = dropOfSubject(ask.subject);
  if (dropId === null) return 'unavailable';
  const reel = await deps.reel(ask.creatorId, dropId);
  if (reel?.category !== 'instagram_reel') return 'unavailable';
  const persona = await deps.persona(ask.creatorId);
  if (persona === null) return 'unavailable';
  const seen = ask.shown.flatMap((answer) => (answer.text === null ? [] : [answer.text]));
  try {
    const captions = await captionsFor(deps, persona, {
      creatorId: ask.creatorId,
      creatorName: persona.creatorName,
      personaSheet: persona.personaSheet,
      examples: await deps.examples(ask.creatorId),
      mediaDescription: reel.description,
      durationS: reel.durationS,
      sentence: reel.sentence,
      otherIdeas: { hints, note: ask.wish.note, seen },
    });
    if (captions === 'budget') return 'unavailable';
    const other = unseen(captions, seen);
    return other.length < DECISION_ANSWERS_MIN ? 'unavailable' : captionAnswers(other);
  } catch (error) {
    if (error instanceof CaptionWritingFailed) return 'unavailable';
    throw error;
  }
}
