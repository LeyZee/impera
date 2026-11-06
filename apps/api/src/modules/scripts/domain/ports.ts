import type {
  CreateScriptStructureBody,
  CreatorId,
  SaveScriptStructureBody,
  PersonaLimits,
  ScriptCadenceOutcome,
  ScriptCadenceSkip,
  ScriptDisgustBlock,
  ScriptStructure,
  ScriptStructureId,
  ScriptStructureList,
  ScriptStructureVersion,
} from '@impera/contracts';

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
