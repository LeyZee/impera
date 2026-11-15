import type { DesireMarkId, DesireMarkVerdict, DesireSignal } from '@impera/contracts';

/**
 * The owner's marks on his desire score (ADR 0103 § 6), kept per creator. A mark keeps the counting as it was: the score
 * before and after, every signal counted and the weights' version, so a new counting is replayed on it by code.
 */
export interface DesireMarkRecord {
  readonly id: DesireMarkId;
  readonly creatorId: string;
  readonly fanMessageNumber: number;
  readonly fanMessage: string;
  readonly verdict: DesireMarkVerdict;
  readonly note: string | null;
  readonly reading: {
    readonly before: number | null;
    readonly score: number;
    readonly signals: readonly DesireSignal[];
  };
  readonly weightsVersion: string;
  readonly markedBy: string;
  readonly markedAt: Date;
}

export interface DesireMarkStore {
  add(mark: DesireMarkRecord): Promise<void>;
  /** Hers, newest first, at most `limit`. */
  list(creatorId: string, limit: number): Promise<DesireMarkRecord[]>;
}

/** Without a database (the tests, the terminal): kept for the process only. */
export function createMemoryDesireMarkStore(): DesireMarkStore {
  const marks: DesireMarkRecord[] = [];
  return {
    add(mark) {
      marks.push(mark);
      return Promise.resolve();
    },
    list(creatorId, limit) {
      return Promise.resolve(
        marks
          .filter((m) => m.creatorId === creatorId)
          .reverse()
          .slice(0, limit),
      );
    },
  };
}
