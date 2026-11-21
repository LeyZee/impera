import {
  InstagramMediaKindSchema,
  InstagramMediaRefSchema,
  newId,
  SnapshotAgeSchema,
} from '@impera/contracts';
import { schema, withTenantJob, type Database } from '@impera/db';
import { z } from 'zod';

import type { KeptMedia, MediaInsightStore } from '../../domain/instagram-insights';

const { mediaInsightSnapshots } = schema;

const SnapshotIdSchema = z.uuid().brand<'MediaInsightSnapshotId'>();

/**
 * The readings of her Instagram numbers (ADR 0120 § 2), a creator's rows: read and written under the app role, one
 * creator and one transaction at a time (`withTenantJob`, job `media_insights`), never by the service role. The job
 * reads and inserts; the base lets it change or remove nothing, so a step kept stays as it was written.
 */
export function createDrizzleMediaInsightStore(db: Database): MediaInsightStore {
  return {
    keptOf: (creatorId, since) =>
      withTenantJob(db, creatorId, 'media_insights', async (tx) => {
        const rows = await tx
          .select({
            mediaRef: mediaInsightSnapshots.mediaRef,
            mediaKind: mediaInsightSnapshots.mediaKind,
            publishedAt: mediaInsightSnapshots.publishedAt,
            age: mediaInsightSnapshots.age,
          })
          .from(mediaInsightSnapshots)
          .orderBy(mediaInsightSnapshots.publishedAt, mediaInsightSnapshots.mediaRef);
        const byRef = new Map<string, KeptMedia & { kept: KeptMedia['kept'][number][] }>();
        for (const row of rows) {
          const age = SnapshotAgeSchema.parse(row.age);
          const media = byRef.get(row.mediaRef);
          if (media !== undefined) media.kept.push(age);
          else
            byRef.set(row.mediaRef, {
              ref: InstagramMediaRefSchema.parse(row.mediaRef),
              kind: InstagramMediaKindSchema.parse(row.mediaKind),
              publishedAt: row.publishedAt.toISOString(),
              kept: [age],
            });
        }
        const steps = SnapshotAgeSchema.options.length;
        return [...byRef.values()].filter(
          (media) => Date.parse(media.publishedAt) >= since.getTime() || media.kept.length < steps,
        );
      }),

    record: async (creatorId, rows) => {
      const values = rows.flatMap(({ media, snapshots }) =>
        snapshots.map((snapshot) => ({
          id: newId(SnapshotIdSchema),
          creatorId,
          mediaRef: media.ref,
          mediaKind: media.kind,
          publishedAt: new Date(media.publishedAt),
          age: snapshot.age,
          readAt: new Date(snapshot.readAt),
          missed: snapshot.numbers === null,
          views: snapshot.numbers?.views ?? null,
          reach: snapshot.numbers?.reach ?? null,
          likes: snapshot.numbers?.likes ?? null,
          commentCount: snapshot.numbers?.comments ?? null,
          shares: snapshot.numbers?.shares ?? null,
          saves: snapshot.numbers?.saves ?? null,
          reposts: snapshot.numbers?.reposts ?? null,
          // The skip rate exists for a Reel only: never kept of another kind, whatever an adapter answers.
          skipRate: media.kind === 'reel' ? (snapshot.numbers?.skipRate ?? null) : null,
        })),
      );
      if (values.length === 0) return 0;
      return withTenantJob(db, creatorId, 'media_insights', async (tx) => {
        const added = await tx
          .insert(mediaInsightSnapshots)
          .values(values)
          // A step already kept is never replaced: a job replayed, or two runs at once, add nothing.
          .onConflictDoNothing({
            target: [
              mediaInsightSnapshots.creatorId,
              mediaInsightSnapshots.mediaRef,
              mediaInsightSnapshots.age,
            ],
          })
          .returning({ age: mediaInsightSnapshots.age });
        return added.length;
      });
    },
  };
}
