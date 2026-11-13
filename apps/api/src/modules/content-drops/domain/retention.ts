import {
  ARCHIVED_THUMBNAIL_DAYS,
  DROP_ERASE_NOTICE_DAYS,
  DROP_KEPT_DAYS,
  DROP_UPLOAD_HOURS,
} from '@impera/contracts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * When an original kept at `keptAt` is erased, as long as no exit is planned for it (ADR 0055 § 7): a year later. A
 * planned exit (PUB-01) will bring it to the exit and 30 days.
 */
export const keptUntil = (keptAt: Date): Date => new Date(keptAt.getTime() + DROP_KEPT_DAYS * DAY_MS);

/** A send begun before this instant is refused (`DROP_UPLOAD_HOURS`): the storage has dropped its parts by now. */
export const abandonedBefore = (now: Date): Date => new Date(now.getTime() - DROP_UPLOAD_HOURS * HOUR_MS);

/** An original erased before this instant is announced to the agency now (`DROP_ERASE_NOTICE_DAYS`). */
export const noticeUntil = (now: Date): Date => new Date(now.getTime() + DROP_ERASE_NOTICE_DAYS * DAY_MS);

/** A creator archived before this instant has her reduced pictures erased now (ADR 0089). */
export const thumbnailsArchivedBefore = (now: Date): Date =>
  new Date(now.getTime() - ARCHIVED_THUMBNAIL_DAYS * DAY_MS);

/** The sentence of a file whose send did not end in time: she drops it again. */
export const ABANDONED = 'L’envoi ne s’est pas terminé dans les 24 h : dépose-le à nouveau';
