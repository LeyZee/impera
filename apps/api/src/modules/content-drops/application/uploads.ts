import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { DROP_PART_BYTES, kindOfMime, probedFileRefusal, type DropFileUpload } from '@impera/contracts';

import {
  ContentDropFileSettled,
  ContentDropStorageUnavailable,
  ContentDropUploadUnprocessable,
  UnreadableFile,
} from '../domain/errors';
import type { CleanedFile, DropFileTarget, DropStorage, FileCleaner, ReceiptStore } from '../domain/ports';
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

/** Only a file still waiting, in a drop still sending, takes bytes; a file already past that answers « sent ». */
function takesBytes(target: DropFileTarget): boolean {
  if (target.dropState === 'withdrawn') throw new ContentDropFileSettled();
  if (target.fileState !== 'awaiting') return false;
  if (target.dropState !== 'uploading') throw new ContentDropFileSettled();
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

export interface ReceiptDeps {
  readonly storage: DropStorage;
  readonly receipts: ReceiptStore;
  readonly cleaner: FileCleaner;
  /** Where the job writes the raw and the cleaned file, each in its own folder erased after. */
  readonly scratchDir: string;
}

/**
 * `content_drops.receive_file`: her file whole in the storage is received (its size checked against her phone's
 * word), then cleaned (ADR 0055 § 3): its bytes read for what they are, its metadata removed, its format checked on
 * the cleaned file (`probedFileRefusal`), its fingerprint taken on the cleaned bytes. It becomes a medium of her
 * library, or a duplicate of the one she already gave; the raw file is erased either way. A drop withdrawn meanwhile
 * has its raw file erased at once. Replayable: each step starts from the file's state, a medium is written under its
 * fingerprint. A storage or an ffmpeg that does not answer throws, and the job retries.
 */
export async function receiveFile(
  deps: ReceiptDeps,
  fileId: string,
  now: Date,
  correlationId: string,
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

  const dir = await mkdtemp(join(deps.scratchDir, 'impera-drop-'));
  try {
    const raw = join(dir, 'raw');
    const out = join(dir, 'clean');
    if (!(await storage.download(key, raw))) {
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
      cleaned = await deps.cleaner.clean(raw, out, family, target.mime);
    } catch (error) {
      if (error instanceof UnreadableFile) {
        await refuse(UNREADABLE);
        return;
      }
      throw error;
    }
    const kind = kindOfMime(target.mime);
    if ((kind === 'video' && !cleaned.hasVideo) || (kind === 'audio' && !cleaned.hasAudio)) {
      await refuse(NOT_WHAT_IT_SAYS);
      return;
    }
    const refusal = probedFileRefusal(target.category, {
      kind,
      width: cleaned.width,
      height: cleaned.height,
      durationMs: cleaned.durationMs,
    });
    if (refusal !== null) {
      await refuse(refusal);
      return;
    }
    const { sha256, bytes } = await sha256Of(out);
    const storageKey = mediaKeyOf(target.creatorId, sha256);
    // A medium she already holds is not written again: the file becomes its duplicate. Erased, it is written again.
    const uploaded = (await receipts.knownMedia(target.creatorId, sha256)) === null;
    if (uploaded) await storage.upload(storageKey, out, target.mime, sha256);
    await receipts.settle(
      fileId,
      {
        state: 'kept',
        media: {
          kind,
          mime: target.mime,
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
    await rm(dir, { recursive: true, force: true });
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
