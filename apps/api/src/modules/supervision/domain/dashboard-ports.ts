import type {
  AgentHoursNow,
  AutomaticGate,
  CreatorId,
  DecidedDraft,
  HandoffCause,
  LiveRateReading,
  Platform,
  SalesTotals,
  TeamMemberId,
  TeamScope,
  UserId,
  DropCategory,
} from '@impera/contracts';

import type { AgencyCreatorRead } from './agency-insights';
import type { UsdRate } from './fan-ranking';

/** The voice version whose live rate the Dashboard shows: the one the composition root gives `conversations` too. */
export interface VoiceVersion {
  readonly voicePrompt: string;
  readonly voiceModel: string;
}

/**
 * A conversation waiting for a human: handed over, with a draft unread for more than 10 minutes, stopped by a
 * send that failed for good (state `error`), his message left with nothing under way for 30 minutes (P3-11), or a
 * fan the AI proposes to mark « fragile », in his latest conversation (ADR 0085 § 9, lot b2).
 */
export interface WaitingConversation {
  readonly conversationId: string;
  readonly fanId: string;
  readonly fanName: string;
  readonly kind: HandoffCause | 'awaiting_approval' | 'send_failed' | 'unanswered' | 'fragile_proposed';
  readonly since: Date;
  /** Its own sentence, where the kind's is not enough (the signs of a « fragile » proposal). */
  readonly why?: string;
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
  /** Her Arrêt is a pause (ADR 0148 § 1): when it lifts itself. `null` for an Arrêt lifted by hand, or none. */
  readonly pausedUntil: Date | null;
  /** Her hours now, exceptions read (ADR 0148 § 1). */
  readonly hoursNow: AgentHoursNow;
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
 * The agency's figures as read creator by creator (ADR 0078 § 1, § 5), in her tenant and with the account's team scope:
 * `out_of_scope` for a scope of one's own, `not_linked` before a register is linked.
 */
export interface AgencyFiguresStore {
  read(
    creatorId: CreatorId,
    userId: UserId,
    range: { readonly from: string; readonly previousFrom: string; readonly to: string },
    /** A calendar month's first day: her revenue objective for it is read too (ADR 0092 § 6). */
    objectiveMonth?: string | null,
  ): Promise<
    | { readonly kind: 'out_of_scope' }
    | { readonly kind: 'not_linked' }
    | { readonly kind: 'read'; readonly read: AgencyCreatorRead }
  >;
  /** Display names of the team, member id to name, read as `userId` through the first creator given. */
  memberNames(creatorId: CreatorId, userId: UserId): Promise<ReadonlyMap<string, string>>;
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

/** What the sales panel reads of the platform's register (CRM-04 lot c), in one transaction of the reader. */
export interface RevealSalesReading {
  /** The platforms of her accounts linked to the register, at least one. */
  readonly platforms: readonly [Platform, ...Platform[]];
  readonly totals: SalesTotals;
  /** Member id to display name, for the owner and an active manager; `null` for anyone else (ADR 0043 § 7). */
  readonly names: ReadonlyMap<string, string> | null;
}

/** A platform's feed as Réglages › Ventes shows it (the connectors' `salesFeeds.list`, by the composition root). */
export interface SalesFeedState {
  readonly platform: Platform;
  readonly state: 'not_connected' | 'connected' | 'needs_reconnect';
  readonly message: string;
  readonly lastReadAt: string | null;
}

export interface RevealSalesView {
  /**
   * Her sales totals from `from` to `to` (days, both included), read as `userId`; undefined while none of her accounts
   * is linked to a platform's register (CRM-01): the panel then stays away.
   */
  read(
    creatorId: CreatorId,
    userId: UserId,
    range: { readonly from: string; readonly to: string },
  ): Promise<RevealSalesReading | undefined>;
}

/** What one tenant transaction reads of her for her card. */
export interface CreatorOverviewFacts {
  readonly timezone: string;
  readonly scope: TeamScope;
  readonly switches: DashboardFacts['switches'];
  readonly pausedUntil: DashboardFacts['pausedUntil'];
  readonly hoursNow: DashboardFacts['hoursNow'];
  readonly autoConversations: number;
  /** One of her persona versions is active: without one her agent writes nothing (PRO1-03). */
  readonly hasActivePersona: boolean;
  /** The platforms where a session of one of her accounts expired (recette REV-05). */
  readonly expiredSessions: readonly Platform[];
  /** Her open requests with nothing dropped, the first due first; empty for a scope of one's own (RLS). */
  readonly requests: readonly { readonly category: DropCategory; readonly dueOn: string }[];
  /** Member id to display name (the team's, read by the owner and an active manager). */
  readonly names: ReadonlyMap<string, string>;
}

export interface OnShiftReading {
  readonly memberId: TeamMemberId;
  readonly endsAt: Date;
}

/** What a creator's card in the list of Créatrices reads of her, in one transaction of the reader (RLS). */
export interface CreatorOverviewView {
  /** Undefined when the creator does not exist. */
  read(creatorId: CreatorId, userId: UserId): Promise<CreatorOverviewFacts | undefined>;
}

/**
 * Who is on shift on her accounts at `at`, without the margin (module scheduling, wired by the composition root): read
 * as the system, so the route asks it only for a reader whose scope reads the team.
 */
export type OnShiftView = (creatorId: CreatorId, at: Date) => Promise<readonly OnShiftReading[]>;
