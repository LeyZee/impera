import type {
  CreatorDecision,
  CreatorDecisionId,
  CreatorDecisionKind,
  CreatorId,
  DecisionAnswer,
  NewCreatorDecision,
  OtherIdeasBody,
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

/** A decision of hers that may take other answers, with what the code that asked named it by. */
interface RenewableDecision {
  readonly creatorId: CreatorId;
  readonly subject: string;
  readonly decision: CreatorDecision;
}

/** What she asks of other ideas, given to the code that proposes for this kind of decision. */
export interface OtherIdeasAsk {
  readonly creatorId: CreatorId;
  readonly subject: string;
  /** What she reads now and wants replaced. */
  readonly shown: readonly DecisionAnswer[];
  readonly wish: OtherIdeasBody;
}

/**
 * The code that proposes other answers for one kind of decision (wired by the composition root). It gives answers
 * that fit the decision's layout; `unavailable` when it cannot for now; its own `DomainError` for a wish it refuses.
 */
export type OtherIdeasWriter = (
  ask: OtherIdeasAsk,
  now: Date,
) => Promise<readonly DecisionAnswer[] | 'unavailable'>;

/** How long a request for other ideas may be written before its mark counts as left behind. */
export const IDEAS_WRITING_MS = 2 * 60_000;

export interface DecisionStore {
  /**
   * A decision of hers still waiting with a request for other ideas left, read in her own account; `DecisionNotFound`
   * or `DecisionNoMoreIdeas` otherwise.
   */
  renewable(userId: string, id: CreatorDecisionId, now: Date): Promise<RenewableDecision>;
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
  /**
   * Counts a request for other ideas before anything is paid for it: one fewer left, marked as being written. `false`
   * when another request is being written, none is left, or the question is no longer open. A mark older than
   * `IDEAS_WRITING_MS` was left by a run that stopped: it is taken over.
   */
  countIdeas(creatorId: CreatorId, id: CreatorDecisionId, now: Date): Promise<boolean>;
  /** Gives the request counted back: nothing could be proposed. */
  returnIdeas(creatorId: CreatorId, id: CreatorDecisionId): Promise<void>;
  /**
   * The other answers of the request counted: the decision as she now reads it; `null` when it was answered or
   * withdrawn in between.
   */
  otherIdeas(
    creatorId: CreatorId,
    id: CreatorDecisionId,
    answers: readonly DecisionAnswer[],
  ): Promise<CreatorDecision | null>;
  /** Where a question stands; `null` when it was never asked. */
  read(
    creatorId: CreatorId,
    kind: CreatorDecisionKind,
    subject: string,
    now: Date,
  ): Promise<AskedDecision | null>;
}
