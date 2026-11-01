import { RATE_MICROS_SCALE } from '@nirvana/contracts';

/**
 * The best fans of the Dashboard in euros (choix de Charles, 28/10): what each fan spent over the period, his sales in
 * dollars converted at the last ECB rate known, the one pay keeps (ADR 0033). A ranking, never a payout: nothing here
 * is paid, and no rate is ever guessed.
 */

/** A rate as pay keeps it: euros for one dollar in millionths (`rate_micros`), and the ECB day it is for. */
export interface UsdRate {
  readonly day: string;
  readonly rateMicros: number;
}

/** `rate_micros` for one euro per dollar, the scale pay keeps its rates at. */
const RATE_SCALE = BigInt(RATE_MICROS_SCALE);
const TWO = BigInt(2);

/**
 * A dollar amount in euro cents: `usdMinor × rateMicros ÷ 1 000 000`, rounded to the nearest cent, a half cent away
 * from zero, as pay rounds (ADR 0023 § Paie). On integers (`bigint` for the product), never on floats.
 */
export function usdToEurMinor(usdMinor: number, rateMicros: number): number {
  if (!Number.isSafeInteger(usdMinor) || usdMinor < 0)
    throw new RangeError('A sale is a whole number of cents');
  if (!Number.isSafeInteger(rateMicros) || rateMicros <= 0) throw new RangeError('A rate is positive');
  const product = BigInt(usdMinor) * BigInt(rateMicros);
  const quotient = product / RATE_SCALE;
  const away = TWO * (product % RATE_SCALE) >= RATE_SCALE;
  const result = Number(away ? quotient + BigInt(1) : quotient);
  if (!Number.isSafeInteger(result)) throw new RangeError('An amount past the safe integers');
  return result;
}

/** What one fan paid over the period, by currency: in cents, every sale, and the part the agent sold. */
export interface FanSales {
  readonly fanId: string;
  /** His conversation of the latest paid message of the period: « Ouvrir dans Suivi » opens it. */
  readonly conversationId: string;
  readonly eurMinor: number;
  readonly usdMinor: number;
  readonly byAgentEurMinor: number;
  readonly byAgentUsdMinor: number;
}

export interface RankedFan {
  readonly fanId: string;
  readonly conversationId: string;
  /** In euro cents, his dollars converted. */
  readonly spentMinor: number;
  readonly byAgentMinor: number;
}

/**
 * The `top` best fans, by what they spent in euros, the most first (then by id, so that a tie always reads the same).
 * His dollars are converted on his total of the period, the whole and the agent's part each rounded once, so that the
 * agent's part never exceeds the whole. Without a rate they do not count: a fan who paid in dollars only drops out.
 */
export function rankFans(sales: readonly FanSales[], rate: UsdRate | null, top: number): RankedFan[] {
  const inEuros = (eurMinor: number, usdMinor: number): number =>
    eurMinor + (rate === null ? 0 : usdToEurMinor(usdMinor, rate.rateMicros));
  return sales
    .map((fan) => ({
      fanId: fan.fanId,
      conversationId: fan.conversationId,
      spentMinor: inEuros(fan.eurMinor, fan.usdMinor),
      byAgentMinor: inEuros(fan.byAgentEurMinor, fan.byAgentUsdMinor),
    }))
    .filter((fan) => fan.spentMinor > 0)
    .sort((a, b) => b.spentMinor - a.spentMinor || (a.fanId < b.fanId ? -1 : a.fanId > b.fanId ? 1 : 0))
    .slice(0, top);
}
