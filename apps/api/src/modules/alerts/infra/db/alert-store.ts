import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  CustomAlertGroupIdSchema,
  CustomAlertGroupSchema,
  CustomAlertIdSchema,
  CustomAlertSchema,
  customAlertNameKey,
  LOCKED_SYSTEM_ALERTS,
  newId,
  SYSTEM_ALERT_CODES,
  SystemAlertCodeSchema,
  type CreatorId,
  type CustomAlert,
  type CustomAlertBody,
  type CustomAlertGroup,
  type SystemAlertCode,
  type SystemAlertSetting,
} from '@nirvana/contracts';
import { and, enterCreator, eq, schema, sql, withTenant, type Database, type Transaction } from '@nirvana/db';

import type { AlertStore } from '../../domain/ports';

type Row = typeof schema.customAlerts.$inferSelect;
type SettingRow = typeof schema.systemAlertSettings.$inferSelect;

/** A row as the contract has it, parsed: the table is written by this module only, but a row is still a boundary. */
const toAlert = (row: Row): CustomAlert =>
  CustomAlertSchema.parse({
    id: row.id,
    groupId: row.groupId,
    creatorId: row.creatorId,
    name: row.name,
    phrase: row.phrase,
    keywords: row.keywords,
    pausesAgent: row.pausesAgent,
    notify: row.notify,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

/**
 * The rows of one group as one alert. Its rows are written together, so they share their fields; the latest row
 * written says them all the same, should two ever differ.
 */
function toGroup(rows: readonly Row[], order: readonly string[]): CustomAlertGroup {
  const latest = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (latest === undefined) throw new Error('alert group without rows');
  const created = Math.min(...rows.map((row) => row.createdAt.getTime()));
  return CustomAlertGroupSchema.parse({
    groupId: latest.groupId,
    name: latest.name,
    phrase: latest.phrase,
    keywords: latest.keywords,
    pausesAgent: latest.pausesAgent,
    notify: latest.notify,
    creators: [...rows]
      .sort((a, b) => order.indexOf(a.creatorId) - order.indexOf(b.creatorId))
      .map((row) => ({ creatorId: row.creatorId, enabled: row.enabled, alertId: row.id })),
    createdAt: new Date(created).toISOString(),
    updatedAt: latest.updatedAt.toISOString(),
  });
}

/** The fields every row of the group shares. */
const fieldsOf = (body: CustomAlertBody) => ({
  name: body.name,
  phrase: body.phrase,
  keywords: [...body.keywords],
  pausesAgent: body.pausesAgent,
  notify: body.notify,
});

/** The same alert, whatever the order of its creators: a replay of a creation. */
function sameAlert(group: CustomAlertGroup, body: CustomAlertBody): boolean {
  const creators = (list: readonly { readonly creatorId: string; readonly enabled: boolean }[]) =>
    JSON.stringify(list.map((c) => [c.creatorId, c.enabled]).sort());
  return (
    JSON.stringify(fieldsOf(group)) === JSON.stringify(fieldsOf(body)) &&
    creators(group.creators) === creators(body.creators)
  );
}

const isLocked = (code: SystemAlertCode): boolean => LOCKED_SYSTEM_ALERTS.includes(code);

export function createDrizzleAlertStore(db: Database): AlertStore {
  /** Every creator's id, by name: `creators` is the tenant root, without RLS. */
  const creatorIds = async (tx: Transaction): Promise<CreatorId[]> =>
    (
      await tx
        .select({ id: schema.creators.id })
        .from(schema.creators)
        .orderBy(schema.creators.displayName, schema.creators.id)
    ).map((row) => CreatorIdSchema.parse(row.id));

  /** The rows of a group on each creator in turn, archived ones too with `archived`. */
  async function groupRows(
    tx: Transaction,
    groupId: string,
    creators: readonly string[],
    archived: boolean,
  ): Promise<Row[]> {
    const rows: Row[] = [];
    for (const creatorId of creators) {
      await enterCreator(tx, creatorId, creators);
      rows.push(
        ...(await tx
          .select()
          .from(schema.customAlerts)
          .where(
            archived
              ? eq(schema.customAlerts.groupId, groupId)
              : and(eq(schema.customAlerts.groupId, groupId), sql`${schema.customAlerts.archivedAt} is null`),
          )),
      );
    }
    return rows;
  }

  async function audit(
    tx: Transaction,
    action: string,
    entityId: string,
    userId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId,
      action,
      entity: action.startsWith('system_alert') ? 'system_alert' : 'custom_alert',
      entityId,
      details,
    });
  }

  /**
   * One writer of custom alerts at a time, until the transaction ends: the name check and the write it allows are
   * never split by another one (two alerts of the same name posted at once), and a creation sent twice at once is
   * written and audited once, the second one reading it back as a replay.
   */
  const lockNames = (tx: Transaction) =>
    tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('alerts.custom_alert_names', 0))`);

  /**
   * The creators of the body where another group already has an active alert (enabled, not archived) of the same
   * name: only where the body switches the alert on, since a switched-off one leaves the name free. Under `lockNames`.
   */
  async function nameTakenOn(
    tx: Transaction,
    groupId: string,
    body: CustomAlertBody,
    creators: readonly string[],
  ): Promise<CreatorId[]> {
    const key = customAlertNameKey(body.name);
    const taken: CreatorId[] = [];
    for (const { creatorId, enabled } of body.creators) {
      if (!enabled) continue;
      await enterCreator(tx, creatorId, creators);
      const names = await tx
        .select({ name: schema.customAlerts.name })
        .from(schema.customAlerts)
        .where(
          and(
            eq(schema.customAlerts.enabled, true),
            sql`${schema.customAlerts.archivedAt} is null and ${schema.customAlerts.groupId} <> ${groupId}`,
          ),
        );
      if (names.some((row) => customAlertNameKey(row.name) === key)) taken.push(creatorId);
    }
    return taken;
  }

  /** Writes the body on its creators: an update where the group has a row (archived or not), an insert elsewhere. */
  async function write(
    tx: Transaction,
    groupId: string,
    body: CustomAlertBody,
    userId: string,
    creators: readonly string[],
  ): Promise<void> {
    for (const { creatorId, enabled } of body.creators) {
      await enterCreator(tx, creatorId, creators);
      const updated = await tx
        .update(schema.customAlerts)
        .set({ ...fieldsOf(body), enabled, updatedBy: userId, updatedAt: sql`now()`, archivedAt: null })
        .where(and(eq(schema.customAlerts.groupId, groupId), eq(schema.customAlerts.creatorId, creatorId)))
        .returning({ id: schema.customAlerts.id });
      if (updated.length > 0) continue;
      await tx.insert(schema.customAlerts).values({
        id: newId(CustomAlertIdSchema),
        groupId,
        creatorId,
        ...fieldsOf(body),
        enabled,
        createdBy: userId,
        updatedBy: userId,
      });
    }
  }

  /** What the audit keeps: the alert's settings and its creators (nothing of a fan is in it anyway). */
  const auditDetails = (body: CustomAlertBody): Record<string, unknown> => ({
    ...fieldsOf(body),
    creators: body.creators.map((c) => ({ creatorId: c.creatorId, enabled: c.enabled })),
  });

  /** A system alert on each creator, from the rows read: no row is on, `keyword` always is. */
  const settingOf = (
    code: SystemAlertCode,
    creators: readonly CreatorId[],
    rows: readonly SettingRow[],
  ): SystemAlertSetting => ({
    code,
    locked: isLocked(code),
    creators: creators.map((creatorId) => ({
      creatorId,
      enabled:
        isLocked(code) ||
        (rows.find((row) => row.creatorId === creatorId && row.code === code)?.enabled ?? true),
    })),
  });

  async function settingRows(tx: Transaction, creators: readonly string[]): Promise<SettingRow[]> {
    const rows: SettingRow[] = [];
    for (const creatorId of creators) {
      await enterCreator(tx, creatorId, creators);
      rows.push(...(await tx.select().from(schema.systemAlertSettings)));
    }
    return rows;
  }

  return {
    async view() {
      return db.transaction(async (tx) => {
        const creators = await creatorIds(tx);
        const groups = new Map<string, Row[]>();
        for (const creatorId of creators) {
          await enterCreator(tx, creatorId, creators);
          const rows = await tx
            .select()
            .from(schema.customAlerts)
            .where(sql`${schema.customAlerts.archivedAt} is null`);
          for (const row of rows) groups.set(row.groupId, [...(groups.get(row.groupId) ?? []), row]);
        }
        const settings = await settingRows(tx, creators);
        return {
          custom: [...groups.values()]
            .map((rows) => toGroup(rows, creators))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.groupId.localeCompare(b.groupId)),
          system: SYSTEM_ALERT_CODES.map((code) => settingOf(code, creators, settings)),
        };
      });
    },

    async create(body, userId) {
      return db.transaction(async (tx) => {
        await lockNames(tx);
        const creators = await creatorIds(tx);
        const existing = await groupRows(tx, body.groupId, creators, true);
        if (existing.length > 0) {
          if (existing.some((row) => row.archivedAt !== null)) return { kind: 'conflict' as const };
          const stored = toGroup(existing, creators);
          return sameAlert(stored, body)
            ? { kind: 'replayed' as const, alert: stored }
            : { kind: 'conflict' as const };
        }
        if (body.creators.some((c) => !creators.includes(c.creatorId)))
          return { kind: 'unknown_creator' as const };
        const taken = await nameTakenOn(tx, body.groupId, body, creators);
        if (taken.length > 0) return { kind: 'name_conflict' as const, creatorIds: taken };
        await write(tx, body.groupId, body, userId, creators);
        await audit(tx, 'custom_alert.create', body.groupId, userId, auditDetails(body));
        return {
          kind: 'created' as const,
          alert: toGroup(await groupRows(tx, body.groupId, creators, false), creators),
        };
      });
    },

    async replace(groupId, body, userId) {
      return db.transaction(async (tx) => {
        await lockNames(tx);
        const creators = await creatorIds(tx);
        const before = await groupRows(tx, groupId, creators, false);
        if (before.length === 0) return 'not_found' as const;
        if (body.creators.some((c) => !creators.includes(c.creatorId))) return 'unknown_creator' as const;
        const taken = await nameTakenOn(tx, groupId, body, creators);
        if (taken.length > 0) return { kind: 'name_conflict' as const, creatorIds: taken };
        await write(tx, groupId, body, userId, creators);
        const kept = new Set<string>(body.creators.map((c) => c.creatorId));
        for (const row of before) {
          if (kept.has(row.creatorId)) continue;
          await enterCreator(tx, row.creatorId, creators);
          await tx
            .update(schema.customAlerts)
            .set({ archivedAt: sql`now()`, updatedBy: userId, updatedAt: sql`now()` })
            .where(eq(schema.customAlerts.id, row.id));
        }
        await audit(tx, 'custom_alert.update', groupId, userId, auditDetails(body));
        return toGroup(await groupRows(tx, groupId, creators, false), creators);
      });
    },

    async archive(groupId, userId) {
      return db.transaction(async (tx) => {
        // Behind a change of the same alert, never between its read and its write: the change would bring the
        // archived rows back, or leave active the ones it adds.
        await lockNames(tx);
        const creators = await creatorIds(tx);
        const rows = await groupRows(tx, groupId, creators, false);
        if (rows.length === 0) return false;
        for (const row of rows) {
          await enterCreator(tx, row.creatorId, creators);
          await tx
            .update(schema.customAlerts)
            .set({ archivedAt: sql`now()`, updatedBy: userId, updatedAt: sql`now()` })
            .where(eq(schema.customAlerts.id, row.id));
        }
        await audit(tx, 'custom_alert.archive', groupId, userId, {});
        return true;
      });
    },

    async setSystem(code, body, userId) {
      if (isLocked(code)) return 'locked';
      return db.transaction(async (tx) => {
        const creators = await creatorIds(tx);
        if (body.creators.some((c) => !creators.includes(c.creatorId))) return 'unknown_creator' as const;
        for (const { creatorId, enabled } of body.creators) {
          await enterCreator(tx, creatorId, creators);
          await tx
            .insert(schema.systemAlertSettings)
            .values({ creatorId, code, enabled, updatedBy: userId })
            .onConflictDoUpdate({
              target: [schema.systemAlertSettings.creatorId, schema.systemAlertSettings.code],
              set: { enabled, updatedBy: userId, updatedAt: sql`now()` },
            });
        }
        await audit(tx, 'system_alert.update', code, userId, { creators: body.creators });
        return settingOf(code, creators, await settingRows(tx, creators));
      });
    },

    async activeFor(creatorId) {
      return withTenant(db, creatorId, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.customAlerts)
          .where(and(eq(schema.customAlerts.enabled, true), sql`${schema.customAlerts.archivedAt} is null`))
          .orderBy(schema.customAlerts.createdAt, schema.customAlerts.id);
        return rows.map(toAlert);
      });
    },

    async names(creatorId) {
      return withTenant(db, creatorId, async (tx) => {
        const rows = await tx
          .select({
            id: schema.customAlerts.id,
            groupId: schema.customAlerts.groupId,
            name: schema.customAlerts.name,
          })
          .from(schema.customAlerts);
        return new Map(
          rows.map((row) => [
            CustomAlertIdSchema.parse(row.id),
            { groupId: CustomAlertGroupIdSchema.parse(row.groupId), name: row.name },
          ]),
        );
      });
    },

    async systemOn(creatorId) {
      return withTenant(db, creatorId, async (tx) => {
        const off = new Set(
          (
            await tx
              .select({ code: schema.systemAlertSettings.code })
              .from(schema.systemAlertSettings)
              .where(eq(schema.systemAlertSettings.enabled, false))
          ).map((row) => SystemAlertCodeSchema.parse(row.code)),
        );
        return new Set(SYSTEM_ALERT_CODES.filter((code) => isLocked(code) || !off.has(code)));
      });
    },
  };
}
