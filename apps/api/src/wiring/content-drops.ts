import { JOB_PAYLOADS } from '@impera/contracts';

import { mediaBucket } from '../config';
import { defineTask } from '../jobs';
import { createContentDropsModule, type ContentDropsModule } from '../modules/content-drops';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredContentDrops {
  readonly module: ContentDropsModule;
  readonly tasks: TasksOf<'content_drops'>;
  readonly routes: readonly Routes[];
}

/** Her drops and the agency's requests (CR-06), their files sent to the media bucket (`S3_*`) and received by a job. */
export function wireContentDrops(shared: Shared): WiredContentDrops {
  const module = createContentDropsModule({
    db: shared.db,
    adminDb: shared.adminDb,
    bucket: mediaBucket(shared.config),
    requireRole: shared.requireRole,
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
    },
    routes: [module.routes],
  };
}
