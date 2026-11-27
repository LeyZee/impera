import type { ChannelGestureRefusalKind, ChannelPostGesture, ChannelPostState } from '@impera/contracts';

/**
 * The review of her channel's week (ADR 0162 § 3) and what comes after a post went out (§ 6): who may still touch a
 * post, what a gesture does to it, the engagement mark of a post, and which old post may go out again. Pure.
 */

export interface ReviewedPost {
  readonly state: ChannelPostState;
  readonly at: Date;
  readonly kind: 'text' | 'photo' | 'poll' | 'main';
}

/** A gesture is allowed up to the post's hour, on a post still waiting (§ 3.3, § 3.7). */
export function gestureRefusal(
  post: ReviewedPost,
  gesture: ChannelPostGesture,
  now: Date,
): ChannelGestureRefusalKind | null {
  if (post.state !== 'planned') return 'not_planned';
  if (now >= post.at) return 'too_late';
  // A poll has no text of its own to edit by hand: it is rewritten instead.
  if (gesture.gesture === 'edit' && post.kind === 'poll') return 'not_a_text';
  return null;
}

/** Whether a gesture locks the post against the code's rewriting (§ 3.6): every hand on it but a removal. */
export const locksPost = (gesture: ChannelPostGesture): boolean => gesture.gesture !== 'remove';

/** ADR 0162 § 6.1: reactions under the post at 48 h, and for a main post the link's clicks in the 3 hours after. */
/** A click says more than a reaction: someone left Telegram to come and talk to her. */
const CLICK_WEIGHT = 3;

export function engagementMark(reactions: number, clicks: number | null): number {
  return reactions + CLICK_WEIGHT * (clicks ?? 0);
}

/** ADR 0162 § 6.2: an old media goes out again only after 60 days, once a week at most, the best one first. */
const REPOST_AFTER_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PastMedia {
  readonly mediaId: string;
  /** When it last went out on the channel. */
  readonly lastSentAt: Date;
  readonly mark: number;
}

export function repostChoice(
  past: readonly PastMedia[],
  repostsThisWeek: number,
  now: Date,
): PastMedia | null {
  if (repostsThisWeek >= 1) return null;
  const old = past.filter(
    (media) => now.getTime() - media.lastSentAt.getTime() >= REPOST_AFTER_DAYS * DAY_MS,
  );
  return (
    [...old].sort((a, b) => b.mark - a.mark || a.lastSentAt.getTime() - b.lastSentAt.getTime())[0] ?? null
  );
}

/** The key that makes one post go out once (ADR 0080 § 1.4): its id, never sent twice even when a job replays. */
export const sendKeyOf = (postId: string): string => `telegram_channel_post:${postId}`;
