import { JOB_PAYLOADS } from '@impera/contracts';

import { mediaBucket } from '../config';
import { defineTask } from '../jobs';
import {
  createContentDropsModule,
  type ContentDropsModule,
  type DropStorage,
  type ScriptVersions,
} from '../modules/content-drops';

import type { Routes, Shared, TasksNamed } from './shared';

export interface WiredContentDrops {
  readonly module: ContentDropsModule;
  /** `content_drops.drop_received` is the trend watch's to handle (`wiring/trends.ts`, VEI-01 d3). */
  readonly tasks: TasksNamed<
    'content_drops.receive_file' | 'content_drops.convert_file' | 'content_drops.erase_originals'
  >;
  readonly routes: readonly Routes[];
}

/**
 * Her drops and the agency's requests (CR-06), their files sent to the media bucket (`S3_*`) and received by a job. Her
 * script drop reads the library's frozen versions (`scriptVersions`), wired after it by the composition root.
 */
export function wireContentDrops(
  shared: Shared,
  deps: { readonly scriptVersions: ScriptVersions; readonly storage?: DropStorage },
): WiredContentDrops {
  const module = createContentDropsModule({
    db: shared.db,
    adminDb: shared.adminDb,
    bucket: mediaBucket(shared.config),
    requireRole: shared.requireRole,
    scriptVersions: deps.scriptVersions,
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
