import type { Announcement } from '@impera/contracts';

import { addDays, clockAt, dayOf } from '@/scheduling/time';

/** « jeu. 19 nov. »: a day further than yesterday. */
const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** When it was written, in the reader's zone: « aujourd’hui, 13 h 05 », « hier, 9 h », « jeu. 19 nov., 9 h ». */
export function whenWritten(createdAt: string, zone: string, today: string): string {
  const day = dayOf(createdAt, zone);
  const word =
    day === today
      ? 'aujourd’hui'
      : day === addDays(today, -1)
        ? 'hier'
        : SHORT_DAY.format(new Date(`${day}T00:00:00Z`));
  return `${word}, ${clockAt(createdAt, zone)}`;
}

/** Whom it is addressed to: « À toute l’équipe », « À l’équipe de Nora ». */
export function audienceOf(announcement: Pick<Announcement, 'creatorId' | 'creatorName'>): string {
  if (announcement.creatorId === null) return 'À toute l’équipe';
  return announcement.creatorName === null
    ? 'À l’équipe d’une créatrice'
    : `À l’équipe de ${announcement.creatorName}`;
}

/** How many read it, for its author and the managers: « Lue par 2 sur 5 », « Lue par tous ». */
export function readsLine(reads: NonNullable<Announcement['reads']>): string {
  if (reads.of === 0) return 'Personne d’autre dans cette équipe';
  if (reads.read === 0)
    return `Pas encore lue · ${String(reads.of)} ${reads.of === 1 ? 'membre' : 'membres'}`;
  if (reads.read >= reads.of) return reads.of === 1 ? 'Lue' : `Lue par tous · ${String(reads.of)}`;
  return `Lue par ${String(reads.read)} sur ${String(reads.of)}`;
}
