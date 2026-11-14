/**
 * The day's AI budget and the trend watch's cap as the owner sets them (choix de Charles 12/11), in euro cents. The
 * gateway enforces them; this file only says which value applies and whether a change is coherent.
 */

/** What is stored: `null` is the code's default. */
export interface StoredCaps {
  readonly dailyCapMinor: number | null;
  readonly trendWatchCapMinor: number | null;
  readonly updatedAt: Date | null;
}

export interface CapDefaults {
  readonly dailyCapMinor: number;
  readonly trendWatchCapMinor: number;
}

export interface EffectiveCaps {
  readonly dailyCapMinor: number;
  readonly trendWatchCapMinor: number;
}

export const NO_CAPS: StoredCaps = { dailyCapMinor: null, trendWatchCapMinor: null, updatedAt: null };

export function effectiveCaps(stored: StoredCaps, defaults: CapDefaults): EffectiveCaps {
  return {
    dailyCapMinor: stored.dailyCapMinor ?? defaults.dailyCapMinor,
    trendWatchCapMinor: stored.trendWatchCapMinor ?? defaults.trendWatchCapMinor,
  };
}

/**
 * The trend watch is counted inside the day's budget: its cap above the budget would never be reached, and would read
 * as a promise the budget breaks. The bounds of each value are the contract's (`PutAiBudgetBodySchema`).
 */
export function capsProblem(
  next: Pick<StoredCaps, 'dailyCapMinor' | 'trendWatchCapMinor'>,
  defaults: CapDefaults,
): string | null {
  const caps = effectiveCaps({ ...next, updatedAt: null }, defaults);
  return caps.trendWatchCapMinor > caps.dailyCapMinor
    ? 'Le plafond de veille ne peut pas dépasser le plafond du jour : il est compté dedans.'
    : null;
}
