import {
  BranchConditionSchema,
  CreatorIdSchema,
  CurrencySchema,
  DescriptionReviewReasonSchema,
  MediaSlotKindSchema,
  newId,
  PlatformAccountIdSchema,
  PlatformSchema,
  PlatformScriptIdSchema,
  PlatformScriptMomentSchema,
  PreparedScriptContentSchema,
  PreparedScriptIdSchema,
  ScriptIdentityAuthorSchema,
  ScriptIdentityContentSchema,
  ScriptIdentityIdSchema,
  type CreatorId,
  type PlatformScript,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  onCreatorList,
  schema,
  sql,
  withAdmin,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import { readingKey, type DailyReading, type MeasuredScript } from '../../domain/performance';
import {
  platformScriptFingerprint,
  type KnownPlatformScript,
  type PlatformScriptsPlan,
} from '../../domain/platform-scripts';
import type {
  OurCopy,
  PlatformScriptImportStore,
  PlatformScriptReadStore,
  StoredPlatformScript,
  StoredStepMedia,
} from '../../domain/ports';

const scripts = schema.platformScripts;
const steps = schema.platformScriptSteps;
const stepMedia = schema.platformScriptStepMedia;
const identities = schema.scriptIdentities;
const branches = schema.platformScriptBranches;
const daily = schema.platformScriptStepDaily;

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
      platformIndex: step.platformIndex,
      platformStepRef: step.ref.id,
      name: step.name,
      text: step.text,
      priceMinor: step.priceMinor,
      currency: step.currency,
      discountPriceMinor: step.discount?.priceMinor ?? null,
      discountMinutes: step.discount?.minutes ?? null,
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
    account: (creatorId, platformAccountId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({
            id: schema.platformAccounts.id,
            creatorId: schema.platformAccounts.creatorId,
            platform: schema.platformAccounts.platform,
          })
          .from(schema.platformAccounts)
          .innerJoin(schema.creators, eq(schema.creators.id, schema.platformAccounts.creatorId))
          // Hers, and an archived creator is read no more (ADR 0071 § 2).
          .where(
            and(
              eq(schema.platformAccounts.id, platformAccountId),
              eq(schema.platformAccounts.creatorId, creatorId),
              sql`${schema.creators.archivedAt} is null`,
            ),
          );
        return row === undefined
          ? null
          : {
              id: PlatformAccountIdSchema.parse(row.id),
              creatorId: CreatorIdSchema.parse(row.creatorId),
              platform: PlatformSchema.parse(row.platform),
            };
      }),

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

    apply: (account, plan: PlatformScriptsPlan, now, totals) =>
      withAdmin(adminDb, async (tx) => {
        const written: string[] = [];
        for (const script of plan.added) {
          const id = newId(PlatformScriptIdSchema);
          written.push(id);
          await tx.insert(scripts).values({
            id,
            creatorId: account.creatorId,
            platformAccountId: account.id,
            platformScriptRef: script.ref.id,
            name: script.name,
            moment: script.moment,
            fingerprint: platformScriptFingerprint(script),
            syncedAt: now,
            versionAt: now,
          });
          await writeSteps(tx, id, account.creatorId, script);
        }
        for (const { id, script } of plan.changed) {
          written.push(id);
          await tx
            .update(scripts)
            .set({
              name: script.name,
              moment: script.moment,
              fingerprint: platformScriptFingerprint(script),
              active: true,
              deactivatedAt: null,
              syncedAt: now,
              versionAt: now,
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
        // The platform's totals of its steps on the day, over the row of the same day (ADR 0129 § 12).
        if (totals !== null && totals.steps.length > 0)
          await tx
            .insert(daily)
            .values(
              totals.steps.map((each) => ({
                creatorId: account.creatorId,
                platformAccountId: account.id,
                platformStepRef: each.platformStepRef,
                day: totals.day,
                sent: each.sent,
                purchased: each.purchased,
                paidMinor: each.paidMinor,
                currency: each.currency,
                readAt: now,
              })),
            )
            .onConflictDoUpdate({
              target: [daily.platformAccountId, daily.platformStepRef, daily.day],
              set: {
                sent: sql`excluded.sent`,
                purchased: sql`excluded.purchased`,
                paidMinor: sql`excluded.paid_minor`,
                currency: sql`excluded.currency`,
                readAt: sql`excluded.read_at`,
              },
            });
        return written;
      }),
  };
}

type ScriptRow = typeof scripts.$inferSelect;
type StepRow = typeof steps.$inferSelect;
type MediaRow = typeof stepMedia.$inferSelect;

const LinkRowSchema = z.object({
  platform_account_id: z.uuid(),
  platform_media_id: z.string(),
  media_asset_id: z.uuid().nullable(),
  description_id: z.uuid().nullable(),
  imported: z.boolean(),
  offered: z.boolean(),
  shown_id: z.uuid().nullable(),
  shown_detailed: z.string().nullable(),
  shown_reasons: z.array(DescriptionReviewReasonSchema).nullable(),
  shown_validated: z.boolean().nullable(),
});

/**
 * Where the media of these scripts stand in her vault (`media_platform_refs`, written by the vault sync, fiche
 * vault-sync), in the caller's transaction and so under its RLS: a link the platform no longer lists (`removed_at`) is
 * not in the vault. `description_id`: the latest description of its media a human validated (ADR 0083), with its
 * `detailed` text, as the script sheet reads it (SC-04 lot c4); `imported`, chosen for the CRM (ADR 0145 § 5);
 * `offered`, offered once (§ 2, `vaultOffered`); `shown`, the description the agency reviews (the latest validated,
 * else the latest written with a `detailed` text: never the platform's own, which has none, ADR 0099 § 4). Keyed by
 * account and platform id.
 */
async function vaultLinksOf(
  tx: Transaction,
  rows: readonly ScriptRow[],
  mediaRows: readonly MediaRow[],
): Promise<Map<string, StoredStepMedia['vault']>> {
  if (mediaRows.length === 0) return new Map();
  const accounts = sql.join(
    [...new Set(rows.map((row) => row.platformAccountId))].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const refs = sql.join(
    [...new Set(mediaRows.map((media) => media.platformMediaRef))].map((ref) => sql`${ref}`),
    sql`, `,
  );
  const result = await tx.execute(sql`
    select l.platform_account_id, l.platform_media_id, l.media_asset_id,
      (select md.id from ${schema.mediaDescriptions} md
        where md.media_asset_id = l.media_asset_id and md.validated_at is not null and md.content ? 'detailed'
        order by md.validated_at desc, md.created_at desc, md.id desc
        limit 1) as description_id,
      ${schema.vaultImported({ account: sql`l.platform_account_id`, media: sql`l.platform_media_id`, folder: sql`l.folder_ref` })} as imported,
      ${schema.vaultOffered({ sentForFreeAt: sql`l.sent_for_free_at`, mediaAsset: sql`l.media_asset_id` })} as offered,
      s.id as shown_id, s.content ->> 'detailed' as shown_detailed, s.review_reasons as shown_reasons,
      s.validated_at is not null as shown_validated
    from ${schema.mediaPlatformRefs} l
    left join lateral (
      select md.id, md.content, md.review_reasons, md.validated_at from ${schema.mediaDescriptions} md
        where md.media_asset_id = l.media_asset_id and md.content ? 'detailed'
        order by md.validated_at is not null desc, md.validated_at desc nulls last, md.created_at desc, md.id desc
        limit 1) s on true
    where l.platform_account_id in (${accounts})
      and l.platform_media_id in (${refs})
      and l.removed_at is null`);
  return new Map(
    z
      .array(LinkRowSchema)
      .parse(result.rows)
      .map((row) => [
        `${row.platform_account_id}:${row.platform_media_id}`,
        {
          mediaAssetId: row.media_asset_id,
          descriptionId: row.description_id,
          imported: row.imported,
          offered: row.offered,
          shown:
            row.shown_id === null || row.shown_detailed === null
              ? null
              : {
                  id: row.shown_id,
                  detailed: row.shown_detailed,
                  reviewReasons: row.shown_reasons ?? [],
                  validated: row.shown_validated === true,
                },
        },
      ]),
  );
}

/**
 * Rows of a set of scripts, put back together in the platform's order, with their vault links, the settings of their
 * branches (ADR 0112) and their identities.
 */
export async function storedOf(tx: Transaction, rows: readonly ScriptRow[]): Promise<StoredPlatformScript[]> {
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
  const links = await vaultLinksOf(tx, rows, mediaRows);
  const identityRows = await tx
    .select()
    .from(identities)
    .where(inArray(identities.platformScriptId, ids))
    .orderBy(identities.createdAt, identities.id);
  const branchRows = await tx
    .select()
    .from(branches)
    .where(inArray(branches.platformScriptId, ids))
    .orderBy(branches.platformScriptId, branches.branchOrder, branches.platformStepRef);
  // The scripts of ours they are the recognised copies of (ADR 0161 § 5), in the same transaction.
  const oursRows = await tx
    .select({
      id: schema.preparedScripts.id,
      content: schema.preparedScripts.content,
      nativeId: schema.preparedScripts.matchedPlatformScriptId,
    })
    .from(schema.preparedScripts)
    .where(
      and(
        inArray(schema.preparedScripts.matchedPlatformScriptId, ids),
        eq(schema.preparedScripts.state, 'matched'),
      ),
    )
    // Nothing keeps two of ours from naming the same native script: the last recognised wins, always the same one.
    .orderBy(schema.preparedScripts.matchedAt, schema.preparedScripts.id);
  const ours = new Map(
    oursRows.map((row): [string | null, OurCopy] => {
      const content = PreparedScriptContentSchema.parse(row.content);
      return [
        row.nativeId,
        {
          preparedScriptId: PreparedScriptIdSchema.parse(row.id),
          description: content.description,
          moment: content.moment,
          steps: content.steps.map((step) => ({
            branches: step.branches.map((branch) => ({
              priceMinor: branch.priceMinor,
              currency: branch.currency,
            })),
          })),
        },
      ];
    }),
  );
  const accountOf = new Map(rows.map((row) => [row.id, row.platformAccountId]));
  const mediaOf = (step: StepRow, role: 'sold' | 'preview'): StoredStepMedia[] =>
    mediaRows
      .filter(
        (media: MediaRow) =>
          media.platformScriptId === step.platformScriptId && media.position === step.position,
      )
      .filter((media) => media.role === role)
      .map((media) => ({
        ref: media.platformMediaRef,
        kind: MediaSlotKindSchema.parse(media.kind),
        vault: links.get(`${accountOf.get(media.platformScriptId) ?? ''}:${media.platformMediaRef}`) ?? null,
      }));
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
        platformIndex: step.platformIndex,
        ref: step.platformStepRef,
        name: step.name,
        text: step.text,
        priceMinor: step.priceMinor,
        currency: CurrencySchema.parse(step.currency),
        discount:
          step.discountPriceMinor === null && step.discountMinutes === null
            ? null
            : { priceMinor: step.discountPriceMinor, minutes: step.discountMinutes },
        media: mediaOf(step, 'sold'),
        previewMedia: mediaOf(step, 'preview'),
      })),
    branches: branchRows
      .filter((branch) => branch.platformScriptId === row.id)
      .map((branch) => ({
        stepRef: branch.platformStepRef,
        order: branch.branchOrder,
        condition: BranchConditionSchema.parse(branch.condition),
      })),
    identities: identityRows
      .filter((identity) => identity.platformScriptId === row.id)
      .map((identity) => ({
        id: ScriptIdentityIdSchema.parse(identity.id),
        inputHash: identity.inputHash,
        content: ScriptIdentityContentSchema.parse(identity.content),
        author: ScriptIdentityAuthorSchema.parse(identity.author),
        promptHash: identity.promptHash,
        validatedAt: identity.validatedAt,
        createdAt: identity.createdAt,
      })),
    ours: ours.get(row.id) ?? null,
  }));
}

/**
 * The agency's reads of her native scripts: under her RLS and the team's scopes (the owner, an active manager of her
 * list, `onCreatorList`, as her vault is read); her own account is closed by the base. Anyone else gets the same `null`
 * for a creator who exists and one who does not, never her existence. Her vault links are read in the same
 * transaction, never by the service role. `oneForJob` and `ofAccountForJob` alone are the service role's, for a job.
 */
/**
 * `run` as a person of the agency reads her native scripts: in his transaction, under her RLS and his scope. The owner
 * reads every creator of hers; an active manager only those of his list, as her vault (fiche vault-sync). `creators` is
 * out of RLS: a creator who does not exist answers like one he may not read (`null`).
 */
function asTeam<T>(
  db: Database,
  creatorId: CreatorId,
  userId: string,
  run: (tx: Transaction) => Promise<T>,
): Promise<T | null> {
  return withTenantMember(db, creatorId, userId, async (tx, scope) => {
    if (scope !== 'owner' && scope !== 'agency') return null;
    if (scope === 'agency' && !(await onCreatorList(tx, userId, creatorId))) return null;
    const readable = await tx
      .select({ id: schema.creators.id })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId));
    if (readable.length === 0) return null;
    return run(tx);
  });
}

const DiscountedRowSchema = z.object({
  id: PlatformScriptIdSchema,
  name: z.string(),
  steps: z.number().int().positive(),
  since: z.date(),
});

export function createDrizzlePlatformScriptReadStore(
  db: Database,
  adminDb: Database,
): PlatformScriptReadStore {
  return {
    ofCreator: (creatorId, userId) =>
      asTeam(db, creatorId, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(scripts)
          .where(eq(scripts.creatorId, creatorId))
          .orderBy(scripts.platformAccountId, scripts.name, scripts.id);
        return storedOf(tx, rows);
      }),

    discountedOf: (creatorId, userId) =>
      asTeam(db, creatorId, userId, async (tx) => {
        const rows = await tx
          .select({
            id: scripts.id,
            name: scripts.name,
            since: scripts.versionAt,
            steps: sql<number>`count(*)::int`,
          })
          .from(scripts)
          .innerJoin(steps, eq(steps.platformScriptId, scripts.id))
          .where(
            and(
              eq(scripts.creatorId, creatorId),
              eq(scripts.active, true),
              sql`(${steps.discountPriceMinor} is not null or ${steps.discountMinutes} is not null)`,
            ),
          )
          .groupBy(scripts.id)
          .orderBy(scripts.versionAt, scripts.id);
        return rows.map((row) => DiscountedRowSchema.parse(row));
      }),

    oneForJob: (creatorId, scriptId) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select()
          .from(scripts)
          .where(and(eq(scripts.id, scriptId), eq(scripts.creatorId, creatorId)));
        const [stored] = await storedOf(tx, rows);
        return stored ?? null;
      }),

    performanceOf: (creatorId, userId) =>
      asTeam(db, creatorId, userId, async (tx) => {
        // Her active scripts recognised as ours (ADR 0161: the native ones of another tool are not measured).
        const ours = await tx
          .selectDistinct({
            id: scripts.id,
            platformAccountId: scripts.platformAccountId,
            ref: scripts.platformScriptRef,
            name: scripts.name,
            moment: scripts.moment,
          })
          .from(scripts)
          .innerJoin(schema.preparedScripts, eq(schema.preparedScripts.matchedPlatformScriptId, scripts.id))
          .where(
            and(
              eq(scripts.creatorId, creatorId),
              eq(scripts.active, true),
              eq(schema.preparedScripts.state, 'matched'),
            ),
          );
        const ids = ours.map((one) => one.id);
        const stepRows =
          ids.length === 0
            ? []
            : await tx
                .select({
                  scriptId: steps.platformScriptId,
                  platformIndex: steps.platformIndex,
                  ref: steps.platformStepRef,
                  priceMinor: steps.priceMinor,
                  currency: steps.currency,
                })
                .from(steps)
                .where(inArray(steps.platformScriptId, ids))
                .orderBy(steps.platformScriptId, steps.platformIndex, steps.position);
        const readingRows =
          ids.length === 0
            ? []
            : await tx
                .select({
                  platformAccountId: daily.platformAccountId,
                  ref: daily.platformStepRef,
                  day: daily.day,
                  sent: daily.sent,
                  purchased: daily.purchased,
                  paidMinor: daily.paidMinor,
                })
                .from(daily)
                .where(eq(daily.creatorId, creatorId))
                .orderBy(daily.day);
        const readings = new Map<string, DailyReading[]>();
        for (const row of readingRows) {
          const key = readingKey(row.platformAccountId, row.ref);
          readings.set(key, [...(readings.get(key) ?? []), row]);
        }
        const measured = ours.flatMap((one): MeasuredScript[] => {
          const own = stepRows.filter((row) => row.scriptId === one.id);
          const first = own[0];
          if (first === undefined) return [];
          const ranks = [...new Set(own.map((row) => row.platformIndex))].sort((a, b) => a - b);
          return [
            {
              id: PlatformScriptIdSchema.parse(one.id),
              ref: one.ref,
              name: one.name,
              moment: one.moment === null ? null : PlatformScriptMomentSchema.parse(one.moment),
              currency: CurrencySchema.parse(first.currency),
              steps: ranks.map((platformIndex, rank) => {
                const branchRows = own.filter((row) => row.platformIndex === platformIndex);
                return {
                  rank,
                  refs: branchRows.map((row) => readingKey(one.platformAccountId, row.ref)),
                  paid: branchRows.some((row) => row.priceMinor > 0),
                };
              }),
            },
          ];
        });
        return { scripts: measured, readings };
      }),

    ofAccountForJob: (creatorId, platformAccountId) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select()
          .from(scripts)
          .where(and(eq(scripts.creatorId, creatorId), eq(scripts.platformAccountId, platformAccountId)))
          .orderBy(scripts.name, scripts.id);
        return storedOf(tx, rows);
      }),
  };
}
