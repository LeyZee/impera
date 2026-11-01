/**
 * The one rounding of pay (ADR 0023 § Paie): to the minor unit, half away from zero, negatives included. Computed on
 * integers (`bigint` for the product, so that nothing is lost past 2^53), never on floats.
 */

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

/** `value × numerator ÷ denominator`, rounded half away from zero. `denominator` is positive. */
export function mulDivRound(value: number, numerator: number, denominator: number): number {
  if (
    !Number.isSafeInteger(value) ||
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator)
  ) {
    throw new RangeError('Pay rounds integers only');
  }
  if (denominator <= 0) throw new RangeError('A pay ratio divides by a positive integer');
  const product = BigInt(value) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const quotient = product / divisor;
  const remainder = product % divisor;
  const away = TWO * (remainder < ZERO ? -remainder : remainder) >= divisor;
  const rounded = away ? quotient + (product < ZERO ? -ONE : ONE) : quotient;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) throw new RangeError('A pay amount past the safe integers');
  // `-0` would read as a sign in a statement.
  return result === 0 ? 0 : result;
}

/** Basis points: 10 000 is 100 %. */
export const BPS = 10_000;

/** An exchange rate in millionths: 1 000 000 is one euro for one unit of the currency. */
export const RATE_SCALE = 1_000_000;
