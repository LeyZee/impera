import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ContentDropFileIdSchema, newId } from '@impera/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  CleanedFile,
  DropFileTarget,
  DropStorage,
  FileCleaner,
  FileOutcome,
  ReceiptStore,
  ScratchRoom,
} from '../../domain/ports';
import { receiveFile } from '../uploads';

const NOW = new Date('2026-11-05T19:00:00.000Z');
const GIB = 1024 * 1024 * 1024;
/** The first bytes of a Matroska or WebM file (EBML), then filler: the cleaner is a fake, nothing reads further. */
const WEBM_HEAD = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array<number>(28).fill(0)]);

/**
 * The receipt's choices around a heavy video (ADR 0070 § 4), with a fake storage, store and cleaner: the room on
 * disk checked before anything is read, a video to convert handed over to its queue, the conversion done by the job
 * of that queue. Invented data only.
 */
describe('content-drops › content_drops.receive_file and content_drops.convert_file (ADR 0070)', () => {
  let scratchDir = '';

  beforeAll(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), 'impera-receipt-test-'));
  });

  afterAll(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  function fakes(options: { readonly free: number; readonly rawHeld: boolean; readonly convert: boolean }) {
    const log: string[] = [];
    const target: DropFileTarget & { readonly category: 'feed_shoot' } = {
      creatorId: 'creator',
      dropId: 'drop',
      fileId: newId(ContentDropFileIdSchema),
      mime: 'video/webm',
      bytes: 4 * GIB,
      fileState: 'received',
      dropState: 'received',
      category: 'feed_shoot',
      lengths: null,
    };
    const refuse = (what: string) => (): Promise<never> => Promise.reject(new Error(`${what} not expected`));
    const storage: DropStorage = {
      openUpload: refuse('openUpload'),
      startUpload: refuse('startUpload'),
      storedParts: refuse('storedParts'),
      partUrl: refuse('partUrl'),
      completeUpload: refuse('completeUpload'),
      sizeOf: () => Promise.resolve(options.rawHeld ? target.bytes : null),
      remove: (key) => {
        log.push(`remove ${key}`);
        return Promise.resolve();
      },
      download: async (key, path, bytes) => {
        log.push(`download ${key} ${String(bytes)}`);
        await writeFile(path, WEBM_HEAD);
        return true;
      },
      upload: (key, _path, mime) => {
        log.push(`upload ${key} ${mime}`);
        return Promise.resolve();
      },
    };
    const receipts: ReceiptStore = {
      pending: () => Promise.resolve(target),
      knownMedia: () => Promise.resolve(null),
      settle: (_fileId, outcome: FileOutcome) => {
        log.push(
          `settle ${outcome.state === 'refused' ? outcome.refusal : outcome.state === 'kept' ? `kept ${outcome.media.mime}` : outcome.state}`,
        );
        return Promise.resolve();
      },
      enqueue: (task, file, _correlationId, runAt) => {
        log.push(
          `enqueue ${task} ${file.fileId === target.fileId ? 'file' : 'other'} ${runAt?.toISOString() ?? 'now'}`,
        );
        return Promise.resolve();
      },
    };
    const cleaner: FileCleaner = {
      needsConversion: (_raw, family) => {
        log.push(`probe ${family}`);
        return Promise.resolve(options.convert);
      },
      clean: async (_raw, out): Promise<CleanedFile> => {
        log.push('clean');
        await writeFile(out, 'cleaned');
        return {
          mime: 'video/mp4',
          width: 1080,
          height: 1920,
          durationMs: 30_000,
          hasVideo: true,
          hasAudio: true,
        };
      },
    };
    // The room as the worker counts it, with nothing else taken: the disk's free bytes against what the file needs.
    const room: ScratchRoom = {
      take: (bytes) => Promise.resolve(options.free >= bytes ? () => undefined : null),
    };
    const deps = { storage, receipts, cleaner, scratchDir, room };
    return { deps, log, target };
  }

  it('hands a video to convert over to its queue, and never cleans it itself', async () => {
    const { deps, log, target } = fakes({ free: 20 * GIB, rawHeld: true, convert: true });
    await receiveFile(deps, target.fileId, NOW, 'corr');
    expect(log).toEqual([
      `download incoming/creator/${target.fileId} ${String(4 * GIB)}`,
      'probe ebml',
      'enqueue content_drops.convert_file file now',
    ]);
  });

  it('the conversion job converts it, keeps it as an MP4 and erases the raw bytes', async () => {
    const { deps, log, target } = fakes({ free: 20 * GIB, rawHeld: true, convert: true });
    await receiveFile(deps, target.fileId, NOW, 'corr', 'content_drops.convert_file');
    expect(log.slice(1)).toEqual([
      'clean',
      expect.stringMatching(/^upload media\/creator\/[0-9a-f]{64} video\/mp4$/u),
      'settle kept video/mp4',
      `remove incoming/creator/${target.fileId}`,
    ]);
  });

  it('short of disk (less than 2.5 times the file), comes back in 15 minutes without reading anything', async () => {
    const { deps, log, target } = fakes({ free: 9 * GIB, rawHeld: true, convert: true });
    await receiveFile(deps, target.fileId, NOW, 'corr', 'content_drops.convert_file');
    expect(log).toEqual(['enqueue content_drops.convert_file file 2026-11-05T19:15:00.000Z']);
  });

  it('short of disk with the raw bytes already gone, refuses the file with her sentence', async () => {
    const { deps, log, target } = fakes({ free: GIB, rawHeld: false, convert: false });
    await receiveFile(deps, target.fileId, NOW, 'corr');
    expect(log).toEqual([
      'settle Ce fichier n’est pas arrivé à temps : renvoie-le',
      `remove incoming/creator/${target.fileId}`,
    ]);
  });
});
