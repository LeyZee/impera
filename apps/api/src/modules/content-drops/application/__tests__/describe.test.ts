import { tmpdir } from 'node:os';

import { DESCRIPTION_TRIES } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { DropDescriptionFailed } from '../../domain/errors';
import type { DropDescriber, DropStorage, MediaToDescribe } from '../../domain/ports';
import { describeFile, type DescribeDeps } from '../describe';

const NOW = new Date('2026-11-21T16:00:00.000Z');
const CREATOR = '00000000-0000-4000-8000-000000000001';
const MEDIUM = '00000000-0000-4000-8000-000000000002';
const CORRELATION = 'corr-1';

/** Invented: a Reel she dropped, kept in her library. */
const reel: MediaToDescribe = {
  creatorId: CREATOR,
  kind: 'video',
  mime: 'video/mp4',
  bytes: 1024,
  storageKey: 'drops/reel',
  erased: false,
  category: 'instagram_reel',
  script: null,
};

type Described = Awaited<ReturnType<DropDescriber['describe']>>;

interface Setup {
  /** Whether the medium already has its description (a replay). */
  readonly already?: boolean;
  /** What the vision AI answers. */
  readonly outcome?: Described;
  /** The medium's count of failures after this one. */
  readonly failures?: number;
  /** `false`: nobody waits for the description. */
  readonly listening?: boolean;
}

function setup(options: Setup): { deps: DescribeDeps; told: string[]; summaries: string[] } {
  const told: string[] = [];
  const summaries: string[] = [];
  const refuse = (what: string) => (): Promise<never> => Promise.reject(new Error(`${what} not expected`));
  const storage: DropStorage = {
    openUpload: refuse('openUpload'),
    startUpload: refuse('startUpload'),
    storedParts: refuse('storedParts'),
    partUrl: refuse('partUrl'),
    completeUpload: refuse('completeUpload'),
    sizeOf: refuse('sizeOf'),
    remove: refuse('remove'),
    download: () => Promise.resolve(true),
    read: refuse('read'),
    upload: refuse('upload'),
  };
  const deps: DescribeDeps = {
    storage,
    queue: {
      target: () => Promise.resolve(reel),
      later: () => Promise.resolve(),
      failed: () => Promise.resolve(options.failures ?? 1),
    },
    describer: {
      promptHash: 'hash',
      described: () => Promise.resolve(options.already ?? false),
      detailed: () => Promise.resolve(new Map()),
      describe: () => Promise.resolve(options.outcome ?? 'described'),
    },
    summaries: {
      enqueueFor: (_creatorId, mediaAssetId) => {
        summaries.push(mediaAssetId);
        return Promise.resolve(0);
      },
    },
    ...(options.listening !== false && {
      onDescribed: (creatorId: string, mediaAssetId: string, correlationId: string) => {
        told.push(`${creatorId} ${mediaAssetId} ${correlationId}`);
        return Promise.resolve();
      },
    }),
    versions: { frozen: () => Promise.resolve(null) },
    scratchDir: tmpdir(),
    room: { take: () => Promise.resolve(() => undefined) },
  };
  return { deps, told, summaries };
}

const run = (deps: DescribeDeps): ReturnType<typeof describeFile> =>
  describeFile(deps, CREATOR, MEDIUM, NOW, CORRELATION);

describe('describeFile tells whoever waits for the description (onDescribed)', () => {
  it('tells once when the medium is described, with the creator the queue read', async () => {
    const { deps, told, summaries } = setup({ outcome: 'described' });

    await expect(run(deps)).resolves.toBe('described');
    expect(told).toEqual([`${CREATOR} ${MEDIUM} ${CORRELATION}`]);
    expect(summaries).toEqual([MEDIUM]);
  });

  it('tells once again on a replay, the medium already described', async () => {
    const { deps, told } = setup({ already: true });

    await expect(run(deps)).resolves.toBe('already');
    expect(told).toEqual([`${CREATOR} ${MEDIUM} ${CORRELATION}`]);
  });

  it('never tells when every model failed and the job is retried', async () => {
    const { deps, told, summaries } = setup({ outcome: 'failed', failures: 1 });

    await expect(run(deps)).rejects.toBeInstanceOf(DropDescriptionFailed);
    expect(told).toEqual([]);
    expect(summaries).toEqual([]);
  });

  it('never tells when the medium is given up after its last try', async () => {
    const { deps, told } = setup({ outcome: 'failed', failures: DESCRIPTION_TRIES });

    await expect(run(deps)).resolves.toBe('given_up');
    expect(told).toEqual([]);
  });

  it.each(['budget', 'unreadable'] as const)('never tells on %s', async (outcome) => {
    const { deps, told } = setup({ outcome });

    await run(deps);
    expect(told).toEqual([]);
  });

  it('describes as before when nobody waits', async () => {
    const { deps, summaries } = setup({ outcome: 'described', listening: false });

    await expect(run(deps)).resolves.toBe('described');
    expect(summaries).toEqual([MEDIUM]);
  });
});
