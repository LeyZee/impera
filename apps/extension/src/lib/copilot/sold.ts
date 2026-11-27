import type { CopilotAssist, FanStanding } from '@impera/contracts';

/**
 * A sale paid, as the panel sees it (maquette v4, cadre 9; Charles 27/11): between two reads of the same fan, what he
 * spent with her went up and his last purchase moved. The panel celebrates it once, in the panel only, without sound,
 * and says what was sold; never a commission (Charles, 21/11).
 */

/** How long the line « Vendu » stays after the sale was seen. */
export const SOLD_SHOWN_MS = 8_000;
/** The sparks fly only when the panel draws the sale right after seeing it, never again on a later draw. */
export const SPARKS_WITHIN_MS = 1_500;

export interface MoneySeen {
  readonly fanId: string;
  readonly money: FanStanding;
}

export interface Sold {
  readonly amountMinor: number;
  /** The step's name when the code had offered one at that very price, else null. */
  readonly stepName: string | null;
  /** When the panel saw it, in ms since the epoch. */
  readonly seenAt: number;
}

export function soldBetween(
  before: MoneySeen | null,
  after: MoneySeen,
  offered: CopilotAssist['sale'] | null,
  seenAt: number,
): Sold | null {
  if (before?.fanId !== after.fanId) return null;
  const amountMinor = after.money.spentMinor - before.money.spentMinor;
  if (amountMinor <= 0 || after.money.lastPurchaseAt === before.money.lastPurchaseAt) return null;
  const next = offered?.nextStep ?? null;
  return {
    amountMinor,
    stepName: next !== null && next.priceMinor === amountMinor ? next.name : null,
    seenAt,
  };
}
