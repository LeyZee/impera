import { isDeepStrictEqual } from 'node:util';

import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  MediaSlotKindSchema,
  newId,
  PlatformAccountIdSchema,
  PlatformScriptIdSchema,
  PreparedScriptContentSchema,
  PreparedScriptIdSchema,
  PreparedScriptStateSchema,
  CreatorSettingsSchema,
  type CreatorId,
  type PreparedScriptContent,
} from '@impera/contracts';
import {
  and,
  eq,
  onCreatorList,
  schema,
  sql,
  withTenant,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import type { PreparedScriptStore, StoredPreparedScript } from '../../domain/ports';
import type { PreparedVaultMedia } from '../../domain/prepared-scripts';

import { nativesOf } from './natives';

const { auditLog, mediaDescriptions, mediaPlatformRefs, platformAccounts, preparedScripts } = schema;

type Row = typeof preparedScripts.$inferSelect;

const VaultRowSchema = z.object({
  platform_media_id: z.string(),
  kind: MediaSlotKindSchema,
  described: z.boolean(),
  offered: z.boolean(),
});

/** The Postgres code behind a failed query (Drizzle wraps it as `cause`). */
function pgCodeOf(error: unknown): string | null {
  for (let current = error; typeof current === 'object' && current !== null;) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

/** The refs a script names, each once. */
const refsOf = (content: PreparedScriptContent) => [
  ...new Set(
    content.steps.flatMap((step) => step.branches.flatMap((branch) => branch.media.map((m) => m.ref))),
  ),
];

/**
 * Where these media stand in her vault for this account (`media_platform_refs`), under the caller's RLS: a link the
 * platform no longer lists (`removed_at`) is not in it; described = a description of its media a human validated, with
 * its `detailed` text, as the native scripts read it; offered = offered once (ADR 0145 § 2, `vaultOffered`).
 */
async function vaultOf(
  tx: Transaction,
  platformAccountId: string,
  refs: readonly string[],
): Promise<Map<string, PreparedVaultMedia>> {
  if (refs.length === 0) return new Map();
  const list = sql.join(
    refs.map((ref) => sql`${ref}`),
    sql`, `,
  );
  const result = await tx.execute(sql`
    select l.platform_media_id, l.kind,
      exists (select 1 from ${mediaDescriptions} md
        where md.media_asset_id = l.media_asset_id and md.validated_at is not null and md.content ? 'detailed')
        as described,
      ${schema.vaultOffered({ sentForFreeAt: sql`l.sent_for_free_at`, mediaAsset: sql`l.media_asset_id` })} as offered
    from ${mediaPlatformRefs} l
    where l.platform_account_id = ${platformAccountId}::uuid
      and l.platform_media_id in (${list})
      and l.removed_at is null`);
  return new Map(
    z
      .array(VaultRowSchema)
      .parse(result.rows)
      .map((row) => [
        row.platform_media_id,
        { kind: row.kind, described: row.described, offered: row.offered },
      ]),
  );
}

async function storedOf(tx: Transaction, row: Row): Promise<StoredPreparedScript> {
  const content = PreparedScriptContentSchema.parse(row.content);
  return {
    id: PreparedScriptIdSchema.parse(row.id),
    creatorId: CreatorIdSchema.parse(row.creatorId),
    platformAccountId: PlatformAccountIdSchema.parse(row.platformAccountId),
    state: PreparedScriptStateSchema.parse(row.state),
    revision: row.revision,
    content,
    matchedPlatformScriptId:
      row.matchedPlatformScriptId === null ? null : PlatformScriptIdSchema.parse(row.matchedPlatformScriptId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    vault: await vaultOf(tx, row.platformAccountId, refsOf(content)),
    // What it is compared with while it waits to be copied: the native scripts of its name (ADR 0112 § 23).
    natives:
      row.state === 'ready_to_copy'
        ? await nativesOf(tx, row.platformAccountId, { name: content.name })
        : null,
  };
}

/** The owner, or an active manager whose list holds her: the readers of her scripts (ADR 0099, as her vault). */
async function mayRead(
  tx: Transaction,
  scope: string,
  userId: string,
  creatorId: CreatorId,
): Promise<boolean> {
  if (scope === 'owner') return true;
  return scope === 'agency' && (await onCreatorList(tx, userId, creatorId));
}

/**
 * Her scripts in preparation (ADR 0112 §§ 20-22), in the person's transaction, under her RLS and the team's scope;
 * her own account is closed by the base. Every write leaves a line in `audit_log`.
 */
export function createDrizzlePreparedScriptStore(db: Database): PreparedScriptStore {
  return {
    staircase: (creatorId) =>
      withTenant(db, creatorId, async (tx) => {
        const [creator] = await tx
          .select({ settings: schema.creators.settings })
          .from(schema.creators)
          .where(eq(schema.creators.id, creatorId));
        const settings = CreatorSettingsSchema.safeParse(creator?.settings ?? {});
        return settings.success ? settings.data.staircase : undefined;
      }),

    list: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!(await mayRead(tx, scope, userId, creatorId))) return null;
        const rows = await tx
          .select()
          .from(preparedScripts)
          .where(eq(preparedScripts.creatorId, creatorId))
          .orderBy(sql`${preparedScripts.updatedAt} desc`, sql`${preparedScripts.id} desc`);
        return Promise.all(rows.map((row) => storedOf(tx, row)));
      }),

    one: (creatorId, id, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!(await mayRead(tx, scope, userId, creatorId))) return null;
        const [row] = await tx
          .select()
          .from(preparedScripts)
          .where(and(eq(preparedScripts.id, id), eq(preparedScripts.creatorId, creatorId)));
        return row === undefined ? null : storedOf(tx, row);
      }),

    create: (creatorId, input, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!(await mayRead(tx, scope, userId, creatorId))) return 'not_found';
        const [existing] = await tx.select().from(preparedScripts).where(eq(preparedScripts.id, input.id));
        if (existing !== undefined) {
          const same =
            existing.creatorId === creatorId &&
            existing.platformAccountId === input.platformAccountId &&
            isDeepStrictEqual(PreparedScriptContentSchema.parse(existing.content), input.content);
          return same ? 'replayed' : 'conflict';
        }
        const [account] = await tx
          .select({ id: platformAccounts.id })
          .from(platformAccounts)
          .where(
            and(eq(platformAccounts.id, input.platformAccountId), eq(platformAccounts.creatorId, creatorId)),
          );
        if (account === undefined) return 'account_invalid';
        try {
          // In a savepoint: an id another creator holds is hidden by her RLS, and found only by the key.
          await tx.transaction((savepoint) =>
            savepoint.insert(preparedScripts).values({
              id: input.id,
              creatorId,
              platformAccountId: input.platformAccountId,
              content: input.content,
              createdBy: userId,
              updatedBy: userId,
            }),
          );
        } catch (error) {
          if (pgCodeOf(error) === '23505') return 'conflict';
          throw error;
        }
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'prepared_script.created',
          entity: 'prepared_script',
          entityId: input.id,
          details: { creatorId, steps: input.content.steps.length },
        });
        return 'created';
      }),

    update: (creatorId, id, change, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!(await mayRead(tx, scope, userId, creatorId))) return 'not_found';
        const [row] = await tx
          .select({ state: preparedScripts.state, revision: preparedScripts.revision })
          .from(preparedScripts)
          .where(and(eq(preparedScripts.id, id), eq(preparedScripts.creatorId, creatorId)))
          .for('update');
        if (row === undefined) return 'not_found';
        if (row.state === 'matched') return 'closed';
        if (row.revision !== change.basedOnRevision) return 'stale';
        await tx
          .update(preparedScripts)
          .set({
            ...(change.content === null ? {} : { content: change.content }),
            state: change.state,
            revision: row.revision + 1,
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(eq(preparedScripts.id, id));
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: change.content === null ? 'prepared_script.state_changed' : 'prepared_script.saved',
          entity: 'prepared_script',
          entityId: id,
          details: { creatorId, state: change.state, revision: row.revision + 1 },
        });
        return 'updated';
      }),
  };
}
