import { z } from 'zod';

/** Money in integer minor units with its currency (ADR 0011). Formatting for people is the UI's job. */
export const CurrencySchema = z.enum(['EUR', 'USD']);
export type Currency = z.infer<typeof CurrencySchema>;

export const MoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

export function money(amountMinor: number, currency: Currency): Money {
  return MoneySchema.parse({ amountMinor, currency });
}

/** Sum of amounts in one currency; mixing currencies is a programming error, not a business case. */
export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new RangeError(`Cannot add ${a.currency} and ${b.currency}`);
  }
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

/** `percent` of an amount (VAT, commission), rounded half away from zero to the minor unit. */
export function multiplyPercent(value: Money, percent: number): Money {
  const raw = (value.amountMinor * percent) / 100;
  const rounded = Math.sign(raw) * Math.round(Math.abs(raw));
  return { amountMinor: rounded === 0 ? 0 : rounded, currency: value.currency };
}

/** Raw, locale-free rendering for logs and tests: `12.50 EUR`, `-0.05 EUR`. */
export function format(value: Money): string {
  const sign = value.amountMinor < 0 ? '-' : '';
  const abs = Math.abs(value.amountMinor);
  const units = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}${String(units)}.${cents} ${value.currency}`;
}

/**
 * The highest amount entered by hand (a bonus, a penalty, an adjustment, the correction of an upheld contest), in euro
 * cents: 50 000 €, a slip guard.
 */
export const PAY_AMOUNT_MAX_MINOR = 5_000_000;
