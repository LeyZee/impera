import type {
  CreatorId,
  ToAgencyMessage,
  ToAgencyMessages,
  NewToAgencyMessageBody,
  WaitingToAgencyMessage,
} from '@impera/contracts';

/** `creator_messages`: hers to write and read in her own account, her team's to read, her owner's to answer. */
export interface MessageStore {
  /** Her latest messages, the newest first. */
  mine(userId: string): Promise<ToAgencyMessages>;
  /** Her message written once; the same id again answers it as it is. */
  write(userId: string, body: NewToAgencyMessageBody): Promise<ToAgencyMessage>;
  /** Her messages not answered yet, read by her owner or an active manager; anyone else is refused. */
  waiting(creatorId: CreatorId, userId: string): Promise<readonly WaitingToAgencyMessage[]>;
  /** The owner's answer, once (`answerOutcome`); anyone else is refused. */
  answer(
    creatorId: CreatorId,
    userId: string,
    id: string,
    answer: string,
    now: Date,
  ): Promise<ToAgencyMessage>;
}

/** Someone a notification goes to, in their own time zone (their quiet hours and their day). */
export interface Phone {
  readonly userId: string;
  readonly timeZone: string;
}

/** Who hears of « Écrire à l'agence », read by the service role: never more than the names of the accounts. */
export interface MessagePhones {
  /** Her name, her owners and the active managers who work on her. */
  agency(creatorId: CreatorId): Promise<{ readonly creatorName: string; readonly phones: readonly Phone[] }>;
  /** Her own accounts, in her time zone. */
  hers(creatorId: CreatorId): Promise<readonly Phone[]>;
}
