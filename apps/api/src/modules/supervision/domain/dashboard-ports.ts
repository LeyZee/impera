import type {
  AutomaticGate,
  CreatorId,
  DecidedDraft,
  HandoffCause,
  LiveRateReading,
  UserId,
} from '@nirvana/contracts';

import type { UsdRate } from './fan-ranking';

/** The voice version whose live rate the Dashboard shows: the one the composition root gives `conversations` too. */
export interface VoiceVersion {
  readonly voicePrompt: string;
  readonly voiceModel: string;
}

/**
 * A conversation waiting for a human: handed over, with a draft unread for more than 10 minutes, stopped by a
 * send that failed for good (state `error`), or his message left with nothing under way for 30 minutes (P3-11).
 */
export interface WaitingConversation {
  readonly conversationId: string;
  readonly fanId: string;
  readonly fanName: string;
  readonly kind: HandoffCause | 'awaiting_approval' | 'send_failed' | 'unanswered';
  readonly since: Date;
}

interface TopFan {
  readonly id: string;
  readonly name: string;
  readonly conversationId: string;
  readonly firstSeenAt: Date;
  /** In euro cents, his dollars converted at the last ECB rate known (`rankFans`). */
  readonly spentMinor: number;
  readonly byAgentMinor: number;
  readonly notes: readonly string[];
  readonly alert: HandoffCause | undefined;
}

/** What the database knows, read in one tenant transaction; the domain turns it into the Dashboard. */
export interface DashboardFacts {
  readonly creator: { readonly name: string; readonly timezone: string };
  /** The latest row of each kill switch scope that stops her: the global one, and hers. */
  readonly switches: { readonly global: boolean; readonly creator: boolean };
  readonly autoConversations: number;
  /**
   * Decided drafts of the active voice version as they stood three weeks ago, newest first (at most 200), for the
   * trend. Today's rate is the one the lock reads (`AutomaticView`).
   */
  readonly decidedThreeWeeksAgo: readonly DecidedDraft[];
  readonly reveal: {
    readonly connected: boolean;
    readonly lastReadAt: Date | null;
    /** When the session was last set: the start of the wait for a first read, when none came yet. */
    readonly sessionSince: Date | null;
    /** The longest the account waits between two polls (its interval plus its jitter), in seconds. */
    readonly pollEverySeconds: number;
    readonly conversations: number;
  };
  readonly voice: { readonly medianWriteMs: number | null; readonly outageHoursLast7d: number };
  readonly replies: {
    readonly medianReplyMinutes: number | null;
    readonly fansWaitingOver10Min: number;
    readonly conversationsOpen: number;
  };
  readonly handoffsToday: readonly { readonly cause: HandoffCause; readonly count: number }[];
  readonly waiting: readonly WaitingConversation[];
  /** Best fans first (`rankFans`). */
  readonly fans: readonly TopFan[];
  /** Whether a dollar sale falls in the period, and the ECB day of the rate it was converted at (`null`: not counted). */
  readonly usdSales: { readonly seen: boolean; readonly rateDay: string | null };
}

export interface DashboardWindow {
  readonly now: Date;
  /** Midnight of her day, in her time zone. */
  readonly dayStart: Date;
  readonly periodStart: Date;
  readonly voice: VoiceVersion;
}

export interface DashboardReader {
  /** Undefined when the creator does not exist. */
  read(
    creatorId: CreatorId,
    window: (timezone: string) => DashboardWindow,
    /** The last ECB rate known for the dollar, `null` when none is: its sales then do not count. */
    usdRate: UsdRate | null,
  ): Promise<{ readonly facts: DashboardFacts; readonly window: DashboardWindow } | undefined>;
}

/**
 * The last ECB rate known for the dollar (module payroll, ADR 0033, wired by the composition root), read under the
 * member context of whoever reads the Dashboard; `null` before the first rate.
 */
export interface UsdRateView {
  latest(userId: UserId): Promise<UsdRate | null>;
}

/**
 * The server lock of Automatique, read by `conversations` (wired by the composition root, ADR 0019), with the live
 * rate it was decided on: the Dashboard shows that one, so its rate and the lock never disagree.
 */
export interface AutomaticView {
  read(creatorId: CreatorId): Promise<{ readonly gate: AutomaticGate; readonly reading: LiveRateReading }>;
}

/** What the Dashboard shows of the Telegram alerts (module telegram, wired by the composition root). */
export interface TelegramReading {
  /** Urgent and important alerts of her night (20 h to 8 h in her time zone), or of the last one by day. */
  readonly alertsTonight: number;
  readonly urgentReachable: boolean;
}

export interface TelegramView {
  read(creatorId: CreatorId): Promise<TelegramReading>;
}
