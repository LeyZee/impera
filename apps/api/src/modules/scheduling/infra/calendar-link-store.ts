import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  AuditEntryIdSchema,
  CalendarLinkIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { Actor, CalendarLinkHolder, CalendarLinkStore } from '../domain/ports';

const { auditLog, calendarLinks, teamMembers, user } = schema;

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

async function audit(
  tx: Transaction,
  actor: Actor,
  action: string,
  linkId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: actor.userId,
    action,
    entity: 'calendar_link',
    entityId: linkId,
    ip: actor.ip,
    details,
  });
}

/** Revokes the live link, in the audit log; the links revoked, with her choice of shifts. */
async function revokeLive(tx: Transaction, actor: Actor): Promise<{ withShifts: boolean }[]> {
  const revoked = await tx
    .update(calendarLinks)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(calendarLinks.userId, actor.userId), sql`${calendarLinks.revokedAt} is null`))
    .returning({ id: calendarLinks.id, withShifts: calendarLinks.withShifts });
  for (const link of revoked) await audit(tx, actor, 'calendar_link.revoke', link.id);
  return revoked;
}

/** A creator's account, or a member who has not left; anyone else's link answers nothing. */
function holderOf(row: {
  userId: string;
  role: string;
  withShifts: boolean;
  memberId: string | null;
  memberStatus: string | null;
}): CalendarLinkHolder | null {
  const userId = UserIdSchema.parse(row.userId);
  if (row.role === 'creator') return { kind: 'creator', userId, withShifts: row.withShifts };
  if (row.memberId === null || row.memberStatus === 'left') return null;
  return { kind: 'member', userId, memberId: TeamMemberIdSchema.parse(row.memberId) };
}

/** `calendar_links` through `withAdmin` (migration 0074): the application role cannot reach it. */
export function createDrizzleCalendarLinkStore(adminDb: Database): CalendarLinkStore {
  return {
    live: async (userId) => {
      const [row] = await withAdmin(adminDb, (tx) =>
        tx
          .select({ createdAt: calendarLinks.createdAt, withShifts: calendarLinks.withShifts })
          .from(calendarLinks)
          .where(and(eq(calendarLinks.userId, userId), sql`${calendarLinks.revokedAt} is null`)),
      );
      return row ?? null;
    },

    replace: (actor) =>
      withAdmin(adminDb, async (tx) => {
        // The account's row is the lock: two links asked at once are made one after the other.
        const [account] = await tx
          .select({ role: user.role })
          .from(user)
          .where(eq(user.id, actor.userId))
          .for('update');
        if (account === undefined) return null;
        // A creator's account opens exactly one creator (`user_creator_link_check`): her link is her agenda's (CR-05).
        if (account.role !== 'creator') {
          const [member] = await tx
            .select({ status: teamMembers.status })
            .from(teamMembers)
            .where(eq(teamMembers.userId, actor.userId));
          if (member === undefined || member.status === 'left') return null;
        }
        // A new address keeps her choice of shifts (ADR 0045 § 5): only the address changes.
        const before = await revokeLive(tx, actor);
        const withShifts = account.role === 'creator' && before.some((link) => link.withShifts);
        const token = randomBytes(TOKEN_BYTES).toString('base64url');
        const id = newId(CalendarLinkIdSchema);
        const [created] = await tx
          .insert(calendarLinks)
          .values({ id, userId: actor.userId, tokenHash: hashOf(token), withShifts })
          .returning({ createdAt: calendarLinks.createdAt });
        if (created === undefined) throw new Error('calendar link not created');
        await audit(tx, actor, 'calendar_link.create', id);
        return { token, createdAt: created.createdAt };
      }),

    revoke: (actor) => withAdmin(adminDb, async (tx) => (await revokeLive(tx, actor)).length > 0),

    choose: (actor, withShifts) =>
      withAdmin(adminDb, async (tx) => {
        const [changed] = await tx
          .update(calendarLinks)
          .set({ withShifts })
          .where(and(eq(calendarLinks.userId, actor.userId), sql`${calendarLinks.revokedAt} is null`))
          .returning({ id: calendarLinks.id, createdAt: calendarLinks.createdAt });
        if (changed === undefined) return null;
        await audit(tx, actor, 'calendar_link.choose', changed.id, { withShifts });
        return { createdAt: changed.createdAt, withShifts };
      }),

    holder: async (token) => {
      const hash = hashOf(token);
      const [row] = await withAdmin(adminDb, (tx) =>
        tx
          .select({
            tokenHash: calendarLinks.tokenHash,
            userId: calendarLinks.userId,
            withShifts: calendarLinks.withShifts,
            role: user.role,
            memberId: teamMembers.id,
            memberStatus: teamMembers.status,
          })
          .from(calendarLinks)
          .innerJoin(user, eq(user.id, calendarLinks.userId))
          .leftJoin(teamMembers, eq(teamMembers.userId, calendarLinks.userId))
          .where(and(eq(calendarLinks.tokenHash, hash), sql`${calendarLinks.revokedAt} is null`)),
      );
      if (row === undefined || !sameHash(row.tokenHash, hash)) return null;
      return holderOf(row);
    },
  };
}
