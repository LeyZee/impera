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
  create(creatorId: string, userId: string, body: CreateSuggestionBody, now: Date): Promise<AgencySuggestion>;
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
  readonly minutes: number;
}
