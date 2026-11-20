import type { CommentOutcome } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  afterGuards,
  beforeModel,
  handoffDelivery,
  hostileCommentAction,
  mayDeleteComment,
  type CommentFacts,
} from '../outcome';

const bounds = { perAuthorPerDay: 2, perThread: 3 };
const facts: CommentFacts = {
  fromOwnAccount: false,
  authorAgeDoubtOpen: false,
  ageDoubtDetected: false,
  distressDetected: false,
  repliesToAuthorToday: 0,
  repliesInThread: 0,
};
const reply: CommentOutcome = { kind: 'reply', text: 'Merci 🌸', reason: 'compliment' };
const refused = [{ code: 'public_explicit', detail: 'sexy' }] as const;

describe('before the model (ADR 0122 § 2 and § 3)', () => {
  it('asks the model for an ordinary comment', () => {
    expect(beforeModel(facts, bounds)).toEqual({ step: 'ask_model' });
  });

  it('ignores a comment of her own account', () => {
    expect(beforeModel({ ...facts, fromOwnAccount: true, distressDetected: true }, bounds)).toEqual({
      step: 'ignore',
    });
  });

  it('hands an age doubt the code detects to a human, without the model', () => {
    expect(beforeModel({ ...facts, ageDoubtDetected: true }, bounds)).toEqual({
      step: 'handoff',
      handoff: 'age_doubt',
    });
  });

  it('mutes an author whose age doubt is open, whatever else he writes', () => {
    expect(beforeModel({ ...facts, authorAgeDoubtOpen: true }, bounds)).toEqual({ step: 'mute' });
  });

  it('hands the distress of an author whose age doubt is open to a human: silence and a relay', () => {
    expect(beforeModel({ ...facts, authorAgeDoubtOpen: true, distressDetected: true }, bounds)).toEqual({
      step: 'handoff',
      handoff: 'distress',
    });
  });

  it('hands a distress to a human, even with a bound reached', () => {
    expect(beforeModel({ ...facts, distressDetected: true, repliesToAuthorToday: 9 }, bounds)).toEqual({
      step: 'handoff',
      handoff: 'distress',
    });
  });

  it('gives no reply once the bound by author or by thread is reached', () => {
    expect(beforeModel({ ...facts, repliesToAuthorToday: 2 }, bounds)).toEqual({ step: 'no_reply' });
    expect(beforeModel({ ...facts, repliesInThread: 3 }, bounds)).toEqual({ step: 'no_reply' });
  });
});

describe('after the guards (§ 3)', () => {
  it('settles a reply the guards let pass', () => {
    expect(afterGuards([{ outcome: reply, violations: [] }], true)).toEqual({
      step: 'settled',
      outcome: reply,
    });
  });

  it('asks for one rewrite of a refused reply', () => {
    expect(afterGuards([{ outcome: reply, violations: refused }], true)).toEqual({
      step: 'rewrite',
      refusedBy: refused,
    });
  });

  it('skips when the rewrite is refused too', () => {
    const attempt = { outcome: reply, violations: refused };
    expect(afterGuards([attempt, attempt], true)).toEqual({
      step: 'settled',
      outcome: { kind: 'skip', reason: 'refused_by_guards' },
    });
  });

  it('keeps a skip, a hide or a handoff as the model gave it', () => {
    const hide: CommentOutcome = { kind: 'hide', reason: 'insulte' };
    expect(afterGuards([{ outcome: hide, violations: [] }], false)).toEqual({
      step: 'settled',
      outcome: hide,
    });
  });

  it('turns a reply into a skip when no reply is allowed', () => {
    expect(afterGuards([{ outcome: reply, violations: [] }], false)).toEqual({
      step: 'settled',
      outcome: { kind: 'skip', reason: 'reply_bound_reached' },
    });
  });
});

describe('hiding, handing over, deleting (§ 3)', () => {
  it('only flags a hostile comment while the hiding switch is off, or the right is missing', () => {
    expect(hostileCommentAction(false, true)).toBe('flag_only');
    expect(hostileCommentAction(true, false)).toBe('flag_only');
    expect(hostileCommentAction(true, true)).toBe('hide');
  });

  it('groups the handoffs beyond the bound, never those for age or distress', () => {
    expect(handoffDelivery('price_question', 2, 3)).toBe('alone');
    expect(handoffDelivery('price_question', 3, 3)).toBe('grouped');
    expect(handoffDelivery('age_doubt', 50, 3)).toBe('alone');
    expect(handoffDelivery('distress', 50, 3)).toBe('alone');
  });

  it('lets the owner alone delete a comment', () => {
    expect(mayDeleteComment({ role: 'owner' })).toBe(true);
    for (const role of ['manager', 'chatter', 'creator', 'service'])
      expect(mayDeleteComment({ role })).toBe(false);
  });
});
