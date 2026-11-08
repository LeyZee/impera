import { describe, expect, it } from 'vitest';

import { openConversationOf } from './open-conversation';

describe('the Reveal conversation open in the tab (ADR 0086 § 2)', () => {
  it.each([
    ['https://app.reveal.me/messages/c-41ab9', 'c-41ab9'],
    ['https://reveal.me/chat/8812?tab=ppv', '8812'],
    ['https://app.reveal.me/inbox?conversation=c-77', 'c-77'],
    ['https://app.reveal.me/messages', null],
    ['https://app.reveal.me/settings', null],
    // Not Reveal, or not over HTTPS: nothing is followed.
    ['http://app.reveal.me/messages/c-41ab9', null],
    ['https://notreveal.me/messages/c-41ab9', null],
    ['http://localhost:5173/suivi?conversation=c-1', null],
    // An id the contract refuses is no conversation.
    ['https://app.reveal.me/messages/%3Cb%3E', null],
    [undefined, null],
  ])('%s → %s', (url, id) => {
    expect(openConversationOf(url)).toBe(id);
  });
});
