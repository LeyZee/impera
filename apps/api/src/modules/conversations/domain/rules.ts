import type { ConversationState, DraftStatus } from '@nirvana/contracts';

/** Default wait after the last fan message before answering, so that three messages get one answer. */
export const DEFAULT_DEBOUNCE_SECONDS = 45;
const MIN_DEBOUNCE_SECONDS = 30;
const MAX_DEBOUNCE_SECONDS = 90;

/** The persona may set its own pace; it stays within the bounds message-flow.md §1 gives. */
export function debounceFor(persona?: { readonly debounceSeconds?: number }): number {
  const wanted = persona?.debounceSeconds ?? DEFAULT_DEBOUNCE_SECONDS;
  return Math.min(MAX_DEBOUNCE_SECONDS, Math.max(MIN_DEBOUNCE_SECONDS, wanted));
}

export interface SendCheck {
  readonly draftStatus: DraftStatus;
  readonly draftCreatedAt: Date;
  readonly conversationState: ConversationState;
  /** The latest fan message, if any. */
  readonly lastInboundAt: Date | null;
}

/**
 * Invariant 3 of message-flow.md §8: a draft leaves only if it was approved, the conversation is sending it, and
 * no fan message arrived after it was written (the answer would ignore it).
 */
export function canSend(check: SendCheck): boolean {
  const isApproved = check.draftStatus === 'approved' || check.draftStatus === 'edited';
  const isStale = check.lastInboundAt !== null && check.lastInboundAt > check.draftCreatedAt;
  return isApproved && check.conversationState === 'sending' && !isStale;
}

/** One key per bubble, so a retried send never posts the same bubble twice (invariant 4). */
export function bubbleIdempotencyKey(draftId: string, index: number): string {
  return `${draftId}:${String(index)}`;
}

const HOUR_MS = 3_600_000;

/** A follow-up due: which delay of the persona, and when. */
export interface FollowUpSlot {
  readonly step: number;
  readonly runAt: Date;
}

/**
 * The next follow-up after her message reached him (P3-10): the first delay of `persona.follow_ups`, counted from his
 * last message (`anchor`), that is still ahead. None past the last delay, nor without any message of his: she never
 * writes first.
 */
export function nextFollowUp(
  anchor: Date | null,
  delaysHours: readonly number[],
  now: Date,
): FollowUpSlot | null {
  if (anchor === null) return null;
  const step = delaysHours.findIndex((hours) => anchor.getTime() + hours * HOUR_MS > now.getTime());
  const hours = delaysHours[step];
  return hours === undefined ? null : { step, runAt: new Date(anchor.getTime() + hours * HOUR_MS) };
}

/** One follow-up draft per silence and per step: a replayed job cannot write a second one. */
export function followUpIdempotencyKey(conversationId: string, anchor: Date, step: number): string {
  return `follow_up:${conversationId}:${String(anchor.getTime())}:${String(step)}`;
}

const MINUTE_MS = 60_000;
const DEFERRED_RESPOND_MIN_MINUTES = 5;
const DEFERRED_RESPOND_MAX_MINUTES = 25;

/**
 * When her deferred answer is tried again (P3-11), or `null` when the engine asked for none or out of bounds: not
 * before 5 minutes, and never after 25, so the « À traiter » net of 30 minutes always comes after it.
 */
export function deferredRespondAt(retryAt: Date | undefined, now: Date): Date | null {
  if (retryAt === undefined) return null;
  const ahead = retryAt.getTime() - now.getTime();
  return ahead >= DEFERRED_RESPOND_MIN_MINUTES * MINUTE_MS &&
    ahead <= DEFERRED_RESPOND_MAX_MINUTES * MINUTE_MS
    ? retryAt
    : null;
}

/**
 * How far ahead the engine may put a follow-up off (her night, or her next reply slot, P3-14): a week of slots and a
 * day of margin. Beyond, it is cancelled.
 */
const FOLLOW_UP_RETRY_MAX_HOURS = 8 * 24;

/** The time a follow-up put off goes out again, or `null` when the engine asked for none or for too far ahead. */
export function followUpRetry(retryAt: Date | undefined, now: Date): Date | null {
  if (retryAt === undefined) return null;
  const ahead = retryAt.getTime() - now.getTime();
  return ahead > 0 && ahead <= FOLLOW_UP_RETRY_MAX_HOURS * HOUR_MS ? retryAt : null;
}
