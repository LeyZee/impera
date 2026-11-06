/**
 * FakeReveal's tracking links (`/v1/tracking-links`, `/v1/stats/tracking-links/daily`), invented (ADR 0010): a few
 * links per test model, their days drawn from their id and date so that a reading is the same every time. Reveal keeps
 * the detail per day since 2026-09-11 only: a link created earlier carries clicks of before in its total alone.
 */

export const TRACKING_DETAIL_SINCE = '2026-09-11';

export interface FakeTrackingLink {
  readonly trackingLinkId: string;
  readonly modelId: string;
  readonly name: string;
  readonly trackingCode: string;
  readonly userName: string;
  readonly createdAt: string;
  /** Clicks before the detail per day began, counted in the total only. */
  readonly clicksBefore: number;
}

export const TRACKING_LINKS: readonly FakeTrackingLink[] = [
  {
    trackingLinkId: 'link_test_insta',
    modelId: 'model_test_01',
    name: 'Insta @recette',
    trackingCode: 'Rc7Insta',
    userName: 'creatrice_test',
    createdAt: '2026-08-02T09:30:00.000Z',
    clicksBefore: 412,
  },
  {
    trackingLinkId: 'link_test_tiktok',
    modelId: 'model_test_01',
    name: 'TikTok bio',
    trackingCode: 'Rc7Tktk',
    userName: 'creatrice_test',
    createdAt: '2026-10-12T14:00:00.000Z',
    clicksBefore: 0,
  },
  {
    trackingLinkId: 'link_test_autre',
    modelId: 'model_test_02',
    name: 'Reddit',
    trackingCode: 'Rc7Rddt',
    userName: 'autre_test',
    createdAt: '2026-10-28T08:00:00.000Z',
    clicksBefore: 0,
  },
];

/** A stable number in [0, modulo) from a text. */
function drawn(text: string, modulo: number): number {
  let hash = 7;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  return hash % modulo;
}

export interface TrackingDay {
  readonly date: string;
  readonly clicks: number;
  readonly newSubscribers: number;
  readonly paidSubscribers: number;
  readonly revenueTtc: number;
}

/** One day of a link; a quiet day (nothing happened) is left out of the daily route, as Reveal does. */
export function trackingDay(link: FakeTrackingLink, date: string): TrackingDay {
  const clicks = drawn(`${link.trackingLinkId}|${date}`, 70) - 10;
  if (clicks <= 0) return { date, clicks: 0, newSubscribers: 0, paidSubscribers: 0, revenueTtc: 0 };
  const newSubscribers = drawn(`${date}|${link.trackingCode}`, 5);
  const paidSubscribers = Math.floor(newSubscribers / 3);
  return { date, clicks, newSubscribers, paidSubscribers, revenueTtc: paidSubscribers * 999 };
}

/** The days from `from` to `to` inclusive, as `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86_400_000) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}
