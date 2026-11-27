import type { ToTalkFan } from '@impera/contracts';

export { FAN_TIER_WORDS as TIER_WORDS } from '@impera/contracts';

/** A wait past this many minutes is said in amber: a warning, never red (red is for urgencies). */
export const LONG_WAIT_MINUTES = 30;

/** « 49,90 € », « 500 € ». */
export function euros(minor: number): string {
  return `${(minor / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} €`;
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** « 4 min », « 2 h », « 3 j ». */
export function duration(minutes: number): string {
  if (minutes < 60) return `${String(Math.max(1, minutes))} min`;
  if (minutes < 1440) return `${String(Math.floor(minutes / 60))} h`;
  return `${String(Math.floor(minutes / 1440))} j`;
}

const daysSince = (iso: string, now: Date): number =>
  Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));

/**
 * When he arrived, never after what he already did: a fan known to Impera today whose message waits since yesterday
 * arrived yesterday at the latest (recette 27/11, G9: « arrivé aujourd’hui · attend depuis 1 j »).
 */
function arrivalOf(fan: ToTalkFan, now: Date): string {
  const seen = [Date.parse(fan.fanSince)];
  if (fan.waitingMinutes !== null) seen.push(now.getTime() - fan.waitingMinutes * 60_000);
  if (fan.lastMessageAt !== null) seen.push(Date.parse(fan.lastMessageAt));
  return new Date(Math.min(...seen.filter((at) => Number.isFinite(at)))).toISOString();
}

/** What the line says after his name: what he spent and when he last bought, or how new he is. */
export function standingOf(fan: ToTalkFan, now: Date): string {
  if (fan.spentMinor > 0) {
    const bought =
      fan.lastPurchaseAt === null
        ? ''
        : daysSince(fan.lastPurchaseAt, now) === 0
          ? ' · a acheté aujourd’hui'
          : ` · dernier achat il y a ${plural(daysSince(fan.lastPurchaseAt, now), 'jour', 'jours')}`;
    return `${euros(fan.spentMinor)} dépensés${bought}`;
  }
  const days = daysSince(arrivalOf(fan, now), now);
  return days === 0 ? 'arrivé aujourd’hui' : `arrivé il y a ${plural(days, 'jour', 'jours')}`;
}

/** What the right of the line says: how long he waits, or how long he has been quiet. */
export function whenOf(fan: ToTalkFan, now: Date): { readonly text: string; readonly long: boolean } {
  if (fan.waitingMinutes !== null)
    return {
      text: `attend depuis ${duration(fan.waitingMinutes)}`,
      long: fan.waitingMinutes >= LONG_WAIT_MINUTES,
    };
  if (fan.lastMessageAt === null) return { text: 'jamais écrit', long: false };
  const days = daysSince(fan.lastMessageAt, now);
  // Under a day, « rien depuis 0 jours » says nothing: a new one not answered yet is to welcome.
  if (days === 0) return { text: fan.tier === 'new' ? 'à accueillir' : 'calme aujourd’hui', long: false };
  return { text: `rien depuis ${plural(days, 'jour', 'jours')}`, long: false };
}
