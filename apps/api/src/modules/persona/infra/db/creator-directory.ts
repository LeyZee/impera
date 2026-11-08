import {
  AgentHoursSchema,
  AuditEntryIdSchema,
  canonicalTimezone,
  CreatorDisplayNameSchema,
  CreatorIdSchema,
  creatorNameKey,
  CreatorSettingsSchema,
  DEFAULT_AGENT_HOURS,
  JOB_MAX_ATTEMPTS,
  JOB_PAYLOADS,
  NewCreatorSchema,
  newId,
  nextReplyOpening,
  reopenJobKey,
  TimezoneSchema,
  type AgentHours,
  type ArchivedCreator,
  type CopilotSwitches,
  type CreatorId,
  type CreatorSummary,
} from '@impera/contracts';
import { and, eq, inArray, schema, sql, type Database } from '@impera/db';

import { CreatorConflict, CreatorNameConflict } from '../../domain/errors';
import type { CreatorDirectory } from '../../domain/ports';

/** The unique index on her name (`creators_name_key_unique`) refused the row: another creator has this name. */
const isNameTaken = (error: unknown): boolean =>
  error instanceof Error &&
  [error, error.cause].some(
    (e) =>
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      e.code === '23505' &&
      'constraint' in e &&
      e.constraint === 'creators_name_key_unique',
  );

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The fans her old hours or clock put off wait for her opening under the new ones, which may be now
 * (`conversation.reopen`, one per creator): never until an opening that no longer is. With nobody waiting, the job
 * finds nothing.
 */
async function moveReopen(
  tx: Transaction,
  creator: { id: string; hours: AgentHours | null; timezone: string },
  at: Date,
  correlationId: string,
): Promise<void> {
  const opening = nextReplyOpening(creator.hours ?? DEFAULT_AGENT_HOURS, creator.timezone, at);
  const payload = JOB_PAYLOADS['conversation.reopen'].parse({ creatorId: creator.id, correlationId });
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'conversation.reopen',
      payload => ${JSON.stringify(payload)}::jsonb,
      run_at => ${opening.toISOString()}::timestamptz,
      max_attempts => ${JOB_MAX_ATTEMPTS['conversation.reopen']}::int,
      job_key => ${reopenJobKey(creator.id)}
    )`,
  );
}

const toSummary = (row: { id: string; displayName: string; timezone: string }): CreatorSummary => ({
  id: CreatorIdSchema.parse(row.id),
  displayName: row.displayName,
  timezone: row.timezone,
});

const archivedOf = (
  row: { id: string; displayName: string; timezone: string },
  at: Date,
): ArchivedCreator => ({ ...toSummary(row), archivedAt: at.toISOString() });

export function createDrizzleCreatorDirectory(
  db: Database,
  now: () => Date = () => new Date(),
): CreatorDirectory {
  const listOf = async (
    ids: readonly CreatorId[] | 'all',
    only: ReturnType<typeof sql> | null,
  ): Promise<CreatorSummary[]> => {
    if (ids !== 'all' && ids.length === 0) return [];
    const among = ids === 'all' ? undefined : inArray(schema.creators.id, [...ids]);
    const rows = await db
      .select({
        id: schema.creators.id,
        displayName: schema.creators.displayName,
        timezone: schema.creators.timezone,
        avatarKey: schema.creators.avatarKey,
      })
      .from(schema.creators)
      .where(and(among, only ?? undefined))
      .orderBy(schema.creators.displayName);
    // Her photo copied at her import (CRM-07 a2b): the page asks for it only when there is one.
    return rows.map((row) => ({ ...toSummary(row), hasAvatar: row.avatarKey !== null }));
  };

  return {
    async list(ids) {
      return listOf(ids, null);
    },

    async unarchived(ids) {
      // Out of every list, the owner's included (ADR 0071 § 2); her history still reads her by `list`.
      return listOf(ids, sql`${schema.creators.archivedAt} is null`);
    },

    async archived() {
      const rows = await db
        .select({
          id: schema.creators.id,
          displayName: schema.creators.displayName,
          timezone: schema.creators.timezone,
          archivedAt: schema.creators.archivedAt,
        })
        .from(schema.creators)
        .where(sql`${schema.creators.archivedAt} is not null`)
        .orderBy(sql`${schema.creators.archivedAt} desc`, schema.creators.displayName);
      return rows.flatMap((row) => (row.archivedAt === null ? [] : [archivedOf(row, row.archivedAt)]));
    },

    async archive(id, userId) {
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            id: schema.creators.id,
            displayName: schema.creators.displayName,
            timezone: schema.creators.timezone,
            archivedAt: schema.creators.archivedAt,
          })
          .from(schema.creators)
          .where(eq(schema.creators.id, id))
          .for('update');
        if (current === undefined) return null;
        if (current.archivedAt !== null) return archivedOf(current, current.archivedAt);
        const at = now();
        await tx.update(schema.creators).set({ archivedAt: at }).where(eq(schema.creators.id, id));
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'creator.archive',
          entity: 'creator',
          entityId: id,
          details: {},
        });
        return archivedOf(current, at);
      });
    },

    async restore(id, userId) {
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            id: schema.creators.id,
            displayName: schema.creators.displayName,
            timezone: schema.creators.timezone,
            archivedAt: schema.creators.archivedAt,
          })
          .from(schema.creators)
          .where(eq(schema.creators.id, id))
          .for('update');
        if (current === undefined) return null;
        if (current.archivedAt === null) return toSummary(current);
        await tx.update(schema.creators).set({ archivedAt: null }).where(eq(schema.creators.id, id));
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'creator.restore',
          entity: 'creator',
          entityId: id,
          details: {},
        });
        return toSummary(current);
      });
    },

    async create(input, userId) {
      const { id: chosen, displayName, timezone } = NewCreatorSchema.parse(input);
      const parsed = { displayName, timezone: canonicalTimezone(timezone) };
      const id = chosen ?? newId(CreatorIdSchema);
      // The same form sent twice: the creator the first request made, without a second audit line. The same id with
      // other values is not a replay.
      const replayOf = (existing: { id: string; displayName: string; timezone: string }): CreatorSummary => {
        if (existing.displayName !== parsed.displayName || existing.timezone !== parsed.timezone) {
          throw new CreatorConflict();
        }
        return toSummary(existing);
      };
      const byId = async (tx: Pick<Database, 'select'>) => {
        const [existing] = await tx
          .select({
            id: schema.creators.id,
            displayName: schema.creators.displayName,
            timezone: schema.creators.timezone,
          })
          .from(schema.creators)
          .where(eq(schema.creators.id, id));
        return existing;
      };
      try {
        return await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(schema.creators)
            .values({ id, ...parsed, nameKey: creatorNameKey(parsed.displayName) })
            .onConflictDoNothing({ target: schema.creators.id })
            .returning({ id: schema.creators.id });
          if (inserted.length === 0) {
            const existing = await byId(tx);
            if (existing === undefined) throw new Error('creator insert conflicted on an id it cannot read');
            return replayOf(existing);
          }
          await tx.insert(schema.auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId: userId ?? null,
            action: 'creator.create',
            entity: 'creator',
            entityId: id,
            details: { displayName: parsed.displayName, timezone: parsed.timezone },
          });
          return { id, ...parsed };
        });
      } catch (error) {
        if (!isNameTaken(error)) throw error;
        // Her name is taken: by the creator this very form made a moment ago (two sends at once, the second checked
        // the name before the id), which is a replay, or by another creator.
        const existing = await byId(db);
        if (existing !== undefined) return replayOf(existing);
        throw new CreatorNameConflict();
      }
    },

    async setTimezone(id, timezone, userId) {
      const zone = canonicalTimezone(TimezoneSchema.parse(timezone));
      return db.transaction(async (tx) => {
        // Locked: two changes at once each read the zone the other left, and the audit says from where to where.
        const [current] = await tx
          .select({
            id: schema.creators.id,
            displayName: schema.creators.displayName,
            timezone: schema.creators.timezone,
            agentHours: schema.creators.agentHours,
          })
          .from(schema.creators)
          .where(eq(schema.creators.id, id))
          .for('update');
        if (current === undefined) return null;
        if (current.timezone === zone) return toSummary(current);
        await tx.update(schema.creators).set({ timezone: zone }).where(eq(schema.creators.id, id));
        const auditId = newId(AuditEntryIdSchema);
        // Her hours read on her new clock; unreadable ones are the defaults, as the worker reads them.
        const stored = current.agentHours === null ? null : AgentHoursSchema.safeParse(current.agentHours);
        const hours = stored?.success === true ? stored.data : null;
        await moveReopen(tx, { id, hours, timezone: zone }, now(), `timezone:${auditId}`);
        await tx.insert(schema.auditLog).values({
          id: auditId,
          userId,
          action: 'creator.timezone',
          entity: 'creator',
          entityId: id,
          details: { from: current.timezone, to: zone },
        });
        return toSummary({ ...current, timezone: zone });
      });
    },

    async rename(id, displayName, userId) {
      const name = CreatorDisplayNameSchema.parse(displayName);
      try {
        return await db.transaction(async (tx) => {
          // Locked: two renames at once each read the name the other left, and the audit says from what to what.
          const [current] = await tx
            .select({
              id: schema.creators.id,
              displayName: schema.creators.displayName,
              timezone: schema.creators.timezone,
            })
            .from(schema.creators)
            .where(eq(schema.creators.id, id))
            .for('update');
          if (current === undefined) return null;
          if (current.displayName === name) return toSummary(current);
          await tx
            .update(schema.creators)
            .set({ displayName: name, nameKey: creatorNameKey(name) })
            .where(eq(schema.creators.id, id));
          await tx.insert(schema.auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId,
            action: 'creator.rename',
            entity: 'creator',
            entityId: id,
            details: { from: current.displayName, to: name },
          });
          return toSummary({ ...current, displayName: name });
        });
      } catch (error) {
        if (isNameTaken(error)) throw new CreatorNameConflict();
        throw error;
      }
    },

    async agentHours(id) {
      const [row] = await db
        .select({ timezone: schema.creators.timezone, agentHours: schema.creators.agentHours })
        .from(schema.creators)
        .where(eq(schema.creators.id, id));
      if (row === undefined) return null;
      if (row.agentHours === null) {
        return { hours: DEFAULT_AGENT_HOURS, isDefault: true, invalidStored: false, timeZone: row.timezone };
      }
      const stored = AgentHoursSchema.safeParse(row.agentHours);
      return stored.success
        ? { hours: stored.data, isDefault: false, invalidStored: false, timeZone: row.timezone }
        : { hours: DEFAULT_AGENT_HOURS, isDefault: true, invalidStored: true, timeZone: row.timezone };
    },

    async setAgentHours(id, hours, userId) {
      const parsed = hours === null ? null : AgentHoursSchema.parse(hours);
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(schema.creators)
          .set({ agentHours: parsed })
          .where(eq(schema.creators.id, id))
          .returning({ timezone: schema.creators.timezone });
        const [creator] = updated;
        if (creator === undefined) return false;
        const auditId = newId(AuditEntryIdSchema);
        await moveReopen(
          tx,
          { id, hours: parsed, timezone: creator.timezone },
          now(),
          `agent_hours:${auditId}`,
        );
        await tx.insert(schema.auditLog).values({
          id: auditId,
          userId,
          action: 'creator.agent_hours',
          entity: 'creator',
          entityId: id,
          details: { hours: parsed },
        });
        return true;
      });
    },

    async copilotSwitches(id) {
      const [row] = await db
        .select({ settings: schema.creators.settings })
        .from(schema.creators)
        .where(eq(schema.creators.id, id));
      return row === undefined ? null : copilotOf(row.settings);
    },

    setCopilotSwitches(id, change, userId) {
      return db.transaction(async (tx) => {
        // Locked: two changes at once each keep the switch the other set.
        const [row] = await tx
          .select({ settings: schema.creators.settings })
          .from(schema.creators)
          .where(eq(schema.creators.id, id))
          .for('update');
        if (row === undefined) return null;
        const before = copilotOf(row.settings);
        const after = { ...before, ...change };
        if (after.fanCard === before.fanCard && after.drafts === before.drafts) return after;
        // Only her `copilot` key is written: the rest of her settings stays as stored, defaults never materialised.
        await tx
          .update(schema.creators)
          .set({
            settings: sql`${schema.creators.settings} || jsonb_build_object('copilot', ${JSON.stringify(after)}::jsonb)`,
          })
          .where(eq(schema.creators.id, id));
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'creator.copilot_switches',
          entity: 'creator',
          entityId: id,
          details: { from: before, to: after },
        });
        return after;
      });
    },
  };
}

/** Her copilot switches (ADR 0086 § 6); settings that no longer read give the defaults: the card on, the drafts off. */
function copilotOf(settings: unknown): CopilotSwitches {
  const parsed = CreatorSettingsSchema.safeParse(settings);
  return (parsed.success ? parsed.data : CreatorSettingsSchema.parse({})).copilot;
}
