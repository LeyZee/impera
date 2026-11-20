import type { AgencyCreatorWeek, CreatorTask, DropCategory, WeekPlan } from '@impera/contracts';

import type { WeekFacts } from './plan';

/** A creator the job computes a week for: her zone, where her Sunday and her deadline are read. */
interface PlannedCreator {
  readonly creatorId: string;
  readonly timeZone: string;
}

/** What became of a draft the job wrote: new, refreshed on the stock of now, or left alone once validated. */
export type DraftOutcome = 'written' | 'refreshed' | 'validated';

/** `creator_weeks` (ADR 0140 § 13): the job writes drafts, her team reads them, the owner validates. */
export interface WeekDraftStore {
  /** Her creators not archived (admin). */
  creators(): Promise<readonly PlannedCreator[]>;
  /** The draft of `week` written or refreshed (admin); a validated week is never touched. */
  saveDraft(creatorId: string, week: string, plan: WeekPlan, now: Date): Promise<DraftOutcome>;
  /** Her week as her team reads it, `null` when none was computed; a chatter is refused. */
  read(creatorId: string, userId: string, week: string): Promise<AgencyCreatorWeek | null>;
  /**
   * The draft the owner is about to validate, read under his account: refused to anyone but the owner, 404 without a
   * week; a week validated already answers itself with its plan, for a replay to compare.
   */
  forValidation(creatorId: string, userId: string, week: string): Promise<AgencyCreatorWeek>;
  /** The week validated with `plan`, by the owner; validated already, it answers itself. */
  markValidated(
    creatorId: string,
    userId: string,
    week: string,
    plan: WeekPlan,
    now: Date,
  ): Promise<AgencyCreatorWeek>;
}

/**
 * What the week is computed on, from the drops and the agenda, never their tables: on the admin connection for the
 * job, which reads every creator; `arrivals` alone runs in her request, so in her own account.
 */
/** Her figures as read: her last script as an instant, made her day by the week's job in her zone. */
export type WeekFactsRead = Omit<WeekFacts, 'lastScriptOn'> & { readonly lastScriptAt: Date | null };

export interface WeekFactsReader {
  facts(creatorId: string, dueBy: string): Promise<WeekFactsRead>;
  /** The days of her shooting days of the week starting `week`, as she kept them. */
  shootDaysOf(creatorId: string, week: string): Promise<readonly string[]>;
  dispoMinutes(creatorId: string): Promise<ReadonlyMap<number, number>>;
  /**
   * What of her delivery arrived between two instants, and which script requests a drop answers: read in her own
   * account (`userId`, her RLS), never with the service role, since it serves her request.
   */
  arrivals(
    userId: string,
    window: { readonly from: Date; readonly to: Date },
    requestIds: readonly string[],
  ): Promise<{
    readonly byCategory: Readonly<Partial<Record<DropCategory, number>>>;
    readonly answered: ReadonlySet<string>;
  }>;
}

/** Accepting one suggestion of hers by its own rules (ADR 0140 § 27). */
export type AcceptSuggestion = (userId: string, suggestionId: string, now: Date) => Promise<CreatorTask>;
