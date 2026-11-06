import type {
  ContentDrop,
  ContentDropFileId,
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
  ScriptMoment,
  ScriptSegment,
  ScriptSlot,
  ScriptVariantLetter,
  SlotLengths,
  StartScriptDropBody,
} from '@impera/contracts';

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

/** Her script drop and the frozen version it shoots. */
export interface StartedScript {
  readonly drop: ContentDrop;
  readonly versionId: string;
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
  /** A card of a frozen version, its SVG; `null` for a segment or series it does not have. */
  card(versionId: string, segmentKey: string, variant: ScriptVariantLetter | null): Promise<string | null>;
  /** The same card as the folder's PNG (SC-03): what goes at `00` of its series. */
  folderCard(
    versionId: string,
    segmentKey: string,
    variant: ScriptVariantLetter | null,
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
   * stopped early closes the connection.
   */
  read(key: string): Promise<AsyncIterable<Uint8Array> | null>;
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
}

/** A sent script's facts for its archive (SC-03 c). */
export interface SentScript {
  readonly scriptNumber: number;
  readonly versionId: string;
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
