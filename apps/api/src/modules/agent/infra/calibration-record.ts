import type { Brief, ConversationTurn } from '@impera/llm';

import type { Destination, RatedAnswer } from '../domain/calibration';
import { checkVoiceOutput, isBlocked, type GuardSettings } from '../domain/guards';
import type { Situation } from '../domain/situation';

/** Everything needed to replay the moment: a rated answer becomes a test without asking anything again. */
export interface RatedMoment {
  /** The conversation before his message, his message included. */
  readonly history: readonly ConversationTurn[];
  readonly fanNotes: string;
  /** The facts, not their wording: a replay writes them again with the current code. */
  readonly situation: Situation;
  readonly brief?: Brief;
}

/** One rating, in the shape the training tables will take (P0-03). */
export interface CalibrationRecord extends RatedAnswer {
  readonly id: string;
  /** The creator whose persona was rated; absent on ratings kept before the table (calibration_ratings). */
  readonly creatorId?: string;
  /** The version of her persona that answered; absent with the invented persona, whose corrections are never hers. */
  readonly personaVersionId?: string;
  readonly sessionId: string;
  readonly fanMessage: string;
  readonly bubbles: readonly string[];
  readonly destination?: Destination;
  readonly moment: RatedMoment;
}

export interface CalibrationStore {
  append(record: CalibrationRecord): Promise<void>;
  list(): Promise<CalibrationRecord[]>;
}

/** Whose examples are read: one creator, one version of her persona, under her guards. */
export interface ExamplesOf {
  readonly creatorId: string;
  readonly personaVersionId: string;
  readonly guardSettings: GuardSettings;
}

/**
 * Her corrected answers, newest first, given back to the voice as her examples (ADR 0102 § 1, § 4; recette AGE-07):
 * only hers, only for the version that answered, and only those her hard guards let through. A correction of the
 * invented persona, or of another version, is never one.
 */
export function voiceExamples(records: readonly CalibrationRecord[], of: ExamplesOf, max = 12): string[] {
  return records
    .filter(
      (r) =>
        r.destination === 'voice_example' &&
        r.creatorId === of.creatorId &&
        r.personaVersionId === of.personaVersionId,
    )
    .flatMap((r) => (r.verdict.kind === 'corrected' ? [r.verdict.text] : []))
    .filter((text) => !isBlocked(checkVoiceOutput([text], of.guardSettings)))
    .reverse()
    .slice(0, max);
}

/** Every correction and rejection is a moment to replay after a change of prompt or model. */
export function replayableTests(records: readonly CalibrationRecord[]): CalibrationRecord[] {
  return records.filter((r) => r.verdict.kind !== 'validated');
}
