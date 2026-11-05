import type {
  ContentDropFileId,
  ContentDrop,
  ContentRequest,
  CreateContentDropBody,
  CreateContentRequestBody,
  CreatorContent,
  DropCategory,
  DropFileState,
  DropMediaKind,
  DropMime,
  DropState,
} from '@impera/contracts';

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

/** A file and its drop, as the one who sends its bytes sees them. */
export interface DropFileTarget {
  readonly creatorId: string;
  readonly dropId: string;
  readonly fileId: ContentDropFileId;
  readonly mime: DropMime;
  readonly bytes: number;
  readonly fileState: DropFileState;
  readonly dropState: DropState;
}

/** A file cleaned, ready to enter her library: its storage key is named by its fingerprint. */
interface CleanedMedia {
  readonly kind: DropMediaKind;
  readonly mime: DropMime;
  readonly bytes: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly durationMs: number | null;
}

/** What becomes of a file: received (raw, whole), refused with its sentence, or kept once cleaned. */
export type FileOutcome =
  | { readonly state: 'received' }
  | { readonly state: 'refused'; readonly refusal: string }
  | { readonly state: 'kept'; readonly media: CleanedMedia };

/** What the receipt job finds of a file and writes of it (`withAdmin`). */
export interface ReceiptStore {
  /** The file, its drop and the drop's category; `null` when it is not there. */
  pending(fileId: string): Promise<(DropFileTarget & { readonly category: DropCategory }) | null>;
  /** The medium of her library with this fingerprint, `null` when she has none. */
  knownMedia(creatorId: string, sha256: string): Promise<string | null>;
  /**
   * The file moved on, in one transaction, the drop locked first; a file already past the state it moves from is
   * left as it is. Received only from `awaiting`; refused from `awaiting` or `received`; kept from `received`, as a new
   * medium of her library or as a duplicate of the one with its fingerprint. The drop follows: received with
   * `content_drop_received` when none of its files waits for its bytes any more, then ready when every file is
   * settled and one was kept, blocked when all were refused.
   */
  settle(fileId: string, outcome: FileOutcome, now: Date, correlationId: string): Promise<void>;
}

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
  /** The object at `key` written to the local file `path`; `false` when there is none. */
  download(key: string, path: string): Promise<boolean>;
  /** The local file `path` written at `key`, signed with its fingerprint, in parts when it is large. */
  upload(key: string, path: string, mime: DropMime, sha256: string): Promise<void>;
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
  ask(creatorId: string, userId: string, body: CreateContentRequestBody): Promise<ContentRequest>;
  cancel(creatorId: string, userId: string, requestId: string, now: Date): Promise<void>;
  fileTarget(creatorId: string, userId: string, dropId: string, fileId: string): Promise<DropFileTarget>;
  markSent(
    creatorId: string,
    userId: string,
    dropId: string,
    fileId: string,
    correlationId: string,
  ): Promise<ContentDrop>;
}

/** A file as the cleaning leaves it (`FileCleaner`): the size it shows at, its length, the streams it holds. */
export interface CleanedFile {
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
  clean(raw: string, out: string, family: FileFamily, mime: DropMime): Promise<CleanedFile>;
}
