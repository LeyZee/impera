import type {
  CreatorAbsence,
  CreatorId,
  CreatorLimits,
  CreatorStop,
  NewAbsenceBody,
  NewStopBody,
} from '@impera/contracts';

/** Her absences and what she no longer does (Charles, 21/11): hers to write in her own account, her team's to read. */
export interface LimitStore {
  /** Hers, read in her own account. */
  mine(userId: string, now: Date): Promise<CreatorLimits>;
  /** Her creator's, read once the route allowed the reader (`withTenant`). */
  ofCreator(creatorId: CreatorId, now: Date): Promise<CreatorLimits>;
  /** Written once: the same id again returns what was written. Refused before today in her zone. */
  tellAbsence(userId: string, body: NewAbsenceBody, now: Date): Promise<CreatorAbsence>;
  /** Taken back, kept; again changes nothing. */
  cancelAbsence(userId: string, id: string): Promise<void>;
  tellStop(userId: string, body: NewStopBody): Promise<CreatorStop>;
  withdrawStop(userId: string, id: string): Promise<void>;
}
