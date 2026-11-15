import { describe, expect, it } from 'vitest';

import { toMessages } from './conversation-messages';

describe('toMessages', () => {
  it('writes the time that passed before his message, outside his block (audit du naturel, A2)', () => {
    const messages = toMessages([
      { from: 'creator', text: 'Dors bien toi' },
      { from: 'fan', text: 'salut', timeNote: '4 jours plus tard, samedi, 14 h' },
    ]);
    expect(messages[1]).toEqual({
      role: 'user',
      content: '[4 jours plus tard, samedi, 14 h]\n<fan_message>\nsalut\n</fan_message>',
    });
  });

  it('adds nothing to a turn without a note, and never to hers', () => {
    const messages = toMessages([
      { from: 'fan', text: 'coucou' },
      { from: 'creator', text: 'hello', timeNote: 'ignored' },
    ]);
    expect(messages[0]?.content).toBe('<fan_message>\ncoucou\n</fan_message>');
    expect(messages[1]).toEqual({ role: 'assistant', content: 'hello' });
  });
});
