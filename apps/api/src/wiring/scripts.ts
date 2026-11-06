import { JOB_PAYLOADS, ScriptStructureIdSchema } from '@impera/contracts';

import { defineTask } from '../jobs';
import type { ContentDropsModule } from '../modules/content-drops';
import type { PersonaModule } from '../modules/persona';
import { createScriptsModule, type ScriptsModule } from '../modules/scripts';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredScripts {
  readonly module: ScriptsModule;
  readonly tasks: TasksOf<'scripts'>;
  readonly routes: readonly Routes[];
}

/**
 * After the persona and her content: a structure is checked against her active persona's limits (ADR 0056 § 1), and
 * the script the cadence asks of her is a content request (SC-02, ADR 0056 § 2).
 */
export function wireScripts(
  shared: Shared,
  deps: {
    readonly persona: PersonaModule;
    readonly contentDrops: ContentDropsModule;
    readonly cardFontsDir: string;
    /** Tests only: another clock than the server's. */
    readonly now?: () => Date;
  },
): WiredScripts {
  const module = createScriptsModule({
    db: shared.db,
    adminDb: shared.adminDb,
    requireRole: shared.requireRole,
    cardFontsDir: deps.cardFontsDir,
    limitsOf: async (creatorId) => (await deps.persona.versions.active(creatorId))?.persona.limits ?? null,
    requests: {
      ask: (request) => deps.contentDrops.scriptRequests.ask(request),
      last: async (creatorId) => {
        const last = await deps.contentDrops.scriptRequests.last(creatorId);
        return last === null
          ? null
          : { ...last, structureId: ScriptStructureIdSchema.parse(last.structureId) };
      },
    },
  });
  const now = deps.now ?? (() => new Date());
  return {
    module,
    tasks: {
      'scripts.ask_scripts': defineTask(
        'scripts.ask_scripts',
        JOB_PAYLOADS['scripts.ask_scripts'],
        shared.logger,
        async (_payload, context) => {
          context.logger.info(await module.jobs.askScripts(now()), 'scripts: the scripts due asked');
        },
      ),
    },
    routes: [module.routes],
  };
}
