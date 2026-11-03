import type { CreatorFanSpent, CreatorMessage, Currency } from '@impera/contracts';

import { addDays, clockAt, dayOf, longDay } from '@/scheduling/time';

/*
 * Her Ventes in words (CR-02 c3): what a fan unlocked, when he was last seen, and his conversation in reading order.
 * Pure functions: the screen only lays them out.
 */

/** « 50 € », « 49,90 € », « 12 $ »: the cents only when there are some, never rounded away (ADR 0011). */
export function amountOf(minor: number, currency: Currency): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/**
 * What a fan unlocked, per currency: « 64 € », « 64 € et 12 $ », `null` when he unlocked nothing yet. The price of
 * the messages he unlocked, taxes included: never her earnings (`modelRevenue`, ADR 0054), which Ventes says apart.
 */
export function unlockedOf(spent: CreatorFanSpent): string | null {
  const parts = [
    ...(spent.eurMinor > 0 ? [amountOf(spent.eurMinor, 'EUR')] : []),
    ...(spent.usdMinor > 0 ? [amountOf(spent.usdMinor, 'USD')] : []),
  ];
  return parts.length === 0 ? null : parts.join(' et ');
}

/** « Fan sans nom » for a pseudo Reveal gave empty. */
export const fanName = (displayName: string): string =>
  displayName.trim() === '' ? 'Fan sans nom' : displayName;

/** A past day against today: « aujourd’hui », « hier », else « mardi 3 novembre ». */
function pastDay(day: string, today: string): string {
  if (day === today) return 'aujourd’hui';
  if (day === addDays(today, -1)) return 'hier';
  return longDay(day);
}

/** When he was last seen: « vu à l’instant », « vu il y a 12 min », « vu il y a 3 h », then « vu hier », « vu mardi 3 novembre ». */
export function seenOf(lastSeenAt: string, now: Date, zone: string): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(lastSeenAt).getTime()) / 60_000));
  if (minutes < 1) return 'vu à l’instant';
  if (minutes < 60) return `vu il y a ${String(minutes)}\u00a0min`;
  if (minutes < 12 * 60) return `vu il y a ${String(Math.floor(minutes / 60))}\u00a0h`;
  return `vu ${pastDay(dayOf(lastSeenAt, zone), dayOf(now, zone))}`;
}

/** A media named by its kind: « Photo », not « Média ». */
const MEDIA_LABELS: Readonly<Record<CreatorMessage['media'][number]['kind'], string>> = {
  image: 'Photo',
  video: 'Vidéo',
  audio: 'Audio',
};

export interface Bubble {
  readonly id: string;
  /** Her fan's, or hers as the fan saw it: never who wrote it (ADR 0021). */
  readonly from: 'fan' | 'creator';
  readonly text: string;
  readonly media: readonly { readonly label: string; readonly description: string | null }[];
  /** « Média payant · 15 € · débloqué »: a paid message, its price and whether he unlocked it. */
  readonly paid: string | null;
  /** « 21 h 04 », in her own time. */
  readonly time: string;
}

export interface ThreadDay {
  /** `2026-11-03`, in her time. */
  readonly day: string;
  /** « Aujourd’hui », « Hier », « Mardi 3 novembre ». */
  readonly label: string;
  readonly bubbles: readonly Bubble[];
}

/** A paid message in words; `null` for a free one. */
function paidOf(message: CreatorMessage): string | null {
  if (message.priceMinor === null || message.currency === null) return null;
  const state = message.isPaid ? 'débloqué' : 'pas encore débloqué';
  return `Média payant · ${amountOf(message.priceMinor, message.currency)} · ${state}`;
}

/**
 * The thread as she reads it, oldest first and grouped by day in her time, from pages the server serves newest first.
 * A message read twice (a page shifted by a new message) shows once.
 */
export function threadOf(
  pages: readonly (readonly CreatorMessage[])[],
  now: Date,
  zone: string,
): ThreadDay[] {
  const byId = new Map<string, CreatorMessage>();
  for (const message of pages.flat()) if (!byId.has(message.id)) byId.set(message.id, message);
  const messages = [...byId.values()].sort((a, b) => a.platformCreatedAt.localeCompare(b.platformCreatedAt));
  const today = dayOf(now, zone);
  const days: { day: string; bubbles: Bubble[] }[] = [];
  for (const message of messages) {
    const day = dayOf(message.platformCreatedAt, zone);
    const bubble: Bubble = {
      id: message.id,
      from: message.direction === 'inbound' ? 'fan' : 'creator',
      text: message.text,
      media: message.media.map((media) => ({
        label: MEDIA_LABELS[media.kind],
        description: media.description,
      })),
      paid: paidOf(message),
      time: clockAt(message.platformCreatedAt, zone),
    };
    const last = days.at(-1);
    if (last?.day === day) last.bubbles.push(bubble);
    else days.push({ day, bubbles: [bubble] });
  }
  return days.map(({ day, bubbles }) => {
    const label = pastDay(day, today);
    return { day, label: label.charAt(0).toUpperCase() + label.slice(1), bubbles };
  });
}

/** The conversation open in her Ventes, from the address: a reload or « retour » keeps it. */
export interface SalesSearch {
  readonly conversation?: string;
}

/** Anything else in the address is ignored: a broken link opens her list, never an error. */
export function parseSalesSearch(search: Record<string, unknown>): SalesSearch {
  const { conversation } = search;
  return typeof conversation === 'string' && /^[0-9a-f-]{36}$/iu.test(conversation) ? { conversation } : {};
}
