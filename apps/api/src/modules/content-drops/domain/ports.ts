import type {
  ContentDrop,
  DropDescriptionsReview,
  ContentDropFileId,
  ShotMoment,
  ContentRequest,
  CreateContentDropBody,
  CreateContentRequestBody,
  CreatorContent,
  DropCategory,
  DropFileState,
  DropMediaKind,
  DropMime,
  DropState,
  FillScriptSlotBody,
  HandIntensity,
  ScriptDropSummary,
  ScriptMoment,
  ScriptSegment,
  ScriptSummaryReviewReason,
  ScriptSlot,
  ScriptVariantLetter,
  SlotLengths,
  StartScriptDropBody,
} from '@impera/contracts';

import type { DropMediaContext } from './describe';
import type { SentDrop } from './drop-export';
import type { ExportedFile } from './script-export';
import type { FileFamily } from './sniff';
import type { StoredPart } from './upload';

/**
 * Her content, read and written in her own account (`withCreatorAccount`): every method takes her account, never her
 * creator, which the server reads in it. Each refusal throws its `DomainError` (`errors.ts`).
 */
export interface CreatorContentStore {
  content(userId: string): Promise<CreatorContent>;
  drop(userId: string, body: CreateContentDropBody): Promise<ContentDrop>;
  withdraw(userId: string, dropId: string, now: Date): Promise<void>;
  refuse(userId: string, requestId: string, reason: string | null, now: Date): Promise<void>;
  /** A file of her drop, to send its bytes; `ContentDropNotFound` or `ContentDropFileNotFound` otherwise. */
  fileTarget(userId: string, dropId: string, fileId: string): Promise<DropFileTarget>;
  /**
   * Her file's bytes are whole in the storage: the receipt is enqueued in the same transaction (one per file, kept
   * once), and the drop answered as it is. A file already past `awaiting` answers the same.
   */
  markSent(userId: string, dropId: string, fileId: string, correlationId: string): Promise<ContentDrop>;
}

/** Her script drop, the frozen version it shoots and the moment its request fixed (`null` before SC-03 c2). */
export interface StartedScript {
  readonly drop: ContentDrop;
  readonly versionId: string;
  readonly moment: ShotMoment | null;
}

/**
 * Her script filled slot by slot (SC-02 lot b, ADR 0056 § 4), in her own account. Each refusal throws its
 * `DomainError`; a drop that is not a script, or a request without a frozen version, `ContentDropScriptUnprocessable`.
 */
export interface ScriptDropStore {
  /** Begun empty (`filling`) from her open script request; replayed under its id, the drop as it is. */
  start(userId: string, body: StartScriptDropBody): Promise<StartedScript>;
  read(userId: string, dropId: string): Promise<StartedScript>;
  /**
   * The file she chose for `slot`, declared before it goes up; the slot's file before it, if any, replaced (it keeps
   * its row, out of her script). The same file again answers the drop as it is.
   */
  fill(
    userId: string,
    dropId: string,
    slot: ScriptSlot,
    file: FillScriptSlotBody,
    now: Date,
  ): Promise<ContentDrop>;
  /**
   * « Envoyer le script »: refused with `ContentDropSlotsUnprocessable` while a slot of `slots` she may not leave out is
   * empty or refused; then the drop goes on as one sent at once. Replayed, the drop as it is.
   */
  submit(
    userId: string,
    dropId: string,
    slots: readonly ScriptSlot[],
    now: Date,
    correlationId: string,
  ): Promise<ContentDrop>;
}

/** The library's versions (`scripts`, wired by the composition root). */
export interface ScriptVersions {
  /** A frozen version, as her script shows it; `null` for one that does not exist or is not frozen. */
  frozen(versionId: string): Promise<{
    readonly name: string;
    readonly moment: ScriptMoment;
    readonly segments: readonly ScriptSegment[];
  } | null>;
  /**
   * A card of a frozen version, its SVG; `null` for a segment or series it does not have. It says `moment`, the one
   * her request fixed (recette MED-05); `null`, a script asked before SC-03 c2, keeps the structure's.
   */
  card(
    versionId: string,
    segmentKey: string,
    variant: ScriptVariantLetter | null,
    moment: ShotMoment | null,
  ): Promise<string | null>;
  /** The same card as the folder's PNG (SC-03): what goes at `00` of its series. */
  folderCard(
    versionId: string,
    segmentKey: string,
    variant: ScriptVariantLetter | null,
    moment: ShotMoment | null,
  ): Promise<Uint8Array | null>;
  /**
   * The latest version of a structure frozen for a request the agency asks by hand, by the one who asks; `null` for a
   * structure unknown, archived, or out of reach of that account.
   */
  freeze(structureId: string, userId: string): Promise<string | null>;
}

/** A file and its drop, as the one who sends its bytes sees them. */
export interface DropFileTarget {
  readonly creatorId: string;
  readonly dropId: string;
  readonly fileId: ContentDropFileId;
  readonly mime: DropMime;
  readonly bytes: number;
  readonly fileState: DropFileState;
  readonly dropState: DropState;
  /** Its video or vocal slot's lengths (SC-02 lot b), checked on the cleaned file; `null` outside such a slot. */
  readonly lengths: SlotLengths | null;
}

/** A file cleaned, ready to enter her library: its storage key is named by its fingerprint. */
interface CleanedMedia {
  readonly kind: DropMediaKind;
  readonly mime: DropMime;
  readonly bytes: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly durationMs: number | null;
  /**
   * Whether this receipt wrote the bytes under `storageKey`: it skips them when she already holds the medium. A
   * medium erased meanwhile is held again only by bytes written (relecture Bilan de #525).
   */
  readonly uploaded: boolean;
}

/** What becomes of a file: received (raw, whole), refused with its sentence, or kept once cleaned. */
export type FileOutcome =
  | { readonly state: 'received' }
  | { readonly state: 'refused'; readonly refusal: string }
  | { readonly state: 'kept'; readonly media: CleanedMedia };

/**
 * A content request asked by an idea of the trend watch (VEI-01 d2): the shoot she accepted in her agenda. Its id is
 * the idea's, its reason the idea's title (80 characters at most), due on the day of her shoot. Never a script: a
 * script is asked with a structure of the library, which only the team's own request checks.
 */
export interface IdeaContentRequest {
  readonly id: string;
  readonly creatorId: string;
  readonly category: Exclude<DropCategory, 'script'>;
  readonly dueOn: string;
  readonly reason: string;
}

/** A script the cadence asks of her (SC-02): the structure and the version frozen for it, due on her day. */
export interface ScriptContentRequest {
  readonly creatorId: string;
  readonly dueOn: string;
  readonly reason: string;
  readonly structureId: string;
  readonly structureVersionId: string;
}

/** Her last script asked by the cadence: its due day, its structure, when it was asked. */
export interface AskedScript {
  readonly dueOn: string;
  readonly structureId: string;
  readonly askedAt: Date;
}

/** What the receipt job finds of a file and writes of it (`withAdmin`). */
export interface ReceiptStore {
  /** The file, its drop and the drop's category; `null` when it is not there. */
  pending(fileId: string): Promise<(DropFileTarget & { readonly category: DropCategory }) | null>;
  /** The medium of her library with this fingerprint whose original is held, `null` when none (or erased, CR-06 c). */
  knownMedia(creatorId: string, sha256: string): Promise<string | null>;
  /**
   * The file moved on, in one transaction, the drop locked first; a file already past the state it moves from is
   * left as it is. Received only from `awaiting`; refused from `awaiting` or `received`; kept from `received`, as a new
   * medium of her library or as a duplicate of the one with its fingerprint. The drop follows: received with
   * `content_drop_received` when none of its files waits for its bytes any more, then ready when every file is
   * settled and one was kept, blocked when all were refused.
   */
  settle(fileId: string, outcome: FileOutcome, now: Date, correlationId: string): Promise<void>;
  /**
   * The file's job enqueued (ADR 0070 § 4), keyed by the task and the file: `content_drops.convert_file` in the queue
   * `content_drops:convert`, where conversions pass one at a time, or either job again at `runAt` when the machine is
   * short of disk. Enqueued from the running job, it is a new job: Graphile frees the key of a locked one.
   */
  enqueue(
    task: ReceiptTask,
    file: { readonly creatorId: string; readonly fileId: string },
    correlationId: string,
    runAt: Date | null,
  ): Promise<void>;
}

/**
 * The room on the worker's disk (ADR 0070 § 4): a job takes what it needs before it downloads, and gives it back once
 * its folder is erased, so that jobs running side by side never count the same free bytes twice.
 */
export interface ScratchRoom {
  /** `bytes` taken, and how to give them back; `null` when the disk has not that much free beyond what is taken. */
  take(bytes: number): Promise<(() => void) | null>;
}

/** The two jobs that receive a file: the receipt itself, and the conversion it hands a video over to. */
export type ReceiptTask = 'content_drops.receive_file' | 'content_drops.convert_file';

/**
 * The media storage, S3-compatible (CR-06 b): a file goes up in parts, straight from her phone, each under its own
 * signed address. Every failure to reach it throws `ContentDropStorageUnavailable`.
 */
export interface DropStorage {
  /** The upload in progress for `key`, the oldest when there are several; `null` when there is none. */
  openUpload(key: string): Promise<string | null>;
  startUpload(key: string, mime: DropMime): Promise<string>;
  storedParts(key: string, uploadId: string): Promise<StoredPart[]>;
  /** A PUT address for part `number`, signed for exactly `bytes` bytes and `DROP_PART_URL_SECONDS`. */
  partUrl(key: string, uploadId: string, number: number, bytes: number): Promise<string>;
  /** `refused` when the storage does not take these parts (one missing or replaced, an unknown upload). */
  completeUpload(
    key: string,
    uploadId: string,
    parts: readonly { readonly number: number; readonly etag: string }[],
  ): Promise<'completed' | 'refused'>;
  /** The size of the object at `key`, `null` when there is none. */
  sizeOf(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
  /**
   * The object at `key`, of `bytes` bytes, written to the local file `path`; `false` when there is none. Its time
   * limit grows with its size (ADR 0070 § 4).
   */
  download(key: string, path: string, bytes: number): Promise<boolean>;
  /**
   * The object at `key`, read as it comes, for an archive the response pulls (SC-03); `null` when there is none. A cut
   * stream, or a storage silent for 30 s while a chunk is awaited, throws `ContentDropStorageUnavailable`; the reader
   * stopped early closes the connection. With `range`, only its bytes, both ends included (a video played from the
   * screen, SC-04 lot c4).
   */
  read(
    key: string,
    range?: { readonly start: number; readonly end: number },
  ): Promise<AsyncIterable<Uint8Array> | null>;
  /** The local file `path` written at `key`, signed with its fingerprint, in parts when it is large. */
  upload(key: string, path: string, mime: DropMime, sha256: string): Promise<void>;
}

/** An original she dropped that leaves the storage now: at its date (`due`), or with every drop it came in by withdrawn. */
export interface DueOriginal {
  readonly mediaAssetId: string;
  readonly creatorId: string;
  readonly storageKey: string;
  readonly reason: 'due' | 'withdrawn';
  /** The day (UTC) it was kept until. */
  readonly erasedOn: string;
}

/**
 * What `content_drops.erase_originals` reads and writes (`withAdmin`, CR-06 c). An original is one a drop kept: a file
 * of hers in the `kept` state names it. Each notice is said once per medium and date (a unique index of 0113).
 */
export interface RetentionStore {
  /** The files still waiting for their bytes in a drop that began sending before `before`. */
  abandonedFiles(before: Date): Promise<string[]>;
  /** `content_media_expiring` for each original still held that goes before `until` and after `now`; how many. */
  announce(now: Date, until: Date, correlationId: string): Promise<number>;
  /** The originals still held that go now, by date or because each drop they came in by was withdrawn. */
  dueOriginals(now: Date): Promise<DueOriginal[]>;
  /**
   * The original erased by `remove`, then marked with `content_media_erased`, under the medium's row lock that a
   * receipt also takes (relecture Bilan de #525): checked again under it, an original given again meanwhile, or
   * already marked, is left as it is (`false`). A `remove` that throws leaves it held and unmarked.
   */
  erase(
    original: DueOriginal,
    now: Date,
    correlationId: string,
    remove: (key: string) => Promise<void>,
  ): Promise<boolean>;
  /** `content_media_erase_failed`, once per medium and date: the next run tries again. */
  eraseFailed(original: DueOriginal, now: Date, correlationId: string): Promise<void>;
  /** The reduced pictures still held of each creator archived before `archivedBefore` (ADR 0089). */
  dueThumbnails(archivedBefore: Date): Promise<DueThumbnail[]>;
  /**
   * The reduced picture erased by `remove`, then its key emptied, under the medium's row lock: checked again under it,
   * one whose creator was reopened meanwhile, or already emptied, is left as it is (`false`). A `remove` that throws
   * leaves it held.
   */
  eraseThumbnail(
    thumbnail: DueThumbnail,
    archivedBefore: Date,
    remove: (key: string) => Promise<void>,
  ): Promise<boolean>;
  /** One audit line for a creator whose reduced pictures went this run: how many, never a key (ADR 0089 § 5). */
  thumbnailsErased(creatorId: string, count: number): Promise<void>;
}

/** A reduced picture of an archived creator's medium that leaves the storage now (ADR 0089). */
export interface DueThumbnail {
  readonly mediaAssetId: string;
  readonly creatorId: string;
  readonly thumbnailKey: string;
}

/** The agency's side (`withTenantMember`): the owner and an active manager; a chatter is refused before any read. */
export interface AgencyContentStore {
  content(creatorId: string, userId: string): Promise<CreatorContent>;
  drop(creatorId: string, userId: string, body: CreateContentDropBody): Promise<ContentDrop>;
  correct(
    creatorId: string,
    userId: string,
    dropId: string,
    category: DropCategory,
    now: Date,
  ): Promise<ContentDrop>;
  withdraw(creatorId: string, userId: string, dropId: string, now: Date): Promise<void>;
  /**
   * A script names a frozen version of its structure (SC-02 lot b): `freeze` gives it, once the structure is checked
   * usable for her and before the request is written; `null` refuses it like a structure out of reach.
   */
  ask(
    creatorId: string,
    userId: string,
    body: CreateContentRequestBody,
    freeze: (structureId: string) => Promise<string | null>,
    now: Date,
  ): Promise<ContentRequest>;
  cancel(creatorId: string, userId: string, requestId: string, now: Date): Promise<void>;
  fileTarget(creatorId: string, userId: string, dropId: string, fileId: string): Promise<DropFileTarget>;
  markSent(
    creatorId: string,
    userId: string,
    dropId: string,
    fileId: string,
    correlationId: string,
  ): Promise<ContentDrop>;
  /**
   * A sent script as its archive reads it (SC-03 c): its number, its frozen version, and each live file of a slot with
   * its kept medium. Refused (`ContentDropExportUnprocessable`) for a drop that is not a numbered script, one not
   * `ready`, `scheduled` or `published` yet, or one whose original is already erased.
   */
  sentScript(creatorId: string, userId: string, dropId: string): Promise<SentScript>;
  /**
   * The team says it copied her sent script into Reveal from its archive (SC-03 c, ADR 0056 § 7): said once (replayed,
   * the drop as it is), with its audit line; each original the script alone kept now goes 30 days later (ADR 0044 § 2),
   * never later than it already went. Refused like `sentScript`.
   */
  confirmExport(creatorId: string, userId: string, dropId: string, now: Date): Promise<ContentDrop>;
  /**
   * Any other drop of hers as its archive reads it (recette créatrice 1): its category, her word, her day, each live kept
   * file in her order. Refused (`ContentDropExportUnprocessable`) for a script, a drop not `ready`, `scheduled` or
   * `published` yet, or one whose original is already erased.
   */
  sentDrop(creatorId: string, userId: string, dropId: string): Promise<SentDrop>;
  /**
   * The team says it put her drop out by hand (ADR 0044: published by hand until the connector does): said once, with
   * its audit line; her originals of it go 30 days later (ADR 0044 § 2). Refused like `sentDrop`.
   */
  confirmDropExport(creatorId: string, userId: string, dropId: string, now: Date): Promise<ContentDrop>;
}

/** A sent script's facts for its archive (SC-03 c). */
export interface SentScript {
  readonly scriptNumber: number;
  readonly versionId: string;
  /** The moment its request fixed (« ok alternance »); `null` for a script asked before SC-03 c. */
  readonly moment: ShotMoment | null;
  readonly files: readonly ExportedFile[];
}

/**
 * A file as the cleaning leaves it (`FileCleaner`): its type (a video moved to MP4 or converted is `video/mp4`), the
 * size it shows at, its length, the streams it holds.
 */
export interface CleanedFile {
  readonly mime: DropMime;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
}

/**
 * Its metadata removed (ADR 0055 § 3), from the raw file at `raw` into `out`, by the family its bytes are of. Throws
 * `UnreadableFile` when the file cannot be followed: it is refused rather than kept half cleaned.
 */
export interface FileCleaner {
  /**
   * Whether this video must be converted (ADR 0070 § 3): neither H.264 nor HEVC. `false` for a photo or a vocal.
   * Throws `UnreadableFile` when the file cannot be read.
   */
  needsConversion(raw: string, family: FileFamily, mime: DropMime): Promise<boolean>;
  clean(raw: string, out: string, family: FileFamily, mime: DropMime): Promise<CleanedFile>;
}

/**
 * A media of her library to describe (ADR 0083 § 1): the medium, and the first live file of a drop that kept it,
 * which gives the context. `null` from the store when no live drop holds it any more (refused, withdrawn, replaced).
 */
export interface MediaToDescribe {
  readonly creatorId: string;
  readonly kind: 'image' | 'video' | 'audio';
  readonly mime: string;
  readonly bytes: number;
  readonly storageKey: string;
  /** Its original left the storage (CR-06 c): nothing to read. */
  readonly erased: boolean;
  /** Her switch (`CreatorSettings.describeDrops`, ADR 0083 § 9): off, her drops wait undescribed. */
  readonly describes: boolean;
  readonly category: DropCategory;
  /** For a script's slot: its key and the frozen version she shot. */
  readonly script: { readonly slotKey: string; readonly versionId: string } | null;
}

/** `content_drops.describe_file`'s reads and its next run, as the owner role. */
export interface DescriptionQueue {
  target(mediaAssetId: string): Promise<MediaToDescribe | null>;
  /** The job again at `runAt` (budget spent, disk short), keyed by the medium: a new job, never twice. */
  later(creatorId: string, mediaAssetId: string, correlationId: string, runAt: Date): Promise<void>;
  /** One more try of the vision AI failed on this medium: its count of failures, this one included. */
  failed(mediaAssetId: string): Promise<number>;
}

/** The media module's description of a dropped media, seen from here (ADR 0083). */
export interface DropDescriber {
  /** The version of the describing prompt now (ADR 0083 § 2): a medium described with another is described again. */
  readonly promptHash: string;
  /** Whether the medium needs no new description: a human's, or the vision AI's with the prompt of now. */
  described(mediaAssetId: string): Promise<boolean>;
  /** The latest detailed description of each of these media that has one, by medium, with its row (ADR 0083 § 2). */
  detailed(
    mediaAssetIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly descriptionId: string; readonly detailed: string }>>;
  /**
   * Described and kept, or why not: `budget`, the day's cap spent, asked again later; `failed`, every model failed;
   * `unreadable`, the file did not open.
   */
  describe(file: {
    readonly creatorId: string;
    readonly mediaAssetId: string;
    readonly path: string;
    readonly mime: string;
    readonly kind: 'image' | 'video';
    readonly bytes: number;
    readonly context: DropMediaContext;
  }): Promise<'described' | 'budget' | 'failed' | 'unreadable'>;
}

/** A sent script to be told step by step (ADR 0083 § 6), as the owner role reads it. */
export interface ScriptToSummarize {
  readonly creatorId: string;
  /** Her switch (`CreatorSettings.describeDrops`, § 9): off, her script waits untold. */
  readonly describes: boolean;
  readonly versionId: string;
  /** The moment her request fixed; `null`, the structure's own. */
  readonly moment: ShotMoment | null;
  /** Its live slots' files: a refused one is left out, one still in the cleaning has no medium yet. */
  readonly files: readonly {
    readonly slotKey: string;
    readonly mediaAssetId: string | null;
    readonly kind: DropMediaKind;
    readonly durationS: number | null;
  }[];
}

/** What a script's synthesis keeps (`script_drop_summaries`), written once per set of media and prompt. */
export interface SummarizedScript {
  readonly mediaHash: string;
  readonly content: ScriptDropSummary;
  readonly reviewReasons: readonly ScriptSummaryReviewReason[];
  readonly model: string;
  readonly promptHash: string;
}

/** `content_drops.summarize_script`'s reads, writes and next runs, as the owner role. */
export interface ScriptSummaryStore {
  /** `null` for a drop that is not a script, is withdrawn, or is still being filled. */
  target(dropId: string): Promise<ScriptToSummarize | null>;
  /** Whether this set of media and descriptions of the script was already told with this version of the prompt. */
  summarized(dropId: string, mediaHash: string, promptHash: string): Promise<boolean>;
  save(creatorId: string, dropId: string, summary: SummarizedScript): Promise<void>;
  /** The job again at `runAt` (budget spent), keyed by the drop. */
  later(creatorId: string, dropId: string, correlationId: string, runAt: Date): Promise<void>;
  /** The job for each sent script holding this medium in a live slot, now; how many. */
  enqueueFor(mediaAssetId: string, correlationId: string): Promise<number>;
}

/** The brain that tells a script (ADR 0083 § 6), seen from here: never a price, from the cards and descriptions. */
export interface ScriptSummarizer {
  /** The version of the prompt it tells with now: a script told with another is told again. */
  readonly promptHash: string;
  summarize(input: {
    readonly creatorId: string;
    readonly scriptName: string;
    readonly moment: ShotMoment | null;
    readonly steps: readonly {
      readonly step: string;
      readonly code: string;
      readonly name: string;
      readonly card: string | null;
      readonly media: readonly {
        readonly kind: DropMediaKind;
        readonly durationS: number | null;
        readonly description: string | null;
      }[];
    }[];
  }): Promise<
    | {
        readonly kind: 'summarized';
        readonly summary: ScriptDropSummary;
        readonly model: string;
        readonly promptHash: string;
      }
    | { readonly kind: 'budget' }
    | { readonly kind: 'failed' }
  >;
}

/**
 * What waits for the vision or the brain, enqueued again (ADR 0083 § 2, § 6, § 9): for each creator whose switch is on
 * (or the one named), each medium of a live drop with no description of now, each sent script with no synthesis of now
 * or older than a description of its media. A job already waiting keeps its time (a spent budget's hour).
 */
export interface DescriptionBacklog {
  enqueue(
    creatorId: string | null,
    prompts: { readonly describe: string; readonly summarize: string },
    correlationId: string,
  ): Promise<{ readonly media: number; readonly scripts: number }>;
}

/** Her switch (`CreatorSettings.describeDrops`, ADR 0083 § 9), read and set by the owner. */
export interface DescribeSwitch {
  /** `null` for a creator that does not exist. */
  read(creatorId: string): Promise<boolean | null>;
  /**
   * Set and audited; turned on, the backlog of this creator is enqueued in the same transaction (her drops described
   * while it was off). `null` for a creator that does not exist.
   */
  set(creatorId: string, on: boolean, userId: string): Promise<boolean | null>;
}

/**
 * The agency's review of a drop's descriptions and of a script's synthesis (ADR 0030 § 3, ADR 0083 § 7), as the owner
 * or an active manager (`withTenantMember`; a chatter is refused). Every write is stamped with the account that makes
 * it and audited; each answers the drop's review as it now stands.
 */
export interface DescriptionReview {
  read(creatorId: string, userId: string, dropId: string): Promise<DropDescriptionsReview>;
  /** These rows validated as they are; a row already validated stays as it was. */
  validate(
    creatorId: string,
    userId: string,
    dropId: string,
    descriptionIds: readonly string[],
    now: Date,
    correlationId: string,
  ): Promise<DropDescriptionsReview>;
  /** A new row from this one, its `detailed` rewritten, validated by whoever writes it; the script told again. */
  correct(
    creatorId: string,
    userId: string,
    dropId: string,
    descriptionId: string,
    detailed: string,
    now: Date,
    correlationId: string,
  ): Promise<DropDescriptionsReview>;
  /**
   * The vision AI asked again on a medium it failed at each try (recette créatrice 2): its count of failures set back
   * to nothing and its job enqueued now. A medium described, or not given up, is left as it is (replayable).
   */
  retryDescription(
    creatorId: string,
    userId: string,
    dropId: string,
    fileId: string,
    correlationId: string,
  ): Promise<DropDescriptionsReview>;
  /**
   * A medium with no description written by hand (recette créatrice 2): its words and its level, the other labels « not
   * seen », validated by whoever writes it; the vision no longer asks it, the script is told again. A medium described
   * meanwhile is refused (`not_shown`), an audio note is not described.
   */
  writeDescription(
    creatorId: string,
    userId: string,
    dropId: string,
    fileId: string,
    written: { readonly detailed: string; readonly intensity: HandIntensity },
    now: Date,
    correlationId: string,
  ): Promise<DropDescriptionsReview>;
  /**
   * The script's current synthesis rewritten by hand (SC-04 lot c5): a new row, its steps the shown one's in their
   * order, validated by whoever writes it; a sum or a currency refused.
   */
  correctSummary(
    creatorId: string,
    userId: string,
    dropId: string,
    summaryId: string,
    content: ScriptDropSummary,
    now: Date,
  ): Promise<DropDescriptionsReview>;
  /** The script's current synthesis validated as it is. */
  validateSummary(
    creatorId: string,
    userId: string,
    dropId: string,
    summaryId: string,
    now: Date,
  ): Promise<DropDescriptionsReview>;
  /**
   * A live file of the drop and where its medium's bytes are (SC-04 lot c4): its original while it is held, its reduced
   * picture once made; `null` when the drop or the file is not a live one of hers. A chatter is refused.
   */
  file(creatorId: string, userId: string, dropId: string, fileId: string): Promise<ReviewedFile | null>;
  /** Who opened which medium, once per opening (SC-04 lot c4): an intimate file seen by the agency leaves a trace. */
  opened(creatorId: string, userId: string, file: ReviewedFile, correlationId: string): Promise<void>;
}

export interface ReviewedFile {
  readonly fileId: string;
  readonly mediaAssetId: string;
  readonly kind: 'image' | 'video' | 'audio';
  readonly mime: string;
  readonly bytes: number;
  /** `null` once the original left the storage (ADR 0044 § 2). */
  readonly originalKey: string | null;
  readonly thumbnailKey: string | null;
}

/** A medium of her library whose reduced picture is to be made, as `content_drops.make_thumbnail` reads it. */
export interface MediaToThumbnail {
  readonly creatorId: string;
  readonly kind: 'image' | 'video' | 'audio';
  readonly bytes: number;
  readonly storageKey: string;
  readonly sha256: string;
  readonly erased: boolean;
  /** Tried already, made or not: never twice. */
  readonly tried: boolean;
}

/** `content_drops.make_thumbnail`'s reads and writes, and the hourly backlog, as the owner role (SC-04 lot c4). */
export interface ThumbnailQueue {
  target(mediaAssetId: string): Promise<MediaToThumbnail | null>;
  /** Tried: its picture's key, or `null` when the file did not give one. Once: a medium already tried stays. */
  settle(mediaAssetId: string, thumbnailKey: string | null, now: Date): Promise<void>;
  /** The job again at `runAt` (disk short), keyed by the medium. */
  later(creatorId: string, mediaAssetId: string, correlationId: string, runAt: Date): Promise<void>;
  /** Each photo and video of a live drop never tried, its original held, enqueued; how many. */
  backlog(correlationId: string): Promise<number>;
}

/** A reduced JPEG of a photo or a video on disk (ffmpeg); `false` when the file gives none (a format it cannot read). */
export interface Thumbnailer {
  make(path: string, kind: 'image' | 'video', out: string): Promise<boolean>;
}
