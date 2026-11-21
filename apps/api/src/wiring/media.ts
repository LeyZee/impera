import { CreatorIdSchema, JOB_PAYLOADS, PlatformAccountIdSchema } from '@impera/contracts';
import type { LlmGateway } from '@impera/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { defineTask } from '../jobs';
import type { VaultFiles } from '../modules/connectors';
import type { ContentDropsModule } from '../modules/content-drops';
import {
  createDrizzleDescriptionReader,
  createDrizzleVaultChoiceStore,
  createMediaModule,
  createVaultChoiceRoutes,
  createVaultDescriptions,
  missingMediaBinaries,
  type MediaModule,
  type VaultDescriptions,
} from '../modules/media';

import type { Shared, TasksOf } from './shared';

export interface WiredMedia {
  readonly module: MediaModule;
  readonly descriptions: ReturnType<typeof createDrizzleDescriptionReader>;
}

export async function wireMedia(shared: Shared): Promise<WiredMedia> {
  // A fan's video needs ffmpeg and ffprobe: said at start-up, not on the first video.
  const missing = await missingMediaBinaries();
  if (missing.length > 0) {
    shared.logger.warn({ missing }, 'ffmpeg missing: fan videos and voice notes cannot be read');
  }
  return { module: createMediaModule(), descriptions: createDrizzleDescriptionReader(shared.db) };
}

export interface WiredVaultDescriptions {
  readonly vault: VaultDescriptions;
  readonly tasks: TasksOf<'media'>;
  /** The vault by choice (ADR 0145 § 5): its ticks, and the description of a selection after its cost was shown. */
  readonly routes: readonly FastifyPluginAsyncZod[];
}

/**
 * Her platform's vault described (ADR 0113): each file read by the connectors, described by the vision AI as her drops
 * are, reduced to its picture by the content drops, never kept. Wired once the three modules and the gateway exist.
 */
export function wireVaultDescriptions(
  shared: Shared,
  deps: {
    readonly vision: Pick<LlmGateway, 'describeDrop' | 'transcribe'>;
    readonly files: VaultFiles;
    readonly drops: Pick<ContentDropsModule, 'picture' | 'unpicture'>;
    /** Today's spend against the AI cap, as the gateway counts it (`health().budget`). */
    readonly budget: () => { readonly spentEur: number; readonly capEur: number };
  },
): WiredVaultDescriptions {
  const { adminDb, logger, requireRole } = shared;
  const vault = createVaultDescriptions({
    adminDb,
    gateway: deps.vision,
    read: (ask) =>
      deps.files.fetch(
        {
          ...ask,
          creatorId: CreatorIdSchema.parse(ask.creatorId),
          platformAccountId: PlatformAccountIdSchema.parse(ask.platformAccountId),
        },
        logger,
      ),
    picture: (ask) => deps.drops.picture(ask),
    unpicture: (key) => deps.drops.unpicture(key),
  });
  return {
    vault,
    routes: [
      createVaultChoiceRoutes(
        { store: createDrizzleVaultChoiceStore(shared.db), budget: deps.budget },
        { teamGuard: requireRole('owner', 'operator'), ownerGuard: requireRole('owner') },
      ),
    ],
    tasks: {
      'media.describe_vault': defineTask(
        'media.describe_vault',
        JOB_PAYLOADS['media.describe_vault'],
        logger,
        async (payload, context) => {
          context.logger.info(
            { platformAccountId: payload.platformAccountId, ...(await vault.run(payload)) },
            'media: a lot of the vault described',
          );
        },
      ),
    },
  };
}
