import type {
  BranchCondition,
  CreateScriptStructureBody,
  CreatorId,
  Currency,
  DescriptionReviewReason,
  MediaSlotKind,
  SaveScriptStructureBody,
  PersonaLimits,
  Platform,
  PlatformAccountId,
  PlatformScript,
  PlatformScriptId,
  PlatformScriptMoment,
  PlatformStepDiscount,
  PreparedScriptContent,
  PreparedScriptId,
  PreparedScriptMoment,
  PreparedScriptState,
  ScriptCadenceOutcome,
  ScriptIdentityAuthor,
  ScriptIdentityContent,
  ScriptIdentityId,
  ScriptCadenceSkip,
  ScriptDisgustBlock,
  ScriptStructure,
  ScriptStructureId,
  ScriptStructureList,
  ScriptStructureVersion,
} from '@impera/contracts';

import type { BranchSetting } from './branches';
import type { KnownPlatformScript, PlatformScriptsPlan, StepTotals } from './platform-scripts';
import type { PreparedVaultMedia } from './prepared-scripts';
import type { NativeScriptForMatch, PreparedForMatch, Recognition } from './recognition';

/** A structure of a queue, with the version a request would take: the latest. */
export interface QueuedStructure {
  readonly structureId: ScriptStructureId;
  readonly current: ScriptStructureVersion;
}

/** A structure `vet` keeps out of her queue, with the stages that touch her limits. */
export interface QueueRefusal {
  readonly structureId: ScriptStructureId;
  readonly blocks: readonly ScriptDisgustBlock[];
}

/**
 * The agency's script structures and the queue of each creator (ADR 0056 § 1 and 2). Every call runs as the signed-in
 * account (`withMember`): the policies let the owner write, the owner and the active managers read, nobody else.
 */
export interface ScriptStructureStore {
  /** The structures not archived, newest first, each with its latest version. */
  list(userId: string): Promise<ScriptStructureList>;
  get(id: ScriptStructureId, userId: string): Promise<ScriptStructure | null>;
  /**
   * Writes a structure and its version 1 under the client's id, audited. The same body sent again gives what is stored
   * (`replayed`); the same id with another body, or archived, is a `conflict`.
   */
  create(
    body: CreateScriptStructureBody,
    userId: string,
  ): Promise<
    | { readonly kind: 'created' | 'replayed'; readonly structure: ScriptStructure }
    | { readonly kind: 'conflict' }
    | { readonly kind: 'creator_invalid' }
  >;
  /**
   * Writes over `basedOnVersion`: the latest version changes in place while it is not frozen, the next one is written
   * once it is (rule 6). `stale` when another version was written since; a structure kept for a creator stays out of
   * every other creator's queue (`creator_invalid` when one holds it).
   */
  save(
    id: ScriptStructureId,
    body: SaveScriptStructureBody,
    userId: string,
  ): Promise<ScriptStructure | 'not_found' | 'stale' | 'creator_invalid'>;
  /** Archives it and takes it out of every queue, audited. `false` when there was none left to archive. */
  archive(id: ScriptStructureId, userId: string): Promise<boolean>;
  /**
   * Freezes its latest version, for a request (SC-02): from then on a change writes the next version. Gives the version
   * frozen, or `null` for an unknown or archived structure.
   */
  freeze(id: ScriptStructureId, userId: string): Promise<ScriptStructureVersion | null>;
  /** Her queue in order; `null` for a creator who does not exist, or for a reader other than the owner and an active manager. */
  queue(creatorId: CreatorId, userId: string): Promise<readonly QueuedStructure[] | null>;
  /**
   * Replaces her queue with these structures, in this order, audited. `unprocessable` names the structures that are
   * unknown, archived, or kept for another creator; `blocked` gives what `vet` refused, read on the versions of the
   * same transaction (a save in between cannot slip a stage past it). Nothing is written then.
   */
  setQueue(
    creatorId: CreatorId,
    ids: readonly ScriptStructureId[],
    userId: string,
    vet: (entries: readonly QueuedStructure[]) => readonly QueueRefusal[],
  ): Promise<
    | { readonly kind: 'written'; readonly entries: readonly QueuedStructure[] }
    | { readonly kind: 'creator_not_found' }
    | { readonly kind: 'unprocessable'; readonly structureIds: readonly ScriptStructureId[] }
    | { readonly kind: 'blocked'; readonly refusals: readonly QueueRefusal[] }
  >;
}

/** A card's SVG drawn as a PNG at its own `width` and `height` (SC-01 lot b): the same SVG gives the same bytes. */
export type RasterizeCard = (svg: string) => Promise<Uint8Array>;

/** Her cadence as stored: `days`, and what the job last found; no row reads as the default, never checked. */
export interface StoredCadence {
  readonly days: number;
  readonly outcome: ScriptCadenceOutcome | null;
  readonly skipped: readonly ScriptCadenceSkip[];
  readonly checkedAt: Date | null;
}

/**
 * Each creator's script cadence (SC-02, ADR 0056 § 2). `read` and `setDays` run as the signed-in account
 * (`withTenantMember`: the owner writes, the owner and the active managers read); the rest is the hourly job's, as the
 * admin role.
 */
export interface CadenceStore {
  /** Her cadence; `null` for a creator who does not exist, or a reader other than the owner and an active manager. */
  read(creatorId: CreatorId, userId: string): Promise<StoredCadence | null>;
  /** Writes `days`, audited; `null` for a creator who does not exist. */
  setDays(creatorId: CreatorId, days: number, userId: string): Promise<StoredCadence | null>;
  /** Every creator not archived, with her zone. */
  creators(): Promise<readonly { readonly id: CreatorId; readonly timeZone: string }[]>;
  /** Her `days` (the default without a row). */
  days(creatorId: CreatorId): Promise<number>;
  /** Her queue in order, with each structure's latest version. */
  queue(creatorId: CreatorId): Promise<readonly QueuedStructure[]>;
  /** A structure not archived and kept for no other creator, with its latest version; `null` otherwise. */
  usable(creatorId: CreatorId, structureId: ScriptStructureId): Promise<QueuedStructure | null>;
  /** Freezes its latest version (or gives it, already frozen); `null` when it is archived or unknown. */
  freeze(structureId: ScriptStructureId): Promise<ScriptStructureVersion | null>;
  /**
   * Takes the structure out of her queue, the positions after it moving up. With `askedAt` (the request's own time,
   * the database's clock), only if it was queued before: a structure put back in her queue since it was asked stays.
   */
  dequeue(creatorId: CreatorId, structureId: ScriptStructureId, askedAt: Date | null): Promise<void>;
  /** What the job found for her this time. */
  record(
    creatorId: CreatorId,
    outcome: ScriptCadenceOutcome,
    skipped: readonly ScriptCadenceSkip[],
    now: Date,
  ): Promise<void>;
}

/** The scripts asked of her, written by `content-drops` (wired by the composition root). */
export interface ScriptRequests {
  ask(request: {
    readonly creatorId: CreatorId;
    readonly dueOn: string;
    readonly reason: string;
    readonly structureId: ScriptStructureId;
    readonly structureVersionId: string;
  }): Promise<void>;
  /** For the hourly job, as the admin role. */
  last(creatorId: CreatorId): Promise<AskedScript | null>;
  /** For a member of her team, under row-level security: `null` for anyone outside it. */
  lastFor(creatorId: CreatorId, userId: string): Promise<AskedScript | null>;
}

/** Her last script asked by the cadence. */
interface AskedScript {
  readonly dueOn: string;
  readonly structureId: ScriptStructureId;
  readonly askedAt: Date;
}

/** Her persona's limits, from her active version; `null` without one. */
export type LimitsOf = (creatorId: CreatorId) => Promise<PersonaLimits | null>;

/** A platform account whose native scripts the import reads, and the creator it belongs to. */
interface ImportAccount {
  readonly id: PlatformAccountId;
  readonly creatorId: CreatorId;
  readonly platform: Platform;
}

/**
 * The platform's totals of the steps read by an import, for its day (ADR 0129 § 12): written with the plan, each over
 * the row of the same day (the platform's last word); the days before stay as they were.
 */
export interface ImportTotals {
  /** The platform's day of the read, `YYYY-MM-DD`. */
  readonly day: string;
  readonly steps: readonly StepTotals[];
}

/** The import's writes (`scripts.import_platform_scripts`, ADR 0099 § 1 time 2), as the service role. */
export interface PlatformScriptImportStore {
  /** Her account, when it is hers and she is not archived; `null` otherwise. */
  account(creatorId: CreatorId, platformAccountId: PlatformAccountId): Promise<ImportAccount | null>;
  known(accountId: PlatformAccountId): Promise<readonly KnownPlatformScript[]>;
  /**
   * The whole plan in one transaction: a cut import leaves the account as it was. Gives the ids of the scripts added
   * or rewritten, whose identity is to write again.
   */
  apply(
    account: ImportAccount,
    plan: PlatformScriptsPlan,
    now: Date,
    totals: ImportTotals | null,
  ): Promise<readonly string[]>;
}

/**
 * The native scripts the platform lists for an account (`listPlatformScripts`, `connectors`, wired by the composition
 * root): a read, never behind the write guard. `null` when the account's connector reads no scripts (no session, no
 * adapter, or `capabilities.scripts` false): the import then changes nothing for it.
 */
/**
 * The recognition of the scripts copied into Reveal (ADR 0112 § 23), as the service role, after an import: in one
 * transaction, the account's scripts « prêt à copier » (the oldest first) and its active native scripts no script in
 * preparation took and the agency set nothing on are given to `decide`; each recognition passes its settings to the
 * native script and closes the script in preparation. Gives how many were tied.
 */
export interface PreparedRecognitionStore {
  recognise(
    account: ImportAccount,
    decide: (
      prepared: readonly PreparedForMatch[],
      natives: readonly NativeScriptForMatch[],
    ) => readonly Recognition[],
    now: Date,
  ): Promise<number>;
}

export type PlatformScriptSource = (account: ImportAccount) => Promise<readonly PlatformScript[] | null>;

/** A vault media as its link says it (`media_platform_refs`): listed by the last sync of the vault and not removed. */
interface VaultLink {
  /** The media it is, once its file is read (ADR 0099 § 7); `null` before. */
  readonly mediaAssetId: string | null;
  /**
   * The latest description of its media a human validated (ADR 0083, ADR 0030 § 3), by its row: what the script's
   * identity is written from (SC-04 lot c8); `null` while there is none.
   */
  readonly descriptionId: string | null;
  /** Chosen for the CRM, by its own tick or its folder's (ADR 0145 § 5): `false`, the agent does not see it. */
  readonly imported: boolean;
  /**
   * The description its media is told with (ADR 0030 § 3): the latest validated, else the latest written, by the vision
   * or by hand, for the agency to validate; never the platform's own text. `null` while it has none.
   */
  readonly shown: ShownDescription | null;
}

/** A description of a vault media as the agency reviews it. */
export interface ShownDescription {
  readonly id: string;
  readonly detailed: string;
  /** Why it waits for a person (ADR 0083 § 3 to 5): validated alone, never with others. */
  readonly reviewReasons: readonly DescriptionReviewReason[];
  readonly validated: boolean;
}

/** A media of a step, by the platform's id of the vault media. */
export interface StoredStepMedia {
  readonly ref: string;
  readonly kind: MediaSlotKind;
  /**
   * Its vault link, read in the same transaction as the script (ADR 0030 § 1, ADR 0099): `null` when the media is not
   * in the vault (never synced, or removed since).
   */
  readonly vault: VaultLink | null;
}

/** A step of a native script as the base keeps it, at its place in the platform's order. */
interface StoredPlatformStep {
  readonly position: number;
  /** The platform's own rank (`stepIndex`): two steps on the same are branches of one step (ADR 0112). */
  readonly platformIndex: number;
  /** What `sendScriptStep` names. */
  readonly ref: string;
  readonly name: string;
  readonly text: string;
  readonly priceMinor: number;
  readonly currency: Currency;
  /** A « Tarif réduit » set on the platform, as read; `null` when none (recette 16/11). */
  readonly discount: PlatformStepDiscount | null;
  readonly media: readonly StoredStepMedia[];
  readonly previewMedia: readonly StoredStepMedia[];
}

/** A native script as the base keeps it. */
export interface StoredPlatformScript {
  readonly id: PlatformScriptId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly ref: string;
  readonly name: string;
  readonly moment: PlatformScriptMoment | null;
  readonly active: boolean;
  readonly deactivatedAt: Date | null;
  readonly syncedAt: Date;
  readonly steps: readonly StoredPlatformStep[];
  /**
   * What the agency set of its branches (ADR 0112 § A 3), by `stepRef`: their order and conditions. A row of a branch
   * Reveal no longer lists is still here; the domain ignores it.
   */
  readonly branches: readonly BranchSetting[];
  /** Every identity written for it, whatever the version (SC-04 lot c8); the domain picks the current one. */
  readonly identities: readonly StoredScriptIdentity[];
  /** Ours when an import recognised it as the copy of a script prepared in Impera (ADR 0161); `null` otherwise. */
  readonly ours: OurCopy | null;
}

/** An identity of a native script as the base keeps it (`script_identities`). */
export interface StoredScriptIdentity {
  readonly id: ScriptIdentityId;
  /** sha256 of the version it was written for (`identityInputHash`). */
  readonly inputHash: string;
  readonly content: ScriptIdentityContent;
  readonly author: ScriptIdentityAuthor;
  /** The brain's prompt; `null` for a hand's. */
  readonly promptHash: string | null;
  readonly validatedAt: Date | null;
  readonly createdAt: Date;
}

export interface PlatformScriptReadStore {
  /**
   * Her native scripts and their vault links, as a person of the agency reads them: in the person's transaction, under
   * her RLS and his scope. `null` for a reader who may not read her.
   */
  ofCreator(creatorId: CreatorId, userId: string): Promise<readonly StoredPlatformScript[] | null>;
  /**
   * One of hers by its id and its vault links, as the service role: for a job only, never with an id a request gave
   * (`forJobs.platformScript`). `null` when it is not hers.
   */
  oneForJob(creatorId: CreatorId, scriptId: string): Promise<StoredPlatformScript | null>;
  /** Hers on one account, active or not, as the service role: what the agent decides on for a fan (ADR 0098). */
  ofAccountForJob(
    creatorId: CreatorId,
    platformAccountId: PlatformAccountId,
  ): Promise<readonly StoredPlatformScript[]>;
  /**
   * Her active native scripts with a « Tarif réduit » on a step (recette 16/11), read as `ofCreator` is and under the
   * same rights, without their texts nor their media: what « À traiter » warns of. `null` for a reader who may not
   * read her.
   */
  discountedOf(creatorId: CreatorId, userId: string): Promise<readonly DiscountedPlatformScript[] | null>;
}

/** A native script of hers kept from being offered by a « Tarif réduit » on the platform, as long as it is there. */
export interface DiscountedPlatformScript {
  readonly id: PlatformScriptId;
  /** As the platform names it. */
  readonly name: string;
  /** How many of its steps carry one (1 or more). */
  readonly steps: number;
  /** The import that wrote its current version, the one with the discount: since when it waits. */
  readonly since: Date;
}

/** The agency's review of the descriptions of a native script's media (ADR 0030 § 3, ADR 0099 § 4). */
export type DescriptionReview =
  | { readonly kind: 'validate'; readonly descriptionIds: readonly string[] }
  | { readonly kind: 'correct'; readonly descriptionId: string; readonly detailed: string };

/**
 * The agency's review of the descriptions of a native script's media (ADR 0030 § 3, ADR 0099 § 4), in the person's
 * transaction, under her RLS and his scope, audited. Its identity is no longer reviewed by hand: the agent offers only
 * the scripts written in Impera (ADR 0161).
 */
export interface ScriptIdentityReviewStore {
  /**
   * The descriptions of its media validated as shown, or one rewritten by hand and validated (ADR 0099 § 4), in the
   * same way: a description that is not the one a media of this script is shown with now is `stale`, one that waits
   * for a person named with others `alone`. No identity is asked after it any more (ADR 0161 § 5).
   */
  describe(
    creatorId: CreatorId,
    scriptId: string,
    review: DescriptionReview,
    userId: string,
  ): Promise<'validated' | 'already' | 'corrected' | 'stale' | 'alone' | 'not_found'>;
}

/** One branch of a step, as the agency sets it: by its `stepRef`, in the order given. */
export interface BranchInput {
  readonly stepRef: string;
  readonly condition: BranchCondition;
}

/** What setting a step's branches did. */
export type SetBranchesOutcome =
  /** Written. */
  | 'set'
  /** Not a step of hers with branches, or a reader who may not write her scripts. */
  | 'not_found'
  /** The branches named are not those the step has now (Reveal changed them since the reading). */
  | 'stale';

/** The agency's settings of a script's branches (ADR 0112 § A 3), in the person's transaction. */
export interface ScriptBranchStore {
  /**
   * Every branch of one step at once, in the order given, each with its condition: under her RLS and the team's scope
   * (the owner, an active manager of her list), audited. The step is read again in the same transaction.
   */
  setStep(
    creatorId: CreatorId,
    scriptId: string,
    platformIndex: number,
    branches: readonly BranchInput[],
    userId: string,
  ): Promise<SetBranchesOutcome>;
}

/** A script in preparation as the base keeps it (`prepared_scripts`, ADR 0112 §§ 20-23). */
export interface StoredPreparedScript {
  readonly id: PreparedScriptId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly state: PreparedScriptState;
  readonly revision: number;
  readonly content: PreparedScriptContent;
  readonly matchedPlatformScriptId: PlatformScriptId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Where each media it names stands in her vault, read in the same transaction; a ref absent is not in it. */
  readonly vault: ReadonlyMap<string, PreparedVaultMedia>;
  /** « Prêt à copier » only: the account's active native scripts of its name, to say what differs; `null` otherwise. */
  readonly natives: readonly NativeScriptForMatch[] | null;
}

export type CreatePreparedOutcome = 'created' | 'replayed' | 'conflict' | 'account_invalid' | 'not_found';
type UpdatePreparedOutcome = 'updated' | 'stale' | 'closed' | 'not_found';

/**
 * Her scripts in preparation, in the person's transaction, under her RLS and the team's scope: the owner and the
 * active managers of her list. Anyone else reads `null` / `not_found`, for a creator or a script that exists and one
 * that does not.
 */
export interface PreparedScriptStore {
  list(creatorId: CreatorId, userId: string): Promise<readonly StoredPreparedScript[] | null>;
  one(creatorId: CreatorId, id: PreparedScriptId, userId: string): Promise<StoredPreparedScript | null>;
  /** Under the client's id: the same content again replays, another is a conflict. */
  create(
    creatorId: CreatorId,
    input: {
      readonly id: PreparedScriptId;
      readonly platformAccountId: PlatformAccountId;
      readonly content: PreparedScriptContent;
    },
    userId: string,
  ): Promise<CreatePreparedOutcome>;
  /** Writes on `basedOnRevision` only, raising it by one; the content stays when `content` is `null`. */
  update(
    creatorId: CreatorId,
    id: PreparedScriptId,
    change: {
      readonly basedOnRevision: number;
      readonly content: PreparedScriptContent | null;
      readonly state: Exclude<PreparedScriptState, 'matched'>;
    },
    userId: string,
  ): Promise<UpdatePreparedOutcome>;
}

/**
 * The script of ours a native script is the recognised copy of (ADR 0161 § 5): what the agent offers it on. Its
 * description and moment are ours, written by a person in the editor; its steps in order, each branch with the price we
 * set, are what the agent checks the copy still matches before offering it.
 */
export interface OurCopy {
  readonly preparedScriptId: PreparedScriptId;
  readonly description: string;
  readonly moment: PreparedScriptMoment;
  readonly steps: readonly {
    readonly branches: readonly { readonly priceMinor: number; readonly currency: Currency }[];
  }[];
}
