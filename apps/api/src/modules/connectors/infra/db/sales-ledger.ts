import { randomUUID } from 'node:crypto';

import {
  AuditEntryIdSchema,
  EventIdSchema,
  newId,
  SaleEventSchema,
  SalesLineIdSchema,
  type Platform,
  type PlatformSale,
  type SalesFeedSignal,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withAdmin, type Database, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import type { CheckLine } from '../../domain/reliability-check';
import {
  inputsHashOf,
  type ChatterLink,
  type LinkedAccount,
  type RecordedPage,
  type SalesLedger,
} from '../../domain/sales-feed';

const sales = schema.platformSales;
const quarantine = schema.platformSalesQuarantine;
const cursors = schema.salesFeedCursors;
const models = schema.salesFeedModels;
const chatters = schema.salesFeedChatters;

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

    recordPage(platform, from, page, at) {
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
            if (inserted.length === 1) {
              recorded += 1;
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
        await tx
          .update(cursors)
          .set({ position: page.endPosition ?? current, readAt: at, pausedUntil: null, updatedAt: at })
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
      return db.transaction(async (tx) => {
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
      });
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

    memberExists(memberId) {
      // `team_members` is under the team policies: the owner's screen checks the id through the admin role.
      return withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ id: schema.teamMembers.id })
          .from(schema.teamMembers)
          .where(eq(schema.teamMembers.id, memberId));
        return row !== undefined;
      });
    },

    async linkChatter(platform, platformChatterId, link, by) {
      const key = and(eq(chatters.platform, platform), eq(chatters.platformChatterId, platformChatterId));
      await db.transaction(async (tx) => {
        const [before] = await tx
          .select({ kind: chatters.kind, memberId: chatters.memberId })
          .from(chatters)
          .where(key)
          .for('update');
        if (link === null) await tx.delete(chatters).where(key);
        else {
          const memberId = link.kind === 'member' ? link.memberId : null;
          const same = before?.kind === link.kind && before.memberId === memberId;
          const values = {
            kind: link.kind,
            memberId,
            linkedBy: by,
            linkedAt: new Date(),
            // A new version only when the link points elsewhere: pay compares it with the one a statement froze.
            ...(same ? {} : { linkVersion: randomUUID() }),
          };
          await tx
            .insert(chatters)
            .values({ platform, platformChatterId, ...values })
            .onConflictDoUpdate({ target: [chatters.platform, chatters.platformChatterId], set: values });
        }
        if (before === undefined && link === null) return;
        // Whose sales a chatter's are (CRM-03 pays by this link): dated, by whom, and what it was before.
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: by,
          action: link === null ? 'sales_feed.chatter_unlinked' : 'sales_feed.chatter_linked',
          entity: 'sales_feed_chatter',
          entityId: `${platform}:${platformChatterId}`,
          details: {
            platform,
            platformChatterId,
            kind: link?.kind ?? null,
            memberId: link?.kind === 'member' ? link.memberId : null,
            previous: before === undefined ? null : { kind: before.kind, memberId: before.memberId },
          },
        });
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
  };
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
