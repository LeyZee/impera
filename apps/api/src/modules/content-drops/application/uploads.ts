import { DROP_PART_BYTES, type DropFileUpload } from '@impera/contracts';

import {
  ContentDropFileSettled,
  ContentDropStorageUnavailable,
  ContentDropUploadUnprocessable,
} from '../domain/errors';
import type { DropFileTarget, DropStorage, ReceiptStore } from '../domain/ports';
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

/**
 * `content_drops.receive_file`: the file whole in the storage becomes received, its drop with it when it was the last
 * one. A drop withdrawn meanwhile has its raw file erased at once rather than in 24 hours. Replayable: a file past
 * `awaiting` is left as it is. A raw file not found throws, and the job retries.
 */
export async function receiveFile(
  storage: DropStorage,
  receipts: ReceiptStore,
  fileId: string,
  now: Date,
  correlationId: string,
): Promise<void> {
  const target = await receipts.pending(fileId);
  if (target?.fileState !== 'awaiting') return;
  const key = rawKeyOf(target.creatorId, target.fileId);
  if (target.dropState === 'withdrawn') {
    await storage.remove(key);
    return;
  }
  const size = await storage.sizeOf(key);
  if (size === null) throw new ContentDropStorageUnavailable(`${key}: marked sent, not in the storage`);
  if (size !== target.bytes) {
    await storage.remove(key);
    await receipts.settle(fileId, { state: 'refused', refusal: WRONG_SIZE }, now, correlationId);
    return;
  }
  await receipts.settle(fileId, { state: 'received' }, now, correlationId);
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
};

function unconfigured(): Promise<never> {
  return Promise.reject(new ContentDropStorageUnavailable('S3_* is not set: no media storage'));
}
