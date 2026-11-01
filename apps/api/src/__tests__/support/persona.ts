import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PersonaSchema, type CreatorId, type Persona } from '@nirvana/contracts';
import { parse } from 'yaml';

import type { App } from '../../composition-root';

/** The fictional demo persona of the repository (ADR 0010: never a real one in a test). */
export const DEMO_PERSONA: Persona = PersonaSchema.parse(
  parse(
    readFileSync(fileURLToPath(new URL('../../../../../personas/demo/v0.2.0.yaml', import.meta.url)), 'utf8'),
  ),
);

/**
 * Gives her the demo persona as her active version: the agent writes with it, and her approvals read its guards
 * (recette 28/10, G4). Without an active version nothing is approved.
 */
export async function activateDemoPersona(app: App, creatorId: CreatorId): Promise<void> {
  await app.modules.persona.versions.load(creatorId, DEMO_PERSONA, {
    sourcePath: 'personas/demo/v0.2.0.yaml',
    activate: true,
  });
}
