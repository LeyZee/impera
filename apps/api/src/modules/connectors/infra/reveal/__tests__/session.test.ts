import { describe, expect, it } from 'vitest';

import { revealSessionShape } from '../session';

/** All invented (CLAUDE.md): never a real token, member or model. */
const session = {
  v: 1,
  bearer: 'invented-bearer-0123456789',
  userId: 'user-bot-test',
  modelId: 'model-test-a',
  userAgent: 'Mozilla/5.0 (test)',
  capturedAt: '2026-11-11T10:00:00.000Z',
};

describe('revealSessionShape', () => {
  it('reads the creator a Reveal session speaks for', () => {
    expect(revealSessionShape(JSON.stringify(session))).toEqual({ owner: 'model-test-a' });
  });

  it.each([
    ['not JSON', 'reveal-session'],
    ['another version', JSON.stringify({ ...session, v: 2 })],
    ['no model', JSON.stringify({ ...session, modelId: '' })],
    ['a short bearer', JSON.stringify({ ...session, bearer: 'short' })],
    ['an unknown field', JSON.stringify({ ...session, cookie: 'x' })],
    ['a date that is not one', JSON.stringify({ ...session, capturedAt: 'hier' })],
  ])('refuses %s', (_label, raw) => {
    expect(revealSessionShape(raw)).toBeNull();
  });
});
