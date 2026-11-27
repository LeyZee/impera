import type {
  ContestRemarkBody,
  CreatorId,
  FaultCode,
  FaultLevel,
  MyShiftReview,
  ReviewCard,
  RuleRemarkBody,
  ShiftId,
  TeamMemberId,
  UserId,
} from '@impera/contracts';

import {
  faultTone,
  missedTotals,
  occurrenceCounts,
  REPEAT_WINDOW_MS,
  type ContestState,
} from '../domain/chatter-review';
import {
  ReviewMemberForbidden,
  ReviewRemarkNotFound,
  ReviewRulingForbidden,
  ReviewShiftNotFound,
} from '../domain/errors';
import type { Actor, RemarkExcerpts, ShiftRemark, ShiftRemarkSource } from '../domain/ports';

/** At most three points to work on (ADR 0170 § 12): the gravest, then the costliest. */
const FAULTS_SHOWN = 3;

/** What the store keeps of a contest, read under the creator. */
export interface StoredContest {
  readonly reason: string;
  readonly ruling: 'upheld' | 'dropped' | null;
}

/** The `team` side of the review, under `withTenantMember` (migration 0281). */
export interface ReviewStore {
  /** The signed-in account's member, or null for the owner or a creator. */
  memberOf(creatorId: CreatorId, userId: UserId): Promise<TeamMemberId | null>;
  /** The signed-in account's member when this shift of the creator is his, else null. */
  shiftMember(creatorId: CreatorId, userId: UserId, shiftId: ShiftId): Promise<TeamMemberId | null>;
  levels(
    creatorId: CreatorId,
    userId: UserId,
    codes: readonly FaultCode[],
  ): Promise<ReadonlyMap<string, { readonly level: FaultLevel; readonly label: string }>>;
  explanations(
    creatorId: CreatorId,
    userId: UserId,
    memberId: TeamMemberId,
    codes: readonly FaultCode[],
  ): Promise<ReadonlyMap<string, Date>>;
  contests(
    creatorId: CreatorId,
    userId: UserId,
    remarkIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredContest>>;
  /** Once per fault: a second explanation of the same fault keeps the first. */
  recordExplanations(
    creatorId: CreatorId,
    userId: UserId,
    memberId: TeamMemberId,
    rows: readonly { readonly faultCode: FaultCode; readonly remarkId: string }[],
  ): Promise<void>;
  contest(
    creatorId: CreatorId,
    userId: UserId,
    memberId: TeamMemberId,
    remarkId: string,
    reason: string,
  ): Promise<void>;
  /** Settled by the owner or a manager of the creator, never on his own contest; once. */
  rule(
    creatorId: CreatorId,
    userId: UserId,
    remarkId: string,
    ruling: 'upheld' | 'dropped',
  ): Promise<'ruled' | 'forbidden' | 'not_found'>;
}

export interface ReviewService {
  /** « Mon bilan » of one of his shifts (ADR 0170 §§ 12, 26 to 30): his remarks only. */
  myShiftReview(userId: UserId, creatorId: CreatorId, shiftId: ShiftId): Promise<MyShiftReview>;
  /** He has read it: each fault shown is explained from now on (§ 29). */
  markSeen(userId: UserId, creatorId: CreatorId, shiftId: ShiftId): Promise<void>;
  /** He contests one of his remarks in one line (§ 14). */
  contest(actor: Actor, remarkId: string, body: ContestRemarkBody): Promise<void>;
  /** The owner or a manager settles a contest, never his own (§ 14). */
  rule(actor: Actor, remarkId: string, body: RuleRemarkBody): Promise<void>;
}

const contestState = (stored: StoredContest | undefined): ContestState =>
  stored === undefined ? 'none' : (stored.ruling ?? 'pending');

const GRAVITY: Record<ReviewCard['tone'] & string, number> = { grave: 0, firm: 1, explain: 2, advice: 3 };

export function createReviewService(deps: {
  readonly store: ReviewStore;
  readonly remarks: ShiftRemarkSource;
  readonly excerpts: RemarkExcerpts;
  readonly now?: () => Date;
}): ReviewService {
  const now = deps.now ?? (() => new Date());

  async function mine(userId: UserId, creatorId: CreatorId): Promise<TeamMemberId> {
    const memberId = await deps.store.memberOf(creatorId, userId);
    if (memberId === null) throw new ReviewMemberForbidden();
    return memberId;
  }

  /** His own shift, or the same answer as a shift that does not exist. */
  async function myShift(userId: UserId, creatorId: CreatorId, shiftId: ShiftId): Promise<TeamMemberId> {
    const memberId = await deps.store.shiftMember(creatorId, userId, shiftId);
    if (memberId === null) throw new ReviewShiftNotFound();
    return memberId;
  }

  async function shiftRemarks(creatorId: CreatorId, shiftId: ShiftId, memberId: TeamMemberId) {
    const all = await deps.remarks.remarksFor({ creatorId, shiftId });
    return all.filter((r) => r.chatterId === memberId);
  }

  const codesOf = (remarks: readonly ShiftRemark[]): FaultCode[] => [
    ...new Set(remarks.flatMap((r) => (r.faultCode === null ? [] : [r.faultCode]))),
  ];

  return {
    async myShiftReview(userId, creatorId, shiftId) {
      const memberId = await myShift(userId, creatorId, shiftId);
      const remarks = await shiftRemarks(creatorId, shiftId, memberId);
      const codes = codesOf(remarks);
      const history = await deps.remarks.remarksOfChatter({
        creatorId,
        chatterId: memberId,
        since: new Date(now().getTime() - REPEAT_WINDOW_MS),
      });
      const [levels, explained, contests] = await Promise.all([
        deps.store.levels(creatorId, userId, codes),
        deps.store.explanations(creatorId, userId, memberId, codes),
        deps.store.contests(creatorId, userId, [...new Set([...remarks, ...history].map((r) => r.id))]),
      ]);

      const card = async (r: ShiftRemark): Promise<ReviewCard> => {
        const saved = r.faultCode === null ? undefined : levels.get(r.faultCode);
        // A code the owner has not named yet is shown as advice, never counted.
        const level: FaultLevel = saved?.level ?? 'advice';
        const explainedAt = r.faultCode === null ? null : (explained.get(r.faultCode) ?? null);
        const stored = contests.get(r.id);
        const counted =
          r.faultCode === null
            ? 0
            : history.filter(
                (h) =>
                  h.faultCode === r.faultCode &&
                  occurrenceCounts(
                    level,
                    { at: h.occurredAt, contest: contestState(contests.get(h.id)), author: h.author },
                    explainedAt,
                  ),
              ).length;
        return {
          remarkId: r.id,
          kind: r.kind,
          faultCode: r.faultCode,
          label: saved?.label ?? null,
          tone: r.kind === 'fault' ? faultTone(level, explainedAt) : null,
          counted,
          occurredAt: r.occurredAt.toISOString(),
          fanFeeling: r.fanFeeling,
          missed:
            r.missedMinor !== null && r.currency !== null && r.missedSource !== null
              ? { minor: r.missedMinor, currency: r.currency, source: r.missedSource }
              : null,
          earned:
            r.earnedMinor !== null && r.currency !== null
              ? { minor: r.earnedMinor, currency: r.currency }
              : null,
          excerpt: [...(await deps.excerpts(creatorId, r.messageIds))],
          alternative: [...r.alternative],
          ruleRef: r.ruleRef,
          contest: stored === undefined ? null : { reason: stored.reason, ruling: stored.ruling },
        };
      };

      const cards = await Promise.all(remarks.map(card));
      const faults = cards
        .filter((c) => c.kind === 'fault')
        .sort(
          (a, b) =>
            GRAVITY[a.tone ?? 'advice'] - GRAVITY[b.tone ?? 'advice'] ||
            (b.missed?.minor ?? 0) - (a.missed?.minor ?? 0),
        );
      const totals = missedTotals(
        faults.map((c) => ({ missed: c.missed, contest: contestState(contests.get(c.remarkId)) })),
      );
      return {
        shiftId,
        creatorId,
        faults: faults.slice(0, FAULTS_SHOWN),
        wellDone: cards.filter((c) => c.kind === 'well_done'),
        missedTotals: [...totals].map(([currency, minor]) => ({ currency, minor })),
      };
    },

    async markSeen(userId, creatorId, shiftId) {
      const memberId = await myShift(userId, creatorId, shiftId);
      const remarks = await shiftRemarks(creatorId, shiftId, memberId);
      const rows = remarks.flatMap((r) =>
        r.faultCode === null ? [] : [{ faultCode: r.faultCode, remarkId: r.id }],
      );
      if (rows.length > 0) await deps.store.recordExplanations(creatorId, userId, memberId, rows);
    },

    async contest(actor, remarkId, body) {
      const memberId = await mine(actor.userId, body.creatorId);
      const remark = await deps.remarks.remark({ creatorId: body.creatorId, remarkId });
      if (remark?.chatterId !== memberId) throw new ReviewRemarkNotFound();
      await deps.store.contest(body.creatorId, actor.userId, memberId, remarkId, body.reason);
    },

    async rule(actor, remarkId, body) {
      const outcome = await deps.store.rule(body.creatorId, actor.userId, remarkId, body.ruling);
      if (outcome === 'forbidden') throw new ReviewRulingForbidden();
      if (outcome === 'not_found') throw new ReviewRemarkNotFound();
    },
  };
}
