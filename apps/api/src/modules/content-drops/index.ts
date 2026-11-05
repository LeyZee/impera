/** Public entry point of the `content-drops` module (CR-06, ADR 0044, ADR 0055). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { NO_STORAGE, receiveFile } from './application/uploads';
import type { DropStorage, IdeaContentRequest } from './domain/ports';
import {
  createDrizzleAgencyContentStore,
  createDrizzleCreatorContentStore,
  createDrizzleReceiptStore,
  requestFromIdea,
} from './infra/db/store';
import { createContentDropRoutes, type RequireRole } from './infra/http/routes';
import { createS3DropStorage, type MediaBucketConfig } from './infra/storage/s3';

export interface ContentDropsModule {
  readonly name: 'content-drops';
  /** Mounted under `/v1` by the server: her `/creator-space/content` and its writes, the agency's `/creators/:creatorId/…`. */
  readonly routes: FastifyPluginAsyncZod;
  readonly jobs: {
    /** `content_drops.receive_file`: her file whole in the storage, received (CR-06 b). */
    receiveFile(fileId: string, correlationId: string): Promise<void>;
  };
  /**
   * The content request of a shoot she accepted from an idea (VEI-01 d2), written by the trend watch's job: origin
   * `idea`, under the idea's id, replayable.
   */
  requestFromIdea(request: IdeaContentRequest): Promise<void>;
}

export type { IdeaContentRequest } from './domain/ports';

export interface ContentDropsDeps {
  /** Application role: her own account's RLS, or the team's. */
  readonly db: Database;
  /** Owner role: the jobs, which move a drop's states. */
  readonly adminDb: Database;
  /** The media bucket (`S3_*`); `null` when unset: every send answers 503 `content_drop_storage_unavailable`. */
  readonly bucket: MediaBucketConfig | null;
  readonly requireRole: RequireRole;
  /** Tests only: another storage than the bucket's (a fake, or a bucket reached another way). */
  readonly storage?: DropStorage;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createContentDropsModule(deps: ContentDropsDeps): ContentDropsModule {
  const storage = deps.storage ?? (deps.bucket === null ? NO_STORAGE : createS3DropStorage(deps.bucket));
  const receipts = createDrizzleReceiptStore(deps.adminDb);
  const clock = deps.clock ?? (() => new Date());
  return {
    name: 'content-drops',
    routes: createContentDropRoutes(
      createDrizzleCreatorContentStore(deps.db),
      createDrizzleAgencyContentStore(deps.db),
      storage,
      deps.requireRole,
      clock,
    ),
    jobs: {
      receiveFile: (fileId, correlationId) => receiveFile(storage, receipts, fileId, clock(), correlationId),
    },
    requestFromIdea: (request) => requestFromIdea(deps.adminDb, request),
  };
}
