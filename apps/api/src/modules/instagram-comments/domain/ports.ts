import type { InstagramCommentRef, InstagramMediaRef, ReceivedComment } from '@impera/contracts';

/**
 * What an Instagram account lets us do to the comments under its own posts (ADR 0122 § 1), one flag a capability:
 * they follow the rights Meta really granted and the creator's agreement, never a setting. The port has no method
 * that comments elsewhere, likes, follows or sends a private message, so no caller can.
 */
export interface InstagramCommentCapabilities {
  readonly read: boolean;
  readonly reply: boolean;
  readonly hide: boolean;
  readonly unhide: boolean;
  readonly delete: boolean;
}

/** Why Meta refused: a right is missing, the rate limit is reached, or the comment is no longer there. */
export type InstagramRefusalKind = 'missing_permission' | 'rate_limited' | 'comment_gone';

/** A refusal of Meta's, by its kind. An adapter throws it; it never answers with a guess. */
export class InstagramRefusal extends Error {
  constructor(readonly kind: InstagramRefusalKind) {
    super(`Instagram refused: ${kind}`);
    this.name = 'InstagramRefusal';
  }
}

export interface InstagramCommentsPort {
  readonly capabilities: InstagramCommentCapabilities;
  /** The comments and replies under one of her posts, the author already opaque. */
  listComments(media: InstagramMediaRef): Promise<readonly ReceivedComment[]>;
  /** A public reply under `comment`. The same `idempotencyKey` never posts twice. */
  reply(
    comment: InstagramCommentRef,
    text: string,
    idempotencyKey: string,
  ): Promise<{ readonly ref: InstagramCommentRef }>;
  hide(comment: InstagramCommentRef): Promise<void>;
  unhide(comment: InstagramCommentRef): Promise<void>;
  /** Irreversible: the owner's gesture only (§ 3), never the model's nor a job's. */
  delete(comment: InstagramCommentRef): Promise<void>;
}
