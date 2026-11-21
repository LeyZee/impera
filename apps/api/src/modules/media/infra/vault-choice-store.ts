import { newId, PlatformAccountIdSchema } from '@impera/contracts';
import {
  and,
  eq,
  onCreatorList,
  schema,
  sql,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import type { VaultChoiceMedia, VaultChoiceStore } from '../application/vault-choices';
import type { DescribeCandidate } from '../domain/vault-choice';

import { enqueueVaultDescribeIn } from './vault-describe-store';

const { mediaPlatformRefs, platformAccounts, vaultDescribeRequests, vaultImportChoices } = schema;

const RowIdSchema = z.uuid();
const KindSchema = z.enum(['image', 'video', 'audio']);
const FolderRowSchema = z.object({
  platform_account_id: PlatformAccountIdSchema,
  folder_ref: z.string().nullable(),
  imported: z.boolean(),
});
const MediaRowSchema = z.object({
  platform_account_id: PlatformAccountIdSchema,
  platform_media_id: z.string(),
  kind: KindSchema,
  removed: z.boolean(),
  imported: z.boolean(),
  linked: z.boolean(),
  asked: z.boolean(),
  failures: z.coerce.number().int(),
  detailed: z.string().nullable(),
});
const CountSchema = z.object({ n: z.coerce.number().int() });

/** The columns of `media_platform_refs` aliased `r`, as `vaultImported` reads them. */
const IMPORTED = schema.vaultImported({
  account: sql`r.platform_account_id`,
  media: sql`r.platform_media_id`,
  folder: sql`r.folder_ref`,
});

/** The media of her vault and where each stands; one account, or all of hers; these ids only, when given. */
async function mediaOf(
  tx: Transaction,
  creatorId: string,
  platformAccountId: string | null,
  ids: readonly string[] | null,
): Promise<z.infer<typeof MediaRowSchema>[]> {
  const only =
    ids === null
      ? sql`r.removed_at is null`
      : sql`r.platform_media_id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  const result = await tx.execute(sql`
    select r.platform_account_id, r.platform_media_id, r.kind,
           r.removed_at is not null as removed,
           ${IMPORTED} as imported,
           r.media_asset_id is not null as linked,
           exists (select 1 from ${vaultDescribeRequests} q
                    where q.platform_account_id = r.platform_account_id
                      and q.platform_media_id = r.platform_media_id) as asked,
           r.description_failures as failures,
           (select md.content ->> 'detailed' from ${schema.mediaDescriptions} md
             where md.media_asset_id = r.media_asset_id and md.content ? 'detailed'
             order by md.created_at desc, md.id desc
             limit 1) as detailed
      from ${mediaPlatformRefs} r
     where r.creator_id = ${creatorId}
       and (${platformAccountId}::uuid is null or r.platform_account_id = ${platformAccountId}::uuid)
       and ${only}
     order by r.platform_account_id, r.platform_media_id`);
  return z.array(MediaRowSchema).parse(result.rows);
}

const candidateOf = (row: z.infer<typeof MediaRowSchema>): DescribeCandidate => ({
  platformMediaId: row.platform_media_id,
  kind: row.kind,
  removed: row.removed,
  imported: row.imported,
  linked: row.linked,
  asked: row.asked,
  failures: row.failures,
});

async function isHers(tx: Transaction, creatorId: string, platformAccountId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: platformAccounts.id })
    .from(platformAccounts)
    .where(and(eq(platformAccounts.id, platformAccountId), eq(platformAccounts.creatorId, creatorId)))
    .limit(1);
  return row !== undefined;
}

/**
 * `vault_import_choices` and `vault_describe_requests` (ADR 0145 § 5), in the person's own `withTenantMember`: the
 * owner, or an active manager of her list to read; the base also refuses a write by anyone but the owner, and her own
 * account. A request queues `media.describe_vault` in the same transaction.
 */
export function createDrizzleVaultChoiceStore(db: Database): VaultChoiceStore {
  return {
    view: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        const reads =
          scope === 'owner' || (scope === 'agency' && (await onCreatorList(tx, userId, creatorId)));
        if (!reads) return null;
        const folders = await tx.execute(sql`
          select platform_account_id, folder_ref, imported
            from ${vaultImportChoices}
           where creator_id = ${creatorId} and scope = 'folder'
           order by platform_account_id, folder_ref nulls last`);
        const media = await mediaOf(tx, creatorId, null, null);
        return {
          folders: z
            .array(FolderRowSchema)
            .parse(folders.rows)
            .map((row) => ({
              platformAccountId: row.platform_account_id,
              folderRef: row.folder_ref,
              imported: row.imported,
            })),
          media: media.map((row): VaultChoiceMedia => ({
            ...candidateOf(row),
            platformAccountId: row.platform_account_id,
            detailed: row.detailed,
          })),
        };
      }),

    set: (creatorId, userId, change) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner') return 'forbidden';
        const account = change.platformAccountId;
        if (!(await isHers(tx, creatorId, account))) return 'unknown_account';
        for (const folder of change.folders) {
          await tx.execute(sql`
            insert into ${vaultImportChoices}
                   (id, creator_id, platform_account_id, scope, folder_ref, platform_media_id, imported, chosen_by)
            values (${newId(RowIdSchema)}, ${creatorId}, ${account}, 'folder', ${folder.folderRef},
                    null, ${folder.imported}, ${userId})
            on conflict (platform_account_id, coalesce(folder_ref, '')) where scope = 'folder'
            do update set imported = excluded.imported, chosen_by = excluded.chosen_by, chosen_at = now()`);
          // The folder ticked or unticked whole: its media's own ticks go.
          await tx.execute(sql`
            delete from ${vaultImportChoices} c
             using ${mediaPlatformRefs} r
             where c.platform_account_id = ${account} and c.scope = 'media'
               and r.platform_account_id = c.platform_account_id and r.platform_media_id = c.platform_media_id
               and coalesce(r.folder_ref, '') = coalesce(${folder.folderRef}::text, '')`);
        }
        for (const media of change.media) {
          // Only a media her vault lists: an id it does not know writes nothing.
          await tx.execute(sql`
            insert into ${vaultImportChoices}
                   (id, creator_id, platform_account_id, scope, folder_ref, platform_media_id, imported, chosen_by)
            select ${newId(RowIdSchema)}, ${creatorId}, r.platform_account_id, 'media', null,
                   r.platform_media_id, ${media.imported}, ${userId}
              from ${mediaPlatformRefs} r
             where r.platform_account_id = ${account} and r.platform_media_id = ${media.platformMediaId}
            on conflict (platform_account_id, platform_media_id) where scope = 'media'
            do update set imported = excluded.imported, chosen_by = excluded.chosen_by, chosen_at = now()`);
        }
        return 'set';
      }),

    ask: (creatorId, userId, request, decide) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner') return 'forbidden';
        if (!(await isHers(tx, creatorId, request.platformAccountId))) return 'unknown_account';
        const replay = await tx.execute(sql`
          select count(*)::int as n from ${vaultDescribeRequests}
           where creator_id = ${creatorId} and asked_key = ${request.key}::uuid`);
        const replayed = CountSchema.parse(replay.rows[0]).n;
        if (replayed > 0) return { replayed };
        const rows = await mediaOf(tx, creatorId, request.platformAccountId, [
          ...new Set(request.platformMediaIds),
        ]);
        const decision = decide(new Map(rows.map((row) => [row.platform_media_id, candidateOf(row)])));
        if (decision.insert.length === 0) return decision.answer;
        await tx
          .insert(vaultDescribeRequests)
          .values(
            decision.insert.map((platformMediaId) => ({
              id: newId(RowIdSchema),
              creatorId,
              platformAccountId: request.platformAccountId,
              platformMediaId,
              askedKey: request.key,
              askedBy: userId,
            })),
          )
          .onConflictDoNothing({
            target: [vaultDescribeRequests.platformAccountId, vaultDescribeRequests.platformMediaId],
          });
        await enqueueVaultDescribeIn(tx, {
          creatorId,
          platformAccountId: request.platformAccountId,
          correlationId: request.correlationId,
        });
        return decision.answer;
      }),
  };
}
