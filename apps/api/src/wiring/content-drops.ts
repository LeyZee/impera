import { JOB_PAYLOADS } from '@impera/contracts';
import type { LlmGateway } from '@impera/llm';

import { mediaBucket } from '../config';
import { defineTask } from '../jobs';
import {
  createContentDropsModule,
  type ContentDropsModule,
  type DropStorage,
  type ScriptVersions,
} from '../modules/content-drops';
import { createDropDescriptions } from '../modules/media';

import type { Routes, Shared, TasksNamed } from './shared';

export interface WiredContentDrops {
  readonly module: ContentDropsModule;
  /** `content_drops.drop_received` is the trend watch's to handle (`wiring/trends.ts`, VEI-01 d3). */
  readonly tasks: TasksNamed<
    | 'content_drops.receive_file'
    | 'content_drops.convert_file'
    | 'content_drops.erase_originals'
    | 'content_drops.describe_file'
    | 'content_drops.summarize_script'
    | 'content_drops.describe_backlog'
  >;
  readonly routes: readonly Routes[];
}

/**
 * Her drops and the agency's requests (CR-06), their files sent to the media bucket (`S3_*`) and received by a job. Her
 * script drop reads the library's frozen versions (`scriptVersions`), wired after it by the composition root.
 */
export function wireContentDrops(
  shared: Shared,
  deps: {
    readonly scriptVersions: ScriptVersions;
    /** The vision AI that describes each photo and video she drops (ADR 0083). */
    readonly vision: Pick<LlmGateway, 'describeDrop' | 'transcribe' | 'promptHashes'>;
    /** The brain that tells each script she sends, from its cards and its media's descriptions (ADR 0083 § 6). */
    readonly brain: Pick<LlmGateway, 'summarizeScript' | 'promptHashes'>;
    readonly storage?: DropStorage;
  },
): WiredContentDrops {
  const module = createContentDropsModule({
    db: shared.db,
    adminDb: shared.adminDb,
    bucket: mediaBucket(shared.config),
    requireRole: shared.requireRole,
    scriptVersions: deps.scriptVersions,
    describer: createDropDescriptions({ adminDb: shared.adminDb, gateway: deps.vision }),
    brain: deps.brain,
    ...(deps.storage !== undefined && { storage: deps.storage }),
  });
  return {
    module,
    tasks: {
      'content_drops.receive_file': defineTask(
        'content_drops.receive_file',
        JOB_PAYLOADS['content_drops.receive_file'],
        shared.logger,
        (payload) => module.jobs.receiveFile(payload.fileId, payload.correlationId),
      ),
      'content_drops.convert_file': defineTask(
        'content_drops.convert_file',
        JOB_PAYLOADS['content_drops.convert_file'],
        shared.logger,
        (payload) => module.jobs.convertFile(payload.fileId, payload.correlationId),
      ),
      'content_drops.describe_file': defineTask(
        'content_drops.describe_file',
        JOB_PAYLOADS['content_drops.describe_file'],
        shared.logger,
        async (payload, context) => {
          const outcome = await module.jobs.describeFile(payload.mediaAssetId, payload.correlationId);
          context.logger.info(
            { mediaAssetId: payload.mediaAssetId, outcome },
            'content drops: dropped media described',
          );
        },
      ),
      'content_drops.summarize_script': defineTask(
        'content_drops.summarize_script',
        JOB_PAYLOADS['content_drops.summarize_script'],
        shared.logger,
        async (payload, context) => {
          const outcome = await module.jobs.summarizeScript(payload.dropId, payload.correlationId);
          context.logger.info({ dropId: payload.dropId, outcome }, 'content drops: sent script summarized');
        },
      ),
      'content_drops.describe_backlog': defineTask(
        'content_drops.describe_backlog',
        JOB_PAYLOADS['content_drops.describe_backlog'],
        shared.logger,
        async (payload, context) => {
          context.logger.info(
            await module.jobs.describeBacklog(payload.creatorId ?? null, `job:${context.jobId}`),
            'content drops: media and scripts waiting for a description enqueued again',
          );
        },
      ),
      'content_drops.erase_originals': defineTask(
        'content_drops.erase_originals',
        JOB_PAYLOADS['content_drops.erase_originals'],
        shared.logger,
        async (_payload, context) => {
          context.logger.info(
            await module.jobs.eraseOriginals(`job:${context.jobId}`),
            'content drops: unfinished sends refused, originals announced and erased',
          );
        },
      ),
    },
    routes: [module.routes],
  };
}
