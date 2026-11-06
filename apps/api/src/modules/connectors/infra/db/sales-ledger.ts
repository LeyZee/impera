import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  creatorNameKey,
  EVENT_PAYLOADS,
  EventIdSchema,
  JOB_MAX_ATTEMPTS,
  newId,
  PlatformAccountIdSchema,
  PlatformModelStatusSchema,
  PlatformSchema,
  SaleEventSchema,
  SalesFeedCheckIdSchema,
  SalesFeedCheckReportSchema,
  SalesLineIdSchema,
  type CreatorId,
  type JobPayload,
  type Platform,
  type PlatformSale,
  type SalesFeedImportLineResult,
  type SalesFeedImportRefusal,
  type SalesFeedSignal,
} from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import { importedNameOf } from '../../domain/model-import';
import type { CheckLine } from '../../domain/reliability-check';
import {
  inputsHashOf,
  type ChatterLink,
  type LinkedAccount,
  type RecordedPage,
  type SalesLedger,
} from '../../domain/sales-feed';
import { ringsWhenRecorded } from '../../domain/sales-totals';

import { sellerOf } from './seller';

const sales = schema.platformSales;
const quarantine = schema.platformSalesQuarantine;
const cursors = schema.salesFeedCursors;
const models = schema.salesFeedModels;
const chatters = schema.salesFeedChatters;
const checks = schema.salesFeedChecks;
const dismissals = schema.salesFeedModelDismissals;
const sightings = schema.salesFeedModelSightings;

/** The columns of a line, shared by the register and the quarantine. */
function lineValues(platform: Platform, sale: PlatformSale) {
  return {
    platform,
    platformSaleId: sale.platformSaleId,
    event: sale.event,
    saleType: sale.type,
    rawType: sale.rawType,
    status: sale.status,
    rawStatus: sale.rawStatus,
    occurredAt: new Date(sale.occurredAt),
    platformModelId: sale.platformModelId,
    platformChatterId: sale.platformChatterId,
    platformFanId: sale.platformFanId,
    currency: sale.currency,
    grossInclVatMinor: sale.amounts.grossInclVat,
    grossExclVatMinor: sale.amounts.grossExclVat,
    netMinor: sale.amounts.net,
    agencyMinor: sale.amounts.agency,
    creatorMinor: sale.amounts.creator,
    position: sale.position,
    inputsHash: inputsHashOf(sale),
  };
}

/** A created creator's zone until the owner changes it on her page (ADR 0069 § 3). */
const IMPORTED_TIMEZONE = 'Europe/Paris';

/** A line of the import refused: the transaction rolls back, and the line says why. */
class ImportRefused extends Error {
  constructor(readonly reason: SalesFeedImportRefusal) {
    super(`sales feed import refused: ${reason}`);
  }
}

/** A unique index refused the row, raised by the driver directly or wrapped by Drizzle (`cause`). */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof Error &&
    [error, error.cause].some(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        e.code === '23505' &&
        'constraint' in e &&
        e.constraint === constraint,
    )
  );
}

async function auditModel(
  tx: Transaction,
  action: 'sales_feed.model_dismissed' | 'sales_feed.model_restored' | 'sales_feed.model_imported',
  platform: Platform,
  platformModelId: string,
  by: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: by,
    action,
    entity: 'sales_feed_model',
    entityId: `${platform}:${platformModelId}`,
    details: { platform, platformModelId, ...details },
  });
}

/** `SET LOCAL app.creator_id`: what follows in the transaction is that creator's, as in `withTenant`. */
async function enterTenant(tx: Transaction, creatorId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.creator_id', ${creatorId}, true)`);
}

async function lockCursor(tx: Transaction, platform: Platform): Promise<string | null> {
  await tx.insert(cursors).values({ platform }).onConflictDoNothing();
  const [row] = await tx
    .select({ position: cursors.position })
    .from(cursors)
    .where(eq(cursors.platform, platform))
    .for('update');
  return row?.position ?? null;
}

const ChatterRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), memberId: z.uuid() }),
  z.object({ kind: z.literal('agent'), memberId: z.null() }),
]);

/**
 * The register through the application role: a page, its quarantined lines and the cursor in one transaction, each
 * line of a linked model inside its creator's tenant, so RLS checks that it lands where its link says. Signals go
 * through the admin role, which alone writes an event with no creator; one lost to a crash is said again by the next
 * occurrence, as `once` looks for an earlier one rather than trusting the register.
 */
export function createDrizzleSalesLedger(db: Database, adminDb: Database): SalesLedger {
  return {
    async cursorOf(platform) {
      const [row] = await db.select().from(cursors).where(eq(cursors.platform, platform));
      return {
        position: row?.position ?? null,
        readAt: row?.readAt ?? null,
        pausedUntil: row?.pausedUntil ?? null,
      };
    },

    recordPage(platform, from, page, at, correlationId) {
      return db.transaction(async (tx): Promise<RecordedPage> => {
        const current = await lockCursor(tx, platform);
        if (current !== from) {
          return { stale: true, recorded: 0, quarantined: 0, duplicates: 0, changed: [], unlinkedModels: [] };
        }
        const modelIds = [...new Set(page.sales.map((sale) => sale.platformModelId))];
        const linkRows =
          modelIds.length === 0
            ? []
            : await tx
                .select()
                .from(models)
                .where(and(eq(models.platform, platform), sql`${models.platformModelId} in ${modelIds}`));
        const links = new Map(linkRows.map((row) => [row.platformModelId, row]));
        const chatterIds = [
          ...new Set(
            page.sales.flatMap((sale) => (sale.platformChatterId === null ? [] : [sale.platformChatterId])),
          ),
        ];
        const chatterRows =
          chatterIds.length === 0
            ? []
            : await tx
                .select({
                  platformChatterId: chatters.platformChatterId,
                  kind: chatters.kind,
                  memberId: chatters.memberId,
                })
                .from(chatters)
                .where(
                  and(eq(chatters.platform, platform), sql`${chatters.platformChatterId} in ${chatterIds}`),
                );
        const chatterLinks = new Map(chatterRows.map((row) => [row.platformChatterId, row]));
        let recorded = 0;
        let quarantined = 0;
        let duplicates = 0;
        const changed: { platformSaleId: string; event: PlatformSale['event'] }[] = [];
        const unlinked = new Set<string>();
        for (const sale of page.sales) {
          const values = lineValues(platform, sale);
          const link = links.get(sale.platformModelId);
          const lineKey = (table: typeof sales | typeof quarantine) =>
            and(
              eq(table.platform, platform),
              eq(table.platformSaleId, sale.platformSaleId),
              eq(table.event, sale.event),
            );
          if (link !== undefined) {
            await enterTenant(tx, link.creatorId);
            const inserted = await tx
              .insert(sales)
              .values({
                id: newId(SalesLineIdSchema),
                creatorId: link.creatorId,
                platformAccountId: link.platformAccountId,
                ...values,
              })
              .onConflictDoNothing()
              .returning({ id: sales.id });
            const [line] = inserted;
            if (line !== undefined) {
              recorded += 1;
              // A fresh sale rings once, in the transaction that records it; one read late is late (CRM-04).
              if (ringsWhenRecorded(values, at)) {
                const eventId = newId(EventIdSchema);
                await tx.insert(schema.domainEvents).values({
                  id: eventId,
                  creatorId: link.creatorId,
                  type: 'sale_detected',
                  payload: EVENT_PAYLOADS.sale_detected.parse({
                    saleId: line.id,
                    platform,
                    platformAccountId: link.platformAccountId,
                    saleType: sale.type,
                    occurredAt: values.occurredAt.toISOString(),
                    currency: sale.currency,
                    grossInclVatMinor: sale.amounts.grossInclVat,
                    netMinor: sale.amounts.net,
                    agencyMinor: sale.amounts.agency,
                    creatorMinor: sale.amounts.creator,
                    seller: sellerOf(
                      sale.platformChatterId,
                      sale.platformChatterId === null ? undefined : chatterLinks.get(sale.platformChatterId),
                    ),
                  }),
                  actor: 'system',
                  correlationId,
                });
                // Her own accounts are told too (CRM-04 lot d2), by a job that exists only once the sale is committed.
                await tx.execute(
                  sql`select public.enqueue_job(
                    task => ${'notifications.creator_sale'},
                    payload => ${JSON.stringify({ eventId })}::jsonb,
                    queue_name => null,
                    run_at => null,
                    max_attempts => ${JOB_MAX_ATTEMPTS['notifications.creator_sale']}::int,
                    job_key => ${`notifications.creator_sale:${line.id}`},
                    job_key_mode => ${'preserve_run_at'}
                  )`,
                );
              }
              continue;
            }
            duplicates += 1;
            const [existing] = await tx
              .select({ inputsHash: sales.inputsHash })
              .from(sales)
              .where(lineKey(sales));
            // A line of another creator is invisible here (RLS): only a visible one is compared.
            if (existing !== undefined && existing.inputsHash !== values.inputsHash) {
              changed.push({ platformSaleId: sale.platformSaleId, event: sale.event });
            }
            continue;
          }
          unlinked.add(sale.platformModelId);
          const inserted = await tx
            .insert(quarantine)
            .values({ id: newId(SalesLineIdSchema), ...values })
            .onConflictDoNothing()
            .returning({ id: quarantine.id });
          if (inserted.length === 1) {
            quarantined += 1;
            continue;
          }
          duplicates += 1;
          const [existing] = await tx
            .select({ inputsHash: quarantine.inputsHash })
            .from(quarantine)
            .where(lineKey(quarantine));
          if (existing !== undefined && existing.inputsHash !== values.inputsHash) {
            changed.push({ platformSaleId: sale.platformSaleId, event: sale.event });
          }
        }
        // A page with nothing after it: the register was read to its end at `at` (ADR 0073 § 2).
        await tx
          .update(cursors)
          .set({
            position: page.endPosition ?? current,
            readAt: at,
            ...(!page.hasMore && { caughtUpAt: at }),
            pausedUntil: null,
            updatedAt: at,
          })
          .where(eq(cursors.platform, platform));
        return { stale: false, recorded, quarantined, duplicates, changed, unlinkedModels: [...unlinked] };
      });
    },

    async pause(platform, until) {
      await db
        .insert(cursors)
        .values({ platform, pausedUntil: until })
        .onConflictDoUpdate({ target: cursors.platform, set: { pausedUntil: until, updatedAt: new Date() } });
    },

    async quarantined(platform) {
      const rows = await db
        .select({ model: quarantine.platformModelId, count: sql<number>`count(*)::int` })
        .from(quarantine)
        .where(and(eq(quarantine.platform, platform), sql`${quarantine.releasedAt} is null`))
        .groupBy(quarantine.platformModelId);
      return new Map(rows.map((row) => [row.model, row.count]));
    },

    async modelLinks(platform) {
      const rows = await db.select().from(models).where(eq(models.platform, platform));
      return new Map(
        rows.map((row) => [
          row.platformModelId,
          { platformAccountId: row.platformAccountId, creatorId: row.creatorId, linkedBy: row.linkedBy },
        ]),
      );
    },

    accounts(platform) {
      // Every creator's accounts: `platform_accounts` is under RLS, so the admin role lists them (the owner's screen).
      return withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({
            platformAccountId: schema.platformAccounts.id,
            creatorId: schema.platformAccounts.creatorId,
            handle: schema.platformAccounts.handle,
            creatorDisplayName: schema.creators.displayName,
          })
          .from(schema.platformAccounts)
          .innerJoin(schema.creators, eq(schema.creators.id, schema.platformAccounts.creatorId))
          .where(eq(schema.platformAccounts.platform, platform))
          .orderBy(schema.platformAccounts.handle);
        return rows;
      });
    },

    linkModel(platform, platformModelId, account, by) {
      return db.transaction((tx) => linkIn(tx, adminDb, platform, platformModelId, account, by));
    },

    async unlinkModel(platform, platformModelId, by) {
      await db.transaction(async (tx) => {
        const removed = await tx
          .delete(models)
          .where(and(eq(models.platform, platform), eq(models.platformModelId, platformModelId)))
          .returning({ platformAccountId: models.platformAccountId });
        const [was] = removed;
        if (was === undefined) return;
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: by,
          action: 'sales_feed.model_unlinked',
          entity: 'sales_feed_model',
          entityId: `${platform}:${platformModelId}`,
          details: { platform, platformModelId, previousAccountId: was.platformAccountId },
        });
      });
    },

    async creators() {
      const rows = await db
        .select({ creatorId: schema.creators.id, displayName: schema.creators.displayName })
        .from(schema.creators)
        .orderBy(schema.creators.displayName);
      return rows.map((row) => ({ ...row, creatorId: CreatorIdSchema.parse(row.creatorId) }));
    },

    async dismissals(platform) {
      const rows = await db.select().from(dismissals).where(eq(dismissals.platform, platform));
      return new Map(rows.map((row) => [row.platformModelId, row.dismissedAt]));
    },

    async sightings(platform) {
      const rows = await db.select().from(sightings).where(eq(sightings.platform, platform));
      return new Map(
        rows.map((row) => [
          row.platformModelId,
          {
            platformModelId: row.platformModelId,
            status: PlatformModelStatusSchema.parse(row.status),
            goneSignalledAt: row.goneSignalledAt,
            bannedSignalledAt: row.bannedSignalledAt,
          },
        ]),
      );
    },

    async recordSightings(platform, listed, changes, now) {
      const banned = new Set(changes.banned);
      const unbanned = new Set(changes.unbanned);
      await db.transaction(async (tx) => {
        for (const model of listed) {
          const id = model.platformModelId;
          const bannedMark = banned.has(id) ? now : unbanned.has(id) ? null : undefined;
          await tx
            .insert(sightings)
            .values({
              platform,
              platformModelId: id,
              status: model.status,
              isActive: model.isActive,
              firstSeenAt: now,
              lastSeenAt: now,
              bannedSignalledAt: bannedMark ?? null,
            })
            .onConflictDoUpdate({
              target: [sightings.platform, sightings.platformModelId],
              set: {
                status: model.status,
                isActive: model.isActive,
                lastSeenAt: now,
                // Listed again: a later departure is signalled again.
                goneSignalledAt: null,
                ...(bannedMark === undefined ? {} : { bannedSignalledAt: bannedMark }),
              },
            });
        }
        for (const id of changes.gone) {
          // Never listed since the table exists: a row of its own, `other` and inactive, so that it is signalled once.
          await tx
            .insert(sightings)
            .values({
              platform,
              platformModelId: id,
              status: 'other',
              isActive: false,
              firstSeenAt: now,
              lastSeenAt: now,
              goneSignalledAt: now,
            })
            .onConflictDoUpdate({
              target: [sightings.platform, sightings.platformModelId],
              set: { goneSignalledAt: now },
            });
        }
      });
    },

    async newModels() {
      const rows = await db
        .select({ platform: sightings.platform, count: sql<number>`count(*)::int` })
        .from(sightings)
        .where(
          and(
            sql`${sightings.goneSignalledAt} is null`,
            sql`${sightings.lastSeenAt} = (select max(latest.last_seen_at) from ${sightings} latest
                                          where latest.platform = ${sightings.platform})`,
            sql`not exists (select 1 from ${models} link
                             where link.platform = ${sightings.platform}
                               and link.platform_model_id = ${sightings.platformModelId})`,
            sql`not exists (select 1 from ${dismissals} aside
                             where aside.platform = ${sightings.platform}
                               and aside.platform_model_id = ${sightings.platformModelId})`,
          ),
        )
        .groupBy(sightings.platform)
        .orderBy(sightings.platform);
      return rows.map((row) => ({ platform: PlatformSchema.parse(row.platform), count: row.count }));
    },

    async dismissModel(platform, platformModelId, by) {
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(dismissals)
          .values({ platform, platformModelId, dismissedBy: by })
          .onConflictDoNothing()
          .returning({ platformModelId: dismissals.platformModelId });
        if (inserted.length === 0) return;
        await auditModel(tx, 'sales_feed.model_dismissed', platform, platformModelId, by, {});
      });
    },

    async restoreModel(platform, platformModelId, by) {
      await db.transaction(async (tx) => {
        const removed = await tx
          .delete(dismissals)
          .where(and(eq(dismissals.platform, platform), eq(dismissals.platformModelId, platformModelId)))
          .returning({ platformModelId: dismissals.platformModelId });
        if (removed.length === 0) return;
        await auditModel(tx, 'sales_feed.model_restored', platform, platformModelId, by, {});
      });
    },

    async importModel(platform, model, action, by) {
      const platformModelId = model.platformModelId;
      const refused = (reason: SalesFeedImportRefusal): SalesFeedImportLineResult => ({
        platformModelId,
        outcome: 'refused',
        reason,
      });
      try {
        return await db.transaction(async (tx): Promise<SalesFeedImportLineResult> => {
          // One import of a model at a time: a double click waits for the first, then finds its link.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`sales_feed_import:${platform}:${platformModelId}`}))`,
          );
          const [current] = await tx
            .select({ creatorId: models.creatorId })
            .from(models)
            .where(and(eq(models.platform, platform), eq(models.platformModelId, platformModelId)));
          if (current !== undefined) {
            return {
              platformModelId,
              outcome: 'already_linked',
              creatorId: CreatorIdSchema.parse(current.creatorId),
            };
          }
          // Every creator's accounts with this handle (any case): `platform_accounts` is under RLS.
          const holders = await withAdmin(adminDb, (admin) =>
            admin
              .select({ id: schema.platformAccounts.id, creatorId: schema.platformAccounts.creatorId })
              .from(schema.platformAccounts)
              .where(
                and(
                  eq(schema.platformAccounts.platform, platform),
                  sql`lower(${schema.platformAccounts.handle}) = lower(${model.handle})`,
                ),
              ),
          );
          let creatorId: CreatorId;
          if (action.kind === 'link') {
            const [creator] = await tx
              .select({ id: schema.creators.id })
              .from(schema.creators)
              .where(eq(schema.creators.id, action.creatorId));
            if (creator === undefined) throw new ImportRefused('creator_not_found');
            creatorId = action.creatorId;
          } else {
            if (holders.length > 0) throw new ImportRefused('handle_taken');
            const name = importedNameOf(model);
            if (name === null) throw new ImportRefused('name_invalid');
            const nameKey = creatorNameKey(name);
            const [taken] = await tx
              .select({ id: schema.creators.id })
              .from(schema.creators)
              .where(eq(schema.creators.nameKey, nameKey));
            if (taken !== undefined) throw new ImportRefused('name_taken');
            creatorId = newId(CreatorIdSchema);
            await tx
              .insert(schema.creators)
              .values({ id: creatorId, displayName: name, nameKey, timezone: IMPORTED_TIMEZONE });
            await tx.insert(schema.auditLog).values({
              id: newId(AuditEntryIdSchema),
              userId: by,
              action: 'creator.create',
              entity: 'creator',
              entityId: creatorId,
              details: {
                displayName: name,
                timezone: IMPORTED_TIMEZONE,
                importedFrom: { platform, platformModelId },
              },
            });
          }
          if (holders.some((holder) => holder.creatorId !== creatorId))
            throw new ImportRefused('handle_taken');
          await enterTenant(tx, creatorId);
          let platformAccountId = holders[0]?.id;
          if (platformAccountId === undefined) {
            platformAccountId = newId(PlatformAccountIdSchema);
            await tx
              .insert(schema.platformAccounts)
              .values({ id: platformAccountId, creatorId, platform, handle: model.handle });
          }
          const linked = await linkIn(
            tx,
            adminDb,
            platform,
            platformModelId,
            { platformAccountId, creatorId },
            by,
          );
          if (linked === 'conflict') throw new ImportRefused('link_conflict');
          await tx
            .delete(dismissals)
            .where(and(eq(dismissals.platform, platform), eq(dismissals.platformModelId, platformModelId)));
          const created = action.kind === 'create';
          // Her photo copied to our bucket once she exists (ADR 0069 § 3), in this transaction: a refused line enqueues
          // nothing. The job reads the address again from the platform's list; the queue carries ids only.
          if (created && model.avatarUrl !== null) {
            const payload: JobPayload<'connector.copy_avatar'> = { platform, platformModelId, creatorId };
            await tx.execute(
              sql`select public.enqueue_job(
                task => ${'connector.copy_avatar'},
                payload => ${JSON.stringify(payload)}::jsonb,
                queue_name => null,
                run_at => null,
                max_attempts => ${JOB_MAX_ATTEMPTS['connector.copy_avatar']}::int,
                job_key => ${`connector.copy_avatar:${creatorId}`},
                job_key_mode => ${'replace'}
              )`,
            );
          }
          // The model's id and what it became: never its subscribers, prices or amounts (ADR 0069 § 6).
          await auditModel(tx, 'sales_feed.model_imported', platform, platformModelId, by, {
            creatorId,
            platformAccountId,
            created,
          });
          return { platformModelId, outcome: created ? 'created' : 'linked', creatorId };
        });
      } catch (error) {
        if (error instanceof ImportRefused) return refused(error.reason);
        // Taken between the check and the insert, by another request.
        if (isUniqueViolation(error, 'creators_name_key_unique')) return refused('name_taken');
        if (isUniqueViolation(error, 'platform_accounts_platform_handle_unique'))
          return refused('handle_taken');
        throw error;
      }
    },

    async chatterLinks(platform) {
      const rows = await db.select().from(chatters).where(eq(chatters.platform, platform));
      return new Map(
        rows.map((row) => {
          const parsed = ChatterRowSchema.parse(row);
          const link: ChatterLink =
            parsed.kind === 'member' ? { kind: 'member', memberId: parsed.memberId } : { kind: 'agent' };
          return [row.platformChatterId, link];
        }),
      );
    },

    checkLines(platform, from, to) {
      // Every creator's register and the quarantine, for the owner: through the admin role, as the agency's figures.
      return withAdmin(adminDb, async (tx) => {
        const read = async (
          table: typeof sales | typeof quarantine,
          linked: boolean,
        ): Promise<CheckLine[]> => {
          const rows = await tx
            .select({
              platformSaleId: table.platformSaleId,
              event: table.event,
              occurredAt: table.occurredAt,
              platformModelId: table.platformModelId,
              platformChatterId: table.platformChatterId,
              grossInclVat: table.grossInclVatMinor,
              grossExclVat: table.grossExclVatMinor,
              net: table.netMinor,
              agency: table.agencyMinor,
              creator: table.creatorMinor,
            })
            .from(table)
            .where(
              and(
                eq(table.platform, platform),
                sql`${table.occurredAt} >= ${from}`,
                sql`(${table.event} = 'refund' or ${table.occurredAt} < ${to})`,
                // A released line moved to the register when its model was linked: counted there, once.
                table === quarantine ? sql`${quarantine.releasedAt} is null` : undefined,
              ),
            );
          return rows.map((row) => ({ ...row, event: SaleEventSchema.parse(row.event), linked }));
        };
        return [...(await read(sales, true)), ...(await read(quarantine, false))];
      });
    },

    async recordCheck(report, clean, by) {
      await db.insert(checks).values({
        id: newId(SalesFeedCheckIdSchema),
        platform: report.platform,
        fromDay: report.from,
        toDay: report.to,
        verdict: report.verdict,
        clean,
        report,
        checkedBy: by,
        generatedAt: new Date(report.generatedAt),
      });
    },

    async lastCheck(platform) {
      const [row] = await db
        .select({ report: checks.report, clean: checks.clean, checkedBy: checks.checkedBy })
        .from(checks)
        .where(eq(checks.platform, platform))
        .orderBy(sql`${checks.generatedAt} desc, ${checks.createdAt} desc`)
        .limit(1);
      if (row === undefined) return null;
      return {
        report: SalesFeedCheckReportSchema.parse(row.report),
        clean: row.clean,
        checkedBy: row.checkedBy,
      };
    },

    firstLineAt(platform) {
      return withAdmin(adminDb, async (tx) => {
        const oldest = async (table: typeof sales | typeof quarantine): Promise<Date | null> => {
          const [row] = await tx
            .select({ at: table.occurredAt })
            .from(table)
            .where(eq(table.platform, platform))
            .orderBy(table.occurredAt)
            .limit(1);
          return row?.at ?? null;
        };
        const found = [await oldest(sales), await oldest(quarantine)].filter((at): at is Date => at !== null);
        return found.length === 0 ? null : new Date(Math.min(...found.map((at) => at.getTime())));
      });
    },

    signal(platform, signal, once, correlationId) {
      return withAdmin(adminDb, async (tx) => {
        const payload: { platform: Platform; signal: SalesFeedSignal } = { platform, signal };
        if (once) {
          const [earlier] = await tx
            .select({ id: schema.domainEvents.id })
            .from(schema.domainEvents)
            .where(
              and(
                eq(schema.domainEvents.type, 'sales_feed_signal'),
                sql`${schema.domainEvents.payload} @> ${JSON.stringify(payload)}::jsonb`,
              ),
            )
            .limit(1);
          if (earlier !== undefined) return false;
        }
        await tx.insert(schema.domainEvents).values({
          id: newId(EventIdSchema),
          creatorId: null,
          type: 'sales_feed_signal',
          payload,
          actor: 'system',
          correlationId,
        });
        return true;
      });
    },

    publishMismatch(mismatch, correlationId) {
      return withAdmin(adminDb, async (tx) => {
        // Once per platform and fortnight: `domain_events_sales_feed_mismatch_unique` (migration 0092).
        const inserted = await tx
          .insert(schema.domainEvents)
          .values({
            id: newId(EventIdSchema),
            creatorId: null,
            type: 'sales_feed_mismatch',
            payload: EVENT_PAYLOADS.sales_feed_mismatch.parse(mismatch),
            actor: 'system',
            correlationId,
          })
          .onConflictDoNothing()
          .returning({ id: schema.domainEvents.id });
        return inserted.length > 0;
      });
    },
  };
}

/**
 * Links a model inside `tx` and moves its quarantined lines to the register: `conflict` when the model already has
 * lines recorded for another account, or the account is linked to another model. Shared by a link and an import.
 */
async function linkIn(
  tx: Transaction,
  adminDb: Database,
  platform: Platform,
  platformModelId: string,
  account: LinkedAccount,
  by: string | null,
): Promise<'linked' | 'conflict'> {
  const [current] = await tx
    .select()
    .from(models)
    .where(and(eq(models.platform, platform), eq(models.platformModelId, platformModelId)))
    .for('update');
  if (current?.platformAccountId === account.platformAccountId) {
    // The owner confirms a link the handle posed: it becomes theirs, dated, with nothing else moving.
    if (current.linkedBy !== null || by === null) return 'linked';
    await tx
      .update(models)
      .set({ linkedBy: by, linkedAt: new Date() })
      .where(and(eq(models.platform, platform), eq(models.platformModelId, platformModelId)));
    await tx.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: by,
      action: 'sales_feed.model_linked',
      entity: 'sales_feed_model',
      entityId: `${platform}:${platformModelId}`,
      details: {
        platform,
        platformModelId,
        platformAccountId: account.platformAccountId,
        previousAccountId: current.platformAccountId,
        auto: false,
        confirmed: true,
        released: 0,
      },
    });
    return 'linked';
  }
  // Lines already recorded for another account stay there (append-only): moving the model would split it.
  const [elsewhere] = await withAdmin(adminDb, (admin) =>
    admin
      .select({ id: sales.id })
      .from(sales)
      .where(
        and(
          eq(sales.platform, platform),
          eq(sales.platformModelId, platformModelId),
          sql`${sales.platformAccountId} <> ${account.platformAccountId}`,
        ),
      )
      .limit(1),
  );
  if (elsewhere !== undefined) return 'conflict';
  const [taken] = await tx
    .select({ model: models.platformModelId })
    .from(models)
    .where(eq(models.platformAccountId, account.platformAccountId));
  if (taken !== undefined && taken.model !== platformModelId) return 'conflict';
  await tx
    .insert(models)
    .values({ platform, platformModelId, ...account, linkedBy: by })
    .onConflictDoUpdate({
      target: [models.platform, models.platformModelId],
      set: { ...account, linkedBy: by, linkedAt: new Date() },
    });
  const released = await releaseQuarantine(tx, platform, platformModelId, account);
  // The link decides whose sales these are (CRM-03 pays by it): dated, and by whom, the handle's own when null.
  await tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: by,
    action: 'sales_feed.model_linked',
    entity: 'sales_feed_model',
    entityId: `${platform}:${platformModelId}`,
    details: {
      platform,
      platformModelId,
      platformAccountId: account.platformAccountId,
      previousAccountId: current?.platformAccountId ?? null,
      auto: by === null,
      released,
    },
  });
  return 'linked';
}

/** The quarantined lines of a model, moved to the register of the account it is now linked to. */
async function releaseQuarantine(
  tx: Transaction,
  platform: Platform,
  platformModelId: string,
  account: LinkedAccount,
): Promise<number> {
  await enterTenant(tx, account.creatorId);
  const waiting = await tx
    .select()
    .from(quarantine)
    .where(
      and(
        eq(quarantine.platform, platform),
        eq(quarantine.platformModelId, platformModelId),
        sql`${quarantine.releasedAt} is null`,
      ),
    )
    .for('update');
  if (waiting.length === 0) return 0;
  const enteredAt = new Date();
  for (const line of waiting) {
    await tx
      .insert(sales)
      .values({
        id: newId(SalesLineIdSchema),
        ...account,
        platform: line.platform,
        platformSaleId: line.platformSaleId,
        event: line.event,
        saleType: line.saleType,
        rawType: line.rawType,
        status: line.status,
        rawStatus: line.rawStatus,
        occurredAt: line.occurredAt,
        platformModelId: line.platformModelId,
        platformChatterId: line.platformChatterId,
        platformFanId: line.platformFanId,
        currency: line.currency,
        grossInclVatMinor: line.grossInclVatMinor,
        grossExclVatMinor: line.grossExclVatMinor,
        netMinor: line.netMinor,
        agencyMinor: line.agencyMinor,
        creatorMinor: line.creatorMinor,
        position: line.position,
        inputsHash: line.inputsHash,
        // Entered the register now, not when it was first read: a period closed in between never counted it, so pay
        // must see it as a late line (ADR 0032), whatever its `occurredAt`.
        recordedAt: enteredAt,
      })
      .onConflictDoNothing();
  }
  await tx
    .update(quarantine)
    .set({ releasedAt: enteredAt })
    .where(
      and(
        eq(quarantine.platform, platform),
        eq(quarantine.platformModelId, platformModelId),
        sql`${quarantine.releasedAt} is null`,
      ),
    );
  return waiting.length;
}
