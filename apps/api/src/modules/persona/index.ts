/** Public entry point of the `persona` module (ADR 0002). Other modules import this file only. */
import type { Persona, PersonaSampleReplyFault } from '@nirvana/contracts';
import type { Database } from '@nirvana/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { PersonaSampleReplyUnprocessable } from './domain/errors';
import type { CreatorDirectory } from './domain/ports';
import type { PersonaVersionStore } from './domain/versions';
import { createDrizzleCreatorDirectory } from './infra/db/creator-directory';
import { createDrizzlePersonaVersionStore } from './infra/db/persona-version-store';
import { createPersonaRoutes } from './infra/http/persona-routes';
import { createCreatorRoutes, type RequireRole } from './infra/http/routes';

export interface PersonaModule {
  readonly name: 'persona';
  /** The creators (one creator, one persona): listed by the dashboard, created by `pnpm creator:create`. */
  readonly creators: CreatorDirectory;
  /**
   * Her persona versions: saved from the dashboard, loaded and activated by `pnpm persona:load`. `versions.active` is
   * the port the agent writes with (her active version, read at each draft), wired by the composition root.
   */
  readonly versions: PersonaVersionStore;
  /** Mounted under `/v1` by the server: `/creators` and her `/agent-hours`, and each creator's `/persona` with its versions. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface PersonaDeps {
  /** Application role: `creators` is the tenant root and has no RLS of its own. */
  readonly db: Database;
  readonly requireRole: RequireRole;
  /** A recent sign-in, for a change of her hours (P3-14). */
  readonly recentLogin: preValidationAsyncHookHandler;
  /**
   * Her sample replies a hard guard of her answers would block (`agent`, P5-01): a version with any is refused, from
   * the dashboard and from `pnpm persona:load` alike. Absent, none is read.
   */
  readonly sampleReplyFaults?: (persona: Persona) => readonly PersonaSampleReplyFault[];
}

/** Refuses a persona whose sample replies teach what a guard of her answers blocks. */
const sampleReplyCheck =
  (faultsOf: NonNullable<PersonaDeps['sampleReplyFaults']>) =>
  (persona: Persona): void => {
    const faults = faultsOf(persona);
    if (faults.length > 0) throw new PersonaSampleReplyUnprocessable(faults);
  };

/** The store, refusing before any write a version whose sample replies teach what a guard blocks. */
function withSampleReplyCheck(
  store: PersonaVersionStore,
  check: (persona: Persona) => void,
): PersonaVersionStore {
  return {
    ...store,
    create: async (creatorId, body, userId) => {
      check(body.persona);
      return store.create(creatorId, body, userId);
    },
    load: async (creatorId, persona, options) => {
      check(persona);
      return store.load(creatorId, persona, options);
    },
  };
}

export function createPersonaModule(deps: PersonaDeps): PersonaModule {
  const creators = createDrizzleCreatorDirectory(deps.db);
  const creatorRoutes = createCreatorRoutes(creators, deps.requireRole, deps.recentLogin);
  const check = deps.sampleReplyFaults === undefined ? undefined : sampleReplyCheck(deps.sampleReplyFaults);
  // Checked again on activation: a version saved before a guard changed is not activated as it is (P5-01).
  const stored = createDrizzlePersonaVersionStore(deps.db, check);
  const versions = check === undefined ? stored : withSampleReplyCheck(stored, check);
  const personaRoutes = createPersonaRoutes(versions, deps.requireRole);
  return {
    name: 'persona',
    creators,
    versions,
    routes: async (app) => {
      await app.register(creatorRoutes);
      await app.register(personaRoutes);
    },
  };
}
