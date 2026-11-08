import type {
  AcceptSuggestionBody,
  AgencySuggestion,
  AgencySuggestionList,
  AvailabilityView,
  CreateAvailabilityBody,
  CreateCreatorTaskBody,
  CreateSuggestionBody,
  CreatorAgenda,
  CreatorAgendaQuery,
  CreatorStreakResult,
  CreatorTask,
  CreatorTicksBody,
  CreatorTicksResult,
  DeclineSuggestionBody,
  IdeaDropCategory,
  ReelBrief,
  UpdateCreatorTaskBody,
} from '@impera/contracts';

/**
 * Her agenda, read and written in her own account (`withCreatorAccount`): every method takes her account, never her
 * creator, which the server reads in it. Each refusal throws its `DomainError` (`errors.ts`).
 */
export interface CreatorAgendaStore {
  agenda(userId: string, query: CreatorAgendaQuery, now: Date): Promise<CreatorAgenda>;
  createTask(userId: string, body: CreateCreatorTaskBody): Promise<CreatorTask>;
  updateTask(userId: string, taskId: string, body: UpdateCreatorTaskBody): Promise<CreatorTask>;
  archiveTask(userId: string, taskId: string): Promise<void>;
  tick(userId: string, body: CreatorTicksBody, now: Date): Promise<CreatorTicksResult>;
  untick(userId: string, taskId: string, day: string, now: Date): Promise<CreatorStreakResult>;
  createAvailability(userId: string, body: CreateAvailabilityBody): Promise<AvailabilityView>;
  archiveAvailability(userId: string, availabilityId: string): Promise<void>;
  accept(userId: string, suggestionId: string, body: AcceptSuggestionBody, now: Date): Promise<CreatorTask>;
  decline(userId: string, suggestionId: string, body: DeclineSuggestionBody, now: Date): Promise<void>;
}

/** The agency's side (`withTenantMember`): the owner and an active manager suggest and read what she did. */
export interface AgencySuggestionStore {
  /**
   * `check` runs once the member may suggest and before anything is written: the guards of a shoot for a drop category
   * (ADR 0082 § 3), which throw to refuse it. A replay of a suggestion already written is not read again.
   */
  create(
    creatorId: string,
    userId: string,
    body: CreateSuggestionBody,
    now: Date,
    check: () => Promise<void>,
  ): Promise<AgencySuggestion>;
  list(creatorId: string, userId: string, week: string): Promise<AgencySuggestionList>;
  /** A shoot of hers with its sheet, in the first room of her dispos or undated (VEI-01 d). */
  suggestShoot(
    creatorId: string,
    userId: string,
    shoot: ShootSuggestion,
    now: Date,
  ): Promise<AgencySuggestion>;
}

/**
 * A shoot the agency suggests with its sheet (VEI-01 d: an idea validated in « Idées du jour »): timed, `minutes` long,
 * in her first room. Its id is the caller's, so that the same suggestion replayed answers itself.
 */
export interface ShootSuggestion {
  readonly id: string;
  readonly title: string;
  readonly purpose: string | null;
  readonly shootBrief: string;
  /** Its reel sheet, for a Reel Insta (ADR 0082 § 3). */
  readonly reelBrief: ReelBrief | null;
  readonly minutes: number;
}

/** A task of her reminder, read by the job (CR-05 lot b3): null once removed. */
export interface ReminderSource {
  reminderOf(taskId: string): Promise<{
    readonly task: CreatorTask;
    readonly timeZone: string;
    /** Her own accounts: told each on its devices, under its quiet hours and its daily cap. */
    readonly accounts: readonly string[];
  } | null>;
}

/** A shoot the agency suggests by hand for a drop category, as the guards read it (ADR 0082 § 3). */
export interface GuardedShoot {
  readonly title: string;
  readonly purpose: string | null;
  readonly dropCategory: IdeaDropCategory;
  readonly reelBrief: ReelBrief | null;
}

/** What such a shoot breaks: the reading of the trend watch's guards, with the field at fault. */
export interface ShootGuardFault {
  readonly reason: 'no_persona' | 'limit' | 'nudity' | 'instagram_guard';
  /** `title`, `purpose`, `hook`, `onScreen`, `shots` or `ending`; `null` without a persona. */
  readonly field: string | null;
}

/**
 * The guards of an idea, handed by the composition root (`trends` reads them, with her persona's limits): the agenda
 * imports no other module.
 */
export type ShootGuard = (creatorId: string, shoot: GuardedShoot) => Promise<ShootGuardFault | null>;
