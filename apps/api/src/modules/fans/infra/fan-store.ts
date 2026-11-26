import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  FanLanguageSourceSchema,
  LanguageSchema,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
  type CreatorId,
  type FanId,
} from '@impera/contracts';
import { and, eq, schema, sql, withTenant, type Database, type Transaction } from '@impera/db';

import { FanNotFound } from '../domain/errors';
import type { Fan, FanStore, KeptLanguage } from '../domain/fan';

type FanRow = typeof schema.fans.$inferSelect;

function toFan(row: FanRow): Fan {
  return {
    id: FanIdSchema.parse(row.id),
    creatorId: CreatorIdSchema.parse(row.creatorId),
    platformAccountId: PlatformAccountIdSchema.parse(row.platformAccountId),
    platformFanId: row.platformFanId,
    displayName: row.displayName,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  };
}

/** His kept language as the row holds it, read back through the contract (a column is a boundary). */
async function readLanguage(
  tx: Transaction,
  creatorId: CreatorId,
  fanId: FanId,
  forUpdate: boolean,
): Promise<KeptLanguage | null> {
  const f = schema.fans;
  const query = tx
    .select({ value: f.language, source: f.languageSource, setBy: f.languageSetBy, setAt: f.languageSetAt })
    .from(f)
    .where(and(eq(f.id, fanId), eq(f.creatorId, creatorId)));
  const [row] = forUpdate ? await query.for('update') : await query;
  if (row === undefined) throw new FanNotFound();
  if (row.value === null || row.source === null || row.setAt === null) return null;
  return {
    value: LanguageSchema.parse(row.value),
    source: FanLanguageSourceSchema.parse(row.source),
    setBy: row.setBy === null ? null : UserIdSchema.parse(row.setBy),
    setAt: row.setAt,
  };
}

export function createDrizzleFanStore(db: Database): FanStore {
  return {
    upsert: (sighting, id) =>
      withTenant(db, sighting.creatorId, async (tx) => {
        const [row] = await tx
          .insert(schema.fans)
          .values({
            id,
            creatorId: sighting.creatorId,
            platformAccountId: sighting.platformAccountId,
            platformFanId: sighting.platformFanId,
            displayName: sighting.displayName,
            firstSeenAt: sighting.seenAt,
            lastSeenAt: sighting.seenAt,
          })
          .onConflictDoUpdate({
            target: [schema.fans.platformAccountId, schema.fans.platformFanId],
            set: {
              displayName: sighting.displayName,
              lastSeenAt: sql`greatest(${schema.fans.lastSeenAt}, ${sighting.seenAt.toISOString()}::timestamptz)`,
            },
          })
          .returning();
        if (row === undefined) throw new Error('Fan upsert returned no row');
        return toFan(row);
      }),
    get: (creatorId, id) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.fans)
          .where(and(eq(schema.fans.id, id), eq(schema.fans.creatorId, creatorId)));
        return row === undefined ? null : toFan(row);
      }),
    language: (creatorId, fanId) =>
      withTenant(db, creatorId, (tx) => readLanguage(tx, creatorId, fanId, false)),
    keepLanguage: (creatorId, fanId, language, at) =>
      withTenant(db, creatorId, async (tx) => {
        const kept = await readLanguage(tx, creatorId, fanId, true);
        if (kept?.source === 'set' || kept?.value === language) return kept;
        await tx
          .update(schema.fans)
          .set({ language, languageSource: 'detected', languageSetBy: null, languageSetAt: at })
          .where(eq(schema.fans.id, fanId));
        return { value: language, source: 'detected', setBy: null, setAt: at };
      }),
    setLanguage: (creatorId, fanId, language, actor, at) =>
      withTenant(db, creatorId, async (tx) => {
        await readLanguage(tx, creatorId, fanId, true);
        await tx
          .update(schema.fans)
          .set({ language, languageSource: 'set', languageSetBy: actor.userId, languageSetAt: at })
          .where(eq(schema.fans.id, fanId));
        // The audit says which language, never a word of his (audit-actions.ts).
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: actor.userId,
          action: 'fan.language_set',
          entity: 'fan',
          entityId: fanId,
          ip: actor.ip,
          details: { language },
        });
        return { value: language, source: 'set', setBy: actor.userId, setAt: at };
      }),
  };
}
