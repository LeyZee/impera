/**
 * Instants and wall-clock time for the planning (EQ-02, ADR 0011). The server speaks in UTC instants; a screen shows
 * them in the zone it chooses (the agency's grid, the reader's), and turns a day and an hour of that zone back into
 * an instant. The browser knows every zone: no table to keep.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
export const MINUTES_PER_DAY = 1440;

const PARTS = new Map<string, Intl.DateTimeFormat>();

function partsFormat(timeZone: string): Intl.DateTimeFormat {
  let format = PARTS.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PARTS.set(timeZone, format);
  }
  return format;
}

interface Wall {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function wallOf(instant: number, timeZone: string): Wall {
  const found: Record<string, number> = {};
  for (const part of partsFormat(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') found[part.type] = Number(part.value);
  }
  return {
    year: found['year'] ?? 1970,
    month: found['month'] ?? 1,
    day: found['day'] ?? 1,
    hour: found['hour'] ?? 0,
    minute: found['minute'] ?? 0,
    second: found['second'] ?? 0,
  };
}

/** How far ahead of UTC the zone's clock is at this instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallOf(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** The calendar day of an instant in a zone, `YYYY-MM-DD`. */
export function dayOf(instant: Date | string, timeZone: string): string {
  const wall = wallOf(new Date(instant).getTime(), timeZone);
  return `${String(wall.year)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The minute of the day of an instant in a zone, 0 to 1439. */
export function minuteOf(instant: Date | string, timeZone: string): number {
  const wall = wallOf(new Date(instant).getTime(), timeZone);
  return wall.hour * 60 + wall.minute;
}

function utcMidnight(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

/**
 * The instant at which a zone's clock reads `minute` on `day` (`minute` may reach 1440 and beyond: the next day). An
 * hour that happens twice, in the autumn, is the first of the two; an hour that does not exist, in the spring gap,
 * becomes the first instant after the gap. The same rules as the server's (contract of `/v1/scheduling`).
 */
export function zonedInstant(day: string, minute: number, timeZone: string): Date {
  const wall = utcMidnight(day) + minute * MINUTE_MS;
  const offsets = new Set([offsetAt(wall - DAY_MS / 2, timeZone), offsetAt(wall + DAY_MS / 2, timeZone)]);
  const valid = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => wall - offsetAt(instant, timeZone) === instant);
  if (valid.length > 0) return new Date(Math.min(...valid));
  // In the gap: the clock jumps over this hour. The first instant after it is where the offset changes.
  const ordered = [...offsets].map((offset) => wall - offset).sort((a, b) => a - b);
  let low = ordered[0] ?? wall;
  let high = ordered.at(-1) ?? wall;
  const after = offsetAt(high, timeZone);
  while (high - low > MINUTE_MS) {
    const middle = Math.floor((low + high) / 2 / MINUTE_MS) * MINUTE_MS;
    if (middle <= low) break;
    if (offsetAt(middle, timeZone) === after) high = middle;
    else low = middle;
  }
  return new Date(high);
}

/** The day `count` days after `day` (before, when negative). */
export function addDays(day: string, count: number): string {
  return new Date(utcMidnight(day) + count * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday of a calendar day: 1 Monday … 7 Sunday. */
export function weekdayOf(day: string): number {
  const weekday = new Date(utcMidnight(day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The Monday of the week that holds `day`. */
export const mondayOf = (day: string): string => addDays(day, 1 - weekdayOf(day));

/** The seven days of the week that starts on `monday`. */
export const weekOf = (monday: string): string[] =>
  Array.from({ length: 7 }, (_, index) => addDays(monday, index));

/** No-break spaces: « 1 h 17 » never splits across two lines. */
const NBSP = '\u00a0';

/** « 23 h », « 23 h 30 »: the French way, short enough for a grid. */
export function clockOf(minute: number): string {
  const inDay = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(inDay / 60);
  const minutes = inDay % 60;
  return minutes === 0 ? `${String(hours)}${NBSP}h` : `${String(hours)}${NBSP}h${NBSP}${pad(minutes)}`;
}

/** An instant's clock in a zone: « 23 h », « 5 h 15 ». */
export const clockAt = (instant: Date | string, timeZone: string): string =>
  clockOf(minuteOf(instant, timeZone));

/** « 23 h – 5 h », a range of two instants read in a zone. */
export const rangeAt = (from: Date | string, to: Date | string, timeZone: string): string =>
  `${clockAt(from, timeZone)} – ${clockAt(to, timeZone)}`;

/** « 6 h », « 5 h 30 », « 45 min »: how long something lasts. */
export function lengthOf(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / MINUTE_MS));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${String(minutes)}${NBSP}min`;
  return minutes === 0 ? `${String(hours)}${NBSP}h` : `${String(hours)}${NBSP}h${NBSP}${pad(minutes)}`;
}

/** « dans 12 min », « dans 3 h 05 », « dans 2 jours »: how far ahead an instant is. */
export function untilOf(milliseconds: number): string {
  if (milliseconds < DAY_MS) return `dans ${lengthOf(Math.max(milliseconds, MINUTE_MS))}`;
  const days = Math.round(milliseconds / DAY_MS);
  return days === 1 ? 'dans 1 jour' : `dans ${String(days)} jours`;
}

const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const LONG_DAY = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const MONTH_DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const FULL_DAY = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** « mar. 28 oct. », « dim. 1er nov. »: a day further than this week. */
export const dayMonth = (day: string): string => withFirstOfMonth(DAY_MONTH.formatToParts(utcMidnight(day)));

/** Calendar days from `from` to `to`, `to` excluded. */
export const daysFrom = (from: string, to: string): number =>
  Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);

/** « mar. 28 », « dim. 1er ». */
export const shortDay = (day: string): string => withFirstOfMonth(SHORT_DAY.formatToParts(utcMidnight(day)));

/** « 28 », « 1 »: the day's number alone, as a calendar's column heads it. */
export const dayNumber = (day: string): string => String(Number(day.slice(8)));

/** A formatted date as French writes it: the first of a month is « 1er ». */
export const withFirstOfMonth = (parts: readonly Intl.DateTimeFormatPart[]): string =>
  parts.map((part) => (part.type === 'day' && part.value === '1' ? '1er' : part.value)).join('');

/** « mardi 28 octobre », « dimanche 1er novembre ». */
export const longDay = (day: string): string => withFirstOfMonth(LONG_DAY.formatToParts(utcMidnight(day)));

/** « 17 octobre 2026 », « 1er novembre 2026 ». */
export const fullDay = (day: string): string => withFirstOfMonth(FULL_DAY.formatToParts(utcMidnight(day)));

/** « 26 oct. – 1er nov. », the week that starts on `monday` (PAIE-19: the first of a month is « 1er » everywhere). */
export const weekLabel = (monday: string): string =>
  `${withFirstOfMonth(MONTH_DAY.formatToParts(utcMidnight(monday)))} – ${withFirstOfMonth(
    MONTH_DAY.formatToParts(utcMidnight(addDays(monday, 6))),
  )}`;

/** The zone the browser reads in: the reader's own time. */
export const readerZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The cities French names otherwise than their zone does. */
const FRENCH_CITIES: ReadonlyMap<string, string> = new Map([
  ['Brussels', 'Bruxelles'],
  ['Lome', 'Lomé'],
  ['London', 'Londres'],
  ['Lisbon', 'Lisbonne'],
  ['Vienna', 'Vienne'],
  ['Warsaw', 'Varsovie'],
  ['Copenhagen', 'Copenhague'],
  ['Athens', 'Athènes'],
  ['Moscow', 'Moscou'],
  ['Mexico City', 'Mexico'],
  ['Sao Paulo', 'São Paulo'],
  ['DumontDUrville', 'Dumont-d’Urville'],
  // The list of zones in French too (recette 05/11, PRO-13): the names French writes otherwise, old names updated.
  ['Addis Ababa', 'Addis-Abeba'],
  ['Algiers', 'Alger'],
  ['Asmera', 'Asmara'],
  ['Cairo', 'Le Caire'],
  ['El Aaiun', 'Laâyoune'],
  ['Mogadishu', 'Mogadiscio'],
  ['Ndjamena', 'N’Djaména'],
  ['Sao Tome', 'São Tomé'],
  ['Asuncion', 'Asunción'],
  ['Bogota', 'Bogotá'],
  ['Cayman', 'Îles Caïmans'],
  ['Ciudad Juarez', 'Ciudad Juárez'],
  ['Curacao', 'Curaçao'],
  ['Dominica', 'Dominique'],
  ['Godthab', 'Nuuk'],
  ['Grenada', 'Grenade'],
  ['Havana', 'La Havane'],
  ['Jamaica', 'Jamaïque'],
  ['Lower Princes', 'Lower Prince’s Quarter'],
  ['Merida', 'Mérida'],
  ['Miquelon', 'Saint-Pierre-et-Miquelon'],
  ['Port of Spain', 'Port-d’Espagne'],
  ['Puerto Rico', 'Porto Rico'],
  ['Santo Domingo', 'Saint-Domingue'],
  ['St Barthelemy', 'Saint-Barthélemy'],
  ['St Johns', 'Saint-Jean de Terre-Neuve'],
  ['St Kitts', 'Saint-Christophe'],
  ['St Lucia', 'Sainte-Lucie'],
  ['St Thomas', 'Saint-Thomas'],
  ['St Vincent', 'Saint-Vincent'],
  ['Bahrain', 'Bahreïn'],
  ['Beirut', 'Beyrouth'],
  ['Damascus', 'Damas'],
  ['Dubai', 'Dubaï'],
  ['Hebron', 'Hébron'],
  ['Jerusalem', 'Jérusalem'],
  ['Kabul', 'Kaboul'],
  ['Katmandu', 'Katmandou'],
  ['Kuwait', 'Koweït'],
  ['Muscat', 'Mascate'],
  ['Nicosia', 'Nicosie'],
  ['Rangoon', 'Rangoun'],
  ['Riyadh', 'Riyad'],
  ['Saigon', 'Hô Chi Minh-Ville'],
  ['Samarkand', 'Samarcande'],
  ['Seoul', 'Séoul'],
  ['Singapore', 'Singapour'],
  ['Tashkent', 'Tachkent'],
  ['Tbilisi', 'Tbilissi'],
  ['Tehran', 'Téhéran'],
  ['Ulaanbaatar', 'Oulan-Bator'],
  ['Yekaterinburg', 'Iekaterinbourg'],
  ['Yerevan', 'Erevan'],
  ['Azores', 'Açores'],
  ['Bermuda', 'Bermudes'],
  ['Canary', 'Canaries'],
  ['Cape Verde', 'Cap-Vert'],
  ['Faeroe', 'Féroé'],
  ['Madeira', 'Madère'],
  ['South Georgia', 'Géorgie du Sud'],
  ['St Helena', 'Sainte-Hélène'],
  ['Andorra', 'Andorre'],
  ['Bucharest', 'Bucarest'],
  ['Chisinau', 'Chișinău'],
  ['Isle of Man', 'Île de Man'],
  ['Kiev', 'Kyiv'],
  ['Malta', 'Malte'],
  ['Tirane', 'Tirana'],
  ['Christmas', 'Île Christmas'],
  ['Cocos', 'Îles Cocos'],
  ['Comoro', 'Comores'],
  ['Mauritius', 'Maurice'],
  ['Reunion', 'La Réunion'],
  ['Easter', 'Île de Pâques'],
  ['Fiji', 'Fidji'],
  ['Galapagos', 'Galápagos'],
  ['Marquesas', 'Marquises'],
  ['Noumea', 'Nouméa'],
  ['Wallis', 'Wallis-et-Futuna'],
]);

/**
 * « Paris », « Porto-Novo », « Bruxelles »: a zone named by its city, in French. The one name every screen gives a
 * zone, the list that chooses it included (CREA-27).
 */
export const cityOf = (timeZone: string): string => {
  const city = (timeZone.split('/').at(-1) ?? timeZone).replaceAll('_', ' ');
  return FRENCH_CITIES.get(city) ?? city;
};

/**
 * The minute of the day a time field holds, on 24 hours: « 23:30 », « 9:00 », « 21h30 », « 21 h », « 22 »,
 * « 2230 », or null while it is empty, half typed or not an hour. The fields are text (`TimeField`), never
 * `<input type="time">`, which Chromium writes in the system's language, « 09:00 AM » on a machine in English,
 * whatever the page's `lang` (recette 28/10).
 */
export function minuteOfInput(text: string): number | null {
  const typed = text.trim();
  // Digits alone, as the phone's number pad types them: « 22 » is 22 h, « 930 » 9 h 30, « 2230 » 22 h 30.
  const match = /^(\d{1,2})(\d{2})$/u.exec(typed) ?? /^(\d{1,2})\s*(?::(\d{2})|h\s*(\d{2})?)?$/iu.exec(typed);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? match[3] ?? '0');
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/**
 * The day a day field holds, as `YYYY-MM-DD`: « 28/03/2027 », « 28/3/27 », « 28.03.2027 », « 28 3 », digits alone as
 * the phone's number pad types them (« 2803 », « 280327 », « 28032027 »), or the « 2027-03-28 » a paste brings; null
 * while it is empty, half typed or not a day. Without a year, it is the first such day from `today` on, or, for a day
 * looked back to (`toward: 'past'`: a birth, a validation, a period read), the last one up to `today`. Two digits of a
 * year are this century, but a past one never lies ahead: « 98 » is 1998 there. The fields are text (`DayField`), never
 * `<input type="date">`, which Chromium writes in the system's language, « 03/28/2027 » on a machine in English
 * (recette #561), as it does the hours.
 */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const PACKED_DAY = /^(\d{2})(\d{2})(\d{2}|\d{4})?$/u;
const WRITTEN_DAY = /^(\d{1,2})[\s./-]+(\d{1,2})(?:[\s./-]+(\d{2}|\d{4}))?$/u;

/**
 * Written as a day is written (« 31/02 », « 3102 », « 31/02/2027 »), whether or not the calendar has it: a day field
 * that cannot read it then says the day does not exist, not how to write one (recette des captures, #575).
 */
export const isDayShaped = (text: string): boolean => {
  const typed = text.trim();
  return ISO_DAY.test(typed) || PACKED_DAY.test(typed) || WRITTEN_DAY.test(typed);
};

export function dayOfInput(text: string, today: string, toward: DayToward = 'ahead'): string | null {
  const typed = text.trim();
  const iso = ISO_DAY.exec(typed);
  const parts = iso === null ? (PACKED_DAY.exec(typed) ?? WRITTEN_DAY.exec(typed)) : null;
  if (iso === null && parts === null) return null;
  const day = Number(iso?.[3] ?? parts?.[1]);
  const month = Number(iso?.[2] ?? parts?.[2]);
  const typedYear = iso?.[1] ?? parts?.[3];
  const thisYear = Number(today.slice(0, 4));
  const century = (short: number): number =>
    toward === 'past' && 2000 + short > thisYear ? 1900 + short : 2000 + short;
  const year =
    typedYear === undefined
      ? thisYear
      : typedYear.length === 2
        ? century(Number(typedYear))
        : Number(typedYear);
  const of = (inYear: number): string | null => {
    const at = new Date(Date.UTC(inYear, month - 1, day));
    // 31/02 rolls over into March: not a day.
    if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
    return at.toISOString().slice(0, 10);
  };
  const found = of(year);
  if (found === null || typedYear !== undefined || toward === 'year') return found;
  if (toward === 'past') return found <= today ? found : of(year - 1);
  return found >= today ? found : of(year + 1);
}

/**
 * Where a day typed without its year is looked for: from today on (an appointment), up to today (a birth), or in this
 * year (the bounds of a period, which may end after today and start before it).
 */
export type DayToward = 'ahead' | 'past' | 'year';

/** A day into a day field's « 28/03/2027 ». */
export const inputOfDay = (day: string): string =>
  `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** Minutes of the day into a time field's « 23:30 ». */
export const inputOf = (minute: number): string =>
  `${pad(Math.floor((minute % MINUTES_PER_DAY) / 60))}:${pad(minute % 60)}`;

/** The minute this instant falls in: the server takes instants on the minute only. */
export const onTheMinute = (instant: Date): Date =>
  new Date(Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS);

/** « Aujourd’hui », « Demain » or « jeudi 29 octobre »: the day of an instant, in a zone, against today there. */
export function dayWordOf(instant: string, zone: string, today: string): string {
  const day = dayOf(instant, zone);
  if (day === today) return 'Aujourd’hui';
  if (day === addDays(today, 1)) return 'Demain';
  const long = longDay(day);
  return long.charAt(0).toUpperCase() + long.slice(1);
}
