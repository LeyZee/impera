import { INVOICE_RETENTION_YEARS } from '@nirvana/contracts';

/**
 * Until when the compliance lock holds a PDF: ten years after the close of the fiscal year of its issue (art. L123-22
 * of the Code de commerce, ADR 0037 § 4). The fiscal year closes on the last day of `fiscalYearEndMonth`; the lock ends
 * at 00:00 UTC the day after that close, ten years on, which is after the close's end in Paris. An invoice of March
 * 2027 under a calendar year: 1 January 2038 at 00:00 UTC, that is through 31 December 2037.
 */
export function invoicePdfRetainUntil(issuedOn: string, fiscalYearEndMonth: number): Date {
  if (!Number.isInteger(fiscalYearEndMonth) || fiscalYearEndMonth < 1 || fiscalYearEndMonth > 12) {
    throw new RangeError(`Not a month: ${String(fiscalYearEndMonth)}`);
  }
  const year = Number(issuedOn.slice(0, 4));
  const month = Number(issuedOn.slice(5, 7));
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(issuedOn) || month < 1 || month > 12) {
    throw new RangeError(`Not a calendar day: ${issuedOn}`);
  }
  const closeYear = month <= fiscalYearEndMonth ? year : year + 1;
  // Months count from 0 here: month `fiscalYearEndMonth` (from 0) is the one after the close.
  return new Date(Date.UTC(closeYear + INVOICE_RETENTION_YEARS, fiscalYearEndMonth, 1));
}
