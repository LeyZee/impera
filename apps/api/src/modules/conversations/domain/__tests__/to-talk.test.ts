import {
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  FanTiersSettingSchema,
  fanTierOf,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { toTalkOf, type ToTalkCandidate } from '../to-talk';

const NOW = new Date('2026-11-21T14:00:00Z');
const TIERS = FanTiersSettingSchema.parse({});
const CREATOR = CreatorIdSchema.parse('00000000-0000-4000-8000-0000000000c1');
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

let n = 0;
function fan(over: Partial<ToTalkCandidate> = {}): ToTalkCandidate {
  n += 1;
  const hex = n.toString(16).padStart(12, '0');
  return {
    conversationId: ConversationIdSchema.parse(`00000000-0000-4000-8000-${hex}`),
    fanId: FanIdSchema.parse(`00000000-0000-4000-9000-${hex}`),
    fanDisplayName: `Fan ${String(n)}`,
    fanSince: hoursAgo(24 * 60),
    lastInboundAt: null,
    lastOutboundAt: null,
    spentMinor: 0,
    lastPurchaseAt: null,
    heldByOther: false,
    ageDisputed: false,
    doNotContact: false,
    noFollowUp: false,
    ...over,
  };
}

describe('the tier of a fan (Charles, 21/11)', () => {
  it('rises with what he spent, from the default thresholds', () => {
    const old = hoursAgo(24 * 30);
    expect(
      [0, 100, 4_999, 5_000, 19_999, 20_000, 50_000].map((spentMinor) =>
        fanTierOf({ spentMinor, fanSince: old }, TIERS, NOW),
      ),
    ).toEqual([null, 'payer', 'payer', 'good', 'good', 'very_good', 'whale']);
  });

  it('calls a fan who bought nothing new for seven days only', () => {
    expect(fanTierOf({ spentMinor: 0, fanSince: hoursAgo(24 * 6) }, TIERS, NOW)).toBe('new');
    expect(fanTierOf({ spentMinor: 0, fanSince: hoursAgo(24 * 7) }, TIERS, NOW)).toBeNull();
  });

  it('refuses thresholds that do not rise', () => {
    expect(
      FanTiersSettingSchema.safeParse({
        goodFromMinor: 5_000,
        veryGoodFromMinor: 5_000,
        whaleFromMinor: 9_000,
      }).success,
    ).toBe(false);
  });
});

describe('« À qui parler maintenant »', () => {
  it('puts the payers who wait first, the highest tier then the longest wait', () => {
    const payer = fan({ spentMinor: 1_000, lastInboundAt: hoursAgo(2) });
    const whale = fan({ spentMinor: 80_000, lastInboundAt: hoursAgo(0.1) });
    const good = fan({ spentMinor: 6_000, lastInboundAt: hoursAgo(1), lastOutboundAt: hoursAgo(3) });
    const answered = fan({ spentMinor: 6_000, lastInboundAt: hoursAgo(3), lastOutboundAt: hoursAgo(1) });
    const result = toTalkOf(CREATOR, [payer, whale, good, answered], TIERS, NOW);
    expect(result.waiting.map((f) => f.fanDisplayName)).toEqual([
      whale.fanDisplayName,
      good.fanDisplayName,
      payer.fanDisplayName,
    ]);
    expect(result.waiting[0]?.waitingMinutes).toBe(6);
  });

  it('lists the new ones never answered or waiting, not the ones already answered', () => {
    const never = fan({ fanSince: hoursAgo(1) });
    const waiting = fan({ fanSince: hoursAgo(5), lastInboundAt: hoursAgo(4) });
    const answered = fan({ fanSince: hoursAgo(5), lastInboundAt: hoursAgo(4), lastOutboundAt: hoursAgo(3) });
    const result = toTalkOf(CREATOR, [never, waiting, answered], TIERS, NOW);
    expect(result.newcomers.map((f) => f.fanDisplayName)).toEqual([
      waiting.fanDisplayName,
      never.fanDisplayName,
    ]);
  });

  it('names the very good payers quiet for five days, never one with no sales follow-up', () => {
    const quiet = fan({
      spentMinor: 30_000,
      lastInboundAt: hoursAgo(24 * 6),
      lastOutboundAt: hoursAgo(24 * 5.5),
    });
    const recent = fan({
      spentMinor: 30_000,
      lastInboundAt: hoursAgo(24 * 2),
      lastOutboundAt: hoursAgo(24 * 1),
    });
    const frozen = fan({
      spentMinor: 90_000,
      lastInboundAt: hoursAgo(24 * 9),
      lastOutboundAt: hoursAgo(24 * 8),
      noFollowUp: true,
    });
    const small = fan({
      spentMinor: 6_000,
      lastInboundAt: hoursAgo(24 * 9),
      lastOutboundAt: hoursAgo(24 * 8),
    });
    const result = toTalkOf(CREATOR, [quiet, recent, frozen, small], TIERS, NOW);
    expect(result.silent.map((f) => f.fanDisplayName)).toEqual([quiet.fanDisplayName]);
  });

  it('never lists a fan held by another, not to contact, or whose age is in doubt, and counts the doubts', () => {
    const result = toTalkOf(
      CREATOR,
      [
        fan({ spentMinor: 1_000, lastInboundAt: hoursAgo(1), heldByOther: true }),
        fan({ spentMinor: 1_000, lastInboundAt: hoursAgo(1), doNotContact: true }),
        fan({ spentMinor: 1_000, lastInboundAt: hoursAgo(1), ageDisputed: true }),
        fan({ fanSince: hoursAgo(1), ageDisputed: true }),
      ],
      TIERS,
      NOW,
    );
    expect(result.waiting).toEqual([]);
    expect(result.newcomers).toEqual([]);
    expect(result.ageHeld).toBe(2);
  });

  it('keeps five fans a group', () => {
    const many = Array.from({ length: 8 }, () => fan({ spentMinor: 1_000, lastInboundAt: hoursAgo(1) }));
    expect(toTalkOf(CREATOR, many, TIERS, NOW).waiting).toHaveLength(5);
  });
});
