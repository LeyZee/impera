import { CommentPromptInputSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { captionForPrompt, commentForPrompt, outcomeWithoutModel, promptInputOf } from '../prompt-input';

describe('what the code prepares for the model (ADR 0122 § 2)', () => {
  it('removes the handles of third parties from a comment, full-width forms too', () => {
    expect(commentForPrompt('Regarde ça @quelquun et ＠autre.compte !')).toBe('Regarde ça et !');
  });

  it('cuts a comment to 500 characters and a caption to 300', () => {
    expect(commentForPrompt('é'.repeat(900))).toHaveLength(500);
    expect(captionForPrompt('é'.repeat(900))).toHaveLength(300);
    expect(commentForPrompt(`${'a'.repeat(499)}🌸`)).toBe('a'.repeat(499));
  });

  it('cleans her caption of its links and mentions', () => {
    expect(captionForPrompt('Dimanche matin avec @uneamie\nhttps://exemple.test/page www.exemple.test')).toBe(
      'Dimanche matin avec',
    );
  });

  it('builds the strict block, the age of the post in whole hours, never negative', () => {
    const base = {
      text: 'Trop belle cette lumière @quelquun',
      caption: 'Dimanche matin',
      mediaKind: 'reel' as const,
      now: new Date('2026-11-19T12:30:00Z'),
      repliesToHer: false,
      authorCommentedBefore: true,
      mayAsk: false,
    };
    const input = promptInputOf({ ...base, postedAt: new Date('2026-11-19T09:00:00Z') });
    expect(CommentPromptInputSchema.parse(input)).toEqual({
      comment: 'Trop belle cette lumière',
      mediaKind: 'reel',
      caption: 'Dimanche matin',
      postAgeHours: 3,
      repliesToHer: false,
      authorCommentedBefore: true,
      mayAsk: false,
    });
    expect(promptInputOf({ ...base, postedAt: new Date('2026-11-19T13:00:00Z') }).postAgeHours).toBe(0);
  });
});

describe('without a usable answer of the model', () => {
  it('gives no reply over the day’s cap, and hands an invalid output to a human', () => {
    expect(outcomeWithoutModel('budget_reached')).toEqual({ kind: 'skip', reason: 'daily_cap_reached' });
    expect(outcomeWithoutModel('model_failed')).toEqual({
      kind: 'handoff',
      handoff: 'other',
      reason: 'model_failed',
    });
  });
});
