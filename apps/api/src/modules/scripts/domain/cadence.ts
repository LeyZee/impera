import type {
  PersonaLimits,
  ScriptCadenceOutcome,
  ScriptCadenceSkip,
  ScriptStructureId,
  ScriptStructureVersion,
} from '@impera/contracts';

import { disgustBlocks } from './disgusts';
import type { QueuedStructure } from './ports';

/** What the cadence decides for one creator whose script is due: the structure to ask, and those passed over. */
export type CadenceChoice =
  | {
      readonly outcome: 'asked' | 'reused';
      readonly structureId: ScriptStructureId;
      readonly skipped: readonly ScriptCadenceSkip[];
    }
  | {
      readonly outcome: Exclude<ScriptCadenceOutcome, 'asked' | 'reused'>;
      readonly skipped: readonly ScriptCadenceSkip[];
    };

const skipOf = (
  structureId: ScriptStructureId,
  current: ScriptStructureVersion,
  limits: PersonaLimits,
): ScriptCadenceSkip | null => {
  const blocks = disgustBlocks(current.segments, limits);
  return blocks.length === 0 ? null : { structureId, name: current.name, blocks };
};

/**
 * The structure to ask of her (ADR 0056 § 2), read in code against her active persona's limits, never by a model:
 * the first of her queue that touches none of them, each one before it passed over (`skipped`); her queue empty, the
 * last structure asked again (`reused`, the agency warned in amber), if it still touches none. Without a persona,
 * nothing is asked: a limit unknown is not a limit absent.
 */
export function chooseStructure(
  queue: readonly QueuedStructure[],
  last: QueuedStructure | null,
  limits: PersonaLimits | null,
): CadenceChoice {
  if (limits === null) return { outcome: 'no_persona', skipped: [] };
  const skipped: ScriptCadenceSkip[] = [];
  for (const entry of queue) {
    const skip = skipOf(entry.structureId, entry.current, limits);
    if (skip === null) return { outcome: 'asked', structureId: entry.structureId, skipped };
    skipped.push(skip);
  }
  if (skipped.length > 0) return { outcome: 'blocked', skipped };
  if (last === null) return { outcome: 'queue_empty', skipped };
  const skip = skipOf(last.structureId, last.current, limits);
  if (skip !== null) return { outcome: 'blocked', skipped: [skip] };
  return { outcome: 'reused', structureId: last.structureId, skipped };
}

/** The request's sentence, as she reads it on her screen (160 characters at most). */
export function scriptReason(name: string): string {
  return `Ton prochain script : ${name}`.slice(0, 160);
}
