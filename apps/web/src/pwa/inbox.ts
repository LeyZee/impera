import {
  NotificationInboxSchema,
  type NotificationInbox,
  type NotificationInboxItem,
  type NotificationReason,
} from '@impera/contracts';

import type { NavIconName } from '@/shell/NavIcon';

/**
 * « Tes notifications » (trou 9 du 21/11): what the server kept for the account, read back on /notifications, where the
 * morning recap now leads. Pure helpers here, the screen in NotificationInbox.tsx.
 */

export const INBOX_URL = '/v1/notifications/inbox';

export const inboxQuery = {
  queryKey: ['notifications', 'inbox'],
  queryFn: async (): Promise<NotificationInbox> => {
    const response = await fetch(INBOX_URL, { credentials: 'include' });
    if (!response.ok) throw new Error(`inbox_${String(response.status)}`);
    return NotificationInboxSchema.parse(await response.json());
  },
} as const;

/** Five families, one colour each (labelled, never colour alone): what a notification is about, for the eye. */
export type InboxFamily = 'money' | 'day' | 'team' | 'alert' | 'safety';

export const FAMILY_OF: Readonly<Record<NotificationReason, InboxFamily>> = {
  sale: 'money',
  agency_share: 'money',
  reminder: 'day',
  routine: 'day',
  streak: 'day',
  own_shift_start: 'team',
  own_shift_end: 'team',
  team: 'team',
  creator_alert: 'alert',
  safety_alert: 'safety',
  owner_change: 'safety',
  decision: 'day',
  agency_alert: 'alert',
  agency_urgent: 'alert',
};

export const FAMILY_WORDS: Readonly<Record<InboxFamily, string>> = {
  money: 'Argent',
  day: 'Ta journée',
  team: 'Équipe',
  alert: 'Alertes',
  safety: 'Sécurité',
};

/** The order of the legend: the money first, the safety last but red. */
export const FAMILY_ORDER: readonly InboxFamily[] = ['money', 'day', 'team', 'alert', 'safety'];

export interface InboxDay {
  readonly key: string;
  readonly label: string;
  readonly items: readonly NotificationInboxItem[];
}

function dayKey(date: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** The items by day of the reader, newest first: « Aujourd’hui », « Hier », then « mardi 18 novembre ». */
export function byDay(
  items: readonly NotificationInboxItem[],
  now: Date,
  timeZone?: string,
): readonly InboxDay[] {
  const today = dayKey(now, timeZone);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone);
  const long = new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' });
  const days: { key: string; label: string; items: NotificationInboxItem[] }[] = [];
  for (const item of items) {
    const at = new Date(item.at);
    const key = dayKey(at, timeZone);
    const last = days.at(-1);
    if (last?.key === key) {
      last.items.push(item);
      continue;
    }
    const label = key === today ? 'Aujourd’hui' : key === yesterday ? 'Hier' : long.format(at);
    days.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1), items: [item] });
  }
  return days;
}

/** How many of each family, in the legend's order, the empty ones left out. */
export function familyCounts(
  items: readonly NotificationInboxItem[],
): readonly { family: InboxFamily; count: number }[] {
  const counts = new Map<InboxFamily, number>();
  for (const item of items) {
    const family = FAMILY_OF[item.reason];
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return FAMILY_ORDER.flatMap((family) => {
    const count = counts.get(family) ?? 0;
    return count === 0 ? [] : [{ family, count }];
  });
}

/**
 * The answer first (the screen's one big thing): what waits for the reader, the ones that never rang, when there are;
 * otherwise how many this week. The other figure comes second, smaller.
 */
export function headline(items: readonly NotificationInboxItem[]): {
  readonly big: string;
  readonly small: string | null;
} {
  if (items.length === 0) return { big: 'Rien cette semaine', small: null };
  const total = `${String(items.length)} cette semaine`;
  const quiet = items.filter((item) => item.quiet).length;
  if (quiet > 0) {
    return {
      big: quiet === 1 ? '1 arrivée sans sonner' : `${String(quiet)} arrivées sans sonner`,
      small: `sur ${total}`,
    };
  }
  return { big: total, small: items.length === 1 ? 'elle a sonné' : 'toutes ont sonné' };
}

/** The icon that says each family without its word (règle de Charles du 21/11). */
export const FAMILY_ICON = {
  money: 'pay',
  day: 'today',
  team: 'team',
  alert: 'bell',
  safety: 'shield',
} as const satisfies Readonly<Record<InboxFamily, NavIconName>>;

export function clockOfInstant(at: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(at),
  );
}
