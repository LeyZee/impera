import { JOB_PAYLOADS, ScriptStructureIdSchema, asPersonaV2 } from '@impera/contracts';

import { defineTask } from '../jobs';
import type { ContentDropsModule } from '../modules/content-drops';
import type { PersonaModule } from '../modules/persona';
import { createScriptsModule, type ScriptsModule } from '../modules/scripts';

import type { Routes, Shared, TasksOf } from './shared';

type AskedScriptRow = Awaited<ReturnType<ContentDropsModule['scriptRequests']['last']>>;

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
  const asked = (last: AskedScriptRow | null) =>
    last === null ? null : { ...last, structureId: ScriptStructureIdSchema.parse(last.structureId) };
  const module = createScriptsModule({
    db: shared.db,
    adminDb: shared.adminDb,
    requireRole: shared.requireRole,
    cardFontsDir: deps.cardFontsDir,
    limitsOf: async (creatorId) => {
      const active = await deps.persona.versions.active(creatorId);
      // Her strict rules, wherever the format keeps them (ADR 0079 § 4).
      return active === null ? null : asPersonaV2(active.persona).agent.rules;
    },
    requests: {
      ask: (request) => deps.contentDrops.scriptRequests.ask(request),
      last: async (creatorId) => asked(await deps.contentDrops.scriptRequests.last(creatorId)),
      lastFor: async (creatorId, userId) =>
        asked(await deps.contentDrops.scriptRequests.lastFor(creatorId, userId)),
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
          const run = await module.jobs.askScripts(now(), (creatorId, error) => {
            context.logger.warn({ err: error, creatorId }, 'scripts: a creator’s script could not be asked');
          });
          context.logger.info(run, 'scripts: the scripts due asked');
        },
      ),
      'scripts.import_platform_scripts': defineTask(
        'scripts.import_platform_scripts',
        JOB_PAYLOADS['scripts.import_platform_scripts'],
        shared.logger,
        async (payload, context) => {
          const run = await module.jobs.importPlatformScripts(payload, now());
          context.logger.info(
            { platformAccountId: payload.platformAccountId, ...run },
            'scripts: the native scripts imported',
          );
        },
      ),
    },
    routes: [module.routes],
  };
}
