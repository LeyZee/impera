/** Public entry point of the `persona` module (ADR 0002). Other modules import this file only. */
import type { PersonaSampleReplyFault, StoredPersona } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { AgencyStyleStore } from './domain/agency-style';
import { PersonaSampleReplyUnprocessable } from './domain/errors';
import type { AgentHourExceptions, CreatorDirectory } from './domain/ports';
import type { PersonaVersionStore } from './domain/versions';
import { createDrizzleAgencyStyleStore } from './infra/db/agency-style-store';
import { createDrizzleAgentHourExceptions } from './infra/db/agent-hour-exceptions';
import { createDrizzleCreatorDirectory } from './infra/db/creator-directory';
import { createDrizzlePersonaCorrectionStore } from './infra/db/persona-correction-store';
import { createDrizzlePersonaVersionStore } from './infra/db/persona-version-store';
import { createAgencyStyleRoutes } from './infra/http/agency-style-routes';
import { createAgentHourExceptionRoutes } from './infra/http/agent-hour-exceptions-routes';
import { createPersonaRoutes } from './infra/http/persona-routes';
import {
  createCreatorArchiveRoutes,
  createCreatorRoutes,
  type CreatorArchiving,
  type RequireRole,
} from './infra/http/routes';

export interface PersonaModule {
  readonly name: 'persona';
  /** The creators (one creator, one persona): listed by the dashboard, created by `pnpm creator:create`. */
  readonly creators: CreatorDirectory;
  /**
   * Her persona versions: saved from the dashboard, loaded and activated by `pnpm persona:load`. `versions.active` is
   * the port the agent writes with (her active version, read at each draft), wired by the composition root.
   */
  readonly versions: PersonaVersionStore;
  /**
   * The agency's base style (ADR 0173): written by the owner at `/agency/style`; `agencyStyle.activeUnscoped` is the
   * port the agent writes with, wired by the composition root.
   */
  readonly agencyStyle: AgencyStyleStore;
  /** Her dated exceptions (ADR 0148 § 3): read by the agent through the composition root, written by their routes. */
  readonly agentHourExceptions: AgentHourExceptions;
  /** Mounted under `/v1` by the server: `/creators` and her `/agent-hours`, and each creator's `/persona` with its versions and her corrections. */
  readonly routes: FastifyPluginAsyncZod;
  /**
   * `/creators/archived`, `/creators/:creatorId/archive` and `…/restore` (ADR 0071 § 2), mounted by the composition
   * root once the modules her archiving closes exist.
   */
  archiveRoutes(archiving: CreatorArchiving): FastifyPluginAsyncZod;
}

export interface PersonaDeps {
  /** Application role: `creators` is the tenant root and has no RLS of its own. */
  readonly db: Database;
  /** The service connection: the agent's read of the active base style, across every creator (ADR 0173). */
  readonly adminDb: Database;
  readonly requireRole: RequireRole;
  /** A recent sign-in, for a change of her hours (P3-14). */
  readonly recentLogin: preValidationAsyncHookHandler;
  /**
   * Her sample replies a hard guard of her answers would block (`agent`, P5-01): a version with any is refused, from
   * the dashboard and from `pnpm persona:load` alike. Absent, none is read.
   */
  readonly sampleReplyFaults?: (persona: StoredPersona) => readonly PersonaSampleReplyFault[];
}

/** Refuses a persona whose sample replies teach what a guard of her answers blocks. */
const sampleReplyCheck =
  (faultsOf: NonNullable<PersonaDeps['sampleReplyFaults']>) =>
  (persona: StoredPersona): void => {
    const faults = faultsOf(persona);
    if (faults.length > 0) throw new PersonaSampleReplyUnprocessable(faults);
  };

/** The store, refusing before any write a version whose sample replies teach what a guard blocks. */
function withSampleReplyCheck(
  store: PersonaVersionStore,
  check: (persona: StoredPersona) => void,
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
  const agentHourExceptions = createDrizzleAgentHourExceptions(deps.db);
  const exceptionRoutes = createAgentHourExceptionRoutes(
    agentHourExceptions,
    deps.requireRole,
    deps.recentLogin,
  );
  const check = deps.sampleReplyFaults === undefined ? undefined : sampleReplyCheck(deps.sampleReplyFaults);
  // Checked again on activation: a version saved before a guard changed is not activated as it is (P5-01).
  const stored = createDrizzlePersonaVersionStore(deps.db, check);
  const versions = check === undefined ? stored : withSampleReplyCheck(stored, check);
  const corrections = createDrizzlePersonaCorrectionStore(deps.db);
  const personaRoutes = createPersonaRoutes(versions, corrections, deps.requireRole, deps.recentLogin);
  const agencyStyle = createDrizzleAgencyStyleStore(deps.db, deps.adminDb);
  const agencyStyleRoutes = createAgencyStyleRoutes(agencyStyle, deps.requireRole, deps.recentLogin);
  return {
    name: 'persona',
    creators,
    versions,
    agencyStyle,
    agentHourExceptions,
    routes: async (app) => {
      await app.register(creatorRoutes);
      await app.register(exceptionRoutes);
      await app.register(personaRoutes);
      await app.register(agencyStyleRoutes);
    },
    archiveRoutes: (archiving) =>
      createCreatorArchiveRoutes(creators, deps.requireRole, deps.recentLogin, archiving),
  };
}
