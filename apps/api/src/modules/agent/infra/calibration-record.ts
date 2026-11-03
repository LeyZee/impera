import type { Brief, ConversationTurn } from '@impera/llm';

import type { Destination, RatedAnswer } from '../domain/calibration';
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

/** The corrected answers, newest first: given back to the voice as her examples. */
export function voiceExamples(records: readonly CalibrationRecord[], max = 12): string[] {
  return records
    .filter((r) => r.destination === 'voice_example' && r.verdict.kind === 'corrected')
    .map((r) => (r.verdict.kind === 'corrected' ? r.verdict.text : ''))
    .reverse()
    .slice(0, max);
}

/** Every correction and rejection is a moment to replay after a change of prompt or model. */
export function replayableTests(records: readonly CalibrationRecord[]): CalibrationRecord[] {
  return records.filter((r) => r.verdict.kind !== 'validated');
}
