import type {
  AccountPayRulesId,
  CreatorId,
  CreatorSummary,
  Currency,
  EarningsSource,
  LeaveRequestId,
  LeaveRequestStatus,
  PayPeriod,
  Platform,
  PlatformAccountId,
  SchedulingSettings,
  ShiftId,
  ShiftReportId,
  ShiftReportStatus,
  ShiftSwapRequestId,
  ShiftSwapStatus,
  ShiftTemplateId,
  TeamMemberId,
  TeamMemberStatus,
  TeamScope,
  UserId,
} from '@nirvana/contracts';

import type { Reader, RulesRow } from './reports';
import type { WorkingMember } from './shifts';

/** Who writes, for the policies (`withTenantMember`) and the audit line. */
export interface Actor {
  readonly userId: UserId;
  readonly ip: string | null;
}

/** The creators that exist, with their names (the `persona` module's directory, injected by the composition root). */
export interface CreatorDirectory {
  list(): Promise<readonly CreatorSummary[]>;
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

/**
 * Storage of the planning, implemented in `infra/` with `withTenantMember`: the policies decide what each scope
 * reads, and the rules that need stored rows (a member's status, a shift under way) run in the same transaction.
 * The exclusion constraints decide overlaps; the store turns their violation into the module's conflict, with the
 * shift in the way.
 */
export interface PlanningStore {
  /** Any team scope; `null` until the owner saves them. */
  settings(actor: UserId): Promise<SchedulingSettings | null>;
  /** Owner. */
  saveSettings(actor: Actor, settings: SchedulingSettings): Promise<void>;
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
  /** The settings, for the job (no member behind it). */
  settingsUnscoped(): Promise<SchedulingSettings | null>;
  /** The templates running on `today` (a calendar day in the grid's zone), for the job. */
  runningTemplatesUnscoped(today: string): Promise<ShiftTemplateId[]>;
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

/** What the job logs through; the composition root passes the job's own logger. */
export interface JobLogger {
  warn(object: object, message: string): void;
}
