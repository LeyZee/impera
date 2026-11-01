import { DEFAULT_AGENT_HOURS, inMinuteRange, type MinuteRange } from '@nirvana/contracts';

/**
 * The moment of the conversation, written by code for the brain and the voice: her local time, day or
 * night, how long they have known each other, what he has spent. Facts only; what they allow (a night
 * script, the sexualisation delay) is decided by the policy, not by the model (CLAUDE.md rule 3).
 */
export interface Situation {
  readonly now: Date;
  /** Her time zone, IANA name: the day and night scripts follow her clock, not the fan's. */
  readonly timeZone: string;
  readonly relationshipStartedAt: Date;
  readonly spentCents: number;
  /** Her night, on her clock (P3-14 `AgentHours.night`); absent, from 22:00 to 7:00. */
  readonly night?: MinuteRange;
}

export type DayPart = 'day' | 'night';

export function localTime(
  now: Date,
  timeZone: string,
): { readonly hour: number; readonly minute: number; readonly label: string } {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    hour: Number(part('hour')),
    minute: Number(part('minute')),
    label: `${part('weekday')} ${part('hour')} h ${part('minute')}`,
  };
}

/** An IANA zone the runtime knows (« Europe/Paris »): checked before it reaches a clock. */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const DAY_MINUTES = 1_440;

/** The next moment her clock shows hour:minute (for « /heure 23:30 »), across a change of daylight saving time. */
export function nextLocalTime(now: Date, timeZone: string, hour: number, minute: number): Date {
  const at = (date: Date): number => {
    const t = localTime(date, timeZone);
    return t.hour * 60 + t.minute;
  };
  const target = hour * 60 + minute;
  const ahead = (from: Date): number => (((target - at(from)) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const first = new Date(now.getTime() + ahead(now) * 60_000);
  // A clock change on the way shifts the landing by its offset: one correction puts it back on her clock.
  const drift = ahead(first);
  if (drift === 0) return first;
  return new Date(first.getTime() + (drift > DAY_MINUTES / 2 ? drift - DAY_MINUTES : drift) * 60_000);
}

/** Day or night at a minute of her clock: night is when the Nuit 🌙 scripts apply (chatting/methode-chatting.md). */
export function dayPart(minute: number, night: MinuteRange = DEFAULT_AGENT_HOURS.night): DayPart {
  return inMinuteRange(night, minute) ? 'night' : 'day';
}

const partOf = (situation: Situation): DayPart => {
  const time = localTime(situation.now, situation.timeZone);
  return dayPart(time.hour * 60 + time.minute, situation.night);
};

function duration(ms: number): string {
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  if (hours < 1) return 'moins d’une heure';
  if (hours < 48) return `${String(hours)} h`;
  return `${String(Math.floor(hours / 24))} jours`;
}

/** Night is when the Nuit scripts apply, on her clock. */
export function isNight(situation: Situation): boolean {
  return partOf(situation) === 'night';
}

export function describeSituation(situation: Situation): string {
  const time = localTime(situation.now, situation.timeZone);
  const spent = situation.spentCents / 100;
  return [
    `Chez elle, on est ${time.label} (${partOf(situation) === 'night' ? 'nuit' : 'jour'}).`,
    `Ils se parlent depuis ${duration(situation.now.getTime() - situation.relationshipStartedAt.getTime())}.`,
    spent > 0
      ? `Il a déjà dépensé ${spent.toFixed(2).replace('.', ',')} € chez elle.`
      : 'Il n’a encore rien acheté.',
  ].join('\n');
}
