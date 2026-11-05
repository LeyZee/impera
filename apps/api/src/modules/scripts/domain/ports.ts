import type {
  CreateScriptStructureBody,
  CreatorId,
  SaveScriptStructureBody,
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
