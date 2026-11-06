import type {
  AccountPayRulesId,
  CreatorAgencyRateId,
  CalendarView,
  CreatorId,
  CreatorPlanned,
  CreatorSummary,
  Currency,
  EarningsSource,
  LeaveRequestId,
  LeaveRequestStatus,
  PayPeriod,
  Platform,
  PlatformAccountId,
  ReportSignal,
  SchedulingSettings,
  SchedulingSettingsInput,
  ShiftFeedbackId,
  ShiftId,
  ShiftReportId,
  ShiftReportStatus,
  ShiftSlot,
  ShiftSwapRequestId,
  ShiftSwapStatus,
  ShiftTemplateId,
  SlotSeat,
  TeamMemberId,
  TeamMemberStatus,
  TeamScope,
  UserId,
} from '@impera/contracts';

import type { CreatorAgent } from './calendar';
import type { FeedEvent } from './calendar-feed';
import type { Reader, RulesRow } from './reports';
import type { WorkingMember } from './shifts';

/** Who writes, for the policies (`withTenantMember`) and the audit line. */
export interface Actor {
  readonly userId: UserId;
  readonly ip: string | null;
}

/** A creator as the planning reads her: her name, and whether she is archived (ADR 0071 § 2). */
export interface ListedCreator extends CreatorSummary {
  readonly archived: boolean;
}

/** The creators that exist, with their names (the `persona` module's directory, injected by the composition root). */
export interface CreatorDirectory {
  /**
   * Every creator, the archived ones included and said so: her past shifts, reports and pay keep her name, and the
   * planning refuses her anything new (ADR 0071 § 2).
   */
  list(): Promise<readonly ListedCreator[]>;
}

/** A shift as stored, cancelled ones never read. */
export interface StoredShift {
  readonly id: ShiftId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly templateId: ShiftTemplateId | null;
  readonly stoppedAt: Date | null;
}

export interface StoredTemplate {
  readonly id: ShiftTemplateId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly validFrom: string;
  readonly validUntil: string | null;
}

export interface StoredAccount {
  readonly id: PlatformAccountId;
  readonly creatorId: CreatorId;
  readonly platform: Platform;
  readonly handle: string;
}

/** A leave as the planning reads it, for what it covers (`leaveCover`). */
export interface StoredLeave {
  readonly id: LeaveRequestId;
  readonly memberId: TeamMemberId;
  readonly status: LeaveRequestStatus;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cancelledAt: Date | null;
}

export interface StoredMember {
  readonly id: TeamMemberId;
  readonly displayName: string;
  readonly color: string | null;
  readonly status: TeamMemberStatus;
}

/**
 * What one reader's scope sees of the planning, on every creator asked. The owner and an active manager read every
 * shift, account and template; anyone else reads their own shifts, and no template.
 */
interface PlanningRead {
  readonly scope: TeamScope;
  /** Not cancelled, overlapping the range read. */
  readonly shifts: readonly StoredShift[];
  /** Every account of the creators for a planner; for anyone else, those their shifts are on. */
  readonly accounts: readonly StoredAccount[];
  /** Running in the range; planners only. */
  readonly templates: readonly StoredTemplate[];
  /** `occurrenceKey` of each shift the templates made in the range, cancelled or moved ones included. */
  readonly made: ReadonlySet<string>;
  /** Planners only: the approved and cancelled leaves of the templates' members overlapping the range (ADR 0031). */
  readonly leaves: readonly StoredLeave[];
  /** The members the policies let the reader see, among those the shifts and templates name. */
  readonly members: readonly StoredMember[];
}

interface NewShift {
  readonly id: ShiftId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface ShiftChange {
  readonly memberId?: TeamMemberId;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
}

interface NewTemplate {
  readonly id: ShiftTemplateId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly validFrom: string;
}

/** Where the store reads « now » and « today » for the rules that need them. */
export interface PlanningClock {
  readonly now: Date;
  readonly timeZone: string;
}

/** A version of the créneaux to write: when it takes effect, in which zone, its créneaux and its places. */
interface NewSlotVersion {
  readonly effectiveAt: Date;
  readonly timeZone: string;
  readonly slots: readonly ShiftSlot[];
  readonly seats: readonly SlotSeat[];
}

/**
 * Storage of the planning, implemented in `infra/` with `withTenantMember`: the policies decide what each scope
 * reads, and the rules that need stored rows (a member's status, a shift under way) run in the same transaction.
 * The exclusion constraints decide overlaps; the store turns their violation into the module's conflict, with the
 * shift in the way.
 */
export interface PlanningStore {
  /**
   * Any team scope: the zone, the margin and the créneaux' versions over `range` (the version in force at `from`, then
   * those taking effect before `to`), the module's defaults where nothing is saved; seats for the owner and the agency.
   */
  settings(
    actor: UserId,
    range: { readonly from: Date; readonly to: Date | null },
  ): Promise<SchedulingSettings>;
  /** Owner: the zone and the margin. */
  saveSettings(actor: Actor, settings: SchedulingSettingsInput): Promise<void>;
  /**
   * Owner: a version of the créneaux and its places, at `effectiveAt` (ahead), in the zone of the grid then (ADR 0049
   * § 1); its id. `slot_version_conflict` on another version's instant, `platform_account_not_found` for a place on an
   * account that does not exist, `slot_version_date_invalid` when its instant has passed by the write.
   */
  addSlotVersion(actor: Actor, version: NewSlotVersion): Promise<string>;
  /**
   * Owner: withdraws a version still ahead, its places with it. `slot_version_not_found`, or
   * `slot_version_effective_conflict` once it took effect.
   */
  withdrawSlotVersion(actor: Actor, id: string): Promise<void>;
  read(
    actor: UserId,
    creatorIds: readonly CreatorId[],
    range: { readonly from: Date; readonly to: Date },
  ): Promise<PlanningRead>;
  /** Owner and active manager: each shift covering `at`, of an active member, with that member. */
  onDuty(
    actor: UserId,
    creatorIds: readonly CreatorId[],
    at: Date,
  ): Promise<{ shift: StoredShift; member: StoredMember }[]>;
  /** Owner and active manager. */
  createShift(actor: Actor, shift: NewShift, clock: PlanningClock): Promise<StoredShift>;
  /**
   * Owner and active manager; `shift_not_found` for a cancelled shift or one the actor cannot read. `null` when the
   * change cancelled it (stopped in the minute it started).
   */
  updateShift(
    actor: Actor,
    id: ShiftId,
    change: ShiftChange,
    clock: PlanningClock,
  ): Promise<StoredShift | null>;
  cancelShift(actor: Actor, id: ShiftId, clock: PlanningClock): Promise<void>;
  /** Owner and active manager: the templates running from `today`. */
  templates(actor: UserId, creatorIds: readonly CreatorId[], today: string): Promise<StoredTemplate[]>;
  /** Owner and active manager: the template, and its shifts ahead, made in the same transaction. */
  createTemplate(actor: Actor, template: NewTemplate, clock: PlanningClock): Promise<StoredTemplate>;
  /** Owner and active manager: ends today, its shifts not yet started cancelled with it. */
  endTemplate(actor: Actor, id: ShiftTemplateId, clock: PlanningClock): Promise<void>;
}

/** Who is on shift on one account of a creator (glossary « En poste »). */
export interface OnShift {
  readonly memberId: TeamMemberId;
  readonly platformAccountId: PlatformAccountId;
  readonly shiftId: ShiftId;
  readonly endsAt: Date;
}

/** The reads and the job that cross creators, on the admin connection (`*Unscoped`). */
export interface PlanningAdmin {
  /** The member's shifts not cancelled whose access window may still be open at `now`, with their accounts. */
  memberShiftsUnscoped(
    userId: UserId,
    since: Date,
  ): Promise<{
    status: TeamMemberStatus;
    shifts: (StoredShift & { platform: Platform; handle: string })[];
  } | null>;
  /** `onShift` on a creator at `at`, without the margin: her active members whose shift covers it. */
  onShiftUnscoped(creatorId: CreatorId, at: Date): Promise<OnShift[]>;
  /** The settings in force now, for the job (no member behind it). */
  settingsUnscoped(): Promise<SchedulingSettings>;
  /** The templates running on `today` (a calendar day in the grid's zone), for the job. */
  runningTemplatesUnscoped(today: string): Promise<ShiftTemplateId[]>;
  /**
   * What still plans someone on her at `now` (ADR 0071 § 2, before she is archived): her shifts not over, neither
   * cancelled nor stopped, and her templates running on `today` or later (a calendar day in the grid's zone).
   */
  plannedUnscoped(creatorId: CreatorId, now: Date, today: string): Promise<CreatorPlanned>;
  /**
   * One template's shifts ahead, in a transaction of its own with the template locked as `endTemplate` locks it: none
   * once it has ended, or while its member is not `active` on its creator; how many were new.
   */
  makeTemplateShiftsUnscoped(id: ShiftTemplateId, clock: PlanningClock): Promise<number>;
}

/** A leave request as stored (ADR 0031): the member's, never a creator's. */
export interface StoredLeaveRequest extends StoredLeave {
  readonly firstDay: string;
  readonly lastDay: string;
  readonly timeZone: string;
  readonly note: string | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  readonly createdAt: Date;
}

interface NewLeaveRequest {
  readonly id: LeaveRequestId;
  readonly firstDay: string;
  readonly lastDay: string;
  readonly note: string | null;
}

/**
 * Storage of the leaves (ADR 0031), through `withMember`: the team tables' policies decide who reads and writes a
 * leave. The approval runs under the member's lock (`lockMembers`), reads the member's shifts and lapses their swap
 * proposals creator by creator, in the same transaction.
 */
export interface LeaveStore {
  /** Any member who has not left, for themselves; `created` is false when the same request was already recorded. */
  create(
    actor: Actor,
    request: NewLeaveRequest,
    now: Date,
  ): Promise<{ leave: StoredLeaveRequest; created: boolean }>;
  /** Owner and active manager; `creatorIds` are the creators that exist, for the shifts and swaps of the member. */
  decide(
    actor: Actor,
    id: LeaveRequestId,
    decision: { readonly decision: 'approve' | 'refuse'; readonly note: string | null },
    creatorIds: readonly CreatorId[],
    now: Date,
  ): Promise<StoredLeaveRequest>;
  /** The member withdraws their pending request; the owner or an active manager cancels an approved leave. */
  end(actor: Actor, id: LeaveRequestId, now: Date): Promise<void>;
  /** The requests overlapping the range, withdrawn ones aside, with the members they name. */
  list(
    actor: UserId,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<{ leaves: StoredLeaveRequest[]; members: StoredMember[] }>;
}

/** A swap as stored (ADR 0031), with what it noted of each shift when it was proposed. */
export interface StoredSwap {
  readonly id: ShiftSwapRequestId;
  readonly creatorId: CreatorId;
  readonly shiftId: ShiftId;
  readonly requesterId: TeamMemberId;
  readonly shiftStartsAt: Date;
  readonly shiftEndsAt: Date;
  readonly targetMemberId: TeamMemberId;
  readonly targetCreatorId: CreatorId | null;
  readonly targetShiftId: ShiftId | null;
  readonly targetShiftStartsAt: Date | null;
  readonly targetShiftEndsAt: Date | null;
  readonly message: string | null;
  readonly status: ShiftSwapStatus;
  readonly resolvedAt: Date | null;
  readonly revertedAt: Date | null;
  /** `withdrawn` by someone other than its requester: the owner or an active manager. */
  readonly withdrawnByAgency: boolean;
  readonly createdAt: Date;
}

interface NewSwap {
  readonly id: ShiftSwapRequestId;
  readonly shiftId: ShiftId;
  readonly targetMemberId: TeamMemberId;
  readonly targetShiftId: ShiftId | null;
  readonly message: string | null;
}

/**
 * Storage of the swaps (ADR 0031), through `withTenantMember`: the requester writes on their own shift, the colleague
 * answers, the owner or an active manager withdraws or reverts, each under its policy. An acceptance and a revert
 * take both members' locks, then the swap's row, then the shifts', and move the shifts under the policies, one
 * creator after the other.
 */
export interface SwapStore {
  /** The shift's member; `created` is false when the same swap was already recorded. */
  propose(actor: Actor, swap: NewSwap, now: Date): Promise<{ swap: StoredSwap; created: boolean }>;
  /** The colleague asked. */
  answer(actor: Actor, id: ShiftSwapRequestId, answer: 'accept' | 'decline', now: Date): Promise<StoredSwap>;
  /** The requester, the owner or an active manager withdraws a proposed swap; the agency reverts an accepted one. */
  end(actor: Actor, id: ShiftSwapRequestId, now: Date): Promise<void>;
  /**
   * The swaps the reader made or received (every one for a planner), proposed or resolved since `since`, with the
   * shifts they name that the policies let the reader read, and the accounts of every creator they name.
   */
  list(
    actor: UserId,
    creatorIds: readonly CreatorId[],
    since: Date,
  ): Promise<{ swaps: StoredSwap[]; shifts: StoredShift[]; accounts: StoredAccount[] }>;
  /**
   * The reader's own shift that has not started, read under the policies, with the creators the reader works on:
   * where the candidates of a swap start from.
   */
  offeredShift(
    actor: UserId,
    id: ShiftId,
    now: Date,
  ): Promise<{ shift: StoredShift; creatorIds: CreatorId[] }>;
}

/** A colleague as a chatter may see them (ADR 0031): a display name and a colour, nothing else. */
export interface NamedMember {
  readonly id: TeamMemberId;
  readonly displayName: string;
  readonly color: string | null;
}

/**
 * What a chatter reads of their colleagues, on the admin connection, after the policies have shown that the reader
 * may (ADR 0031): bounded to a display name, a colour and shifts, never a rate, a country, a status or a leave.
 */
export interface ColleagueReads {
  /** The display name and colour of these members. */
  namesUnscoped(memberIds: readonly TeamMemberId[]): Promise<NamedMember[]>;
  /**
   * The colleagues who could take `shift`: active, working on its creator, not the requester, and no leave covering
   * its hours, each `freeThen` when no other shift of theirs overlaps it, on any creator; with their shifts not
   * cancelled starting in (`now`, `until`), on `creatorIds`, and those shifts' accounts.
   */
  candidatesUnscoped(
    shift: StoredShift,
    creatorIds: readonly CreatorId[],
    now: Date,
    until: Date,
  ): Promise<{
    members: (NamedMember & { readonly freeThen: boolean })[];
    shifts: StoredShift[];
    accounts: StoredAccount[];
  }>;
  /**
   * A shift of the member, not cancelled, that overlaps [`startsAt`, `endsAt`) on any creator, other than `except`:
   * what would put them on two shifts at once. Its id, for the caller to say only when the shift is the reader's.
   */
  overlappingShiftUnscoped(
    memberId: TeamMemberId,
    span: { readonly startsAt: Date; readonly endsAt: Date },
    except: readonly ShiftId[],
  ): Promise<ShiftId | null>;
  /**
   * Whether a leave of the member covers part of [`startsAt`, `endsAt`) (`leaveCover`): for the requester of an
   * exchange, whose leaves the colleague who accepts does not read. Only the effect, never the leave.
   */
  onLeaveUnscoped(
    memberId: TeamMemberId,
    span: { readonly startsAt: Date; readonly endsAt: Date },
  ): Promise<boolean>;
  /**
   * Whether a member can take a shift on a creator (status, creators, first day), for the side of a swap the reader's
   * policies hide: the colleague asked when proposing, the requester when accepting. `null` when no such member.
   */
  memberWorkUnscoped(memberId: TeamMemberId): Promise<WorkingMember | null>;
  /** A shift the reader's policies hide: the colleague's shift asked back in an exchange. */
  shiftUnscoped(id: ShiftId): Promise<(StoredShift & { cancelled: boolean }) | null>;
  /**
   * `scheduling.lapse_swaps`: the proposed swaps whose shifts started, were cancelled, or changed hands or hours
   * since the proposal become `lapsed`; how many.
   */
  lapseSwapsUnscoped(now: Date): Promise<number>;
}

/** A report or a correction as stored (EQ-03), with who last sent it, for the four eyes of its review. */
export interface StoredShiftReport {
  readonly id: ShiftReportId;
  readonly shiftId: ShiftId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  readonly period: PayPeriod;
  readonly correctsId: ShiftReportId | null;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly comment: string | null;
  readonly incident: string | null;
  readonly status: ShiftReportStatus;
  readonly version: number;
  readonly byAgency: boolean;
  readonly submittedBy: UserId;
  readonly submittedAt: Date;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
  readonly createdAt: Date;
}

interface NewShiftReport {
  readonly id: ShiftReportId;
  readonly shiftId: ShiftId;
  readonly correctsId: ShiftReportId | null;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly comment: string | null;
  readonly incident: string | null;
}

/** What a `PATCH` changes; a field left out keeps its value. */
interface ShiftReportChange {
  readonly amountMinor?: number | undefined;
  readonly comment?: string | null | undefined;
  readonly incident?: string | null | undefined;
}

type ShiftReportReview =
  { readonly decision: 'validate' } | { readonly decision: 'reject'; readonly note: string };

/**
 * Storage of the end-of-shift reports (EQ-03), through `withTenantMember` in the shift's creator: the policies decide
 * who reads, makes, changes and reviews, and the rules that need stored rows (the account's pay rules, the shift's
 * validated total) run in the same transaction, under the lock (member, period) that pay's validation takes too
 * (`lockMemberPeriod`), taken before any row is locked. Each result carries the `Reader` it was read for, so that
 * `canReview` is said from the same transaction.
 */
export interface ShiftReportStore {
  /** The shift's member, the owner or an active manager: the shift, its account, period, rules and reports. */
  context(
    actor: UserId,
    shiftId: ShiftId,
  ): Promise<{
    shift: StoredShift;
    account: StoredAccount;
    period: PayPeriod;
    rules: RulesRow | null;
    reports: StoredShiftReport[];
    reader: Reader;
  }>;
  /** A report by the shift's member, or a correction; `created` is false when the same one was already recorded. */
  create(
    actor: Actor,
    report: NewShiftReport,
    now: Date,
  ): Promise<{ report: StoredShiftReport; created: boolean; reader: Reader }>;
  /** Its maker, from the version read. */
  update(
    actor: Actor,
    id: ShiftReportId,
    version: number,
    change: ShiftReportChange,
    now: Date,
  ): Promise<{ report: StoredShiftReport; reader: Reader }>;
  /** The owner or an active manager, from the version read, in a transaction of its own. */
  review(
    actor: Actor,
    id: ShiftReportId,
    version: number,
    review: ShiftReportReview,
    now: Date,
  ): Promise<{ report: StoredShiftReport; reader: Reader }>;
  /**
   * With `period`, its reports and the shifts not cancelled that start in it and take a report already, with those
   * the reports name; without, the reports still open and the shifts they name. The accounts of those shifts, and the
   * members named whom the policies show.
   */
  list(
    actor: UserId,
    creatorIds: readonly CreatorId[],
    period: PayPeriod | null,
    now: Date,
  ): Promise<{
    reports: StoredShiftReport[];
    shifts: StoredShift[];
    accounts: StoredAccount[];
    members: StoredMember[];
    reader: Reader;
  }>;
  /** Who the signed-in account is, for a validation sent by someone who may not review. */
  reader(actor: UserId): Promise<Reader>;
}

/** An account's pay rules as stored (EQ-03): added only, never changed. */
export interface StoredPayRules {
  readonly id: AccountPayRulesId;
  readonly platformAccountId: PlatformAccountId;
  readonly creatorId: CreatorId;
  readonly fromPeriod: PayPeriod;
  readonly currency: Currency;
  readonly vatBps: number;
  readonly platformFeeBps: number;
  readonly earningsSource: EarningsSource;
  readonly createdAt: Date;
}

interface NewPayRules {
  readonly id: AccountPayRulesId;
  readonly platformAccountId: PlatformAccountId;
  readonly fromPeriod: PayPeriod;
  readonly currency: Currency;
  readonly vatBps: number;
  readonly platformFeeBps: number;
  readonly earningsSource: EarningsSource;
}

/**
 * Storage of the accounts' pay rules (EQ-03), which the reports read in their own transaction: the owner and an
 * active manager read them, the owner alone adds them (`withTenantMember` in the account's creator). The period
 * running now is read in the agency's zone, in the same transaction.
 */
export interface PayRulesStore {
  /** Every account of the creators, with its rules newest first, and the period running at `now`. */
  list(
    actor: UserId,
    creatorIds: readonly CreatorId[],
    now: Date,
  ): Promise<{
    currentPeriod: PayPeriod;
    accounts: { account: StoredAccount; rules: StoredPayRules[] }[];
  }>;
  /** Owner; `created` is false when the same rules were already recorded. */
  create(actor: Actor, rules: NewPayRules, now: Date): Promise<{ rules: StoredPayRules; created: boolean }>;
}

/** A creator's agency percentage as stored (CR-04): added only, never changed. `fromDay` is `YYYY-MM-DD`. */
export interface StoredAgencyRate {
  readonly id: CreatorAgencyRateId;
  readonly creatorId: CreatorId;
  readonly fromDay: string;
  readonly agencyBps: number;
  readonly createdAt: Date;
}

interface NewAgencyRate {
  readonly id: CreatorAgencyRateId;
  readonly fromDay: string;
  readonly agencyBps: number;
}

/**
 * Storage of the creators' agency percentages (CR-04), through `withTenantMember` in the creator: the owner alone
 * reads and adds them, the table refuses any change or removal. Today is read in the agency's zone, in the same
 * transaction.
 */
export interface AgencyRatesStore {
  /** Her percentages newest first, and the day it is at `now` in the agency's zone. */
  list(actor: UserId, creatorId: CreatorId, now: Date): Promise<{ today: string; rates: StoredAgencyRate[] }>;
  /** Owner; `created` is false when the same percentage was already recorded. */
  create(
    actor: Actor,
    creatorId: CreatorId,
    rate: NewAgencyRate,
    now: Date,
  ): Promise<{ rate: StoredAgencyRate; created: boolean }>;
}

/** What the job logs through; the composition root passes the job's own logger. */
export interface JobLogger {
  warn(object: object, message: string): void;
}

/** A shift as the calendar reads it (`calendar_shifts`): who, with their name and colour, on which creator, and when. */
export interface CalendarRow {
  readonly memberId: TeamMemberId;
  readonly memberName: string;
  readonly memberColor: string | null;
  readonly creatorId: CreatorId;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * The calendar's reads (CR-12, ADR 0045 § 1), through `withMember` and the two functions of migration 0069, which
 * apply the boundary from the account the transaction names: `agency` for the owner or an active manager, `team` for
 * an active chatter (every shift of the team and the agent), `own` for anyone else (their own shifts, no agent).
 */
export interface CalendarReads {
  /**
   * One snapshot: the view, the shifts and the agent, the settings, and for `agency` alone the accounts and the shifts
   * of each, read creator by creator (`creatorIds`, the creators that exist) under the same policies as Planning, so
   * that the créneaux to fill, the hours and the coverage agree with the shifts shown; with them, the members of those
   * shifts who are not at work (`away`), whose shifts hold nothing (recette EQP-03).
   */
  read(
    actor: UserId,
    window: { readonly from: Date; readonly to: Date },
    creatorIds: readonly CreatorId[],
  ): Promise<{
    view: CalendarView;
    settings: SchedulingSettings;
    shifts: CalendarRow[];
    agents: CreatorAgent[];
    agency: { accounts: StoredAccount[]; shifts: StoredShift[]; away: ReadonlySet<string> } | null;
  }>;
}

/**
 * Calendar links (CR-12, ADR 0045 § 5), through the admin connection (`calendar_links` is out of `nirvana_app`'s
 * reach). The token is made, hashed and compared here, and leaves only from `replace`.
 */
export interface CalendarLinkStore {
  /** The account's live link, if any: since when and her choice of shifts, never the token. */
  live(userId: UserId): Promise<{ createdAt: Date; withShifts: boolean } | null>;
  /**
   * A new link for a member of the team who has not left, or for a creator's own account (CR-05, ADR 0042 § 4),
   * revoking the live one, both in the audit log, and keeping her choice of shifts; `null` when the account is
   * neither.
   */
  replace(actor: Actor): Promise<{ token: string; createdAt: Date } | null>;
  /** Revokes the live link; whether there was one. */
  revoke(actor: Actor): Promise<boolean>;
  /** Her choice of shifts on her live link (ADR 0045 § 5), in the audit log; `null` when there is no live link. */
  choose(actor: Actor, withShifts: boolean): Promise<{ createdAt: Date; withShifts: boolean } | null>;
  /**
   * The holder of a live link, found by the token's hash: a member who has not left, or a creator's account that still
   * opens her; `null` otherwise.
   */
  holder(token: string): Promise<CalendarLinkHolder | null>;
}

/** Whose link it is: a member's feed holds their shifts, a creator's her agenda (CR-05). */
export type CalendarLinkHolder =
  | { readonly kind: 'member'; readonly userId: UserId; readonly memberId: TeamMemberId }
  | { readonly kind: 'creator'; readonly userId: UserId; readonly withShifts: boolean };

/** One shift of her accounts in her calendar link (ADR 0045 § 5): who answers her fans, where, and when. */
export interface CreatorFeedShift {
  readonly shiftId: string;
  readonly displayName: string;
  readonly platform: Platform;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** Her accounts' shifts over the feed's window, read with her own rights (`creator_on_duty`). */
export type CreatorShiftsFeed = (
  userId: UserId,
  window: { readonly from: Date; readonly to: Date },
) => Promise<readonly CreatorFeedShift[]>;

/**
 * A creator's agenda as her feed shows it (CR-05 lot c2, the `creator-tasks` module's `feedOf`): her tasks between
 * two instants, read with her own rights, as events of the feed.
 */
export type CreatorAgendaFeed = (
  userId: UserId,
  window: { readonly from: Date; readonly to: Date },
) => Promise<readonly FeedEvent[]>;

/** A shift's mini feedback as stored (ADR 0050 § 10). */
export interface StoredShiftFeedback {
  readonly id: ShiftFeedbackId;
  readonly shiftId: ShiftId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  readonly period: PayPeriod;
  readonly nothingToReport: boolean;
  readonly comment: string | null;
  readonly incident: string | null;
  readonly signals: readonly ReportSignal[];
  readonly createdAt: Date;
}

/** What the member says at the end of the shift: the contract's body, checked. */
export interface ShiftFeedbackInput {
  readonly id: ShiftFeedbackId;
  readonly nothingToReport: boolean;
  readonly comment: string | null;
  readonly incident: string | null;
  readonly signals: readonly ReportSignal[];
}

/** The mini feedback through `withTenantMember` in the shift's creator: the policies decide who reads and writes. */
export interface ShiftFeedbackStore {
  /** The shift's member, the owner or an active manager: its feedback, `null` before it is made. */
  read(actor: UserId, shiftId: ShiftId): Promise<StoredShiftFeedback | null>;
  /** The shift's member alone; `created` is false when the same feedback was already recorded. */
  create(
    actor: Actor,
    shiftId: ShiftId,
    feedback: ShiftFeedbackInput,
    now: Date,
  ): Promise<{ feedback: StoredShiftFeedback; created: boolean }>;
}
