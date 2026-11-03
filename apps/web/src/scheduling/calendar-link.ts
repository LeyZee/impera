/**
 * The three ways to add a calendar link (CR-12, ADR 0045 § 5), from the path the server gives on the dashboard's own
 * origin (`/v1/calendar-feed/<token>.ics`, which `nginx` passes to the API):
 * - `https`, to copy into any calendar;
 * - `webcal`, which Apple's Calendar (iPhone, Mac) opens as a subscription;
 * - Google Agenda's « ajouter par URL », which takes the `webcal` address in `cid`.
 */
export interface FeedAddresses {
  readonly https: string;
  readonly webcal: string;
  readonly google: string;
}

export function feedAddresses(path: string, origin: string): FeedAddresses {
  const https = new URL(path, origin);
  const webcal = `webcal://${https.host}${https.pathname}`;
  return {
    https: https.toString(),
    webcal,
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
  };
}
