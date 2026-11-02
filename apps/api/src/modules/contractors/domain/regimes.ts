import { calendarDayAt, type CreateBillingRegimeBody } from '@nirvana/contracts';

import { BillingRegimeCountryMismatch } from './errors';

/**
 * The billing regimes as the owner writes them (EQ-06 lot 5b), the pure rules: whether a regime sent again is the one
 * recorded, whether it is the contractor's country's, and when a regime assigned from a day comes into force. When a
 * change may start (today at the earliest, after the last one) is `assertRegimeChange` (`billing.ts`), which the issue
 * reads too.
 */

/**
 * Whether `body` is the regime recorded under its id: every word of it, its countries and documents in their order.
 * A regime is never changed, so anything else under the same id is another regime.
 */
export function sameRegime(recorded: CreateBillingRegimeBody, body: CreateBillingRegimeBody): boolean {
  return JSON.stringify(canonical(recorded)) === JSON.stringify(canonical(body));
}

/** The body's fields in one order, the VAT's too: two equal regimes print the same text. */
const canonical = (regime: CreateBillingRegimeBody) => ({
  id: regime.id,
  name: regime.name,
  countries: regime.countries,
  vat:
    regime.vat.treatment === 'exempt'
      ? { treatment: regime.vat.treatment }
      : { treatment: regime.vat.treatment, rateBps: regime.vat.rateBps },
  withholding: regime.withholding,
  mentions: regime.mentions,
  documents: regime.documents,
  taxIdRequired: regime.taxIdRequired,
});

/**
 * A contractor takes a regime of his own country, the one of his member record: its mentions, its VAT and its
 * documents are that country's (Benin and Madagascar share one).
 */
export function assertRegimeOfCountry(countries: readonly string[], country: string): void {
  if (!countries.includes(country)) throw new BillingRegimeCountryMismatch(country);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The first minute of `day` in `timeZone`: when a regime assigned from that day comes into force, and his waiting
 * statements are tried again. Every zone's midnight lies between 14 hours before and 12 hours after UTC's (UTC+14 to
 * UTC−12), so the search starts an hour wider on each side; a zone's calendar day never goes back as time goes on.
 */
export function dayStartsAt(day: string, timeZone: string): Date {
  const midnightUtc = Date.parse(`${day}T00:00:00Z`);
  let before = midnightUtc - 15 * HOUR_MS;
  let within = midnightUtc + 13 * HOUR_MS;
  while (within - before > MINUTE_MS) {
    const middle = before + Math.floor((within - before) / MINUTE_MS / 2) * MINUTE_MS;
    if (calendarDayAt(new Date(middle), timeZone) >= day) within = middle;
    else before = middle;
  }
  return new Date(within);
}
