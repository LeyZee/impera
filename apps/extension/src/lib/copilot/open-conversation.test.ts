import { describe, expect, it } from 'vitest';

import { openConversationOf } from './open-conversation';

// Invented ids, in the shape of Reveal's UUIDs.
const MODEL = '00000000-0000-4000-8000-0000000000aa';
const CONVERSATION = '00000000-0000-4000-8000-0000000000c1';
const DASHBOARD = 'https://dashboard.reveal.me';

describe('the Reveal conversation open in the tab (ADR 0086 § 2)', () => {
  it.each([
    // The dashboard's own form, seen on the PC on 2026-11-11.
    [`${DASHBOARD}/models/${MODEL}/conversations/${CONVERSATION}`, CONVERSATION],
    [`${DASHBOARD}/models/${MODEL}/conversations/${CONVERSATION}/`, CONVERSATION],
    [`${DASHBOARD}/models/${MODEL}/conversations/${CONVERSATION}?tab=ppv#bas`, CONVERSATION],
    // The list, or a page further down a conversation, is no conversation open.
    [`${DASHBOARD}/models/${MODEL}/conversations`, null],
    [`${DASHBOARD}/models/${MODEL}/conversations/${CONVERSATION}/stats`, null],
    [`${DASHBOARD}/models/${MODEL}`, null],
    [`${DASHBOARD}/settings/crm-api`, null],
    // Not Reveal, or not over HTTPS: nothing is followed.
    [`http://dashboard.reveal.me/models/${MODEL}/conversations/${CONVERSATION}`, null],
    [`https://notreveal.me/models/${MODEL}/conversations/${CONVERSATION}`, null],
    [`http://localhost:5173/suivi/conversations/${CONVERSATION}`, null],
    // An id the contract refuses, or a broken escape, is no conversation.
    [`${DASHBOARD}/models/${MODEL}/conversations/%3Cb%3E`, null],
    [`${DASHBOARD}/models/${MODEL}/conversations/%E0%A4%A`, null],
    [undefined, null],
  ])('%s → %s', (url, id) => {
    expect(openConversationOf(url)).toBe(id);
  });
});
