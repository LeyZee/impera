import { randomUUID } from 'node:crypto';

import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  newId,
  PlatformSchema,
  TeamMemberIdSchema,
  type Platform,
  type TeamImportCounts,
  type TeamMemberId,
  type TeamPlatformRemoval,
} from '@impera/contracts';
import { and, eq, inArray, schema, sql, withMember, type Database, type Transaction } from '@impera/db';

import { SalesFeedMemberUnprocessable, SalesFeedTeamForbidden } from '../../domain/errors';
import {
  isAbnormalReading,
  linkRefusal,
  type ReviewState,
  type TeamImportContext,
  type TeamImportStore,
  type TeamImportViewer,
  type TeamLink,
  type TeamLinkOutcome,
  type TeamLinkRequest,
} from '../../domain/team-import';

const chatters = schema.salesFeedChatters;
const reviews = schema.salesFeedChatterReviews;
const readings = schema.salesFeedTeamReadings;

/** The owner, or an active manager with his member record; `null` for anyone else (ADR 0076 § 8). */
async function viewerIn(tx: Transaction, userId: string, scope: string): Promise<TeamImportViewer | null> {
  if (scope === 'owner') return { kind: 'owner' };
  if (scope !== 'agency') return null;
  const [own] = await tx
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, userId));
  return own === undefined ? null : { kind: 'manager', memberId: TeamMemberIdSchema.parse(own.id) };
}

/** One write at a time per account, whoever writes it: the review's links, its invitations. */
async function lockAccount(tx: Transaction, platform: Platform, platformChatterId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`sales_feed_chatter:${platform}:${platformChatterId}`}))`,
  );
}

const reviewKey = (platform: Platform, platformChatterId: string) =>
  and(eq(reviews.platform, platform), eq(reviews.platformChatterId, platformChatterId));

async function audit(
  tx: Transaction,
  by: string,
  action: string,
  platform: Platform,
  platformChatterId: string,
  details: Record<string, unknown>,
): Promise<void> {
  // The platform's id and the link, never a person's name, e-mail or an amount (ADR 0076 § 4).
  await tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: by,
    action,
    entity: 'sales_feed_chatter',
    entityId: `${platform}:${platformChatterId}`,
    details: { platform, platformChatterId, ...details },
  });
}

/** Sets the account's decision (`none`, `dismissed`) or clears it; the row is created when the reading has not yet. */
async function decide(
  tx: Transaction,
  platform: Platform,
  platformChatterId: string,
  decision: 'none' | 'dismissed' | null,
  by: string,
): Promise<void> {
  const values = {
    decision,
    decidedBy: decision === null ? null : by,
    decidedAt: decision === null ? null : new Date(),
  };
  await tx
    .insert(reviews)
    .values({ platform, platformChatterId, ...values })
    .onConflictDoUpdate({ target: [reviews.platform, reviews.platformChatterId], set: values });
}

/**
 * One account's link moved, as the viewer may (ADR 0076 § 2, § 4), in the viewer's transaction: the restrictive
 * policies of migration 0135 hold the same rule for a manager's own record, this one answers row by row in French.
 */
async function linkIn(
  tx: Transaction,
  viewer: TeamImportViewer,
  by: string,
  platform: Platform,
  platformChatterId: string,
  link: TeamLinkRequest['link'],
  isExternal: boolean,
): Promise<TeamLinkOutcome> {
  const key = and(eq(chatters.platform, platform), eq(chatters.platformChatterId, platformChatterId));
  // Locked by its key, then read plainly: `FOR UPDATE` would go through the update policy, which hides a manager's own
  // link from him, and his refusal would be read as « no link yet » (ADR 0076 § 4).
  await lockAccount(tx, platform, platformChatterId);
  const [before] = await tx
    .select({ kind: chatters.kind, memberId: chatters.memberId })
    .from(chatters)
    .where(key);
  const beforeMember = before?.memberId == null ? null : TeamMemberIdSchema.parse(before.memberId);
  const refusal = linkRefusal(viewer, { isExternal }, beforeMember, link ?? { kind: 'none' });
  if (refusal !== null) return { ok: false, kind: refusal };
  if (link?.kind === 'member') {
    if (!TeamMemberIdSchema.safeParse(link.memberId).success) return { ok: false, kind: 'member_unknown' };
    // A member who left may be linked: his sales from before his departure go on his final statement, the pay module
    // counts none after it (ADR 0072).
    const [member] = await tx
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, link.memberId));
    if (member === undefined) return { ok: false, kind: 'member_unknown' };
  }
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
      ...(same ? {} : { linkVersion: randomUUID(), linkVersionAt: new Date() }),
    };
    await tx
      .insert(chatters)
      .values({ platform, platformChatterId, ...values })
      .onConflictDoUpdate({ target: [chatters.platform, chatters.platformChatterId], set: values });
  }
  // « Personne » is a decision kept apart from the links: the account is no longer new (§ 1, § 6).
  await decide(tx, platform, platformChatterId, link === null ? 'none' : null, by);
  // Whose sales a chatter's are (CRM-03 pays by this link): dated, by whom, and what it was before.
  await audit(
    tx,
    by,
    link === null ? 'sales_feed.chatter_unlinked' : 'sales_feed.chatter_linked',
    platform,
    platformChatterId,
    {
      kind: link?.kind ?? null,
      memberId: link?.kind === 'member' ? link.memberId : null,
      previous: before === undefined ? null : { kind: before.kind, memberId: before.memberId },
    },
  );
  return { ok: true };
}

/**
 * The review of a platform's team (ADR 0076), read and written through `withMember`: the owner, or an active manager
 * whose own record the base keeps out of his reach.
 */
export function createDrizzleTeamImportStore(db: Database): TeamImportStore {
  return {
    viewer: (userId) => withMember(db, userId, (tx, scope) => viewerIn(tx, userId, scope)),

    removals: (userId) =>
      withMember(db, userId, async (tx, scope): Promise<TeamPlatformRemoval[]> => {
        if ((await viewerIn(tx, userId, scope)) === null) return [];
        const rows = await tx
          .select({
            platform: reviews.platform,
            platformChatterId: reviews.platformChatterId,
            memberId: chatters.memberId,
            removedAt: reviews.platformRemovedAt,
            absentSince: reviews.absentSince,
          })
          .from(reviews)
          .innerJoin(
            chatters,
            and(
              eq(chatters.platform, reviews.platform),
              eq(chatters.platformChatterId, reviews.platformChatterId),
            ),
          )
          .innerJoin(schema.teamMembers, eq(schema.teamMembers.id, chatters.memberId))
          .where(
            and(
              sql`${schema.teamMembers.status} <> 'left'`,
              sql`(${reviews.platformRemovedAt} is not null or ${reviews.absentSince} is not null)`,
            ),
          )
          .orderBy(reviews.platform, reviews.platformChatterId);
        return rows.map((row) => ({
          platform: PlatformSchema.parse(row.platform),
          platformChatterId: row.platformChatterId,
          memberId: TeamMemberIdSchema.parse(row.memberId),
          removedAt: row.removedAt?.toISOString() ?? null,
          absent: row.absentSince !== null,
        }));
      }),

    context: (userId, platform) =>
      withMember(db, userId, async (tx, scope): Promise<TeamImportContext | null> => {
        const viewer = await viewerIn(tx, userId, scope);
        if (viewer === null) return null;
        // One after the other: a transaction's client runs one query at a time.
        const memberRows = await tx
          .select({
            id: schema.teamMembers.id,
            firstName: schema.teamMembers.firstName,
            lastName: schema.teamMembers.lastName,
            displayName: schema.teamMembers.displayName,
            leftOn: schema.teamMembers.leftOn,
            email: schema.user.email,
            creatorIds: schema.user.creatorIds,
          })
          .from(schema.teamMembers)
          .innerJoin(schema.user, eq(schema.user.id, schema.teamMembers.userId));
        const linkRows = await tx.select().from(chatters).where(eq(chatters.platform, platform));
        const reviewRows = await tx.select().from(reviews).where(eq(reviews.platform, platform));
        const modelRows = await tx
          .select({
            platformModelId: schema.salesFeedModels.platformModelId,
            creatorId: schema.salesFeedModels.creatorId,
          })
          .from(schema.salesFeedModels)
          .where(eq(schema.salesFeedModels.platform, platform));
        const creatorRows = await tx
          .select({ id: schema.creators.id, displayName: schema.creators.displayName })
          .from(schema.creators);
        const reading = await tx
          .select({ abnormal: readings.abnormal })
          .from(readings)
          .where(eq(readings.platform, platform));
        const creatorNames = new Map(
          creatorRows.map((row) => [CreatorIdSchema.parse(row.id), row.displayName] as const),
        );
        return {
          viewer,
          members: memberRows.map((row) => ({
            memberId: TeamMemberIdSchema.parse(row.id),
            displayName: row.displayName,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            leftOn: row.leftOn,
            creatorIds: row.creatorIds.map((id) => CreatorIdSchema.parse(id)),
          })),
          links: new Map(
            linkRows.map((row): [string, TeamLink] => [
              row.platformChatterId,
              row.kind === 'member' && row.memberId !== null
                ? { kind: 'member', memberId: TeamMemberIdSchema.parse(row.memberId) }
                : { kind: 'agent' },
            ]),
          ),
          reviews: new Map(
            reviewRows.map((row): [string, ReviewState] => [
              row.platformChatterId,
              {
                decision: row.decision === 'none' || row.decision === 'dismissed' ? row.decision : null,
                decidedAt: row.decidedAt,
                platformRemovedAt: row.platformRemovedAt,
                absentSince: row.absentSince,
                isBot: row.isBot,
              },
            ]),
          ),
          modelCreators: new Map(
            modelRows.map((row) => {
              const creatorId = CreatorIdSchema.parse(row.creatorId);
              return [
                row.platformModelId,
                { creatorId, displayName: creatorNames.get(creatorId) ?? '' },
              ] as const;
            }),
          ),
          creatorNames,
          abnormalRead: reading[0]?.abnormal ?? false,
        };
      }),

    async recordReading(platform, listed, now) {
      await db.transaction(async (tx) => {
        // One reading at a time per platform: the previous count decides whether this one is believed.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sales_feed_team:${platform}`}))`);
        const [previous] = await tx.select().from(readings).where(eq(readings.platform, platform));
        // The first reading has no count before it: the accounts already linked stand for it, so that a first list
        // that comes back empty is not believed and puts no linked member in alert (relecture Extension de #626).
        const [linkedBefore] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(chatters)
          .where(eq(chatters.platform, platform));
        const abnormal = isAbnormalReading(listed.length, previous?.listed ?? linkedBefore?.count ?? 0);
        for (const chatter of listed) {
          const seen = {
            platformRemovedAt: chatter.removedAt === null ? null : new Date(chatter.removedAt),
            absentSince: null,
            isBot: chatter.isBot,
          };
          await tx
            .insert(reviews)
            .values({ platform, platformChatterId: chatter.platformChatterId, firstSeenAt: now, ...seen })
            .onConflictDoUpdate({ target: [reviews.platform, reviews.platformChatterId], set: seen });
        }
        if (!abnormal) {
          // Gone only after a complete, believed reading (§ 5); an account linked but never seen becomes known here.
          const ids = listed.map((chatter) => chatter.platformChatterId);
          const unlisted = sql`not (${inArray(reviews.platformChatterId, ids)})`;
          await tx
            .update(reviews)
            .set({ absentSince: now })
            .where(and(eq(reviews.platform, platform), sql`${reviews.absentSince} is null`, unlisted));
          const linked = await tx
            .select({ id: chatters.platformChatterId })
            .from(chatters)
            .where(
              and(eq(chatters.platform, platform), sql`not (${inArray(chatters.platformChatterId, ids)})`),
            );
          for (const { id } of linked) {
            await tx
              .insert(reviews)
              .values({ platform, platformChatterId: id, firstSeenAt: now, absentSince: now })
              .onConflictDoNothing();
          }
        }
        // Believed or not, the count of the last reading is the one the next compares with.
        const reading = { readAt: now, listed: abnormal ? (previous?.listed ?? 0) : listed.length, abnormal };
        await tx
          .insert(readings)
          .values({ platform, ...reading })
          .onConflictDoUpdate({ target: readings.platform, set: reading });
      });
    },

    link: (userId, platform, requests) =>
      withMember(db, userId, async (tx, scope) => {
        const viewer = await viewerIn(tx, userId, scope);
        if (viewer === null) return null;
        const outcomes: TeamLinkOutcome[] = [];
        // Each row in its own savepoint: a refused one leaves the others standing.
        for (const request of requests) {
          outcomes.push(
            await tx.transaction((row) =>
              linkIn(
                row,
                viewer,
                userId,
                platform,
                request.platformChatterId,
                request.link,
                request.isExternal,
              ),
            ),
          );
        }
        return outcomes;
      }),

    dismiss: (userId, platform, platformChatterId, dismissed) =>
      withMember(db, userId, async (tx, scope) => {
        const viewer = await viewerIn(tx, userId, scope);
        if (viewer === null) return 'forbidden';
        const [linked] = await tx
          .select({ kind: chatters.kind })
          .from(chatters)
          .where(and(eq(chatters.platform, platform), eq(chatters.platformChatterId, platformChatterId)));
        // A linked account is never set aside: its link is changed instead.
        if (linked !== undefined) return 'linked';
        const [review] = await tx
          .select({ decision: reviews.decision })
          .from(reviews)
          .where(reviewKey(platform, platformChatterId))
          .for('update');
        const was = review?.decision === 'dismissed';
        if (was === dismissed) return 'done';
        await decide(tx, platform, platformChatterId, dismissed ? 'dismissed' : null, userId);
        await audit(
          tx,
          userId,
          dismissed ? 'sales_feed.chatter_dismissed' : 'sales_feed.chatter_restored',
          platform,
          platformChatterId,
          {},
        );
        return 'done';
      }),

    counts: (userId, platform) =>
      withMember(db, userId, async (tx, scope): Promise<TeamImportCounts | null> => {
        if ((await viewerIn(tx, userId, scope)) === null) return null;
        const [row] = await tx
          .execute<{ new_count: number; removal_count: number; abnormal: boolean | null }>(
            sql`
          select
            (select count(*)::int from sales_feed_chatter_reviews r
              where r.platform = ${platform} and r.decision is null and not r.is_bot
                and r.platform_removed_at is null and r.absent_since is null
                and not exists (select 1 from sales_feed_chatters c
                  where c.platform = r.platform and c.platform_chatter_id = r.platform_chatter_id)) as new_count,
            (select count(*)::int from sales_feed_chatter_reviews r
              join sales_feed_chatters c on c.platform = r.platform and c.platform_chatter_id = r.platform_chatter_id
              join team_members m on m.id = c.member_id
              where r.platform = ${platform} and m.status <> 'left'
                and (r.platform_removed_at is not null or r.absent_since is not null)) as removal_count,
            (select abnormal from sales_feed_team_readings where platform = ${platform}) as abnormal
        `,
          )
          .then((result) => result.rows);
        return {
          newCount: row?.new_count ?? 0,
          removalCount: row?.removal_count ?? 0,
          abnormalRead: row?.abnormal ?? false,
        };
      }),
  };
}

interface PlatformAccount {
  readonly platform: Platform;
  readonly platformChatterId: string;
}

/**
 * The link an invitation poses (ADR 0076 § 3), for `team`'s port, in the inviter's own `withMember` transaction: the
 * account locked until it ends, then linked to the member just made, with its audit line and its decision cleared.
 */
export const invitationChatterLinks = {
  async lockLink(tx: Transaction, account: PlatformAccount): Promise<TeamLink | null> {
    await lockAccount(tx, account.platform, account.platformChatterId);
    const [row] = await tx
      .select({ kind: chatters.kind, memberId: chatters.memberId })
      .from(chatters)
      .where(
        and(
          eq(chatters.platform, account.platform),
          eq(chatters.platformChatterId, account.platformChatterId),
        ),
      );
    if (row === undefined) return null;
    return row.kind === 'member' && row.memberId !== null
      ? { kind: 'member', memberId: TeamMemberIdSchema.parse(row.memberId) }
      : { kind: 'agent' };
  },

  async link(
    tx: Transaction,
    account: PlatformAccount,
    memberId: TeamMemberId,
    actor: { readonly userId: string },
  ): Promise<void> {
    const [setting] = await tx
      .execute<{ scope: string | null }>(
        sql`select nullif(current_setting('app.team_scope', true), '') as scope`,
      )
      .then((result) => result.rows);
    const viewer = await viewerIn(tx, actor.userId, setting?.scope ?? '');
    if (viewer === null) throw new SalesFeedTeamForbidden();
    const outcome = await linkIn(
      tx,
      viewer,
      actor.userId,
      account.platform,
      account.platformChatterId,
      { kind: 'member', memberId },
      false,
    );
    // The invitation checked all this before (a free account, a new and active member): a refusal here is a gap
    // between the two, read as the refusal it is, never as a 500.
    if (!outcome.ok) {
      throw outcome.kind === 'member_unknown'
        ? new SalesFeedMemberUnprocessable()
        : new SalesFeedTeamForbidden();
    }
  },
};
