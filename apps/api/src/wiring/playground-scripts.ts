import { CreatorIdSchema } from '@impera/contracts';

import type { HerCatalogue, HerScriptsSource, PlaygroundScript, ShownMedia } from '../modules/playground';
import type { ScriptsModule } from '../modules/scripts';

import { agentScriptViewOf } from './agent-scripts';

/** One of her native scripts as the agency reads it (`scripts.reads.platformScripts`). */
type HerScript = NonNullable<Awaited<ReturnType<ScriptsModule['reads']['platformScripts']>>>[number];
type HerStepMedia = HerScript['steps'][number]['media'][number];

const shownOf = (media: HerStepMedia): ShownMedia => ({
  ref: media.ref,
  kind: media.kind,
  description: media.description?.detailed ?? null,
});

/**
 * Her scripts for the playground (ADR 0103 § 15): the ones production would offer, through the agent's own filter
 * (`agentScriptViewOf`: proposable, identity validated, no step with branches), each with what its steps send on the
 * platform. Read as the trainer reads them (the owner, under her RLS), never as the service role: nothing is written.
 * A fan's catalogue is the scripts of one account; with scripts ready on several, the playground plays none.
 */
export function playgroundCatalogueOf(scripts: readonly HerScript[]): HerCatalogue {
  if (scripts.length === 0) return { kind: 'none', reason: 'no_script' };
  const ready = scripts.flatMap((script) => {
    const view = agentScriptViewOf(script);
    return view === null ? [] : [{ script, view }];
  });
  if (ready.length === 0) return { kind: 'none', reason: 'none_ready' };
  if (new Set(ready.map(({ script }) => script.platformAccountId)).size > 1)
    return { kind: 'none', reason: 'several_accounts' };
  return {
    kind: 'ready',
    scripts: ready.map(({ script, view }): PlaygroundScript => ({
      view,
      name: script.name,
      steps: script.steps.map((step) => ({
        text: step.text,
        media: step.media.map(shownOf),
        teaser: step.previewMedia.map(shownOf),
      })),
    })),
  };
}

export function createPlaygroundScripts(
  scripts: Pick<ScriptsModule['reads'], 'platformScripts'>,
): HerScriptsSource {
  return async (creatorId, trainer) => {
    // Read with the trainer's own rights: the owner, or an active manager for the creators of his list (ADR 0092 § 8).
    const read = await scripts.platformScripts(CreatorIdSchema.parse(creatorId), {
      userId: trainer.userId,
      role: trainer.role,
    });
    return read === null ? { kind: 'none', reason: 'unreadable' } : playgroundCatalogueOf(read);
  };
}
