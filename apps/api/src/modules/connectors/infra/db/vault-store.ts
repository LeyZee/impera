import {
  MediaPlatformRefIdSchema,
  newId,
  PlatformAccountIdSchema,
  PlatformSchema,
  PlatformScriptMomentSchema,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  schema,
  sql,
  withTenant,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import { readsCreatorFigures } from '../../domain/connector-reads';
import {
  planVaultSync,
  type StoredVaultRef,
  type VaultRefRow,
  type VaultStore,
} from '../../domain/vault-sync';

import { readerIn } from './connector-reads-store';

const KindSchema = z.enum(['image', 'video', 'audio']);

const columns = {
  platform: schema.mediaPlatformRefs.platform,
  platformAccountId: schema.mediaPlatformRefs.platformAccountId,
  platformMediaId: schema.mediaPlatformRefs.platformMediaId,
  kind: schema.mediaPlatformRefs.kind,
  folderRef: schema.mediaPlatformRefs.folderRef,
  folderName: schema.mediaPlatformRefs.folderName,
  folderMoment: schema.mediaPlatformRefs.folderMoment,
  folderPosition: schema.mediaPlatformRefs.folderPosition,
  platformCreatedAt: schema.mediaPlatformRefs.platformCreatedAt,
  durationSeconds: schema.mediaPlatformRefs.durationSeconds,
  platformDescription: schema.mediaPlatformRefs.platformDescription,
  suggestedMinMinor: schema.mediaPlatformRefs.suggestedMinMinor,
  suggestedMaxMinor: schema.mediaPlatformRefs.suggestedMaxMinor,
  lastSyncedAt: schema.mediaPlatformRefs.lastSyncedAt,
  removedAt: schema.mediaPlatformRefs.removedAt,
};

type Row = Awaited<ReturnType<typeof selectRows>>[number];

const selectRows = (tx: Transaction) => tx.select(columns).from(schema.mediaPlatformRefs);

function rowOf(row: Row): VaultRefRow {
  return {
    platform: PlatformSchema.parse(row.platform),
    platformAccountId: PlatformAccountIdSchema.parse(row.platformAccountId),
    platformMediaId: row.platformMediaId,
    kind: KindSchema.parse(row.kind),
    folderRef: row.folderRef,
    folderName: row.folderName,
    folderMoment: row.folderMoment === null ? null : PlatformScriptMomentSchema.parse(row.folderMoment),
    folderPosition: row.folderPosition,
    platformCreatedAt: row.platformCreatedAt.toISOString(),
    durationSeconds: row.durationSeconds,
    platformDescription: row.platformDescription,
    suggestedMinMinor: row.suggestedMinMinor,
    suggestedMaxMinor: row.suggestedMaxMinor,
    lastSyncedAt: row.lastSyncedAt,
    removedAt: row.removedAt,
  };
}

/**
 * `media_platform_refs` (fiche vault-sync): written by the sync in the creator's tenant, read by the agency in the
 * person's own `withTenantMember` (the owner, an active manager of her list).
 */
export function createDrizzleVaultStore(db: Database): VaultStore {
  return {
    apply: (account, read, now) =>
      withTenant(db, account.creatorId, async (tx) => {
        // ADR 0071: an archived creator is no longer read, nor written.
        const [creator] = await tx
          .select({ archivedAt: schema.creators.archivedAt })
          .from(schema.creators)
          .where(eq(schema.creators.id, account.creatorId));
        // Unknown, or archived (`archivedAt` set): nothing read, nothing written.
        if (creator?.archivedAt !== null) return null;
        // Locked: two syncs of one account write one after the other (the job runs on the account's queue anyway).
        const kept = await selectRows(tx)
          .where(eq(schema.mediaPlatformRefs.platformAccountId, account.id))
          .for('update');
        const stored: StoredVaultRef[] = kept.map((row) => ({
          ...rowOf(row),
          removed: row.removedAt !== null,
        }));
        const plan = planVaultSync(read, stored);
        for (const row of plan.upserts) {
          const values = {
            kind: row.kind,
            folderRef: row.folderRef,
            folderName: row.folderName,
            folderMoment: row.folderMoment,
            folderPosition: row.folderPosition,
            platformCreatedAt: new Date(row.platformCreatedAt),
            durationSeconds: row.durationSeconds,
            platformDescription: row.platformDescription,
            suggestedMinMinor: row.suggestedMinMinor,
            suggestedMaxMinor: row.suggestedMaxMinor,
            lastSyncedAt: now,
            removedAt: null,
          };
          await tx
            .insert(schema.mediaPlatformRefs)
            .values({
              id: newId(MediaPlatformRefIdSchema),
              creatorId: account.creatorId,
              platform: account.platform,
              platformAccountId: account.id,
              platformMediaId: row.platformMediaId,
              ...values,
            })
            .onConflictDoUpdate({
              target: [schema.mediaPlatformRefs.platformAccountId, schema.mediaPlatformRefs.platformMediaId],
              set: values,
            });
        }
        if (plan.removals.length > 0) {
          await tx
            .update(schema.mediaPlatformRefs)
            .set({ removedAt: now, lastSyncedAt: now })
            .where(
              and(
                eq(schema.mediaPlatformRefs.platformAccountId, account.id),
                inArray(schema.mediaPlatformRefs.platformMediaId, [...plan.removals]),
                sql`${schema.mediaPlatformRefs.removedAt} is null`,
              ),
            );
        }
        return { listed: read.length, written: plan.upserts.length, removed: plan.removals.length };
      }),

    rows: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!readsCreatorFigures(await readerIn(tx, userId, creatorId, scope))) return null;
        return (await selectRows(tx)).map(rowOf);
      }),
  };
}
