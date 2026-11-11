import type { ConversationState, DraftStatus } from '@impera/contracts';

/** Default wait after the last fan message before answering, so that three messages get one answer. */
export const DEFAULT_DEBOUNCE_SECONDS = 45;
const MIN_DEBOUNCE_SECONDS = 30;
const MAX_DEBOUNCE_SECONDS = 90;

/** The persona may set its own pace; it stays within the bounds message-flow.md §1 gives. */
export function debounceFor(persona?: { readonly debounceSeconds?: number }): number {
  const wanted = persona?.debounceSeconds ?? DEFAULT_DEBOUNCE_SECONDS;
  return Math.min(MAX_DEBOUNCE_SECONDS, Math.max(MIN_DEBOUNCE_SECONDS, wanted));
}

/** Her answers to one fan in an hour at her usual pace; past them she slows down, and never stops. */
export const REPLIES_PER_HOUR_BEFORE_SLOWING = 60;
/** Slowed down: one answer every three minutes. */
export const SLOWED_REPLY_SECONDS = 180;

/**
 * When the answer to his message is written: after the usual wait, so that a burst gets one answer; and, once she has
 * answered him 60 times within the hour, not before three minutes after her last answer. The slow pace is counted
 * from her last answer, not from his last message: a fan who never stops writing still gets his answer.
 */
export function respondAt(input: {
  readonly now: Date;
  readonly repliesLastHour: number;
  readonly lastReplyAt: Date | null;
}): Date {
  const usual = input.now.getTime() + debounceFor() * 1_000;
  if (input.repliesLastHour < REPLIES_PER_HOUR_BEFORE_SLOWING || input.lastReplyAt === null) {
    return new Date(usual);
  }
  return new Date(Math.max(usual, input.lastReplyAt.getTime() + SLOWED_REPLY_SECONDS * 1_000));
}

/** What one fan message keeps of its words and of its media: beyond, it is cut, never refused. */
export const FAN_TEXT_MAX_CHARS = 4_000;
export const FAN_MEDIA_MAX = 20;

/** His words, cut at 4 000 characters without splitting a character in two. */
export function boundFanText(text: string): string {
  if (text.length <= FAN_TEXT_MAX_CHARS) return text;
  const cut = text.slice(0, FAN_TEXT_MAX_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
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

/**
 * The fan's last message has no answer yet: nothing left after it. A follow-up (P3-10) answers no message, so a
 * conversation whose last word is hers never counts as waiting.
 */
export function fanAwaitsAnswer(conversation: {
  readonly lastInboundAt: Date | null;
  readonly lastOutboundAt: Date | null;
}): boolean {
  const { lastInboundAt, lastOutboundAt } = conversation;
  return lastInboundAt !== null && (lastOutboundAt === null || lastOutboundAt < lastInboundAt);
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
