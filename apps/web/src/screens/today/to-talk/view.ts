import type { FanTier, ToTalkFan } from '@impera/contracts';

/** The words of a tier, as the chatter reads them (Charles, 21/11). */
export const TIER_WORDS: Readonly<Record<FanTier, string>> = {
  new: 'Nouveau',
  payer: 'Payeur',
  good: 'Bon payeur',
  very_good: 'Très bon payeur',
  whale: 'Baleine',
};

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
  const days = daysSince(fan.fanSince, now);
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
  return { text: `rien depuis ${plural(daysSince(fan.lastMessageAt, now), 'jour', 'jours')}`, long: false };
}
