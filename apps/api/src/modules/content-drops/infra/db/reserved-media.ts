import { randomUUID } from 'node:crypto';

import {
  ReservedMediaAskSchema,
  ReservedMediaSchema,
  ReservedMediaSentSchema,
  type ReservedMedia,
  type ReservedMediaAsk,
  type ReservedMediaSent,
} from '@impera/contracts';
import { sql, withTenantJob, type Database, type Transaction } from '@impera/db';

import { ONCE_PER_FAN, PROVEN_GIFT_INTENSITIES } from '../../domain/reserved';

/** A drop that reached the agency, out or not: its kept media are hers to send. */
const ARRIVED = sql`('received', 'ready', 'scheduled', 'published')`;
const PROVEN = sql.join(
  [...PROVEN_GIFT_INTENSITIES].map((intensity) => sql`${intensity}`),
  sql`, `,
);

/**
 * A medium of hers the AI may send this fan, from the coffre (Charles, 21/11): a voice of hers or a whale gift, kept,
 * never replaced, described and validated by the agency, a gift proven not nude. A voice goes once to a fan, whichever
 * file; a gift never twice the same. The oldest first; `null` when none is left for this fan. Nothing written.
 */
async function pickReservedMedia(tx: Transaction, ask: ReservedMediaAsk): Promise<ReservedMedia | null> {
  const { creatorId, category, fanId } = ReservedMediaAskSchema.parse(ask);
  const oncePerFan = ONCE_PER_FAN.has(category);
  const rows = await tx.execute<{ media_asset_id: string; kind: string }>(sql`
    with hers as (
      select f.media_asset_id, f.kind, d.created_at, f.position
        from content_drop_files f
        join content_drops d on d.id = f.drop_id
       where d.creator_id = ${creatorId}
         and d.category = ${category}
         and d.state in ${ARRIVED}
         and f.state in ('kept', 'duplicate')
         and f.replaced_at is null
         and f.media_asset_id is not null
    )
    select h.media_asset_id, h.kind
      from hers h
      join lateral (
        select md.content
          from media_descriptions md
         where md.media_asset_id = h.media_asset_id and md.validated_at is not null
         order by md.validated_at desc
         limit 1
      ) shown on true
     where (${category} <> 'whale_gift' or shown.content ->> 'intensity' in (${PROVEN}))
       and not exists (
         select 1 from media_sends s
          where s.creator_id = ${creatorId} and s.fan_id = ${fanId}
            and (s.media_asset_id = h.media_asset_id
                 or (${oncePerFan} and s.media_asset_id in (select media_asset_id from hers)))
       )
     order by h.created_at, h.position
     limit 1
  `);
  const first = rows.rows[0];
  return first === undefined
    ? null
    : ReservedMediaSchema.parse({ mediaAssetId: first.media_asset_id, kind: first.kind });
}

/**
 * That medium noted as sent to this fan for free, once the send is confirmed (the agent calls it). Replayable: a second
 * call for the same fan and medium writes nothing (`media_sends_free_once_idx`). Only a medium of hers in a category the
 * AI sends is noted; any other answers `false`, as a replay does.
 */
async function recordReservedMediaSent(tx: Transaction, sent: ReservedMediaSent): Promise<boolean> {
  const { creatorId, mediaAssetId, fanId, conversationId, messageId, sentAt } =
    ReservedMediaSentSchema.parse(sent);
  const reserved = sql.join(
    ReservedMediaAskSchema.shape.category.options.map((category) => sql`${category}`),
    sql`, `,
  );
  const inserted = await tx.execute<{ id: string }>(sql`
    insert into media_sends (id, creator_id, media_asset_id, fan_id, conversation_id, message_id, price_minor, sent_at)
    select ${randomUUID()}, ${creatorId}, ${mediaAssetId}, ${fanId}, ${conversationId}, ${messageId}, null, ${sentAt}
     where exists (
       select 1 from content_drop_files f join content_drops d on d.id = f.drop_id
        where f.media_asset_id = ${mediaAssetId} and d.creator_id = ${creatorId} and d.category in (${reserved})
     )
    on conflict (fan_id, media_asset_id) where price_minor is null do nothing
    returning id
  `);
  return inserted.rows.length > 0;
}

/** What the AI sends from her coffre, read and noted for the agent (ADR 0163 § 7). */
export interface ReservedMediaStore {
  pick(ask: ReservedMediaAsk): Promise<ReservedMedia | null>;
  noteSent(sent: ReservedMediaSent): Promise<boolean>;
}

/**
 * Under her tenant as the job that reads her dropped media (`drop_media`): her drops are read by herself, her team or
 * that job only, never by a bare tenant. One creator at a time; the note is a row of hers (`media_sends`).
 */
export function createDrizzleReservedMedia(db: Database): ReservedMediaStore {
  return {
    pick: (ask) =>
      withTenantJob(db, ReservedMediaAskSchema.parse(ask).creatorId, 'drop_media', (tx) =>
        pickReservedMedia(tx, ask),
      ),
    noteSent: (sent) =>
      withTenantJob(db, ReservedMediaSentSchema.parse(sent).creatorId, 'drop_media', (tx) =>
        recordReservedMediaSent(tx, sent),
      ),
  };
}
