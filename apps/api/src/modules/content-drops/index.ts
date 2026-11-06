/** Public entry point of the `content-drops` module (CR-06, ADR 0044, ADR 0055). Other modules import this file only. */
import { tmpdir } from 'node:os';

import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { eraseOriginals, type RetentionRun } from './application/retention';
import { NO_STORAGE, receiveFile } from './application/uploads';
import type {
  AskedScript,
  DropStorage,
  IdeaContentRequest,
  ScriptContentRequest,
  ScriptVersions,
} from './domain/ports';
import { createFileCleaner } from './infra/cleaning/cleaner';
import { createScratchRoom } from './infra/cleaning/room';
import { createDrizzleRetentionStore } from './infra/db/retention-store';
import { createDrizzleScriptDropStore } from './infra/db/script-drop-store';
import {
  createDrizzleAgencyContentStore,
  createDrizzleCreatorContentStore,
  createDrizzleReceiptStore,
  lastScriptRequest,
  lastScriptRequestFor,
  requestFromIdea,
  requestScript,
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
    /** `content_drops.convert_file`: her video in a format the platforms do not read, converted (ADR 0070). */
    convertFile(fileId: string, correlationId: string): Promise<void>;
    /**
     * `content_drops.erase_originals`, each hour (CR-06 c): unfinished sends refused after 24 h, the agency told 7 days
     * before an original goes, the originals due erased. Counts only.
     */
    eraseOriginals(correlationId: string): Promise<RetentionRun>;
  };
  /**
   * The content request of a shoot she accepted from an idea (VEI-01 d2), written by the trend watch's job: origin
   * `idea`, under the idea's id, replayable.
   */
  requestFromIdea(request: IdeaContentRequest): Promise<void>;
  /** The scripts the cadence asks of her (SC-02), written by the scripts' job as the owner's role, replayable. */
  readonly scriptRequests: {
    ask(request: ScriptContentRequest): Promise<void>;
    last(creatorId: string): Promise<AskedScript | null>;
    /** The same for a member of her team, under row-level security: `null` for anyone outside it. */
    lastFor(creatorId: string, userId: string): Promise<AskedScript | null>;
  };
}

export type { DropStorage, IdeaContentRequest, ScriptVersions } from './domain/ports';

export interface ContentDropsDeps {
  /** Application role: her own account's RLS, or the team's. */
  readonly db: Database;
  /** Owner role: the jobs, which move a drop's states. */
  readonly adminDb: Database;
  /** The media bucket (`S3_*`); `null` when unset: every send answers 503 `content_drop_storage_unavailable`. */
  readonly bucket: MediaBucketConfig | null;
  readonly requireRole: RequireRole;
  /** The library's frozen versions (`scripts`, wired by the composition root): what her script drop shoots. */
  readonly scriptVersions: ScriptVersions;
  /** Tests only: another storage than the bucket's (a fake, or a bucket reached another way). */
  readonly storage?: DropStorage;
  /** Where the job writes a file while it cleans it; the system's temporary folder by default. */
  readonly scratchDir?: string;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createContentDropsModule(deps: ContentDropsDeps): ContentDropsModule {
  const storage = deps.storage ?? (deps.bucket === null ? NO_STORAGE : createS3DropStorage(deps.bucket));
  const receipts = createDrizzleReceiptStore(deps.adminDb);
  const cleaner = createFileCleaner();
  const clock = deps.clock ?? (() => new Date());
  const scratchDir = deps.scratchDir ?? tmpdir();
  const receipt = { storage, receipts, cleaner, scratchDir, room: createScratchRoom(scratchDir) };
  return {
    name: 'content-drops',
    routes: createContentDropRoutes(
      createDrizzleCreatorContentStore(deps.db),
      createDrizzleAgencyContentStore(deps.db),
      storage,
      { store: createDrizzleScriptDropStore(deps.db, deps.adminDb), versions: deps.scriptVersions },
      deps.requireRole,
      clock,
    ),
    jobs: {
      receiveFile: (fileId, correlationId) => receiveFile(receipt, fileId, clock(), correlationId),
      convertFile: (fileId, correlationId) =>
        receiveFile(receipt, fileId, clock(), correlationId, 'content_drops.convert_file'),
      eraseOriginals: (correlationId) =>
        eraseOriginals(
          { storage, receipts, retention: createDrizzleRetentionStore(deps.adminDb) },
          clock(),
          correlationId,
        ),
    },
    requestFromIdea: (request) => requestFromIdea(deps.adminDb, request),
    scriptRequests: {
      ask: (request) => requestScript(deps.adminDb, request),
      last: (creatorId) => lastScriptRequest(deps.adminDb, creatorId),
      lastFor: (creatorId, userId) => lastScriptRequestFor(deps.db, creatorId, userId),
    },
  };
}
