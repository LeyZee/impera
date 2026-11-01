import type { Persona } from '@nirvana/contracts';

import { personaForModels, type PersonaForModels } from './persona-file';

/** Her active version as the `persona` module stores it (`versions.active`), matched by shape: no import of it. */
interface StoredActivePersona {
  readonly id: string;
  readonly creatorName: string;
  readonly persona: Persona;
}

/**
 * The port the agent writes with (ADR 0010, 0022): her active persona version, read from the base at each call;
 * `null` when she has none. Throws when it cannot be read: the caller fails closed, never on another persona.
 */
export type ActivePersonaSource = (creatorId: string) => Promise<StoredActivePersona | null>;

/** Who she is for the models, from her active version; `null` without one. A placeholder first name reads as hers. */
export async function activePersonaForModels(
  source: ActivePersonaSource,
  creatorId: string,
  now: Date,
): Promise<PersonaForModels | null> {
  const stored = await source(creatorId);
  if (stored === null) return null;
  return {
    ...personaForModels(stored.persona, stored.creatorName, now.toISOString().slice(0, 10)),
    versionId: stored.id,
  };
}
