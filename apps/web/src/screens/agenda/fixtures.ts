import {
  CreatorAgendaSchema,
  CreatorTaskSchema,
  type CreatorAgenda,
  type CreatorTask,
} from '@impera/contracts';

/*
 * Her agenda for the tests, invented (ADR 0010): Paris, the week of Monday 2 November 2026 (UTC+1 after 25/10, so
 * 13:00Z is 14 h). Ids are fixed UUID v7 so that the snapshots and the gestures read the same.
 */

export const ZONE = 'Europe/Paris';
export const MONDAY = '2026-11-02';
export const WEDNESDAY = '2026-11-04';

const id = (n: number): string => `01936f00-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const shoot: CreatorTask = CreatorTaskSchema.parse({
  id: id(1),
  when: { kind: 'timed', startsAt: '2026-11-04T13:00:00.000Z', endsAt: '2026-11-04T15:00:00.000Z' },
  category: 'shoot',
  title: 'Tournage tenue rouge',
  purpose: 'Les photos du pack de vendredi',
  shootBrief: 'Pour : pack du vendredi\nTenue rouge, lumière douce\n10 photos, 2 vidéos courtes',
  essential: false,
  reminderMinutes: 30,
});

export const live: CreatorTask = CreatorTaskSchema.parse({
  id: id(2),
  when: { kind: 'timed', startsAt: '2026-11-04T20:00:00.000Z', endsAt: '2026-11-04T21:00:00.000Z' },
  category: 'live',
  title: 'Live du soir',
  purpose: null,
  essential: false,
  reminderMinutes: null,
});

export const stretch: CreatorTask = CreatorTaskSchema.parse({
  id: id(3),
  when: { kind: 'routine', weekdays: [1, 3, 5] },
  category: 'personal',
  title: 'Story du matin',
  purpose: 'Rester présente chaque jour',
  essential: true,
  reminderMinutes: null,
});

export const post: CreatorTask = CreatorTaskSchema.parse({
  id: id(4),
  when: { kind: 'day', day: WEDNESDAY },
  category: 'post',
  title: 'Publier le carrousel',
  purpose: null,
  essential: false,
  reminderMinutes: null,
});

export const agendaOf = (patch: Partial<CreatorAgenda> = {}): CreatorAgenda =>
  CreatorAgendaSchema.parse({
    timeZone: ZONE,
    today: WEDNESDAY,
    tasks: [shoot, live, stretch, post],
    ticks: [],
    availabilities: [
      { id: id(10), when: { kind: 'weekly', weekday: 3, startMinute: 17 * 60, endMinute: 20 * 60 } },
      { id: id(11), when: { kind: 'weekly', weekday: 5, startMinute: 22 * 60, endMinute: 2 * 60 } },
    ],
    suggestions: [
      {
        id: id(20),
        when: null,
        week: MONDAY,
        minutes: 90,
        category: 'shoot',
        title: 'Séance lingerie',
        purpose: 'Pour le script de la semaine',
        shootBrief: 'Pour : feed\nAmbiance Nuit, noir et dentelle',
        essential: false,
      },
      {
        id: id(21),
        when: { kind: 'timed', startsAt: '2026-11-04T16:00:00.000Z', endsAt: '2026-11-04T17:00:00.000Z' },
        week: MONDAY,
        minutes: 60,
        category: 'socials',
        title: 'Répondre aux commentaires',
        purpose: null,
        essential: false,
      },
    ],
    streak: { days: 12, jokerUsed: false, atRisk: false, milestone: null, next: 14 },
    ...patch,
  });
