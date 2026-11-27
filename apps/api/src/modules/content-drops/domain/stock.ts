import type { DropCategory, StockCategory, StockStatus } from '@impera/contracts';

/*
 * Coffre Impera (ADR 0163): what she dropped, by use, against the rhythm the agency asks of her. The rhythm and the
 * days of advance are values of code (CLAUDE.md, rule 3), never of a prompt nor of a screen.
 */

/**
 * How a category is counted (ADR 0163 § 3):
 * - `days`: its stock in days of advance at its pace (a drop or a file each day, or a few a week);
 * - `count`: a stock that is not spent at a pace (scripts, gifts), held against a minimum;
 * - `bonus`: nothing is asked of her (Telegram and her Reveal story ride on the feed's video), only shown.
 */
export type StockRule =
  | {
      readonly mode: 'days';
      /** What one use spends: a whole drop (a boudoir session) or one of its files (a story). */
      readonly unit: 'drop' | 'file';
      /** Uses a day. */
      readonly perDay: number;
      readonly targetDays: number;
    }
  | { readonly mode: 'count'; readonly unit: 'drop' | 'file'; readonly target: number }
  | { readonly mode: 'bonus'; readonly unit: 'file' };

const WEEK = 7;

/** The rhythm asked of her (Charles, 21/11): 7 days of advance for Reveal, 3 for Instagram. */
export const STOCK_RULES: Readonly<Record<DropCategory, StockRule>> = {
  feed_video: { mode: 'days', unit: 'file', perDay: 1, targetDays: 7 },
  feed_shoot: { mode: 'days', unit: 'drop', perDay: 3 / WEEK, targetDays: 7 },
  // Her story is the feed's video with a caption of its own (Charles, 27/11): nothing more to shoot, shown only.
  reveal_story: { mode: 'bonus', unit: 'file' },
  mass_dm: { mode: 'days', unit: 'file', perDay: 3 / WEEK, targetDays: 7 },
  // Three playable scripts for the AI to speak (ADR 0145), and one ahead.
  script: { mode: 'count', unit: 'drop', target: 4 },
  whale_gift: { mode: 'count', unit: 'file', target: 3 },
  // What the AI answers with in her real voice (Charles, 21/11): one beep, two proofs.
  voice_beep: { mode: 'count', unit: 'file', target: 1 },
  voice_real: { mode: 'count', unit: 'file', target: 2 },
  // No stock asked yet (Charles, 21/11: « pas encore décidé »): shown, never lacking.
  sale_video: { mode: 'bonus', unit: 'file' },
  instagram_post: { mode: 'days', unit: 'file', perDay: 2, targetDays: 3 },
  instagram_reel: { mode: 'days', unit: 'file', perDay: 1, targetDays: 3 },
  instagram_story: { mode: 'days', unit: 'file', perDay: 4, targetDays: 3 },
  telegram_post: { mode: 'bonus', unit: 'file' },
};

/** Where a category goes out, for the screen's groups (Reveal, Instagram, Telegram). */
const STOCK_PLATFORM_OF: Readonly<Record<DropCategory, StockCategory['platform']>> = {
  feed_video: 'reveal',
  feed_shoot: 'reveal',
  reveal_story: 'reveal',
  mass_dm: 'reveal',
  script: 'reveal',
  whale_gift: 'reveal',
  voice_beep: 'reveal',
  voice_real: 'reveal',
  sale_video: 'reveal',
  instagram_post: 'instagram',
  instagram_reel: 'instagram',
  instagram_story: 'instagram',
  telegram_post: 'telegram',
};

/** The order of the screen: Reveal, then Instagram, then Telegram, each in the order of its day. */
export const STOCK_ORDER: readonly DropCategory[] = [
  'feed_video',
  'feed_shoot',
  'reveal_story',
  'mass_dm',
  'script',
  'whale_gift',
  'sale_video',
  'voice_beep',
  'voice_real',
  'instagram_post',
  'instagram_reel',
  'instagram_story',
  'telegram_post',
];

/** What the read counted of a category: its units and its media in stock, scheduled, and out over the last 7 days. */
export interface StockCounts {
  readonly stockDrops: number;
  readonly stockFiles: number;
  readonly scheduledDrops: number;
  readonly scheduledFiles: number;
  readonly outDrops7: number;
  readonly outFiles7: number;
}

/**
 * Where a stock stands against its target: nothing left (`empty`), under half (`low`, amber for the agency, never red
 * for her), under the target (`short`), or held (`ok`). A bonus category is always `ok`.
 */
export function statusOf(value: number, target: number): StockStatus {
  if (value <= 0) return 'empty';
  if (value < target / 2) return 'low';
  if (value < target) return 'short';
  return 'ok';
}

const round1 = (value: number): number => Math.floor(value * 10) / 10;

/** A category of her stock, its stock read against its rule (ADR 0163 § 3). Pure. */
export function stockCategory(category: DropCategory, counts: StockCounts): StockCategory {
  const rule = STOCK_RULES[category];
  const units = rule.unit === 'drop' ? counts.stockDrops : counts.stockFiles;
  const base = {
    category,
    platform: STOCK_PLATFORM_OF[category],
    stockUnits: units,
    stockMedia: counts.stockFiles,
    scheduledUnits: rule.unit === 'drop' ? counts.scheduledDrops : counts.scheduledFiles,
    outUnits7: rule.unit === 'drop' ? counts.outDrops7 : counts.outFiles7,
    unit: rule.unit,
  } as const;
  if (rule.mode === 'days') {
    const days = round1(units / rule.perDay);
    const lacking = Math.max(0, Math.ceil(rule.targetDays * rule.perDay - units));
    return {
      ...base,
      mode: 'days',
      perWeek: Math.round(rule.perDay * WEEK),
      daysAhead: days,
      target: rule.targetDays,
      lacking,
      status: statusOf(days, rule.targetDays),
    };
  }
  if (rule.mode === 'count')
    return {
      ...base,
      mode: 'count',
      perWeek: null,
      daysAhead: null,
      target: rule.target,
      lacking: Math.max(0, rule.target - units),
      status: statusOf(units, rule.target),
    };
  return { ...base, mode: 'bonus', perWeek: null, daysAhead: null, target: null, lacking: 0, status: 'ok' };
}

/**
 * The few days that matter for one platform: the weakest of its `days` categories (Instagram runs dry when its first
 * category does). `null` when the platform has none.
 */
export function platformDays(
  categories: readonly StockCategory[],
  platform: StockCategory['platform'],
): number | null {
  const days = categories
    .filter((c) => c.platform === platform && c.mode === 'days' && c.daysAhead !== null)
    .map((c) => c.daysAhead ?? 0);
  return days.length === 0 ? null : Math.min(...days);
}
