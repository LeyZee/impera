import { describe, expect, it } from 'vitest';

import { revealSessionShape, revealTokenExpiry } from '../session';

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
  it('reads the creator a Reveal session speaks for and the member it belongs to', () => {
    expect(revealSessionShape(JSON.stringify(session))).toEqual({
      owner: 'model-test-a',
      member: session.userId,
      expiresAt: null,
      memberInToken: false,
    });
  });

  it('reads the expiry of a JWT-shaped bearer, and nothing else of it', () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_794_870_000, userId: 'user-bot-test' })).toString(
      'base64url',
    );
    const bearer = `eyJhbGciOiJIUzI1NiJ9.${payload}.invented-signature`;
    expect(revealSessionShape(JSON.stringify({ ...session, bearer }))?.expiresAt).toEqual(
      new Date(1_794_870_000_000),
    );
  });

  it('refuses a token that names another member than the session says (ADR 0147 § 4)', () => {
    const claims = (userId: string) =>
      `aaaa.${Buffer.from(JSON.stringify({ exp: 1_794_870_000, userId })).toString('base64url')}.cccc`;
    expect(revealSessionShape(JSON.stringify({ ...session, bearer: claims('user-bot-test') }))).toMatchObject(
      { memberInToken: true },
    );
    expect(revealSessionShape(JSON.stringify({ ...session, bearer: claims('user-owner-test') }))).toBeNull();
  });

  it.each([
    ['no dots', 'invented-bearer-0123456789'],
    ['a payload that is not JSON', 'aaaa.bm90LWpzb24.cccc'],
    ['no exp', `aaaa.${Buffer.from('{"iat":1}').toString('base64url')}.cccc`],
  ])('reads no expiry from %s', (_label, bearer) => {
    expect(revealTokenExpiry(bearer)).toBeNull();
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
