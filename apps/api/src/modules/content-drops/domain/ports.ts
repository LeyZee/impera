import type {
  ContentDropFileId,
  ContentDrop,
  ContentRequest,
  CreateContentDropBody,
  CreateContentRequestBody,
  CreatorContent,
  DropCategory,
  DropFileState,
  DropMime,
  DropState,
} from '@impera/contracts';

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

/** What the receipt job finds of a file (`withAdmin`): `null` when it is not there. */
export interface ReceiptStore {
  pending(fileId: string): Promise<DropFileTarget | null>;
  /**
   * The file received, or refused with its sentence, if it still waits; the drop received with it when no file of it
   * waits any more and it was still sending, with `content_drop_received`. One transaction, the drop locked first.
   */
  settle(
    fileId: string,
    outcome: { readonly state: 'received' } | { readonly state: 'refused'; readonly refusal: string },
    now: Date,
    /** The request that sent its last file, carried to `content_drop_received`. */
    correlationId: string,
  ): Promise<void>;
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
