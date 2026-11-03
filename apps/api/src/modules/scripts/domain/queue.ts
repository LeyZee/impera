import type { CreatorId, PersonaLimits, ScriptQueue } from '@nirvana/contracts';

import { disgustBlocks } from './disgusts';
import type { QueuedStructure, QueueRefusal } from './ports';

/** The structures her limits keep out of her queue; none without an active persona, which the view says. */
export function queueRefusals(
  entries: readonly QueuedStructure[],
  limits: PersonaLimits | null,
): QueueRefusal[] {
  if (limits === null) return [];
  return entries.flatMap((entry) => {
    const blocks = disgustBlocks(entry.current.segments, limits);
    return blocks.length === 0 ? [] : [{ structureId: entry.structureId, blocks }];
  });
}

/** Her queue as the screen reads it, each entry with what blocks it today. */
export function queueView(
  creatorId: CreatorId,
  entries: readonly QueuedStructure[],
  limits: PersonaLimits | null,
): ScriptQueue {
  const refusals = new Map(
    queueRefusals(entries, limits).map((refusal) => [refusal.structureId, refusal.blocks]),
  );
  return {
    creatorId,
    personaChecked: limits !== null,
    entries: entries.map((entry) => ({
      structureId: entry.structureId,
      name: entry.current.name,
      moment: entry.current.moment,
      version: entry.current.version,
      blocks: [...(refusals.get(entry.structureId) ?? [])],
    })),
  };
}
