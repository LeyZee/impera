import {
  FAN_SILENT_DAYS,
  FAN_TIER_RANK,
  fanTierOf,
  TO_TALK_GROUP_MAX,
  type ConversationId,
  type CreatorId,
  type FanId,
  type FanTiersSetting,
  type ToTalk,
  type ToTalkFan,
} from '@impera/contracts';

/**
 * « À qui parler maintenant » (Charles, 21/11): the method's order made into code. Payers who wait first, the highest
 * tier first; then the new ones to welcome; then the very good payers and whales gone quiet, never one whose sales are
 * frozen or who is fragile (no sales follow-up). Nobody is listed who must not be written to, and a doubt on his age
 * holds his conversation until a human lifts it: counted, never listed.
 */

/** One conversation as the store reads it, facts only. */
export interface ToTalkCandidate {
  readonly conversationId: ConversationId;
  readonly fanId: FanId;
  readonly fanDisplayName: string;
  readonly fanSince: Date;
  readonly lastInboundAt: Date | null;
  readonly lastOutboundAt: Date | null;
  /** In euro cents, his dollars converted at the last known rate. */
  readonly spentMinor: number;
  readonly lastPurchaseAt: Date | null;
  /** Another person holds it: he answers it, not the reader. */
  readonly heldByOther: boolean;
  readonly ageDisputed: boolean;
  readonly doNotContact: boolean;
  /** Sales frozen or fragile: no sales follow-up. */
  readonly noFollowUp: boolean;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const waits = (c: ToTalkCandidate): boolean =>
  c.lastInboundAt !== null && (c.lastOutboundAt === null || c.lastOutboundAt < c.lastInboundAt);

const latest = (c: ToTalkCandidate): Date | null => {
  if (c.lastInboundAt === null) return c.lastOutboundAt;
  if (c.lastOutboundAt === null) return c.lastInboundAt;
  return c.lastInboundAt > c.lastOutboundAt ? c.lastInboundAt : c.lastOutboundAt;
};

export function toTalkOf(
  creatorId: CreatorId,
  candidates: readonly ToTalkCandidate[],
  tiers: FanTiersSetting,
  now: Date,
): ToTalk {
  const fans = candidates
    .filter((c) => !c.doNotContact && !c.heldByOther)
    .map((c) => {
      const last = latest(c);
      const fan: ToTalkFan = {
        conversationId: c.conversationId,
        fanId: c.fanId,
        fanDisplayName: c.fanDisplayName,
        tier: fanTierOf(c, tiers, now),
        waitingMinutes:
          waits(c) && c.lastInboundAt !== null
            ? Math.max(0, Math.floor((now.getTime() - c.lastInboundAt.getTime()) / MINUTE_MS))
            : null,
        spentMinor: c.spentMinor,
        lastPurchaseAt: c.lastPurchaseAt?.toISOString() ?? null,
        fanSince: c.fanSince.toISOString(),
        lastMessageAt: last?.toISOString() ?? null,
      };
      return { candidate: c, fan, last };
    });
  const open = fans.filter((f) => !f.candidate.ageDisputed);
  const byWait = (a: ToTalkFan, b: ToTalkFan): number => (b.waitingMinutes ?? 0) - (a.waitingMinutes ?? 0);

  const waiting = open
    .filter((f) => f.fan.tier !== null && f.fan.tier !== 'new' && f.fan.waitingMinutes !== null)
    .map((f) => f.fan)
    .toSorted((a, b) => rank(a) - rank(b) || byWait(a, b));
  const newcomers = open
    .filter(
      (f) => f.fan.tier === 'new' && (f.fan.waitingMinutes !== null || f.candidate.lastOutboundAt === null),
    )
    .map((f) => f.fan)
    .toSorted(byWait);
  const silent = open
    .filter(
      (f) =>
        (f.fan.tier === 'very_good' || f.fan.tier === 'whale') &&
        !f.candidate.noFollowUp &&
        f.fan.waitingMinutes === null &&
        f.last !== null &&
        now.getTime() - f.last.getTime() >= FAN_SILENT_DAYS * DAY_MS,
    )
    .map((f) => f.fan)
    .toSorted((a, b) => b.spentMinor - a.spentMinor);

  return {
    creatorId,
    waiting: waiting.slice(0, TO_TALK_GROUP_MAX),
    newcomers: newcomers.slice(0, TO_TALK_GROUP_MAX),
    silent: silent.slice(0, TO_TALK_GROUP_MAX),
    ageHeld: fans.filter((f) => f.candidate.ageDisputed).length,
  };
}

const rank = (fan: ToTalkFan): number => (fan.tier === null ? 9 : FAN_TIER_RANK[fan.tier]);
