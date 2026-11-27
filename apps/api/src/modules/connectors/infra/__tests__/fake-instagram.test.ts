import {
  CommentAuthorKeySchema,
  InstagramCommentRefSchema,
  InstagramMediaRefSchema,
  type ReceivedComment,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { InstagramRefusal } from '../../../instagram-comments';
import { FakeInstagram } from '../fake/FakeInstagram';

const media = InstagramMediaRefSchema.parse('média-inventé-1');
const otherMedia = InstagramMediaRefSchema.parse('média-inventé-2');
const first = InstagramCommentRefSchema.parse('commentaire-inventé-1');
const second = InstagramCommentRefSchema.parse('commentaire-inventé-2');
const gone = InstagramCommentRefSchema.parse('commentaire-disparu');

function comment(ref: typeof first, mediaRef = media): ReceivedComment {
  return {
    ref,
    mediaRef,
    parentRef: null,
    author: CommentAuthorKeySchema.parse('a'.repeat(64)),
    fromOwnAccount: false,
    text: 'Commentaire inventé',
    hidden: false,
    at: '2026-11-19T10:00:00.000Z',
  };
}

const refusal = async (attempt: Promise<unknown>) => {
  const error: unknown = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof InstagramRefusal ? error.kind : null;
};

describe('FakeInstagram, the comments (ADR 0122)', () => {
  it('lists the comments of one post only', async () => {
    const fake = new FakeInstagram().seed(comment(first), comment(second, otherMedia));
    expect((await fake.listComments(media)).map((c) => c.ref)).toEqual([first]);
  });

  it('posts a reply once for one idempotence key', async () => {
    const fake = new FakeInstagram().seed(comment(first));
    const one = await fake.reply(first, 'Merci 🌸', 'clé-1');
    const again = await fake.reply(first, 'Merci 🌸', 'clé-1');
    expect(again.ref).toBe(one.ref);
    expect(fake.posted).toHaveLength(1);
  });

  it('hides, shows again and deletes a comment', async () => {
    const fake = new FakeInstagram().seed(comment(first));
    await fake.hide(first);
    expect(fake.comment(first)?.hidden).toBe(true);
    await fake.unhide(first);
    expect(fake.comment(first)?.hidden).toBe(false);
    await fake.delete(first);
    expect(fake.comment(first)).toBeNull();
  });

  it('refuses what the account has no right to do', async () => {
    const fake = new FakeInstagram({ reply: false, hide: false, delete: false }).seed(comment(first));
    expect(await refusal(fake.reply(first, 'Merci', 'clé-2'))).toBe('missing_permission');
    expect(await refusal(fake.hide(first))).toBe('missing_permission');
    expect(await refusal(fake.delete(first))).toBe('missing_permission');
    expect(fake.posted).toHaveLength(0);
  });

  it('refuses under a rate limit until restored', async () => {
    const fake = new FakeInstagram().seed(comment(first)).refuseWith('rate_limited');
    expect(await refusal(fake.listComments(media))).toBe('rate_limited');
    fake.restore();
    expect(await fake.listComments(media)).toHaveLength(1);
  });

  it('refuses a comment that is no longer there', async () => {
    const fake = new FakeInstagram();
    expect(await refusal(fake.reply(gone, 'Merci', 'clé-3'))).toBe('comment_gone');
    expect(await refusal(fake.hide(gone))).toBe('comment_gone');
  });
});
