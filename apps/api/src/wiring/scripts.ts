import type { PersonaModule } from '../modules/persona';
import { createScriptsModule, type ScriptsModule } from '../modules/scripts';

import type { Routes, Shared } from './shared';

export interface WiredScripts {
  readonly module: ScriptsModule;
  readonly routes: readonly Routes[];
}

/** After the persona: a structure is checked against her active persona's limits (ADR 0056 § 1). */
export function wireScripts(
  shared: Shared,
  deps: { readonly persona: PersonaModule; readonly cardFontsDir: string },
): WiredScripts {
  const module = createScriptsModule({
    db: shared.db,
    requireRole: shared.requireRole,
    cardFontsDir: deps.cardFontsDir,
    limitsOf: async (creatorId) => (await deps.persona.versions.active(creatorId))?.persona.limits ?? null,
  });
  return { module, routes: [module.routes] };
}
