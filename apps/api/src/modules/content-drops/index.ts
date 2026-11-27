/** Public entry point of the `content-drops` module (CR-06, ADR 0044, ADR 0055). Other modules import this file only. */
import { tmpdir } from 'node:os';

import type { Database } from '@impera/db';
import type { LlmGateway } from '@impera/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { describeBacklog } from './application/backlog';
import { describeFile, type DescribeOutcome } from './application/describe';
import {
  creatorDrops,
  creatorScripts,
  creatorScriptSteps,
  type ContentReader,
  type DropsPage,
  type ScriptDigest,
  type ScriptSteps,
} from './application/reads';
import { eraseOriginals, type RetentionRun } from './application/retention';
import { summarizeScript, type SummarizeOutcome } from './application/summarize';
import { makeThumbnail, pictureOf, type PictureAsk, type ThumbnailOutcome } from './application/thumbnail';
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
import { dropsOfMedium, mediaOfDrop, type DropOfMedium } from './infra/db/described-drops';
import { createDrizzleDescriptionBacklog } from './infra/db/description-backlog';
import { createDrizzleDescriptionQueue } from './infra/db/description-queue';
import {
  createDrizzleCreatorDescriptionReview,
  createDrizzleDescriptionReview,
} from './infra/db/description-review-store';
import { createDrizzleReservedMedia, type ReservedMediaStore } from './infra/db/reserved-media';
import { createDrizzleRetentionStore } from './infra/db/retention-store';
import { createDrizzleScriptDropStore } from './infra/db/script-drop-store';
import { createDrizzleScriptSummaryStore } from './infra/db/script-summary-store';
import { createDrizzleStockStore } from './infra/db/stock-store';
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
import { createStockRoutes } from './infra/http/stock-routes';
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
    describeFile(creatorId: string, mediaAssetId: string, correlationId: string): Promise<DescribeOutcome>;
    /**
     * `content_drops.summarize_script` (ADR 0083 § 6): a script she sent, once each of its media is described, told
     * step by step and summed up by the brain, kept for the agency to validate. What happened, for the log.
     */
    summarizeScript(creatorId: string, dropId: string, correlationId: string): Promise<SummarizeOutcome>;
    /**
     * `content_drops.describe_backlog` (ADR 0083 § 2): each hour, what of her drops waits for the vision or the brain
     * enqueued again. Counts, for the log.
     */
    describeBacklog(
      creatorId: string | null,
      correlationId: string,
    ): Promise<{ readonly media: number; readonly scripts: number }>;
    /**
     * `content_drops.make_thumbnail` (ADR 0030 § 4, SC-04 lot c4): a photo or a video of her library gets its reduced
     * picture for the agency's screen. What happened, for the log.
     */
    makeThumbnail(creatorId: string, mediaAssetId: string, correlationId: string): Promise<ThumbnailOutcome>;
    /** `content_drops.thumbnail_backlog`, each hour: the media never tried enqueued. How many. */
    thumbnailBacklog(correlationId: string): Promise<number>;
  };
  /**
   * The reduced picture of a file another module read and never kept (a vault media, ADR 0113 § 1), made and stored as
   * a dropped medium's (ADR 0030 § 4): its `thumbnail_key`, or `null` when ffmpeg cannot read it. A storage that does
   * not answer throws.
   */
  picture(ask: PictureAsk): Promise<string | null>;
  /**
   * The live drops of hers that hold a medium, with its latest description (ADR 0164 § 9): what a listener of
   * `onDescribed` reads. Empty while the medium has no description, or when nothing describes.
   */
  describedDrops(creatorId: string, mediaAssetId: string): Promise<readonly DescribedDrop[]>;
  /**
   * One live drop of hers with the latest description of a medium it holds (ADR 0164 § 9, « D'autres idées »); `null`
   * when the drop is not hers, no longer live, or holds no described medium.
   */
  describedDrop(creatorId: string, dropId: string): Promise<DescribedDrop | null>;
  /** That picture removed when no media came to carry it (ADR 0113 § 1); nothing when no storage is set. */
  unpicture(key: string): Promise<void>;
  /**
   * The content request of a shoot she accepted from an idea (VEI-01 d2), written by the trend watch's job: origin
   * `idea`, under the idea's id, replayable.
   */
  requestFromIdea(request: IdeaContentRequest): Promise<void>;
  /**
   * The agency's reads of her content, bounded by her id, who reads checked in `application/` (ADR 0026 § 1): what the
   * MCP server lists (ADR 0105 § 4, `drops_list`, `scripts_list`, `script_steps_get`). Never a medium nor its address.
   */
  readonly reads: {
    /** Her drops, newest first, 50 at most a page; `after` is the last id of the page before. */
    drops(
      creatorId: string,
      reader: ContentReader,
      page: { readonly after: string | null; readonly limit?: number },
    ): Promise<DropsPage>;
    /** Her scripts asked and dropped, newest first, with their structure's name and size. */
    scripts(creatorId: string, reader: ContentReader): Promise<readonly ScriptDigest[]>;
    /** The steps of a script of hers, the agency's words; `null` for a drop that is not a script of hers. */
    scriptSteps(creatorId: string, reader: ContentReader, dropId: string): Promise<ScriptSteps | null>;
  };
  /**
   * What the AI sends from her coffre (ADR 0163 § 7), for the agent: a voice or a whale gift not sent to this fan yet,
   * and the send noted once the platform confirmed it (replayable). Never a medium's key nor its address.
   */
  readonly reserved: ReservedMediaStore;
  /** The scripts the cadence asks of her (SC-02), written by the scripts' job as the owner's role, replayable. */
  readonly scriptRequests: {
    ask(request: ScriptContentRequest): Promise<void>;
    last(creatorId: string): Promise<AskedScript | null>;
    /** The same for a member of her team, under row-level security: `null` for anyone outside it. */
    lastFor(creatorId: string, userId: string): Promise<AskedScript | null>;
  };
}

/** A live drop and what the vision AI saw in its medium. */
interface DescribedDrop extends DropOfMedium {
  readonly description: string;
}

export type { DropStorage, IdeaContentRequest, ScriptVersions } from './domain/ports';
/** @public Her drops and requests as the creator's game counts them (ADR 0107), for the composition root. */
export { dropsForGameUnscoped, type DropsForGame } from './infra/db/game-reads';
/** @public Her stock, her open scripts and what of her delivery arrived (ADR 0140 § 4 and § 25), for the week's job and reads. */
export { weekArrivals, weekStockUnscoped, type WeekStockFacts } from './infra/db/week-reads';

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
  /**
   * Told each time a medium of hers is described, again on a replay (ADR 0164 § 9). Wired by the composition root;
   * this module knows nothing of who listens. The listener stays short and replayable: it enqueues, and never calls
   * a model here.
   */
  readonly onDescribed?: (creatorId: string, mediaAssetId: string, correlationId: string) => Promise<void>;
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
  const summaries = createDrizzleScriptSummaryStore(deps.db);
  const thumbnails = createDrizzleThumbnailQueue(deps.db, deps.adminDb);
  const agency = createDrizzleAgencyContentStore(deps.db);
  const scriptReads = { store: agency, versions: deps.scriptVersions };
  return {
    name: 'content-drops',
    routes: async (app) => {
      await app.register(
        createContentDropRoutes(
          createDrizzleCreatorContentStore(deps.db),
          agency,
          storage,
          { store: createDrizzleScriptDropStore(deps.db, deps.adminDb), versions: deps.scriptVersions },
          createDrizzleDescriptionReview(deps.db),
          deps.requireRole,
          clock,
        ),
      );
      // Coffre Impera (ADR 0163): her stock by use, and her own review of her media.
      await app.register(
        createStockRoutes(
          createDrizzleStockStore(deps.db),
          createDrizzleCreatorDescriptionReview(deps.db),
          storage,
          deps.requireRole,
          clock,
        ),
      );
    },
    jobs: {
      receiveFile: (fileId, correlationId) => receiveFile(receipt, fileId, clock(), correlationId),
      convertFile: (fileId, correlationId) =>
        receiveFile(receipt, fileId, clock(), correlationId, 'content_drops.convert_file'),
      describeFile: async (creatorId, mediaAssetId, correlationId) =>
        deps.describer === undefined
          ? 'off'
          : describeFile(
              {
                storage,
                queue: createDrizzleDescriptionQueue(deps.db),
                describer: deps.describer,
                summaries,
                ...(deps.onDescribed !== undefined && { onDescribed: deps.onDescribed }),
                versions: deps.scriptVersions,
                scratchDir,
                room: receipt.room,
              },
              creatorId,
              mediaAssetId,
              clock(),
              correlationId,
            ),
      summarizeScript: async (creatorId, dropId, correlationId) =>
        deps.describer === undefined || deps.brain === undefined
          ? 'off'
          : summarizeScript(
              {
                store: summaries,
                describer: deps.describer,
                summarizer: createGatewayScriptSummarizer(deps.brain),
                versions: deps.scriptVersions,
              },
              creatorId,
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
      makeThumbnail: (creatorId, mediaAssetId, correlationId) =>
        makeThumbnail(
          { storage, queue: thumbnails, thumbnailer: createThumbnailer(), scratchDir, room: receipt.room },
          creatorId,
          mediaAssetId,
          clock(),
          correlationId,
        ),
      thumbnailBacklog: (correlationId) => thumbnails.backlog(correlationId),
      eraseOriginals: (correlationId) =>
        eraseOriginals(
          { storage, receipts, retention: createDrizzleRetentionStore(deps.adminDb, deps.db) },
          clock(),
          correlationId,
        ),
    },
    reads: {
      drops: (creatorId, reader, page) => creatorDrops(agency, reader, creatorId, page),
      scripts: (creatorId, reader) => creatorScripts(scriptReads, reader, creatorId),
      scriptSteps: (creatorId, reader, dropId) => creatorScriptSteps(scriptReads, reader, creatorId, dropId),
    },
    // No storage set (`S3_*` unset, as on a PC without one): the vault's media are kept described, without a picture.
    picture: (ask) =>
      pictureOf(
        { storage: storage === NO_STORAGE ? null : storage, thumbnailer: createThumbnailer(), scratchDir },
        ask,
      ),
    describedDrops: async (creatorId, mediaAssetId) => {
      const description = (await deps.describer?.detailed([mediaAssetId]))?.get(mediaAssetId);
      if (description === undefined) return [];
      const drops = await dropsOfMedium(deps.db, creatorId, mediaAssetId);
      return drops.map((drop) => ({ ...drop, description: description.detailed }));
    },
    describedDrop: async (creatorId, dropId) => {
      const held = await mediaOfDrop(deps.db, creatorId, dropId);
      if (held.length === 0 || deps.describer === undefined) return null;
      const descriptions = await deps.describer.detailed(held.map((one) => one.mediaAssetId));
      for (const { mediaAssetId, ...drop } of held) {
        const description = descriptions.get(mediaAssetId);
        if (description !== undefined) return { ...drop, description: description.detailed };
      }
      return null;
    },
    unpicture: (key) => (storage === NO_STORAGE ? Promise.resolve() : storage.remove(key)),
    requestFromIdea: (request) => requestFromIdea(deps.adminDb, request),
    reserved: createDrizzleReservedMedia(deps.db),
    scriptRequests: {
      ask: (request) => requestScript(deps.adminDb, request),
      last: (creatorId) => lastScriptRequest(deps.adminDb, creatorId),
      lastFor: (creatorId, userId) => lastScriptRequestFor(deps.db, creatorId, userId),
    },
  };
}
