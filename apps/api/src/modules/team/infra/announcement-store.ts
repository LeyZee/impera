import {
  AnnouncementIdSchema,
  AnnouncementReaderSchema,
  AnnouncementReadSchema,
  AuditEntryIdSchema,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  type AnnouncementId,
  type AnnouncementRead,
  type AnnouncementReader,
  type CreateAnnouncementBody,
  type CreatorId,
  type UserId,
} from '@impera/contracts';
import { and, eq, schema, sql, withMember, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import {
  AnnouncementCreatorForbidden,
  AnnouncementNotFound,
  AnnouncementWithdrawForbidden,
} from '../domain/errors';
import { assertReadsTeam } from '../domain/members';
import type { Actor } from '../domain/ports';

const { announcements, announcementReads, auditLog, teamMembers, user } = schema;

/** How many of an announcement's members have read it: the owner's and the managers' view. */
interface ReadCount {
  readonly read: number;
  readonly of: number;
}

/** An announcement as the base holds it, for the reader of the transaction; the creator's name is the service's. */
export interface StoredAnnouncement {
  readonly id: AnnouncementId;
  readonly body: string;
  readonly creatorId: CreatorId | null;
  readonly authorName: string;
  readonly mine: boolean;
  readonly createdAt: Date;
  readonly readAt: Date | null;
  readonly reads: ReadCount | null;
}

export interface AnnouncementStore {
  /** The newest first, at most `limit`, those the policies let `reader` read; withdrawn ones left out. */
  list(reader: UserId, limit: number): Promise<StoredAnnouncement[]>;
  /** Written by `actor`: the owner, or an active manager to the whole team or a creator of his own list. */
  create(actor: Actor, body: CreateAnnouncementBody): Promise<StoredAnnouncement>;
  /** His « Lu », once: a second one returns the first. */
  read(actor: Actor, id: AnnouncementId): Promise<AnnouncementRead>;
  /** Owner and active managers: every member it is addressed to, those who read it first. */
  readers(reader: UserId, id: AnnouncementId): Promise<AnnouncementReader[]>;
  /** By the owner or its author, once. */
  withdraw(actor: Actor, id: AnnouncementId): Promise<void>;
}

/**
 * The members an announcement is addressed to, as the base reads them now: still in the team, not its author, and
 * for a creator's announcement, with her on their list. `a` is the announcement's alias in the query.
 */
const addressedTo = sql`m.status <> 'left' and m.user_id <> a.author_user_id and (a.creator_id is null or a.creator_id = any(u.creator_ids))`;

const ListRowSchema = z.object({
  id: AnnouncementIdSchema,
  body: z.string(),
  creator_id: CreatorIdSchema.nullable(),
  author_name: z.string(),
  mine: z.boolean(),
  created_at: z.coerce.date(),
  read_at: z.coerce.date().nullable(),
  read_count: z.coerce.number().int(),
  of_count: z.coerce.number().int(),
});

const ReaderRowSchema = z.object({
  member_id: TeamMemberIdSchema,
  name: z.string(),
  read_at: z.coerce.date().nullable(),
});

const toStored = (row: z.infer<typeof ListRowSchema>, counts: boolean): StoredAnnouncement => ({
  id: row.id,
  body: row.body,
  creatorId: row.creator_id,
  authorName: row.author_name,
  mine: row.mine,
  createdAt: row.created_at,
  readAt: row.read_at,
  reads: counts ? { read: row.read_count, of: row.of_count } : null,
});

/**
 * Reads as the session's account (`withMember`): the policies of `announcements` decide what each one reads, and the
 * counts of reads are computed for the owner and the active managers only.
 */
async function listOf(
  tx: Transaction,
  reader: UserId,
  counts: boolean,
  where: ReturnType<typeof sql>,
  limit: number,
): Promise<StoredAnnouncement[]> {
  const { rows } = await tx.execute(sql`
    select a.id, a.body, a.creator_id, author.name as author_name, a.author_user_id = ${reader} as mine,
      a.created_at,
      (select r.read_at from announcement_reads r join team_members me on me.id = r.member_id
        where r.announcement_id = a.id and me.user_id = ${reader}) as read_at,
      ${
        counts
          ? sql`(select count(*) from announcement_reads r join team_members m on m.id = r.member_id
              join "user" u on u.id = m.user_id where r.announcement_id = a.id and ${addressedTo})`
          : sql`0`
      } as read_count,
      ${
        counts
          ? sql`(select count(*) from team_members m join "user" u on u.id = m.user_id where ${addressedTo})`
          : sql`0`
      } as of_count
    from announcements a join "user" author on author.id = a.author_user_id
    where a.withdrawn_at is null and ${where}
    order by a.created_at desc, a.id desc
    limit ${limit}`);
  return rows.map((row) => toStored(ListRowSchema.parse(row), counts));
}

async function audit(
  tx: Transaction,
  actor: Actor,
  action: string,
  id: AnnouncementId,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: actor.userId,
    action,
    entity: 'announcement',
    entityId: id,
    details,
    ip: actor.ip,
  });
}

export function createDrizzleAnnouncementStore(db: Database, now: () => Date): AnnouncementStore {
  return {
    list: (reader, limit) =>
      withMember(db, reader, (tx, scope) => listOf(tx, reader, scope !== 'self', sql`true`, limit)),

    create: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertReadsTeam(scope);
        if (scope === 'agency' && body.creatorId !== null) {
          const [own] = await tx
            .select({ creatorIds: user.creatorIds })
            .from(user)
            .where(eq(user.id, actor.userId));
          if (!own?.creatorIds.includes(body.creatorId)) {
            throw new AnnouncementCreatorForbidden();
          }
        }
        const id = newId(AnnouncementIdSchema);
        await tx.insert(announcements).values({
          id,
          creatorId: body.creatorId,
          body: body.body,
          authorUserId: actor.userId,
          createdAt: now(),
        });
        // Never its text: the trace says who wrote to whom.
        await audit(tx, actor, 'announcement.create', id, { creatorId: body.creatorId });
        const [created] = await listOf(tx, actor.userId, true, sql`a.id = ${id}`, 1);
        if (created === undefined) throw new AnnouncementNotFound();
        return created;
      }),

    read: (actor, id) =>
      withMember(db, actor.userId, async (tx) => {
        const [visible] = await tx
          .select({ id: announcements.id })
          .from(announcements)
          .where(and(eq(announcements.id, id), sql`${announcements.withdrawnAt} is null`));
        const [member] = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(and(eq(teamMembers.userId, actor.userId), sql`${teamMembers.status} <> 'left'`));
        // Not addressed to him, withdrawn, or he is no member (the owner): nothing he may say « Lu » to.
        if (visible === undefined || member === undefined) throw new AnnouncementNotFound();
        await tx
          .insert(announcementReads)
          .values({ announcementId: id, memberId: member.id })
          .onConflictDoNothing();
        const [read] = await tx
          .select({ readAt: announcementReads.readAt })
          .from(announcementReads)
          .where(and(eq(announcementReads.announcementId, id), eq(announcementReads.memberId, member.id)));
        if (read === undefined) throw new AnnouncementNotFound();
        return AnnouncementReadSchema.parse({ announcementId: id, readAt: read.readAt.toISOString() });
      }),

    readers: (reader, id) =>
      withMember(db, reader, async (tx, scope) => {
        assertReadsTeam(scope);
        const { rows } = await tx.execute(sql`
          select m.id as member_id, u.name, r.read_at
          from announcements a
          join team_members m on true
          join "user" u on u.id = m.user_id
          left join announcement_reads r on r.announcement_id = a.id and r.member_id = m.id
          where a.id = ${id} and a.withdrawn_at is null and ${addressedTo}
          order by r.read_at asc nulls last, u.name asc`);
        if (rows.length === 0) {
          const [known] = await tx
            .select({ id: announcements.id })
            .from(announcements)
            .where(and(eq(announcements.id, id), sql`${announcements.withdrawnAt} is null`));
          if (known === undefined) throw new AnnouncementNotFound();
        }
        return rows.map((row) => {
          const parsed = ReaderRowSchema.parse(row);
          return AnnouncementReaderSchema.parse({
            memberId: parsed.member_id,
            name: parsed.name,
            readAt: parsed.read_at === null ? null : parsed.read_at.toISOString(),
          });
        });
      }),

    withdraw: (actor, id) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertReadsTeam(scope);
        const [found] = await tx
          .select({ authorUserId: announcements.authorUserId })
          .from(announcements)
          .where(and(eq(announcements.id, id), sql`${announcements.withdrawnAt} is null`));
        if (found === undefined) throw new AnnouncementNotFound();
        if (scope !== 'owner' && found.authorUserId !== actor.userId)
          throw new AnnouncementWithdrawForbidden();
        await tx
          .update(announcements)
          .set({ withdrawnAt: now(), withdrawnBy: actor.userId })
          .where(eq(announcements.id, id));
        await audit(tx, actor, 'announcement.withdraw', id, {});
      }),
  };
}
