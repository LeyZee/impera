import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { sql, withTenantJob, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import { CHANNEL_FILE_MAX_BYTES, publicDescriptionOf } from '../../domain/channel-visual';
import type { DropStorage } from '../../domain/ports';

/** A visual her channel may send (ADR 0162 § 5.2), as the Telegram module reads it (matched by shape). */
interface ChannelVisualRead {
  readonly mediaId: string;
  readonly kind: 'photo' | 'video';
  readonly description: string;
}

/** Its file, fetched for the bot, which sends it as an upload: no address of the storage ever leaves. */
interface ChannelVisualFile {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime: string;
}

export interface ChannelVisualsReader {
  eveningCandidates(creatorId: string, day: string): Promise<readonly ChannelVisualRead[]>;
  telegramStock(creatorId: string): Promise<readonly ChannelVisualRead[]>;
  file(creatorId: string, mediaId: string): Promise<ChannelVisualFile | 'gone' | 'too_big'>;
  places(
    creatorId: string,
    mediaIds: readonly string[],
  ): Promise<Readonly<Record<string, { dropId: string; fileId: string }>>>;
}

const PlaceRowSchema = z.object({ media_asset_id: z.string(), drop_id: z.string(), file_id: z.string() });

const CandidateRowSchema = z.object({
  media_asset_id: z.string(),
  kind: z.enum(['image', 'video']),
  content: z.unknown(),
});

/** The drops whose media her channel may send: the evening's (§ 5.2) and her Telegram stock (§ 1). */
const EVENING = ['feed_video', 'mass_dm', 'telegram_post'] as const;
const STOCK = ['telegram_post'] as const;
const list = (values: readonly string[]) =>
  sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Her stock serves the week to come: a medium whose original goes before then is not offered. */
const STOCK_HORIZON_MS = 8 * DAY_MS;

interface CandidateAsk {
  readonly categories: readonly string[];
  /** Its original must outlive this instant: the day it goes out (Médias, 21/11). */
  readonly keptUntil: Date;
  /** One medium only, read again just before its file is sent. */
  readonly mediaId?: string;
}

/**
 * Her live media in drops of these categories, oldest first, each with its latest validated description. The feed's
 * video is taken once out on Reveal too (the evening post is that very video); the others only while in stock. Never
 * one that is in a script, hers or on the platform, nor one sold to a fan: a script's medium is never free (ADR 0145).
 * Bounded to her, in her transaction (`withTenantJob`, job `telegram_channel`), read only.
 */
async function candidates(
  tx: Transaction,
  creatorId: string,
  ask: CandidateAsk,
): Promise<ChannelVisualRead[]> {
  const result = await tx.execute(sql`
    select c.media_asset_id, c.kind, c.content from (
      select distinct on (f.media_asset_id) f.media_asset_id, a.kind, d.created_at, f.position, v.content
        from content_drops d
        join content_drop_files f on f.drop_id = d.id and f.creator_id = d.creator_id
        join media_assets a on a.id = f.media_asset_id and a.creator_id = d.creator_id
        join lateral (
          select md.content from media_descriptions md
           where md.media_asset_id = a.id and md.creator_id = a.creator_id and md.validated_at is not null
           order by md.validated_at desc, md.created_at desc, md.id desc limit 1
        ) v on true
       where d.creator_id = ${creatorId}
         and d.category in ${list(ask.categories)}
         and d.withdrawn_at is null
         and (
           (d.category = 'feed_video' and d.state in ('ready', 'scheduled', 'published'))
           or (d.category <> 'feed_video' and d.state in ('ready', 'scheduled') and d.exported_at is null)
         )
         and f.state in ('kept', 'duplicate') and f.replaced_at is null and f.redo_sentence is null
         and a.kind in ('image', 'video') and a.erased_at is null
         and (a.expires_at is null or a.expires_at > ${ask.keptUntil})
         ${ask.mediaId === undefined ? sql`` : sql`and a.id = ${ask.mediaId}`}
         and not exists (
           select 1 from content_drop_files sf join content_drops sd on sd.id = sf.drop_id
            where sf.media_asset_id = a.id and sf.creator_id = a.creator_id and sd.category = 'script')
         and not exists (
           select 1 from media_platform_refs r join platform_script_step_media m
             on m.creator_id = r.creator_id and m.platform_media_ref = r.platform_media_id
            where r.media_asset_id = a.id and r.creator_id = a.creator_id)
         and not exists (
           select 1 from media_sends s
            where s.media_asset_id = a.id and s.creator_id = a.creator_id and coalesce(s.price_minor, 0) > 0)
       order by f.media_asset_id, d.created_at, f.position
    ) c order by c.created_at, c.position`);
  return result.rows.flatMap((raw): ChannelVisualRead[] => {
    const row = CandidateRowSchema.safeParse(raw);
    if (!row.success) return [];
    const description = publicDescriptionOf(row.data.content);
    return description === null
      ? []
      : [
          {
            mediaId: row.data.media_asset_id,
            kind: row.data.kind === 'image' ? 'photo' : 'video',
            description,
          },
        ];
  });
}

/** The file's name as Telegram shows it; never the storage's key. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const AssetRowSchema = z.object({
  storage_key: z.string(),
  bytes: z.coerce.number(),
  mime: z.string(),
  kind: z.enum(['image', 'video']),
});

/**
 * Her channel's visuals, read by the Telegram module's jobs (ADR 0162 § 5): one creator and one transaction at a
 * time, under the app role. The file is fetched to a scratch folder and read back; no storage address is made.
 */
export function createChannelVisualsReader(
  db: Database,
  storage: Pick<DropStorage, 'download'>,
  scratchDir: string,
): ChannelVisualsReader {
  const read = (creatorId: string, ask: CandidateAsk) =>
    withTenantJob(db, creatorId, 'telegram_channel', (tx) => candidates(tx, creatorId, ask));
  return {
    // Nothing in a drop ties it to a day yet: the day only says how long its original must be kept.
    eveningCandidates: (creatorId, day) =>
      read(creatorId, {
        categories: EVENING,
        keptUntil: new Date(Date.parse(`${day}T00:00:00Z`) + 2 * DAY_MS),
      }),
    // Its newest live file among her drops, for its reduced picture in the review; read in her creator only.
    places: (creatorId, mediaIds) =>
      withTenantJob(db, creatorId, 'telegram_channel', async (tx) => {
        const result = await tx.execute(sql`
          select distinct on (f.media_asset_id) f.media_asset_id, f.drop_id, f.id as file_id
            from content_drop_files f join content_drops d on d.id = f.drop_id and d.creator_id = f.creator_id
           where f.creator_id = ${creatorId} and f.media_asset_id in ${list(mediaIds)}
             and d.withdrawn_at is null and f.replaced_at is null
           order by f.media_asset_id, d.created_at desc, f.position`);
        return Object.fromEntries(
          result.rows.flatMap((raw) => {
            const row = PlaceRowSchema.safeParse(raw);
            return row.success
              ? [[row.data.media_asset_id, { dropId: row.data.drop_id, fileId: row.data.file_id }] as const]
              : [];
          }),
        );
      }),
    telegramStock: (creatorId) =>
      read(creatorId, { categories: STOCK, keptUntil: new Date(Date.now() + STOCK_HORIZON_MS) }),
    async file(creatorId, mediaId) {
      // Read again with the file, in one transaction: between Saturday and its hour it may have entered a script,
      // lost its description or been withdrawn. It goes out only if it still passes every guard.
      const raw = await withTenantJob(db, creatorId, 'telegram_channel', async (tx) => {
        const still = await candidates(tx, creatorId, {
          categories: EVENING,
          keptUntil: new Date(),
          mediaId,
        });
        if (still.length === 0) return undefined;
        const [row] = (
          await tx.execute(sql`
            select storage_key, bytes, mime, kind from media_assets
             where id = ${mediaId} and creator_id = ${creatorId} and erased_at is null`)
        ).rows;
        return row;
      });
      const asset = AssetRowSchema.safeParse(raw);
      if (!asset.success) return 'gone';
      if (asset.data.bytes > CHANNEL_FILE_MAX_BYTES) return 'too_big';
      const dir = await mkdtemp(join(scratchDir, 'impera-channel-'));
      try {
        const path = join(dir, 'media');
        if (!(await storage.download(asset.data.storage_key, path, asset.data.bytes))) return 'gone';
        const extension = EXTENSIONS[asset.data.mime] ?? (asset.data.kind === 'image' ? 'jpg' : 'mp4');
        return {
          bytes: new Uint8Array(await readFile(path)),
          filename: `${asset.data.kind === 'image' ? 'photo' : 'video'}.${extension}`,
          mime: asset.data.mime,
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
