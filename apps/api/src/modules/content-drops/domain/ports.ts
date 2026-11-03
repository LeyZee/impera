import type {
  ContentDrop,
  ContentRequest,
  CreateContentDropBody,
  CreateContentRequestBody,
  CreatorContent,
  DropCategory,
} from '@impera/contracts';

/**
 * Her content, read and written in her own account (`withCreatorAccount`): every method takes her account, never her
 * creator, which the server reads in it. Each refusal throws its `DomainError` (`errors.ts`).
 */
export interface CreatorContentStore {
  content(userId: string): Promise<CreatorContent>;
  drop(userId: string, body: CreateContentDropBody): Promise<ContentDrop>;
  withdraw(userId: string, dropId: string, now: Date): Promise<void>;
  refuse(userId: string, requestId: string, reason: string | null, now: Date): Promise<void>;
}

/** The agency's side (`withTenantMember`): the owner and an active manager; a chatter is refused before any read. */
export interface AgencyContentStore {
  content(creatorId: string, userId: string): Promise<CreatorContent>;
  drop(creatorId: string, userId: string, body: CreateContentDropBody): Promise<ContentDrop>;
  correct(
    creatorId: string,
    userId: string,
    dropId: string,
    category: DropCategory,
    now: Date,
  ): Promise<ContentDrop>;
  withdraw(creatorId: string, userId: string, dropId: string, now: Date): Promise<void>;
  ask(creatorId: string, userId: string, body: CreateContentRequestBody): Promise<ContentRequest>;
  cancel(creatorId: string, userId: string, requestId: string, now: Date): Promise<void>;
}
