import { CreatorIdSchema } from '@impera/contracts';

import type { AppLlm } from '../llm';
import type { ActivePersonaSource } from '../modules/agent';
import type { ConnectorsModule } from '../modules/connectors';
import type { PersonaModule } from '../modules/persona';
import { createDbDesireMarkStore, startPlaygroundModule, type PlaygroundModule } from '../modules/playground';

import type { Routes, Shared } from './shared';

export interface WiredPlayground {
  /** Null in the worker, or when its persona cannot be read: the API starts without the playground and says why. */
  readonly module: PlaygroundModule | null;
  readonly routes: readonly Routes[];
}

export async function wirePlayground(
  shared: Shared,
  deps: {
    readonly llm: AppLlm;
    readonly persona: PersonaModule;
    readonly activePersona: ActivePersonaSource;
    /** Her bio as the poll last read it (ADR 0154 § 7): her version played reads it as her real fans' drafts do. */
    readonly connectors: ConnectorsModule;
    /** The persona file and the training folder, from the repository root (`composition-root.ts`). */
    readonly personaPath: string;
    readonly trainingDir: string;
    /** The worker serves no HTTP, so it starts no playground (its sessions live in the API's memory). */
    readonly enabled: boolean;
  },
): Promise<WiredPlayground> {
  const { logger, requireRole } = shared;
  const module = !deps.enabled
    ? null
    : await startPlaygroundModule({
        ...deps.llm.deps,
        gateway: deps.llm.gateway,
        // The ratings belong to the only creator there is; with several, the screen will have to choose.
        creatorId: async () => {
          const creators = await deps.persona.creators.list('all');
          return creators.length === 1 ? (creators[0]?.id ?? null) : null;
        },
        personaPath: deps.personaPath,
        trainingDir: deps.trainingDir,
        activePersona: deps.activePersona,
        personaVersion: (creatorId, versionId) => deps.persona.versions.version(creatorId, versionId),
        profileBioOf: (creatorId) => deps.connectors.profileBioOf(CreatorIdSchema.parse(creatorId)),
        desireMarks: createDbDesireMarkStore(shared.db),
      }).catch((error: unknown) => {
        logger.warn({ err: error }, 'playground not started: persona unreadable');
        return null;
      });
  return { module, routes: module === null ? [] : [module.routes({ guard: requireRole('owner') })] };
}
