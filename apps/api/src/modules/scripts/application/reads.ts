import type { CreatorId, ScriptMoment, UserRole } from '@impera/contracts';

import type { QueuedStructure, ScriptStructureStore } from '../domain/ports';

/**
 * The agency's read of her script queue, for both doors (ADR 0026 § 1): the route and the MCP server call this, never
 * the store, so that the rule of who reads lives here once. Who reads is checked here (the owner and the team); the
 * store then keeps the team's scope (an operator who is not an active manager reads nothing) and her RLS.
 */
export interface ScriptsReader {
  readonly userId: string;
  readonly role: UserRole;
}

/** Her queue in order; `null` for a reader of another role, a creator who does not exist, or one the reader may not read. */
export async function creatorQueue(
  store: ScriptStructureStore,
  reader: ScriptsReader,
  creatorId: CreatorId,
): Promise<readonly QueuedStructure[] | null> {
  if (reader.role !== 'owner' && reader.role !== 'operator') return null;
  return store.queue(creatorId, reader.userId);
}

/** A structure of her queue (MCP `scripts_list`): its name and size, never its steps' text. */
export interface QueuedDigest {
  readonly structureId: string;
  /** The agency's words. */
  readonly name: string;
  readonly moment: ScriptMoment;
  readonly stages: number;
  readonly bridges: number;
}

export function queuedDigest(entry: QueuedStructure): QueuedDigest {
  const { segments } = entry.current;
  return {
    structureId: entry.structureId,
    name: entry.current.name,
    moment: entry.current.moment,
    stages: segments.filter((segment) => segment.kind === 'stage').length,
    bridges: segments.filter((segment) => segment.kind === 'bridge').length,
  };
}
