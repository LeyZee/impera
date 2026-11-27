import type { InstagramCommentRef, InstagramMediaRef, ReceivedComment } from '@impera/contracts';
import { InstagramCommentRefSchema } from '@impera/contracts';

import {
  InstagramRefusal,
  type InstagramCommentCapabilities,
  type InstagramCommentsPort,
  type InstagramRefusalKind,
} from '../../../instagram-comments';

const ALL: InstagramCommentCapabilities = { read: true, reply: true, hide: true, unhide: true, delete: true };

type Action = 'listComments' | 'reply' | 'hide' | 'unhide' | 'delete';

/**
 * Instagram's comments in memory (ADR 0122): the comments a test seeds under her posts, the replies posted, what is
 * hidden or deleted, and Meta's refusals on demand. Invented data only: no test gives it a real handle nor a real
 * comment. Like the port, it cannot comment elsewhere nor send a private message.
 */
export class FakeInstagram implements InstagramCommentsPort {
  readonly capabilities: InstagramCommentCapabilities;
  private readonly comments = new Map<InstagramCommentRef, ReceivedComment>();
  private readonly replies = new Map<string, InstagramCommentRef>();
  private refusal: InstagramRefusalKind | null = null;
  private nextReply = 1;
  /** The calls made, in order: a test reads them to check what was asked of Meta. */
  readonly calls: { readonly action: Action; readonly target: string }[] = [];
  /** The replies posted, in order, with the comment each one answers. */
  readonly posted: {
    readonly ref: InstagramCommentRef;
    readonly under: InstagramCommentRef;
    readonly text: string;
  }[] = [];

  constructor(capabilities: Partial<InstagramCommentCapabilities> = {}) {
    this.capabilities = { ...ALL, ...capabilities };
  }

  seed(...comments: readonly ReceivedComment[]): this {
    for (const comment of comments) this.comments.set(comment.ref, comment);
    return this;
  }

  /** Every call is refused with `kind` until `restore()`. */
  refuseWith(kind: InstagramRefusalKind): this {
    this.refusal = kind;
    return this;
  }

  restore(): this {
    this.refusal = null;
    return this;
  }

  /** A comment as it stands now, null once deleted. */
  comment(ref: InstagramCommentRef): ReceivedComment | null {
    return this.comments.get(ref) ?? null;
  }

  listComments(media: InstagramMediaRef): Promise<readonly ReceivedComment[]> {
    return this.run('listComments', media, 'read', () =>
      [...this.comments.values()].filter((comment) => comment.mediaRef === media),
    );
  }

  reply(
    comment: InstagramCommentRef,
    text: string,
    idempotencyKey: string,
  ): Promise<{ readonly ref: InstagramCommentRef }> {
    return this.run('reply', comment, 'reply', () => {
      const already = this.replies.get(idempotencyKey);
      if (already !== undefined) return { ref: already };
      this.existing(comment);
      const ref = InstagramCommentRefSchema.parse(`fake-reply-${String(this.nextReply)}`);
      this.nextReply += 1;
      this.replies.set(idempotencyKey, ref);
      this.posted.push({ ref, under: comment, text });
      return { ref };
    });
  }

  hide(comment: InstagramCommentRef): Promise<void> {
    return this.run('hide', comment, 'hide', () => {
      this.comments.set(comment, { ...this.existing(comment), hidden: true });
    });
  }

  unhide(comment: InstagramCommentRef): Promise<void> {
    return this.run('unhide', comment, 'unhide', () => {
      this.comments.set(comment, { ...this.existing(comment), hidden: false });
    });
  }

  delete(comment: InstagramCommentRef): Promise<void> {
    return this.run('delete', comment, 'delete', () => {
      this.existing(comment);
      this.comments.delete(comment);
    });
  }

  private existing(ref: InstagramCommentRef): ReceivedComment {
    const comment = this.comments.get(ref);
    if (comment === undefined) throw new InstagramRefusal('comment_gone');
    return comment;
  }

  private run<T>(
    action: Action,
    target: string,
    capability: keyof InstagramCommentCapabilities,
    act: () => T,
  ): Promise<T> {
    this.calls.push({ action, target });
    try {
      if (!this.capabilities[capability]) throw new InstagramRefusal('missing_permission');
      if (this.refusal !== null) throw new InstagramRefusal(this.refusal);
      return Promise.resolve(act());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
