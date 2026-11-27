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
