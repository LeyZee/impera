import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { DESCRIPTION_TRIES } from '@impera/contracts';

import { sniffMediaType } from '../domain/media';
import {
  VAULT_LOT,
  isMpegTs,
  vaultDescribeOrder,
  type VaultCandidate,
  type VaultScript,
} from '../domain/vault';

import type { DescribedDrop, DropDescriber, FileMediaTools } from './describe-drop';

/** A media of the vault waiting for its file, with the platform's own text of it (ADR 0099 § 4). */
export interface VaultRef extends VaultCandidate {
  readonly platformDescription: string | null;
  /** The platform's name, the `model` of its own text's row. */
  readonly platform: string;
}

/** The account's vault as the job reads it, and where the job writes, as the owner role (ADR 0113). */
export interface VaultDescribeStore {
  /** The account's creator; `null` for an account unknown, or a creator archived. */
  account(platformAccountId: string): Promise<{ readonly creatorId: string } | null>;
  /**
   * Its media the owner asked to describe and that are in the CRM (ADR 0145 § 5), still without a file, not removed,
   * neither a voice note nor one waiting for the agency; its scripts.
   */
  waiting(
    creatorId: string,
    platformAccountId: string,
  ): Promise<{ readonly refs: readonly VaultRef[]; readonly scripts: readonly VaultScript[] }>;
  /**
   * The media of hers that has this fingerprint, if any (`media_assets_creator_sha256_unique`), and whether a fan sent
   * it: a media received is never sent back, so a vault file equal to one is never linked to it.
   */
  assetOf(
    creatorId: string,
    sha256: string,
  ): Promise<{ readonly id: string; readonly fromFan: boolean } | null>;
  /** The link to a media already known, and the platform's text kept beside it; nothing for a ref already linked. */
  link(creatorId: string, ref: VaultRef, mediaAssetId: string): Promise<void>;
  /**
   * In one transaction: the media born erased (origin `vault`, no storage key), its vision description when there is
   * one (author `sense`, never validated), the platform's text (author `platform`), and the link. A media of the same
   * fingerprint written meanwhile is linked instead, unless a fan sent it: then nothing is written (`fan`).
   */
  keep(
    creatorId: string,
    ref: VaultRef,
    asset: VaultAsset,
    described: DescribedDrop,
  ): Promise<'kept' | 'fan'>;
  /** `count` more tries that could not describe it, at most `DESCRIPTION_TRIES` in all; the count after. */
  failed(refId: string, count: number): Promise<number>;
  /** `media.describe_vault` for the account at `runAt` (`null`: now), under its key on the account's queue. */
  later(
    job: { readonly creatorId: string; readonly platformAccountId: string; readonly correlationId: string },
    runAt: Date | null,
  ): Promise<void>;
}

/** What the media row keeps of a file read and erased (ADR 0113 § 1). */
export interface VaultAsset {
  readonly kind: 'image' | 'video';
  readonly mime: string;
  readonly bytes: number;
  readonly durationMs: number | null;
  readonly sha256: string;
  readonly thumbnailKey: string | null;
  readonly at: Date;
}

/** The connectors' read of a vault file (`VaultFiles`), seen from this module. */
export type VaultFileRead = (ask: {
  readonly creatorId: string;
  readonly platformAccountId: string;
  readonly platformMediaId: string;
  readonly folderRef: string | null;
  readonly path: string;
  readonly correlationId: string;
}) => Promise<
  | { readonly status: 'fetched'; readonly bytes: number }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'later' | 'gone' | 'unreadable' }
>;

export interface VaultDescribeDeps {
  readonly store: VaultDescribeStore;
  readonly read: VaultFileRead;
  readonly describer: DropDescriber;
  readonly tools: Pick<FileMediaTools, 'probe'>;
  /** A vault video's MPEG-TS stream copied into an MP4 at `out`; `false` when it does not read. */
  readonly remux: (path: string, out: string) => Promise<boolean>;
  /**
   * The content drops' reduced picture of the file (ADR 0030 § 4), its key, or `null` when ffmpeg cannot read it or no
   * storage is set; made before the vision, so a storage that fails costs no description.
   */
  readonly picture: (ask: {
    readonly creatorId: string;
    readonly sha256: string;
    readonly path: string;
    readonly kind: 'image' | 'video';
  }) => Promise<string | null>;
  /** The picture under this key removed from the storage; nothing to do when no storage is set. */
  readonly unpicture: (key: string) => Promise<void>;
  /** Where the job makes its own folder for each file; removed, read or not. */
  readonly scratchDir: string;
  readonly now: () => Date;
}

/** What one run did, counts for the log. */
export interface VaultDescribeRun {
  /**
   * `more`: a lot went through and media still wait, the next run is queued now. `done`: nothing more for now. `budget`:
   * the day's AI budget is spent, the run is put off an hour (ADR 0083 § 8). `models`: every vision model failed, put off
   * a quarter of an hour. `unavailable`: the account cannot be read now. `unknown`: no account.
   */
  readonly stop: 'more' | 'done' | 'budget' | 'models' | 'unavailable' | 'unknown';
  readonly described: number;
  readonly linked: number;
  /** Waiting for the agency's text from now on (« À décrire par l'agence »). */
  readonly toAgency: number;
  /** Not read this time (a link failing for a while, a media gone from its folder): taken again by a later run. */
  readonly skipped: number;
}

/** The day's AI budget spent: asked again each hour, as the drops are (ADR 0083 § 8). */
const BUDGET_DELAY_MS = 60 * 60_000;
/** Every vision model failing (an outage): the account's next lot a quarter of an hour later. */
const MODELS_DELAY_MS = 15 * 60_000;
/** The category the vision is told (ADR 0083 § 5): the code's word, never the folder's name the platform gives. */
const VAULT_CATEGORY = 'Coffre de la plateforme';

const sha256Of = async (path: string): Promise<string> => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
};

const headOf = async (path: string, length: number): Promise<Uint8Array> => {
  const file = await open(path, 'r');
  try {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
};

/** The file as the media tools read it, and its type; `null` when it is not a photo or a video we read. */
async function readable(
  deps: Pick<VaultDescribeDeps, 'remux'>,
  ref: VaultRef,
  path: string,
  dir: string,
): Promise<{ readonly path: string; readonly mime: string; readonly describedMime: string } | null> {
  const head = await headOf(path, 512);
  if (ref.kind === 'video' && isMpegTs(head)) {
    const out = join(dir, 'readable.mp4');
    return (await deps.remux(path, out))
      ? { path: out, mime: 'video/mp2t', describedMime: 'video/mp4' }
      : null;
  }
  const sniffed = sniffMediaType(head);
  if (sniffed?.startsWith(`${ref.kind}/`) !== true) return null;
  return { path, mime: sniffed, describedMime: sniffed };
}

/** A picture left in the storage without a media row: the job fails and is replayed, never swallowed. */
export class VaultPictureNotRemoved extends Error {
  constructor() {
    // Never the key: it names her and the file's fingerprint.
    super('media.describe_vault: a picture kept by no media could not be removed');
    this.name = 'VaultPictureNotRemoved';
  }
}

async function unpicture(deps: Pick<VaultDescribeDeps, 'unpicture'>, key: string): Promise<void> {
  try {
    await deps.unpicture(key);
  } catch {
    throw new VaultPictureNotRemoved();
  }
}

type ItemOutcome = 'described' | 'linked' | 'to_agency' | 'skipped' | 'budget' | 'models' | 'unavailable';

async function describeOne(
  deps: VaultDescribeDeps,
  job: { readonly creatorId: string; readonly platformAccountId: string; readonly correlationId: string },
  ref: VaultRef,
): Promise<ItemOutcome> {
  const toAgency = async (): Promise<'to_agency'> => {
    await deps.store.failed(ref.refId, DESCRIPTION_TRIES);
    return 'to_agency';
  };
  // The job's own folder for this file alone: removed whatever happens, so no byte of it stays (ADR 0113 § 1).
  const dir = await mkdtemp(join(deps.scratchDir, 'impera-vault-'));
  try {
    const original = join(dir, 'original');
    const read = await deps.read({
      creatorId: job.creatorId,
      platformAccountId: job.platformAccountId,
      platformMediaId: ref.platformMediaId,
      folderRef: ref.folderRef,
      path: original,
      correlationId: job.correlationId,
    });
    if (read.status !== 'fetched') {
      if (read.status === 'unavailable') return 'unavailable';
      return read.status === 'unreadable' ? await toAgency() : 'skipped';
    }

    const sha256 = await sha256Of(original);
    const known = await deps.store.assetOf(job.creatorId, sha256);
    // The same bytes as a media a fan sent: never linked to it, which would make it proposable (« média reçu jamais
    // renvoyé »); the agency says what it is.
    if (known?.fromFan === true) return await toAgency();
    if (known !== null) {
      // Already hers (another account, a media placed twice): linked, never shown to the vision again (§ 5).
      await deps.store.link(job.creatorId, ref, known.id);
      return 'linked';
    }

    const file = await readable(deps, ref, original, dir);
    if (file === null) return await toAgency();
    let durationMs: number | null = null;
    if (ref.kind === 'video') {
      try {
        durationMs = Math.round((await deps.tools.probe(file.path)).durationS * 1_000);
      } catch {
        return await toAgency();
      }
    }
    // The picture before the vision: a storage that fails throws here, before a description is paid and then lost.
    const thumbnailKey = await deps.picture({
      creatorId: job.creatorId,
      sha256,
      path: file.path,
      kind: ref.kind,
    });
    // Carried by a media row once `keep` answers: until then, a picture no erasure would ever find (ADR 0113 § 1), so
    // every other way out removes it; the next run makes it again for the price of an ffmpeg.
    let carried = false;
    try {
      const described = await deps.describer.describe({
        creatorId: job.creatorId,
        path: file.path,
        mime: file.describedMime,
        kind: ref.kind,
        bytes: read.bytes,
        context: { category: VAULT_CATEGORY, step: null },
      });
      if (!described.ok) {
        if (described.error.code === 'budget') return 'budget';
        if (described.error.code === 'unreadable') return await toAgency();
        await deps.store.failed(ref.refId, 1);
        return 'models';
      }
      const kept = await deps.store.keep(
        job.creatorId,
        ref,
        {
          kind: ref.kind,
          mime: file.mime,
          bytes: read.bytes,
          durationMs,
          sha256,
          thumbnailKey,
          at: deps.now(),
        },
        described.value,
      );
      // `fan`: a media a fan sent has these bytes, so the same key is its picture: it stays.
      carried = true;
      return kept === 'fan' ? await toAgency() : 'described';
    } finally {
      // The key is the fingerprint's: a media of the same bytes kept meanwhile (a drop, a fan's) carries it, it stays.
      if (thumbnailKey !== null && !carried && (await deps.store.assetOf(job.creatorId, sha256)) === null)
        await unpicture(deps, thumbnailKey);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * `media.describe_vault` (ADR 0113 § 1, § 3, ADR 0145 § 5), on the account's queue: a lot of the media of its vault
 * the owner asked to describe, imported and without a file yet, in the order where scripts become proposable first. Each is read from the platform into a folder of the
 * job's own, fingerprinted, linked to her media of the same fingerprint without a vision call, or else described in
 * detail like a drop (ADR 0083), reduced to its picture and kept as a media born erased; the folder is removed, read or
 * not. A file we do not read waits for the agency's text; a voice note is never taken. The day's budget spent stops the
 * run and puts it off an hour; a lot that went through queues the next one. Replayable: a media linked is not taken
 * again, and a run stopped anywhere leaves nothing half written.
 */
/** The folders a run makes: its own, and the picture's (content-drops), both removed in `finally`. */
const LEFTOVER_PREFIXES = ['impera-vault-', 'impera-picture-'];
/** A folder older than this is no run's: a run reads one file at a time, well under this. */
const LEFTOVER_AGE_MS = 60 * 60_000;

/**
 * Removes what a run killed in the middle of a file left in `scratchDir` (the PC is turned off each night): « never
 * kept » holds even then (ADR 0113 § 1). Only folders old enough to be no running run's, of another account included.
 */
async function sweepVaultLeftovers(scratchDir: string, now: Date): Promise<number> {
  let removed = 0;
  const names = await readdir(scratchDir).catch(() => []);
  for (const name of names) {
    if (!LEFTOVER_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const path = join(scratchDir, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory()) continue;
    if (now.getTime() - info.mtimeMs < LEFTOVER_AGE_MS) continue;
    await rm(path, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

export async function describeVault(
  deps: VaultDescribeDeps,
  job: { readonly platformAccountId: string; readonly correlationId: string },
): Promise<VaultDescribeRun> {
  const counts = { described: 0, linked: 0, toAgency: 0, skipped: 0 };
  await sweepVaultLeftovers(deps.scratchDir, deps.now());
  const account = await deps.store.account(job.platformAccountId);
  if (account === null) return { stop: 'unknown', ...counts };
  const full = { ...job, creatorId: account.creatorId };
  const { refs, scripts } = await deps.store.waiting(account.creatorId, job.platformAccountId);
  const order = vaultDescribeOrder(refs, scripts);
  const lot = order.slice(0, VAULT_LOT);
  for (const ref of lot) {
    const outcome = await describeOne(deps, full, ref);
    if (outcome === 'budget') {
      await deps.store.later(full, new Date(deps.now().getTime() + BUDGET_DELAY_MS));
      return { stop: 'budget', ...counts };
    }
    if (outcome === 'models') {
      await deps.store.later(full, new Date(deps.now().getTime() + MODELS_DELAY_MS));
      return { stop: 'models', ...counts };
    }
    if (outcome === 'unavailable') return { stop: 'unavailable', ...counts };
    if (outcome === 'described') counts.described += 1;
    else if (outcome === 'linked') counts.linked += 1;
    else if (outcome === 'to_agency') counts.toAgency += 1;
    else counts.skipped += 1;
  }
  // The next lot now, only when this one moved something: a lot of media that all failed for a while waits for the hour.
  const moved = counts.described + counts.linked + counts.toAgency > 0;
  if (order.length > lot.length && moved) {
    await deps.store.later(full, null);
    return { stop: 'more', ...counts };
  }
  return { stop: 'done', ...counts };
}
