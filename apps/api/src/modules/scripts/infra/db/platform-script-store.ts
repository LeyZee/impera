import {
  CreatorIdSchema,
  CurrencySchema,
  MediaSlotKindSchema,
  newId,
  PlatformAccountIdSchema,
  PlatformScriptIdSchema,
  PlatformScriptMomentSchema,
  type PlatformScript,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  schema,
  sql,
  withAdmin,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import {
  platformScriptFingerprint,
  type KnownPlatformScript,
  type PlatformScriptsPlan,
} from '../../domain/platform-scripts';
import type {
  ImportAccount,
  PlatformScriptImportStore,
  PlatformScriptReadStore,
  StoredPlatformScript,
  StoredStepMedia,
} from '../../domain/ports';

const scripts = schema.platformScripts;
const steps = schema.platformScriptSteps;
const stepMedia = schema.platformScriptStepMedia;

/** Its steps and their media, in the platform's order: `index` is the position kept (`stepIndex`, ADR 0099 § 3). */
async function writeSteps(
  tx: Transaction,
  scriptId: string,
  creatorId: string,
  script: PlatformScript,
): Promise<void> {
  await tx.insert(steps).values(
    script.steps.map((step) => ({
      platformScriptId: scriptId,
      creatorId,
      position: step.index,
      platformStepRef: step.ref.id,
      name: step.name,
      text: step.text,
      priceMinor: step.priceMinor,
      currency: step.currency,
    })),
  );
  const media = script.steps.flatMap((step) => [
    ...step.media.map((each, rank) => ({ step, each, rank, role: 'sold' })),
    ...step.previewMedia.map((each, rank) => ({ step, each, rank, role: 'preview' })),
  ]);
  if (media.length === 0) return;
  await tx.insert(stepMedia).values(
    media.map(({ step, each, rank, role }) => ({
      platformScriptId: scriptId,
      creatorId,
      position: step.index,
      role,
      rank,
      platformMediaRef: each.ref.id,
      kind: each.kind,
    })),
  );
}

/**
 * The import's writes (`scripts.import_platform_scripts`), as the service role: out of any person, one account at a
 * time, one transaction for the whole plan so that a cut import leaves the account as it was.
 */
export function createDrizzlePlatformScriptImportStore(adminDb: Database): PlatformScriptImportStore {
  return {
    accounts: () =>
      withAdmin(adminDb, async (tx) =>
        (
          await tx
            .select({ id: schema.platformAccounts.id, creatorId: schema.platformAccounts.creatorId })
            .from(schema.platformAccounts)
            .innerJoin(schema.creators, eq(schema.creators.id, schema.platformAccounts.creatorId))
            // An archived creator is read no more (ADR 0071 § 2).
            .where(sql`${schema.creators.archivedAt} is null`)
            .orderBy(schema.platformAccounts.createdAt)
        ).map((row): ImportAccount => ({
          id: PlatformAccountIdSchema.parse(row.id),
          creatorId: CreatorIdSchema.parse(row.creatorId),
        })),
      ),

    known: (accountId) =>
      withAdmin(adminDb, async (tx) =>
        (
          await tx
            .select({
              id: scripts.id,
              ref: scripts.platformScriptRef,
              fingerprint: scripts.fingerprint,
              active: scripts.active,
            })
            .from(scripts)
            .where(eq(scripts.platformAccountId, accountId))
        ).map((row): KnownPlatformScript => row),
      ),

    apply: (account, plan: PlatformScriptsPlan, now) =>
      withAdmin(adminDb, async (tx) => {
        for (const script of plan.added) {
          const id = newId(PlatformScriptIdSchema);
          await tx.insert(scripts).values({
            id,
            creatorId: account.creatorId,
            platformAccountId: account.id,
            platformScriptRef: script.ref.id,
            name: script.name,
            moment: script.moment,
            fingerprint: platformScriptFingerprint(script),
            syncedAt: now,
          });
          await writeSteps(tx, id, account.creatorId, script);
        }
        for (const { id, script } of plan.changed) {
          await tx
            .update(scripts)
            .set({
              name: script.name,
              moment: script.moment,
              fingerprint: platformScriptFingerprint(script),
              active: true,
              deactivatedAt: null,
              syncedAt: now,
            })
            .where(and(eq(scripts.id, id), eq(scripts.platformAccountId, account.id)));
          // Its media go with its steps (on delete cascade).
          await tx.delete(steps).where(eq(steps.platformScriptId, id));
          await writeSteps(tx, id, account.creatorId, script);
        }
        if (plan.unchanged.length > 0)
          await tx
            .update(scripts)
            .set({ syncedAt: now })
            .where(and(inArray(scripts.id, [...plan.unchanged]), eq(scripts.platformAccountId, account.id)));
        if (plan.gone.length > 0)
          await tx
            .update(scripts)
            .set({ active: false, deactivatedAt: now })
            .where(and(inArray(scripts.id, [...plan.gone]), eq(scripts.platformAccountId, account.id)));
      }),
  };
}

type ScriptRow = typeof scripts.$inferSelect;
type StepRow = typeof steps.$inferSelect;
type MediaRow = typeof stepMedia.$inferSelect;

/** Rows of a set of scripts, put back together in the platform's order. */
async function storedOf(tx: Transaction, rows: readonly ScriptRow[]): Promise<StoredPlatformScript[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const stepRows = await tx
    .select()
    .from(steps)
    .where(inArray(steps.platformScriptId, ids))
    .orderBy(steps.platformScriptId, steps.position);
  const mediaRows = await tx
    .select()
    .from(stepMedia)
    .where(inArray(stepMedia.platformScriptId, ids))
    .orderBy(stepMedia.platformScriptId, stepMedia.position, stepMedia.role, stepMedia.rank);
  const mediaOf = (step: StepRow, role: 'sold' | 'preview'): StoredStepMedia[] =>
    mediaRows
      .filter(
        (media: MediaRow) =>
          media.platformScriptId === step.platformScriptId && media.position === step.position,
      )
      .filter((media) => media.role === role)
      .map((media) => ({ ref: media.platformMediaRef, kind: MediaSlotKindSchema.parse(media.kind) }));
  return rows.map((row) => ({
    id: PlatformScriptIdSchema.parse(row.id),
    creatorId: CreatorIdSchema.parse(row.creatorId),
    platformAccountId: PlatformAccountIdSchema.parse(row.platformAccountId),
    ref: row.platformScriptRef,
    name: row.name,
    moment: row.moment === null ? null : PlatformScriptMomentSchema.parse(row.moment),
    active: row.active,
    deactivatedAt: row.deactivatedAt,
    syncedAt: row.syncedAt,
    steps: stepRows
      .filter((step) => step.platformScriptId === row.id)
      .map((step) => ({
        position: step.position,
        ref: step.platformStepRef,
        name: step.name,
        text: step.text,
        priceMinor: step.priceMinor,
        currency: CurrencySchema.parse(step.currency),
        media: mediaOf(step, 'sold'),
        previewMedia: mediaOf(step, 'preview'),
      })),
  }));
}

/**
 * The agency's reads of her native scripts: under her RLS and the team's scopes (the owner, an active manager of her
 * list, as her vault is read); her own account is closed by the base. Anyone else gets the same `null` for a creator
 * who exists and one who does not, never her existence.
 */
export function createDrizzlePlatformScriptReadStore(
  db: Database,
  adminDb: Database,
): PlatformScriptReadStore {
  return {
    ofCreator: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner' && scope !== 'agency') return null;
        // The owner reads every creator of hers; an active manager only those of his list, as her vault (fiche
        // vault-sync). `creators` is out of RLS: a creator who does not exist answers like one he may not read.
        const readable = await tx
          .select({ id: schema.creators.id })
          .from(schema.creators)
          .where(
            scope === 'owner'
              ? eq(schema.creators.id, creatorId)
              : sql`${schema.creators.id} = ${creatorId} and exists (select 1 from "user" u where u.id = ${userId} and ${creatorId}::uuid = any(u.creator_ids))`,
          );
        if (readable.length === 0) return null;
        const rows = await tx
          .select()
          .from(scripts)
          .where(eq(scripts.creatorId, creatorId))
          .orderBy(scripts.platformAccountId, scripts.name, scripts.id);
        return storedOf(tx, rows);
      }),

    one: (creatorId, scriptId) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select()
          .from(scripts)
          .where(and(eq(scripts.id, scriptId), eq(scripts.creatorId, creatorId)));
        const [stored] = await storedOf(tx, rows);
        return stored ?? null;
      }),
  };
}
