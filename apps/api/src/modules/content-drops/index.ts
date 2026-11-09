/** Public entry point of the `content-drops` module (CR-06, ADR 0044, ADR 0055). Other modules import this file only. */
import { tmpdir } from 'node:os';

import type { Database } from '@impera/db';
import type { LlmGateway } from '@impera/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { describeBacklog } from './application/backlog';
import { describeFile, type DescribeOutcome } from './application/describe';
import { eraseOriginals, type RetentionRun } from './application/retention';
import { summarizeScript, type SummarizeOutcome } from './application/summarize';
import { makeThumbnail, type ThumbnailOutcome } from './application/thumbnail';
import { NO_STORAGE, receiveFile } from './application/uploads';
import type {
  AskedScript,
  DropDescriber,
  DropStorage,
  IdeaContentRequest,
  ScriptContentRequest,
  ScriptVersions,
} from './domain/ports';
import { createFileCleaner } from './infra/cleaning/cleaner';
import { createScratchRoom } from './infra/cleaning/room';
import { createThumbnailer } from './infra/cleaning/thumbnail';
import { createDrizzleDescribeSwitch, createDrizzleDescriptionBacklog } from './infra/db/description-backlog';
import { createDrizzleDescriptionQueue } from './infra/db/description-queue';
import { createDrizzleDescriptionReview } from './infra/db/description-review-store';
import { createDrizzleRetentionStore } from './infra/db/retention-store';
import { createDrizzleScriptDropStore } from './infra/db/script-drop-store';
import { createDrizzleScriptSummaryStore } from './infra/db/script-summary-store';
import {
  createDrizzleAgencyContentStore,
  createDrizzleCreatorContentStore,
  createDrizzleReceiptStore,
  lastScriptRequest,
  lastScriptRequestFor,
  requestFromIdea,
  requestScript,
} from './infra/db/store';
import { createDrizzleThumbnailQueue } from './infra/db/thumbnail-queue';
import { createContentDropRoutes, type RequireRole } from './infra/http/routes';
import { createGatewayScriptSummarizer } from './infra/script-summarizer';
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
    /**
     * `content_drops.describe_file` (ADR 0083): a photo or a video she dropped, described by the vision AI with what
     * the drop says of it, kept for the agency to validate. What happened, for the log.
     */
    describeFile(mediaAssetId: string, correlationId: string): Promise<DescribeOutcome>;
    /**
     * `content_drops.summarize_script` (ADR 0083 § 6): a script she sent, once each of its media is described, told
     * step by step and summed up by the brain, kept for the agency to validate. What happened, for the log.
     */
    summarizeScript(dropId: string, correlationId: string): Promise<SummarizeOutcome>;
    /**
     * `content_drops.describe_backlog` (ADR 0083 § 2, § 9): each hour, and for one creator when her switch is turned
     * on, what waits for the vision or the brain enqueued again. Counts, for the log.
     */
    describeBacklog(
      creatorId: string | null,
      correlationId: string,
    ): Promise<{ readonly media: number; readonly scripts: number }>;
    /**
     * `content_drops.make_thumbnail` (ADR 0030 § 4, SC-04 lot c4): a photo or a video of her library gets its reduced
     * picture for the agency's screen. What happened, for the log.
     */
    makeThumbnail(mediaAssetId: string, correlationId: string): Promise<ThumbnailOutcome>;
    /** `content_drops.thumbnail_backlog`, each hour: the media never tried enqueued. How many. */
    thumbnailBacklog(correlationId: string): Promise<number>;
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
  /** The media module's description of her dropped media (ADR 0083); without it, nothing is described. */
  readonly describer?: DropDescriber;
  /** The brain that tells her sent scripts (ADR 0083 § 6); without it, or without the describer, nothing is told. */
  readonly brain?: Pick<LlmGateway, 'summarizeScript' | 'promptHashes'>;
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
  const summaries = createDrizzleScriptSummaryStore(deps.adminDb);
  const thumbnails = createDrizzleThumbnailQueue(deps.adminDb);
  return {
    name: 'content-drops',
    routes: createContentDropRoutes(
      createDrizzleCreatorContentStore(deps.db),
      createDrizzleAgencyContentStore(deps.db),
      storage,
      { store: createDrizzleScriptDropStore(deps.db, deps.adminDb), versions: deps.scriptVersions },
      createDrizzleDescribeSwitch(deps.adminDb),
      createDrizzleDescriptionReview(deps.db),
      deps.requireRole,
      clock,
    ),
    jobs: {
      receiveFile: (fileId, correlationId) => receiveFile(receipt, fileId, clock(), correlationId),
      convertFile: (fileId, correlationId) =>
        receiveFile(receipt, fileId, clock(), correlationId, 'content_drops.convert_file'),
      describeFile: async (mediaAssetId, correlationId) =>
        deps.describer === undefined
          ? 'off'
          : describeFile(
              {
                storage,
                queue: createDrizzleDescriptionQueue(deps.adminDb),
                describer: deps.describer,
                summaries,
                versions: deps.scriptVersions,
                scratchDir,
                room: receipt.room,
              },
              mediaAssetId,
              clock(),
              correlationId,
            ),
      summarizeScript: async (dropId, correlationId) =>
        deps.describer === undefined || deps.brain === undefined
          ? 'off'
          : summarizeScript(
              {
                store: summaries,
                describer: deps.describer,
                summarizer: createGatewayScriptSummarizer(deps.brain),
                versions: deps.scriptVersions,
              },
              dropId,
              clock(),
              correlationId,
            ),
      describeBacklog: async (creatorId, correlationId) =>
        deps.describer === undefined || deps.brain === undefined
          ? { media: 0, scripts: 0 }
          : describeBacklog(
              {
                backlog: createDrizzleDescriptionBacklog(deps.adminDb),
                describer: deps.describer,
                summarizer: createGatewayScriptSummarizer(deps.brain),
              },
              creatorId,
              correlationId,
            ),
      makeThumbnail: (mediaAssetId, correlationId) =>
        makeThumbnail(
          { storage, queue: thumbnails, thumbnailer: createThumbnailer(), scratchDir, room: receipt.room },
          mediaAssetId,
          clock(),
          correlationId,
        ),
      thumbnailBacklog: (correlationId) => thumbnails.backlog(correlationId),
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
