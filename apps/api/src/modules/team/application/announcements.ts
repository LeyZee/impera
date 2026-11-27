import {
  AnnouncementSchema,
  type Announcement,
  type AnnouncementId,
  type AnnouncementRead,
  type AnnouncementReader,
  type CreateAnnouncementBody,
  type CreatorId,
  type UserId,
} from '@impera/contracts';

import type { Actor, CreatorNames } from '../domain/ports';
import type { AnnouncementStore, StoredAnnouncement } from '../infra/announcement-store';

/** What Aujourd'hui and Équipe › Annonces show: the latest ones, older ones being of no use to a shift. */
const ANNOUNCEMENTS_SHOWN = 30;

/** Annonces (EQ-12): the store's reads with each creator's name, as the screens say who it is addressed to. */
export interface AnnouncementService {
  list(reader: UserId): Promise<Announcement[]>;
  create(actor: Actor, body: CreateAnnouncementBody): Promise<Announcement>;
  read(actor: Actor, id: AnnouncementId): Promise<AnnouncementRead>;
  readers(reader: UserId, id: AnnouncementId): Promise<AnnouncementReader[]>;
  withdraw(actor: Actor, id: AnnouncementId): Promise<void>;
}

export function createAnnouncementService(
  store: AnnouncementStore,
  creatorNames: CreatorNames,
): AnnouncementService {
  const named = async (stored: readonly StoredAnnouncement[]): Promise<Announcement[]> => {
    const ids = [...new Set(stored.flatMap((one) => (one.creatorId === null ? [] : [one.creatorId])))];
    const names: ReadonlyMap<CreatorId, string> = ids.length === 0 ? new Map() : await creatorNames(ids);
    return stored.map((one) =>
      AnnouncementSchema.parse({
        id: one.id,
        body: one.body,
        creatorId: one.creatorId,
        // A creator unknown to the directory keeps the announcement readable, without her name.
        creatorName: one.creatorId === null ? null : (names.get(one.creatorId) ?? null),
        authorName: one.authorName,
        mine: one.mine,
        createdAt: one.createdAt.toISOString(),
        readAt: one.readAt === null ? null : one.readAt.toISOString(),
        reads: one.reads,
      }),
    );
  };
  return {
    list: async (reader) => named(await store.list(reader, ANNOUNCEMENTS_SHOWN)),
    create: async (actor, body) => {
      const [created] = await named([await store.create(actor, body)]);
      if (created === undefined) throw new Error('announcement lost between its write and its read');
      return created;
    },
    read: (actor, id) => store.read(actor, id),
    readers: (reader, id) => store.readers(reader, id),
    withdraw: (actor, id) => store.withdraw(actor, id),
  };
}
