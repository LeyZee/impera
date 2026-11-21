import type {
  CreatorDecision,
  CreatorDecisionId,
  CreatorDecisionKind,
  CreatorId,
  NewCreatorDecision,
} from '@impera/contracts';

/** Who answers in her place: the owner's account, read again in the base, and where the request came from. */
export interface DecisionActor {
  readonly userId: string;
  readonly ip: string | null;
}

/** Where a question stands, for the code that asked it. */
export interface AskedDecision {
  readonly state: 'open' | 'answered' | 'withdrawn' | 'ended';
  /** The answer chosen, by her or by the owner; `null` until then. */
  readonly answerKey: string | null;
}

export interface DecisionStore {
  /** What waits on her now, read in her own account. */
  open(userId: string, now: Date): Promise<CreatorDecision[]>;
  /** Her answer: what she reads back. The same answer again changes nothing; another one is refused. */
  answer(userId: string, id: CreatorDecisionId, key: string, now: Date): Promise<string>;
  /** « Plus tard »: aside for a while. */
  later(userId: string, id: CreatorDecisionId, now: Date): Promise<void>;
  /** What waits on a creator, for the owner alone: what she put aside too. */
  openFor(actor: DecisionActor, creatorId: CreatorId, now: Date): Promise<CreatorDecision[]>;
  /** The owner's answer in her place, with its line in the audit log. */
  answerFor(
    actor: DecisionActor,
    creatorId: CreatorId,
    id: CreatorDecisionId,
    key: string,
    now: Date,
  ): Promise<string>;
}

/** The door of the code that asks: one creator at a time, once per subject. */
export interface DecisionAsking {
  /** Asks; `false` when this subject was already asked (a replay writes nothing). */
  ask(creatorId: CreatorId, decision: NewCreatorDecision): Promise<boolean>;
  /** Withdraws a question still open: the content it was about is gone. */
  withdraw(creatorId: CreatorId, kind: CreatorDecisionKind, subject: string): Promise<void>;
  /** Where a question stands; `null` when it was never asked. */
  read(
    creatorId: CreatorId,
    kind: CreatorDecisionKind,
    subject: string,
    now: Date,
  ): Promise<AskedDecision | null>;
}
