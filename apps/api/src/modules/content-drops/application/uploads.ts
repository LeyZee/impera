import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DROP_PART_BYTES,
  kindOfMime,
  probedFileRefusal,
  slotDurationRefusal,
  type DropFileUpload,
} from '@impera/contracts';

import {
  ContentDropFileSettled,
  ContentDropStorageUnavailable,
  ContentDropUploadUnprocessable,
  UnreadableFile,
} from '../domain/errors';
import type {
  CleanedFile,
  DropFileTarget,
  DropStorage,
  FileCleaner,
  ReceiptStore,
  ReceiptTask,
  ScratchRoom,
} from '../domain/ports';
import { holds, sniff } from '../domain/sniff';
import { completionRefusal, partsSplit, rawKeyOf } from '../domain/upload';

/** Said when the bytes in the storage are not the size her phone declared: the raw file is erased, she sends again. */
const WRONG_SIZE = 'Le fichier reçu n’a pas la taille annoncée : relance l’envoi';

/** A file whose bytes need not go up again: already whole, or past `awaiting`. */
const sent = (target: DropFileTarget): DropFileUpload => ({
  fileId: target.fileId,
  sent: true,
  partBytes: DROP_PART_BYTES,
  missing: [],
  stored: [],
});

/** Only a file still waiting, in a drop still sending or being filled, takes bytes; a file already past that answers « sent ». */
function takesBytes(target: DropFileTarget): boolean {
  if (target.dropState === 'withdrawn') throw new ContentDropFileSettled();
  if (target.fileState !== 'awaiting') return false;
  // A script she is still filling takes each slot's file as she chooses it (SC-02 lot b).
  if (target.dropState !== 'uploading' && target.dropState !== 'filling') throw new ContentDropFileSettled();
  return true;
}

/**
 * Where her phone sends the file (CR-06 b): the upload in progress if there is one, so that a send cut in the middle
 * resumes, otherwise a new one; each part still missing with its signed address, each one held with its `etag`.
 */
export async function uploadOf(storage: DropStorage, target: DropFileTarget): Promise<DropFileUpload> {
  if (!takesBytes(target)) return sent(target);
  const key = rawKeyOf(target.creatorId, target.fileId);
  // Completed, but the phone did not hear it: nothing left to send.
  if ((await storage.sizeOf(key)) !== null) return sent(target);
  const uploadId = (await storage.openUpload(key)) ?? (await storage.startUpload(key, target.mime));
  const { missing, kept } = partsSplit(target.bytes, await storage.storedParts(key, uploadId));
  return {
    fileId: target.fileId,
    sent: false,
    partBytes: DROP_PART_BYTES,
    missing: await Promise.all(
      missing.map(async (part) => ({
        number: part.number,
        bytes: part.bytes,
        url: await storage.partUrl(key, uploadId, part.number, part.bytes),
      })),
    ),
    stored: kept.map((part) => ({ number: part.number, etag: part.etag })),
  };
}

/**
 * Every part sent: the storage assembles the file, its size is checked against her phone's word, and only then is it
 * hers to mark sent. A replay after the assembly finds the file whole and checks it again. `false` when the file had
 * already left `awaiting`: nothing was done.
 */
export async function finishUpload(
  storage: DropStorage,
  target: DropFileTarget,
  parts: readonly { readonly number: number; readonly etag: string }[],
): Promise<boolean> {
  if (!takesBytes(target)) return false;
  const refusal = completionRefusal(target.bytes, parts);
  if (refusal !== null) throw new ContentDropUploadUnprocessable(refusal);
  const key = rawKeyOf(target.creatorId, target.fileId);
  let size = await storage.sizeOf(key);
  if (size === null) {
    const uploadId = await storage.openUpload(key);
    if (uploadId === null)
      throw new ContentDropUploadUnprocessable('Cet envoi n’existe plus : relance-le depuis le début');
    if ((await storage.completeUpload(key, uploadId, parts)) === 'refused')
      throw new ContentDropUploadUnprocessable('Une partie du fichier n’est pas arrivée : relance l’envoi');
    size = await storage.sizeOf(key);
    if (size === null) throw new ContentDropStorageUnavailable(`${key}: assembled but not found`);
  }
  if (size !== target.bytes) {
    await storage.remove(key);
    throw new ContentDropUploadUnprocessable(WRONG_SIZE);
  }
  return true;
}

/** Said when the bytes are not of the type declared (a renamed file), or cannot be read at all. */
const NOT_WHAT_IT_SAYS = 'Ce fichier n’est pas ce qu’il annonce : renvoie-le depuis ta galerie';
const UNREADABLE = 'Ce fichier ne se lit pas : renvoie-le depuis ta galerie';
const UNREADABLE_VIDEO = 'Ce fichier n’est pas une vidéo qu’on sait lire : exporte-la en MP4';
/** Said when the raw file is gone before its cleaning (24 hours, the storage's rule). */
const GONE = 'Ce fichier n’est pas arrivé à temps : renvoie-le';

/** Where a cleaned medium lives: named by her creator and its fingerprint, so that a replayed job writes it again. */
const mediaKeyOf = (creatorId: string, sha256: string): string => `media/${creatorId}/${sha256}`;

async function sha256Of(path: string): Promise<{ readonly sha256: string; readonly bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    if (!(chunk instanceof Buffer)) throw new Error('a file read as text');
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

async function headOf(path: string): Promise<Uint8Array> {
  const file = await open(path, 'r');
  try {
    const head = new Uint8Array(32);
    const { bytesRead } = await file.read(head, 0, 32, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/**
 * The room the job needs in its folder before it starts (ADR 0070 § 4): the raw file, its cleaned copy, and a margin
 * for a conversion that comes out heavier.
 */
const ROOM_FACTOR = 2.5;
/** A machine short of disk takes the file again this much later, until there is room or the raw file is gone. */
const SHORT_OF_DISK_DELAY_MS = 15 * 60_000;

export interface ReceiptDeps {
  readonly storage: DropStorage;
  readonly receipts: ReceiptStore;
  readonly cleaner: FileCleaner;
  /** Where the job writes the raw and the cleaned file, each in its own folder erased after. */
  readonly scratchDir: string;
  /** The room on the disk of `scratchDir`, taken before the download. */
  readonly room: ScratchRoom;
}

/**
 * `content_drops.receive_file`: her file whole in the storage is received (its size checked against her phone's
 * word), then cleaned (ADR 0055 § 3): its bytes read for what they are, its metadata removed, its format checked on
 * the cleaned file (`probedFileRefusal`), its fingerprint taken on the cleaned bytes. It becomes a medium of her
 * library, or a duplicate of the one she already gave; the raw file is erased either way. A drop withdrawn meanwhile
 * has its raw file erased at once. Replayable: each step starts from the file's state, a medium is written under its
 * fingerprint. A storage or an ffmpeg that does not answer throws, and the job retries.
 *
 * A video neither in H.264 nor in HEVC is handed over to `content_drops.convert_file` (ADR 0070 § 3), which runs this
 * same receipt in the queue where conversions pass one at a time: the receipt never waits for it. Either job checks
 * the room on disk first, and comes back later when there is not enough (ADR 0070 § 4).
 */
export async function receiveFile(
  deps: ReceiptDeps,
  fileId: string,
  now: Date,
  correlationId: string,
  task: ReceiptTask = 'content_drops.receive_file',
): Promise<void> {
  const { storage, receipts } = deps;
  const target = await receipts.pending(fileId);
  if (target === null) return;
  const key = rawKeyOf(target.creatorId, target.fileId);
  if (target.dropState === 'withdrawn') {
    await storage.remove(key);
    return;
  }
  const refuse = async (refusal: string): Promise<void> => {
    await receipts.settle(fileId, { state: 'refused', refusal }, now, correlationId);
    await storage.remove(key);
  };
  if (target.fileState === 'awaiting') {
    const size = await storage.sizeOf(key);
    if (size === null) throw new ContentDropStorageUnavailable(`${key}: marked sent, not in the storage`);
    if (size !== target.bytes) return refuse(WRONG_SIZE);
    await receipts.settle(fileId, { state: 'received' }, now, correlationId);
  } else if (target.fileState !== 'received') {
    return;
  }

  const release = await deps.room.take(Math.ceil(ROOM_FACTOR * target.bytes));
  if (release === null) {
    if ((await storage.sizeOf(key)) === null) return refuse(GONE);
    await receipts.enqueue(task, target, correlationId, new Date(now.getTime() + SHORT_OF_DISK_DELAY_MS));
    return;
  }
  const kind = kindOfMime(target.mime);
  const unreadable = kind === 'video' ? UNREADABLE_VIDEO : UNREADABLE;
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(deps.scratchDir, 'impera-drop-'));
    const raw = join(dir, 'raw');
    const out = join(dir, 'clean');
    if (!(await storage.download(key, raw, target.bytes))) {
      await refuse(GONE);
      return;
    }
    const family = sniff(await headOf(raw));
    if (family === null || !holds(target.mime, family)) {
      await refuse(NOT_WHAT_IT_SAYS);
      return;
    }
    let cleaned: CleanedFile;
    try {
      if (
        task === 'content_drops.receive_file' &&
        (await deps.cleaner.needsConversion(raw, family, target.mime))
      ) {
        await receipts.enqueue('content_drops.convert_file', target, correlationId, null);
        return;
      }
      cleaned = await deps.cleaner.clean(raw, out, family, target.mime);
    } catch (error) {
      if (error instanceof UnreadableFile) {
        await refuse(unreadable);
        return;
      }
      throw error;
    }
    if ((kind === 'video' && !cleaned.hasVideo) || (kind === 'audio' && !cleaned.hasAudio)) {
      await refuse(NOT_WHAT_IT_SAYS);
      return;
    }
    const refusal =
      probedFileRefusal(target.category, {
        kind,
        width: cleaned.width,
        height: cleaned.height,
        durationMs: cleaned.durationMs,
      }) ?? slotDurationRefusal(target.lengths, cleaned.durationMs);
    if (refusal !== null) {
      await refuse(refusal);
      return;
    }
    const { sha256, bytes } = await sha256Of(out);
    const storageKey = mediaKeyOf(target.creatorId, sha256);
    // A medium she already holds is not written again: the file becomes its duplicate. Erased, it is written again.
    const uploaded = (await receipts.knownMedia(target.creatorId, sha256)) === null;
    if (uploaded) await storage.upload(storageKey, out, cleaned.mime, sha256);
    await receipts.settle(
      fileId,
      {
        state: 'kept',
        media: {
          kind,
          mime: cleaned.mime,
          bytes,
          sha256,
          storageKey,
          durationMs: cleaned.durationMs,
          uploaded,
        },
      },
      now,
      correlationId,
    );
    await storage.remove(key);
  } finally {
    if (dir !== null) await rm(dir, { recursive: true, force: true });
    release();
  }
}

/** The storage when `S3_*` is not set: every send answers 503, and nothing is kept in memory in its place. */
export const NO_STORAGE: DropStorage = {
  openUpload: unconfigured,
  startUpload: unconfigured,
  storedParts: unconfigured,
  partUrl: unconfigured,
  completeUpload: unconfigured,
  sizeOf: unconfigured,
  remove: unconfigured,
  download: unconfigured,
  upload: unconfigured,
};

function unconfigured(): Promise<never> {
  return Promise.reject(new ContentDropStorageUnavailable('S3_* is not set: no media storage'));
}
