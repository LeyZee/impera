import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  AuditEntryIdSchema,
  CalendarLinkIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withAdmin, type Database, type Transaction } from '@nirvana/db';

import type { Actor, CalendarLinkStore } from '../domain/ports';

const { auditLog, calendarLinks, teamMembers } = schema;

/** 256 random bits, base64url: 43 characters (`CalendarLinkTokenSchema`). */
const TOKEN_BYTES = 32;

/** Only the SHA-256 of a token is stored or compared. */
const hashOf = (token: string): string => createHash('sha256').update(token).digest('base64url');

/** Constant time, on two hashes of the same length. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function audit(tx: Transaction, actor: Actor, action: string, linkId: string): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: actor.userId,
    action,
    entity: 'calendar_link',
    entityId: linkId,
    ip: actor.ip,
    details: {},
  });
}

async function revokeLive(tx: Transaction, actor: Actor): Promise<number> {
  const revoked = await tx
    .update(calendarLinks)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(calendarLinks.userId, actor.userId), sql`${calendarLinks.revokedAt} is null`))
    .returning({ id: calendarLinks.id });
  for (const link of revoked) await audit(tx, actor, 'calendar_link.revoke', link.id);
  return revoked.length;
}

/** `calendar_links` through `withAdmin` (migration 0072): the application role cannot reach it. */
export function createDrizzleCalendarLinkStore(adminDb: Database): CalendarLinkStore {
  return {
    live: async (userId) => {
      const [row] = await withAdmin(adminDb, (tx) =>
        tx
          .select({ createdAt: calendarLinks.createdAt })
          .from(calendarLinks)
          .where(and(eq(calendarLinks.userId, userId), sql`${calendarLinks.revokedAt} is null`)),
      );
      return row ?? null;
    },

    replace: (actor) =>
      withAdmin(adminDb, async (tx) => {
        // The member's row is the lock: two links asked at once are made one after the other.
        const [member] = await tx
          .select({ status: teamMembers.status })
          .from(teamMembers)
          .where(eq(teamMembers.userId, actor.userId))
          .for('update');
        if (member === undefined || member.status === 'left') return null;
        await revokeLive(tx, actor);
        const token = randomBytes(TOKEN_BYTES).toString('base64url');
        const id = newId(CalendarLinkIdSchema);
        const [created] = await tx
          .insert(calendarLinks)
          .values({ id, userId: actor.userId, tokenHash: hashOf(token) })
          .returning({ createdAt: calendarLinks.createdAt });
        if (created === undefined) throw new Error('calendar link not created');
        await audit(tx, actor, 'calendar_link.create', id);
        return { token, createdAt: created.createdAt };
      }),

    revoke: (actor) => withAdmin(adminDb, async (tx) => (await revokeLive(tx, actor)) > 0),

    holder: async (token) => {
      const hash = hashOf(token);
      const [row] = await withAdmin(adminDb, (tx) =>
        tx
          .select({
            tokenHash: calendarLinks.tokenHash,
            userId: calendarLinks.userId,
            memberId: teamMembers.id,
          })
          .from(calendarLinks)
          .innerJoin(teamMembers, eq(teamMembers.userId, calendarLinks.userId))
          .where(
            and(
              eq(calendarLinks.tokenHash, hash),
              sql`${calendarLinks.revokedAt} is null`,
              sql`${teamMembers.status} <> 'left'`,
            ),
          ),
      );
      if (row === undefined || !sameHash(row.tokenHash, hash)) return null;
      return { userId: UserIdSchema.parse(row.userId), memberId: TeamMemberIdSchema.parse(row.memberId) };
    },
  };
}
