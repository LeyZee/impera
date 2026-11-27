import { FREE_SEXTING_SESSIONS_KEPT, type FanAvailabilityRecord, type FanTier } from '@impera/contracts';

/**
 * The sexting without a sale (Charles 26/11, ADR 0098 amendement du 26/11): with a fan who pays well, now and then a hot
 * session goes on in words only, no media offered, no step of a script. Code decides it, once per hot session, by a draw
 * the fan cannot foresee (the random source is injected, for tests), never two sessions in a row. He asks for a media:
 * the session goes back to an ordinary sale. Code records each session without a sale and follows whether he buys
 * again: the advantage stops when he stops buying.
 */

/** Scripts he bought from her (one paid step at least) before a session may go without a sale. */
export const FREE_SEXTING_MIN_SCRIPTS_BOUGHT = 2;
/** The chance that a hot session of an eligible fan goes without a sale: about one in four or five. */
export const FREE_SEXTING_CHANCE = 2 / 9;
/** The tiers of « Fans » (`fanTierOf`, the owner's thresholds) that make him a good payer, whatever his scripts. */
const GOOD_PAYER_TIERS: readonly FanTier[] = ['good', 'very_good', 'whale'];
/** After this many sessions without a sale and no purchase since the first of them, no new one. */
const FREE_SEXTING_LAPSE_SESSIONS = 2;
/** Past this span after the last of them with still no purchase, the advantage is lost, not merely waiting. */
export const FREE_SEXTING_LAPSE_MS = 30 * 24 * 60 * 60_000;

type FreeSexting = NonNullable<FanAvailabilityRecord['freeSexting']>;

/**
 * Whether he may still have a session without a sale. `eligible`: yes. `awaiting_purchase`: two sessions without a sale
 * and no purchase since, code waits to see whether he buys again. `lapsed`: still none past the span, the advantage is
 * over until he buys again. `not_faithful`: too few scripts bought.
 */
export type FreeSextingStanding = 'eligible' | 'awaiting_purchase' | 'lapsed' | 'not_faithful';

export interface FreeSextingFacts {
  readonly scriptsBought: number;
  /** His tier in « Fans » (`fanTierOf`), when known: good, very good or whale makes him faithful too. */
  readonly fanTier?: FanTier | null;
  readonly record: FreeSexting | null;
  /** When he last paid; `null` never; absent, unknown (then any session counts as unpaid since). */
  readonly lastSpentAt: Date | null | undefined;
  readonly now: Date;
}

export function freeSextingStanding(input: FreeSextingFacts): FreeSextingStanding {
  const goodPayer =
    input.fanTier !== undefined && input.fanTier !== null && GOOD_PAYER_TIERS.includes(input.fanTier);
  if (input.scriptsBought < FREE_SEXTING_MIN_SCRIPTS_BOUGHT && !goodPayer) return 'not_faithful';
  const sessions = input.record?.noSaleSessions ?? [];
  const lastSpent = input.lastSpentAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const unpaidSince = sessions.filter((at) => at.getTime() >= lastSpent);
  if (unpaidSince.length < FREE_SEXTING_LAPSE_SESSIONS) return 'eligible';
  const latest = Math.max(...unpaidSince.map((at) => at.getTime()));
  return input.now.getTime() - latest >= FREE_SEXTING_LAPSE_MS ? 'lapsed' : 'awaiting_purchase';
}

/**
 * Whether his next hot session may be drawn without a sale: he is eligible and his last drawn session was not one
 * (never two in a row). Pure, without the draw: another rule may read it (a pause after a purchase, ADR 0135).
 */
export function freeSextingDue(input: FreeSextingFacts): boolean {
  return freeSextingStanding(input) === 'eligible' && input.record?.noSale !== true;
}

export interface FreeSextingInput extends FreeSextingFacts {
  /** When the hot session began (`FanAvailabilityRecord.hotAt` after his message); `null`, no hot session now. */
  readonly sessionAt: Date | null;
  /** He asks for a media (or for something paid): the session goes back to an ordinary sale. */
  readonly asksForMedia: boolean;
  /** Anything sexual is allowed with him (adult age confirmed, nothing explicit not asked, no care, no risk). */
  readonly allowed: boolean;
  /** A number in [0, 1): `Math.random` in production, a fixed one in tests. */
  readonly random: () => number;
}

export interface FreeSextingOutcome {
  /** This message is in a session without a sale: words only, no media, no step. */
  readonly noSale: boolean;
  /** He asked for a media in a session without a sale: it goes back to a sale on this very message. */
  readonly backToSale: boolean;
  readonly standing: FreeSextingStanding;
  readonly record: FreeSexting | null;
}

const same = (a: Date, b: Date): boolean => a.getTime() === b.getTime();

/** The draw for a new hot session, or the session's decision kept; then a media asked for takes it back to a sale. */
export function freeSextingTurn(input: FreeSextingInput): FreeSextingOutcome {
  const standing = freeSextingStanding(input);
  const { record, sessionAt } = input;
  const none = (kept: FreeSexting | null): FreeSextingOutcome => ({
    noSale: false,
    backToSale: false,
    standing,
    record: kept,
  });
  if (sessionAt === null) return none(record);
  if (record !== null && same(record.sessionAt, sessionAt)) {
    if (!record.noSale) return none(record);
    if (input.asksForMedia || !input.allowed) {
      // Not a session without a sale after all: it leaves the count, and the next one may be drawn again.
      const kept = record.noSaleSessions.filter((at) => !same(at, sessionAt));
      return {
        noSale: false,
        backToSale: input.asksForMedia,
        standing,
        record: { ...record, noSale: false, noSaleSessions: kept },
      };
    }
    return { noSale: true, backToSale: false, standing, record };
  }
  // A new hot session: one draw, never two sessions without a sale in a row.
  const drawn =
    freeSextingDue(input) && input.allowed && !input.asksForMedia && input.random() < FREE_SEXTING_CHANCE;
  const sessions = record?.noSaleSessions ?? [];
  return {
    noSale: drawn,
    backToSale: false,
    standing,
    record: {
      sessionAt,
      noSale: drawn,
      noSaleSessions: drawn ? [...sessions, sessionAt].slice(-FREE_SEXTING_SESSIONS_KEPT) : [...sessions],
    },
  };
}
