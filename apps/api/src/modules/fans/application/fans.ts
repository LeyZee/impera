import {
  FanIdSchema,
  newId,
  type CreatorId,
  type ClearableFanFlagName,
  type FanFlags,
  type FanId,
  type KycSlot,
  type TeamScope,
  type UserId,
} from '@nirvana/contracts';

import {
  kycSlotsToLearn,
  planFacts,
  selectActiveFacts,
  type FactProposal,
  type StoredFact,
} from '../domain/facts';
import type { Fan, FanSighting, FanStore, FactStore, FlagStore } from '../domain/fan';
import {
  withAgeDisputed,
  withDeclaredAge,
  withFlag,
  withFlagIfUnset,
  mayConfirmDisputedAge,
  withHumanConfirmation,
  withoutFlag,
  type FlagAuthor,
  type FlagChange,
} from '../domain/flags';

/** Who changes a limit and why; the author is the event's actor (P3-02). */
interface FlagCommand {
  readonly author: FlagAuthor;
  readonly reason?: string;
  readonly correlationId: string;
}

/** His limits after a change, and whether its author may confirm a disputed age (SUIVI-04). */
interface FlagsAfter {
  readonly flags: FanFlags;
  readonly mayConfirmDisputedAge: boolean;
}

/** What a written change returns, from the store's one transaction. */
const after = ({ flags, scope }: { flags: FanFlags; scope: TeamScope | null }): FlagsAfter => ({
  flags,
  mayConfirmDisputedAge: mayConfirmDisputedAge(scope),
});

export interface FansService {
  upsertFanByPlatformId(sighting: FanSighting): Promise<Fan>;
  getFan(creatorId: CreatorId, id: FanId): Promise<Fan | null>;
  /** Writes what is new in these proposals (append-only, `planFacts`) and returns the facts written. */
  proposeFacts(creatorId: CreatorId, fanId: FanId, proposals: readonly FactProposal[]): Promise<StoredFact[]>;
  /** What the context gets: active facts by category and confidence, 40 at most. */
  activeFacts(creatorId: CreatorId, fanId: FanId): Promise<StoredFact[]>;
  /** The lines of `slots` none of his active facts fills, read on all of them, not the 40 of the context (P5-01). */
  kycToLearn(creatorId: CreatorId, fanId: FanId, slots: readonly KycSlot[]): Promise<KycSlot[]>;
  /** His limits (`fans.flags`), read by the policy before any offer. */
  flags(creatorId: CreatorId, fanId: FanId): Promise<FanFlags>;
  /**
   * His limits as a person reads them, and whether that person may confirm his age once disputed: the owner and an
   * active manager only (SUIVI-04), as the database says.
   */
  flagsFor(
    creatorId: CreatorId,
    fanId: FanId,
    userId: UserId,
  ): Promise<{ flags: FanFlags; mayConfirmDisputedAge: boolean }>;
  /**
   * Sets one limit; writes `fan_flag_set` only when it changed. Returns his limits after, and whether the author may
   * confirm a disputed age, read in the same transaction.
   */
  setFlag(creatorId: CreatorId, fanId: FanId, change: FlagChange, command: FlagCommand): Promise<FlagsAfter>;
  /** Sets one limit only where none of that name is set (a human's freeze keeps its reason). Returns his limits after. */
  setFlagIfUnset(
    creatorId: CreatorId,
    fanId: FanId,
    change: FlagChange,
    command: FlagCommand,
  ): Promise<FanFlags>;
  /**
   * His own adult statement confirms his age (P3-09), decided under the row lock: never over a confirmation, never
   * after his age was taken back (`ageDisputed`). The author is the policy.
   */
  confirmDeclaredAge(
    creatorId: CreatorId,
    fanId: FanId,
    at: Date,
    command: Omit<FlagCommand, 'author'>,
  ): Promise<FanFlags>;
  /**
   * Lifts one limit; writes `fan_flag_cleared` only when it was set. Returns his limits after. Taking back his age
   * also disputes it, so that his own statement no longer confirms it. A dispute itself is never lifted here: only a
   * confirmation by the owner or a manager ends it (SUIVI-04).
   */
  clearFlag(
    creatorId: CreatorId,
    fanId: FanId,
    flag: ClearableFanFlagName,
    command: FlagCommand,
  ): Promise<FlagsAfter>;
}

export function createFansService(
  store: FanStore,
  facts: FactStore,
  flagStore: FlagStore,
  now: () => Date = () => new Date(),
): FansService {
  return {
    upsertFanByPlatformId: (sighting) => store.upsert(sighting, newId(FanIdSchema)),
    getFan: (creatorId, id) => store.get(creatorId, id),
    proposeFacts: (creatorId, fanId, proposals) =>
      facts.write(creatorId, fanId, (current) => planFacts(current, proposals, now())),
    activeFacts: async (creatorId, fanId) => selectActiveFacts(await facts.current(creatorId, fanId), now()),
    kycToLearn: async (creatorId, fanId, slots) =>
      kycSlotsToLearn(slots, await facts.current(creatorId, fanId), now()),
    flags: (creatorId, fanId) => flagStore.read(creatorId, fanId),
    flagsFor: async (creatorId, fanId, userId) => {
      const { flags, scope } = await flagStore.readAs(creatorId, fanId, userId);
      return { flags, mayConfirmDisputedAge: mayConfirmDisputedAge(scope) };
    },
    setFlag: (creatorId, fanId, change, command) => {
      // A human confirming his age settles a dispute (the owner or a manager, with a reason); the policy never does.
      const human = command.author !== 'system' && change.flag === 'ageConfirmedAt';
      const apply = (flags: FanFlags, scope: TeamScope | null) =>
        human
          ? withHumanConfirmation(flags, change, {
              scope,
              ...(command.reason !== undefined && { reason: command.reason }),
            })
          : withFlag(flags, change);
      return flagStore
        .change(creatorId, fanId, apply, { type: 'fan_flag_set', flag: change.flag, ...command })
        .then(after);
    },
    setFlagIfUnset: (creatorId, fanId, change, command) => {
      return flagStore
        .change(creatorId, fanId, (flags) => withFlagIfUnset(flags, change), {
          type: 'fan_flag_set',
          flag: change.flag,
          ...command,
        })
        .then(({ flags }) => flags);
    },
    confirmDeclaredAge: (creatorId, fanId, at, command) => {
      return flagStore
        .change(creatorId, fanId, (flags) => withDeclaredAge(flags, at), {
          type: 'fan_flag_set',
          flag: 'ageConfirmedAt',
          author: 'system',
          ...command,
        })
        .then(({ flags }) => flags);
    },
    clearFlag: (creatorId, fanId, flag, command) => {
      const by = command.author === 'system' ? 'policy' : 'human';
      const apply = (flags: FanFlags) =>
        flag === 'ageConfirmedAt' ? withAgeDisputed(flags, by, now()) : withoutFlag(flags, flag);
      return flagStore
        .change(creatorId, fanId, apply, { type: 'fan_flag_cleared', flag, ...command })
        .then(after);
    },
  };
}
