import { LinkRefSchema, newId } from '@impera/contracts';
import { and, eq, inArray, schema, sql, withAdmin, withTenantJob, type Database } from '@impera/db';
import { z } from 'zod';

import type { LinkHourStore } from '../../domain/link-stats';

const { redirectLinkHours, redirectLinks } = schema;

const LinkHourIdSchema = z.uuid().brand<'RedirectLinkHourId'>();

/**
 * The hours kept of her redirect links (ADR 0120 § 3), a creator's rows: read and written under the app role, one
 * creator and one transaction at a time (`withTenantJob`, job `link_hours`), never by the service role, which only
 * says which creators have a link to read. The base
 * lets the job change an open hour only and remove nothing: a closed hour stays as it was written.
 */
export function createDrizzleLinkHourStore(db: Database, adminDb: Database): LinkHourStore {
  return {
    // Which creators have a link to read crosses them all: the service role, identifiers only. What is read of
    // each, and every write, goes through her own door below.
    creatorsToRead: () =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .selectDistinct({ creatorId: redirectLinks.creatorId })
          .from(redirectLinks)
          .where(
            and(
              sql`${redirectLinks.serviceRef} is not null`,
              sql`${redirectLinks.placement} is not null`,
              eq(redirectLinks.enabled, true),
            ),
          )
          .orderBy(redirectLinks.creatorId);
        return rows.map((row) => row.creatorId);
      }),

    attachedLinks: (creatorId) =>
      withTenantJob(db, creatorId, 'link_hours', async (tx) => {
        const rows = await tx
          .select({ id: redirectLinks.id, serviceRef: redirectLinks.serviceRef })
          .from(redirectLinks)
          .where(
            and(
              // The policy already keeps the job to her rows; said again here, as every job's store does.
              eq(redirectLinks.creatorId, creatorId),
              sql`${redirectLinks.serviceRef} is not null`,
              sql`${redirectLinks.placement} is not null`,
              eq(redirectLinks.enabled, true),
            ),
          )
          .orderBy(redirectLinks.name);
        return rows.map((row) => ({ id: row.id, ref: LinkRefSchema.parse(row.serviceRef) }));
      }),

    record: async (creatorId, linkId, hours, readAt) => {
      if (hours.length === 0) return 0;
      return withTenantJob(db, creatorId, 'link_hours', async (tx) => {
        // A closed hour is not offered again: the job's update policy would refuse the whole statement on it.
        const closed = await tx
          .select({ hour: redirectLinkHours.hour })
          .from(redirectLinkHours)
          .where(
            and(
              eq(redirectLinkHours.creatorId, creatorId),
              eq(redirectLinkHours.linkId, linkId),
              eq(redirectLinkHours.closed, true),
              inArray(
                redirectLinkHours.hour,
                hours.map((hour) => new Date(hour.hour)),
              ),
            ),
          );
        const frozen = new Set(closed.map((row) => row.hour.toISOString()));
        const values = hours
          .filter((hour) => !frozen.has(hour.hour))
          .map((hour) => ({
            id: newId(LinkHourIdSchema),
            creatorId,
            linkId,
            hour: new Date(hour.hour),
            pageviews: hour.pageviews,
            clicks: hour.clicks,
            robots: hour.robots,
            closed: hour.closed,
            readAt,
          }));
        if (values.length === 0) return 0;
        const written = await tx
          .insert(redirectLinkHours)
          .values(values)
          .onConflictDoUpdate({
            target: [redirectLinkHours.linkId, redirectLinkHours.hour],
            set: {
              pageviews: sql`excluded.pageviews`,
              clicks: sql`excluded.clicks`,
              robots: sql`excluded.robots`,
              closed: sql`excluded.closed`,
              readAt: sql`excluded.read_at`,
            },
            setWhere: eq(redirectLinkHours.closed, false),
          })
          .returning({ hour: redirectLinkHours.hour });
        return written.length;
      });
    },
  };
}
