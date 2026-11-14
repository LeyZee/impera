import type {
  CreateScriptStructureBody,
  CreatorId,
  Currency,
  MediaSlotKind,
  SaveScriptStructureBody,
  PersonaLimits,
  PlatformAccountId,
  PlatformScript,
  PlatformScriptId,
  PlatformScriptMoment,
  ScriptCadenceOutcome,
  ScriptCadenceSkip,
  ScriptDisgustBlock,
  ScriptStructure,
  ScriptStructureId,
  ScriptStructureList,
  ScriptStructureVersion,
} from '@impera/contracts';

import type { KnownPlatformScript, PlatformScriptsPlan } from './platform-scripts';

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
export interface ImportAccount {
  readonly id: PlatformAccountId;
  readonly creatorId: CreatorId;
}

/** The import's writes (`scripts.import_platform_scripts`, ADR 0099 § 1 time 2), as the service role. */
export interface PlatformScriptImportStore {
  /** The accounts of the creators not archived. */
  accounts(): Promise<readonly ImportAccount[]>;
  known(accountId: PlatformAccountId): Promise<readonly KnownPlatformScript[]>;
  /** The whole plan in one transaction: a cut import leaves the account as it was. */
  apply(account: ImportAccount, plan: PlatformScriptsPlan, now: Date): Promise<void>;
}

/**
 * The native scripts the platform lists for an account (`listPlatformScripts`, `connectors`, wired by the composition
 * root): a read, never behind the write guard. `null` when the account's connector reads no scripts (no session, no
 * adapter, or `capabilities.scripts` false): the import then changes nothing for it.
 */
export type PlatformScriptSource = (account: ImportAccount) => Promise<readonly PlatformScript[] | null>;

/** A media of a step, by the platform's id of the vault media. */
export interface StoredStepMedia {
  readonly ref: string;
  readonly kind: MediaSlotKind;
}

/** A step of a native script as the base keeps it, at its place in the platform's order. */
interface StoredPlatformStep {
  readonly position: number;
  /** What `sendScriptStep` names. */
  readonly ref: string;
  readonly name: string;
  readonly text: string;
  readonly priceMinor: number;
  readonly currency: Currency;
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
}

export interface PlatformScriptReadStore {
  /** Her native scripts, as a person of the agency reads them; `null` for a reader who may not read her. */
  ofCreator(creatorId: CreatorId, userId: string): Promise<readonly StoredPlatformScript[] | null>;
  /** One of hers by its id, out of any person (a job of the agent's); `null` when it is not hers. */
  one(creatorId: CreatorId, scriptId: string): Promise<StoredPlatformScript | null>;
}

/** A vault media as its link says it (`media_platform_refs`): listed by the last sync of the vault and not removed. */
interface VaultLink {
  /** The media it is, once its file is read (ADR 0099 § 7); `null` before. */
  readonly mediaAssetId: string | null;
  /** Its media has a validated description (ADR 0083, ADR 0030 § 3). */
  readonly described: boolean;
}

/**
 * The vault links of an account's media, by the platform's id (`media_platform_refs`, ADR 0030 § 1, ADR 0099): a media
 * absent from the map is not in the vault (never synced, or removed since).
 */
export type VaultLinks = (
  platformAccountId: PlatformAccountId,
  mediaRefs: readonly string[],
) => Promise<ReadonlyMap<string, VaultLink>>;
