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
  /** A correction filed as a voice example that a hard guard stopped (ADR 0102 § 4): never one of her examples. */
  readonly exampleBlocked?: true;
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

/** One of her examples: a correction the owner filed as one, by its rating's id. */
export interface VoiceExample {
  readonly id: string;
  readonly text: string;
}

/** How many of her examples the voice reads (ADR 0102 § 2). */
export const VOICE_EXAMPLES_MAX = 12;

/**
 * The examples the voice receives, from her bank newest first (ADR 0102 § 2, § 4): only those her hard guards let
 * through, at most twelve. Production and the playground both choose through it, so what the playground shows is what
 * a fan receives.
 */
export function pickVoiceExamples(
  bank: readonly VoiceExample[],
  guardSettings: GuardSettings,
  max = VOICE_EXAMPLES_MAX,
): VoiceExample[] {
  return bank.filter((e) => !isBlocked(checkVoiceOutput([e.text], guardSettings))).slice(0, max);
}

/**
 * Her corrected answers, newest first, given back to the voice as her examples (ADR 0102 § 1, § 4; recette AGE-07):
 * only hers, only for the version that answered, and only those her hard guards let through. A correction of the
 * invented persona, or of another version, is never one.
 */
export function voiceExamples(
  records: readonly CalibrationRecord[],
  of: ExamplesOf,
  max = Number.POSITIVE_INFINITY,
): VoiceExample[] {
  const bank = records
    .filter(
      (r) =>
        r.destination === 'voice_example' &&
        r.exampleBlocked !== true &&
        r.creatorId === of.creatorId &&
        r.personaVersionId === of.personaVersionId,
    )
    .flatMap((r) => (r.verdict.kind === 'corrected' ? [{ id: r.id, text: r.verdict.text }] : []))
    .reverse();
  return pickVoiceExamples(bank, of.guardSettings, max);
}

/** Every correction and rejection is a moment to replay after a change of prompt or model. */
export function replayableTests(records: readonly CalibrationRecord[]): CalibrationRecord[] {
  return records.filter((r) => r.verdict.kind !== 'validated');
}
