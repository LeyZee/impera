import type { TrophyCase, TrophyCaseItem } from '@impera/contracts';

/*
 * The creator's game (ADR 0107), pure: her streak medals on the day streak she already has, her delivery streak, and
 * her closed list of trophies. Each gain is tied to a fact the code checks, earned once and never lost. Nothing here
 * reads money (§ 5), and refusing never costs her anything (§ 6): a refusal before the due day ends is neutral.
 */

/** Her streak medals (§ 1): the milestones of her day streak, in order. */
const STREAK_MEDALS = {
  day_streak_7: 7,
  day_streak_14: 14,
  day_streak_30: 30,
  day_streak_50: 50,
  day_streak_100: 100,
} as const;
type StreakMedalKind = keyof typeof STREAK_MEDALS;
const STREAK_MEDAL_KINDS: readonly StreakMedalKind[] = [
  'day_streak_7',
  'day_streak_14',
  'day_streak_30',
  'day_streak_50',
  'day_streak_100',
];

/** Her trophies (§ 3), a closed list in the order the showcase draws them. */
const CREATOR_TROPHY_KINDS = [
  'first_drop',
  'first_on_time_delivery',
  'delivery_streak_5',
  'delivery_streak_10',
  'delivery_streak_25',
  'perfect_day',
  'first_script',
  'full_stock',
  'hit_content',
] as const;
type CreatorTrophyKind = (typeof CREATOR_TROPHY_KINDS)[number];

/** How many on-time deliveries in a row each delivery streak trophy asks. */
const DELIVERY_STREAK_TROPHIES = {
  delivery_streak_5: 5,
  delivery_streak_10: 10,
  delivery_streak_25: 25,
} as const;

export type CreatorGainKind = StreakMedalKind | CreatorTrophyKind;
export const CREATOR_GAIN_KINDS: readonly CreatorGainKind[] = [
  ...STREAK_MEDAL_KINDS,
  ...CREATOR_TROPHY_KINDS,
];

/** A content request as the game reads it, its days already in her zone (`YYYY-MM-DD`). */
export interface GameRequest {
  readonly dueOn: string;
  readonly state: 'open' | 'refused' | 'cancelled';
  /** The day she refused it or the agency cancelled it; `null` while open. */
  readonly decidedOn: string | null;
  /** The first day a drop made from it, not withdrawn, arrived (Reçu or beyond); `null` if none has. */
  readonly arrivedOn: string | null;
}

/**
 * `on_time`: arrived by the end of its due day. `late`: arrived after. `missed`: the due day is over with nothing.
 * `neutral`: refused before its due day ended, or cancelled by the agency. `pending`: still ahead.
 */
export type DeliveryOutcome = 'on_time' | 'late' | 'missed' | 'neutral' | 'pending';

export function deliveryOutcome(request: GameRequest, today: string): DeliveryOutcome {
  if (request.arrivedOn !== null && request.arrivedOn <= request.dueOn) return 'on_time';
  if (request.state === 'cancelled') return 'neutral';
  if (request.state === 'refused' && request.decidedOn !== null && request.decidedOn <= request.dueOn)
    return 'neutral';
  if (request.arrivedOn !== null) return 'late';
  return today > request.dueOn ? 'missed' : 'pending';
}

export interface DeliveryStreak {
  readonly current: number;
  readonly best: number;
  /** At least one request delivered on time, ever. */
  readonly anyOnTime: boolean;
}

/** Her delivery streak (§ 2): on-time deliveries in a row, in the order of their due days; neutral and pending skip. */
export function deliveryStreakOf(requests: readonly GameRequest[], today: string): DeliveryStreak {
  let current = 0;
  let best = 0;
  let anyOnTime = false;
  const byDue = requests.toSorted((a, b) => a.dueOn.localeCompare(b.dueOn));
  for (const request of byDue) {
    const outcome = deliveryOutcome(request, today);
    if (outcome === 'on_time') {
      current += 1;
      best = Math.max(best, current);
      anyOnTime = true;
    } else if (outcome === 'late' || outcome === 'missed') {
      current = 0;
    }
  }
  return { current, best, anyOnTime };
}

/** What the job reads of her, from her agenda and her drops. */
export interface CreatorFacts {
  /** Her day streak today and the best of it on the days read (ADR 0042 § 3). */
  readonly dayStreak: { readonly current: number; readonly best: number };
  /** One of her days had every daily task done, essential and her own. */
  readonly perfectDay: boolean;
  readonly requests: readonly GameRequest[];
  /** Her today, in her zone. */
  readonly today: string;
  /** A drop of hers arrived, ever (withdrawn afterwards or not). */
  readonly firstDrop: boolean;
  /** A drop of hers in the Script category arrived, ever. */
  readonly firstScript: boolean;
  /** Every active category above its threshold, at least two; `null` while the stock is not counted (ADR 0055 § 5). */
  readonly fullStock: boolean | null;
  /** One of her publications became « à refaire »; `null` while the signal does not exist (ADR 0044 § 4). */
  readonly hitContent: boolean | null;
}

export interface CreatorStreaks {
  readonly day: { readonly current: number; readonly best: number };
  readonly delivery: { readonly current: number; readonly best: number };
}

export function creatorGainsOf(facts: CreatorFacts): {
  readonly gains: CreatorGainKind[];
  readonly streaks: CreatorStreaks;
} {
  const delivery = deliveryStreakOf(facts.requests, facts.today);
  const earned: Record<CreatorGainKind, boolean> = {
    day_streak_7: facts.dayStreak.best >= STREAK_MEDALS.day_streak_7,
    day_streak_14: facts.dayStreak.best >= STREAK_MEDALS.day_streak_14,
    day_streak_30: facts.dayStreak.best >= STREAK_MEDALS.day_streak_30,
    day_streak_50: facts.dayStreak.best >= STREAK_MEDALS.day_streak_50,
    day_streak_100: facts.dayStreak.best >= STREAK_MEDALS.day_streak_100,
    first_drop: facts.firstDrop,
    first_on_time_delivery: delivery.anyOnTime,
    delivery_streak_5: delivery.best >= DELIVERY_STREAK_TROPHIES.delivery_streak_5,
    delivery_streak_10: delivery.best >= DELIVERY_STREAK_TROPHIES.delivery_streak_10,
    delivery_streak_25: delivery.best >= DELIVERY_STREAK_TROPHIES.delivery_streak_25,
    perfect_day: facts.perfectDay,
    first_script: facts.firstScript,
    full_stock: facts.fullStock === true,
    hit_content: facts.hitContent === true,
  };
  return {
    gains: CREATOR_GAIN_KINDS.filter((kind) => earned[kind]),
    streaks: {
      day: facts.dayStreak,
      delivery: { current: delivery.current, best: delivery.best },
    },
  };
}

/** A gain of hers as it is stored. */
export interface StoredCreatorGain {
  readonly kind: CreatorGainKind;
  readonly earnedAt: Date;
  readonly revealedAt: Date | null;
}

const isMedal = (kind: string): kind is StreakMedalKind => kind in STREAK_MEDALS;
const isDeliveryStreak = (kind: string): kind is keyof typeof DELIVERY_STREAK_TROPHIES =>
  kind in DELIVERY_STREAK_TROPHIES;

function progressOf(kind: CreatorGainKind, streaks: CreatorStreaks): TrophyCaseItem['progress'] {
  if (isMedal(kind)) {
    const target = STREAK_MEDALS[kind];
    return { current: Math.min(streaks.day.current, target), target, unit: 'day' };
  }
  if (isDeliveryStreak(kind)) {
    const target = DELIVERY_STREAK_TROPHIES[kind];
    return { current: Math.min(streaks.delivery.current, target), target, unit: 'delivery' };
  }
  return null;
}

/**
 * Her trophy case (§ 10, contracts `trophy-case.ts`): every medal and trophy of her lists, earned or ahead. A medal
 * still ahead says how many days are left on her streak of now, a delivery streak trophy how many deliveries. No
 * level (§ 4).
 */
export function creatorTrophyCaseOf(
  gains: readonly StoredCreatorGain[],
  streaks: CreatorStreaks,
): TrophyCase {
  const items: TrophyCaseItem[] = CREATOR_GAIN_KINDS.map((kind) => {
    const gain = gains.find((one) => one.kind === kind);
    return {
      kind,
      family: isMedal(kind) ? 'medal' : isDeliveryStreak(kind) ? 'streak' : 'trophy',
      earnedAt: gain?.earnedAt.toISOString() ?? null,
      progress: gain === undefined ? progressOf(kind, streaks) : null,
      revealedAt: gain?.revealedAt?.toISOString() ?? null,
    };
  });
  return {
    items,
    streaks: [
      { kind: 'day', current: streaks.day.current, best: Math.max(streaks.day.best, streaks.day.current) },
      { kind: 'delivery', current: streaks.delivery.current, best: streaks.delivery.best },
    ],
    level: null,
  };
}
