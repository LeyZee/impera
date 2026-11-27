import { describe, expect, it } from 'vitest';

import { mayRemoveChat } from '../membership';
import { describeTelegramError, describeTokenCheckFailure } from '../messages';
import { botIdOfToken } from '../token';

describe('token and messages', () => {
  it('reads the bot id from a well-shaped token only', () => {
    expect(botIdOfToken(` 1234567:AA${'FAKE'.repeat(8)}00 `)).toBe('1234567');
    expect(botIdOfToken('sk-not-a-bot-token')).toBeNull();
    expect(botIdOfToken('1234567:short')).toBeNull();
  });

  it('has one French sentence per error, never a code', () => {
    expect(describeTelegramError('chat_unreachable')).toBe(
      'Le bot ne peut plus écrire dans ce canal. Rajoute-le au canal, puis réessaie.',
    );
    expect(describeTelegramError('unreachable')).not.toMatch(/\d{3}/);
  });
});

describe('mayRemoveChat (REG-28)', () => {
  it('lets go of a group the bot left or was banned from, never of one it sits in', () => {
    expect(mayRemoveChat('left')).toBe(true);
    expect(mayRemoveChat('kicked')).toBe(true);
    expect(mayRemoveChat('member')).toBe(false);
  });
});

describe('a pasted token that could not be checked (recette 05/11, PRO-07)', () => {
  it('says nothing was kept, never that Impera retries by itself', () => {
    const unchecked = describeTokenCheckFailure('unreachable');
    expect(unchecked.kind).toBe('unreachable');
    expect(unchecked.message).toContain('le jeton n’a pas pu être vérifié');
    expect(unchecked.message).not.toContain('réessaie tout seul');
    expect(describeTokenCheckFailure('unauthorized')).toEqual({
      kind: 'token_refused',
      message: describeTelegramError('token_refused'),
    });
  });
});
