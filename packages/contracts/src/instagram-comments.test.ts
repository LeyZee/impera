import { describe, expect, it } from 'vitest';

import {
  CommentOutcomeSchema,
  CommentPromptInputSchema,
  META_COMMENT_SCOPES,
  unexpectedMetaScopes,
} from './instagram-comments';

describe('the rights asked of Meta for comments', () => {
  it('never hold a messaging right', () => {
    for (const scope of META_COMMENT_SCOPES) expect(scope).not.toMatch(/messag/iu);
  });

  it('refuse a right that was not asked for', () => {
    expect(unexpectedMetaScopes([...META_COMMENT_SCOPES])).toEqual([]);
    expect(unexpectedMetaScopes(['instagram_business_basic', 'instagram_business_manage_messages'])).toEqual([
      'instagram_business_manage_messages',
    ]);
    expect(unexpectedMetaScopes(['instagram_business_content_publish'])).toHaveLength(1);
  });
});

describe('the block the model reads', () => {
  const input = {
    comment: 'Trop belle cette lumière',
    mediaKind: 'reel',
    caption: 'Dimanche matin',
    postAgeHours: 3,
    repliesToHer: false,
    authorCommentedBefore: true,
    mayAsk: true,
  };

  it('accepts what the code prepares', () => {
    expect(CommentPromptInputSchema.safeParse(input).success).toBe(true);
  });

  it('has no field for a name or a handle', () => {
    expect(CommentPromptInputSchema.safeParse({ ...input, username: 'someone' }).success).toBe(false);
    expect(CommentPromptInputSchema.safeParse({ ...input, authorName: 'Someone' }).success).toBe(false);
  });

  it('refuses a comment longer than the cut', () => {
    expect(CommentPromptInputSchema.safeParse({ ...input, comment: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('comment_outcome', () => {
  it('knows a reply, a skip, a hide and a handoff', () => {
    expect(
      CommentOutcomeSchema.safeParse({ kind: 'reply', text: 'Merci 🌸', reason: 'compliment' }).success,
    ).toBe(true);
    expect(CommentOutcomeSchema.safeParse({ kind: 'skip', reason: 'rien à dire' }).success).toBe(true);
    expect(CommentOutcomeSchema.safeParse({ kind: 'hide', reason: 'insulte' }).success).toBe(true);
    expect(
      CommentOutcomeSchema.safeParse({ kind: 'handoff', handoff: 'price_question', reason: 'tarif' }).success,
    ).toBe(true);
  });

  it('has no deletion: the model never deletes', () => {
    expect(CommentOutcomeSchema.safeParse({ kind: 'delete', reason: 'spam' }).success).toBe(false);
  });

  it('bounds a reply to 150 characters', () => {
    expect(CommentOutcomeSchema.safeParse({ kind: 'reply', text: 'a'.repeat(151), reason: '' }).success).toBe(
      false,
    );
  });
});
