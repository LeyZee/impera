import { ConversationSummarySchema, type ConversationSummary } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  bubblesFromText,
  bubblesProblem,
  duration,
  fanWaits,
  groupByHand,
  lastMessageAgo,
  mergeConversations,
  orderLines,
  parseTrackingSearch,
  sharedMode,
  situationOf,
  statusClass,
  subline,
} from './view';

const NOW = new Date('2026-10-17T21:00:00Z');

function conversation(id: string, patch: Partial<ConversationSummary> = {}): ConversationSummary {
  return ConversationSummarySchema.parse({
    id: `0192f3a0-0000-7000-8000-00000000000${id}`,
    fanId: `0192f3a0-0000-7000-8000-0000000000f${id}`,
    fanDisplayName: `Fan ${id}`,
    state: 'idle',
    mode: 'copilot',
    lastInboundAt: null,
    lastOutboundAt: null,
    unreadCount: 0,
    updatedAt: '2026-10-17T20:00:00Z',
    desire: null,
    heldBy: null,
    careSince: null,
    ...patch,
  });
}

describe('mergeConversations', () => {
  it('puts every creator in one list, most recently changed first', () => {
    const a = conversation('1', { updatedAt: '2026-10-17T18:00:00Z' });
    const b = conversation('2', { updatedAt: '2026-10-17T20:30:00Z' });
    const c = conversation('3', { updatedAt: '2026-10-17T19:00:00Z' });
    const lines = mergeConversations([
      { creatorId: 'a', creatorName: 'Créatrice A', items: [a, b] },
      { creatorId: 'b', creatorName: 'Créatrice B', items: [c] },
    ]);
    expect(lines.map((l) => `${l.conversation.fanDisplayName} ${l.creatorName}`)).toEqual([
      'Fan 2 Créatrice A',
      'Fan 3 Créatrice B',
      'Fan 1 Créatrice A',
    ]);
  });

  it('orders by his last message, as the time under each pseudo reads, not by a change in the background', () => {
    // Recette chatteur n°6: « Il y a 13 h » listed above « Il y a 12 h ».
    const touched = conversation('1', {
      lastInboundAt: '2026-10-17T08:00:00Z',
      updatedAt: '2026-10-17T20:50:00Z',
    });
    const recent = conversation('2', {
      lastInboundAt: '2026-10-17T09:00:00Z',
      updatedAt: '2026-10-17T09:00:00Z',
    });
    const ours = conversation('3', {
      lastOutboundAt: '2026-10-17T08:30:00Z',
      updatedAt: '2026-10-17T20:55:00Z',
    });
    const lines = mergeConversations([
      { creatorId: 'a', creatorName: 'Créatrice A', items: [touched, recent, ours] },
    ]);
    expect(lines.map((l) => l.conversation.fanDisplayName)).toEqual(['Fan 2', 'Fan 3', 'Fan 1']);
  });
});

describe('lastMessageAgo', () => {
  it('says how long ago, in the unit that reads best', () => {
    expect(lastMessageAgo(null, NOW)).toBeNull();
    expect(lastMessageAgo('2026-10-17T20:59:40Z', NOW)).toBe('à l’instant');
    expect(lastMessageAgo('2026-10-17T20:48:00Z', NOW)).toBe('il y a 12 min');
    expect(lastMessageAgo('2026-10-17T18:00:00Z', NOW)).toBe('il y a 3 h');
    expect(lastMessageAgo('2026-10-15T20:00:00Z', NOW)).toBe('il y a 2 j');
  });

  it('says a wait in days past a day, as the list does: never « 49 h »', () => {
    expect(duration(0)).toBe('0 min');
    expect(duration(59)).toBe('59 min');
    expect(duration(23 * 60 + 59)).toBe('23 h');
    expect(duration(49 * 60)).toBe('2 j');
  });
});

describe('subline, sharedMode and statusClass', () => {
  it('says when he last wrote in a few words, never the mode', () => {
    expect(subline(conversation('1'), NOW)).toEqual({ text: 'Pas encore écrit', band: null });
    const auto = conversation('2', {
      mode: 'auto',
      lastInboundAt: '2026-10-17T20:55:00Z',
      lastOutboundAt: '2026-10-17T20:56:00Z',
    });
    expect(subline(auto, NOW)).toEqual({ text: 'Il y a 5 min', band: null });
    expect(
      subline(
        conversation('3', { lastInboundAt: '2026-10-17T20:59:40Z', lastOutboundAt: '2026-10-17T20:59:50Z' }),
        NOW,
      ).text,
    ).toBe('À l’instant');
  });

  it('finds the mode all lines share, or none', () => {
    const line = (mode: 'copilot' | 'auto') => ({
      conversation: conversation('1', { mode }),
      creatorId: 'a',
      creatorName: 'A',
    });
    expect(sharedMode([line('copilot'), line('copilot')])).toBe('copilot');
    expect(sharedMode([line('copilot'), line('auto')])).toBeNull();
    expect(sharedMode([])).toBeNull();
  });

  it('maps states to their pill', () => {
    expect(statusClass('awaiting_approval')).toBe('nv-status--awaiting-approval');
  });
});

describe('situationOf and groupByHand (CHAT-22, PRO-03)', () => {
  const answered = { lastInboundAt: '2026-10-17T20:00:00Z', lastOutboundAt: '2026-10-17T20:05:00Z' };
  const unanswered = { lastInboundAt: '2026-10-17T20:10:00Z', lastOutboundAt: '2026-10-17T20:05:00Z' };

  it('never says « Rien à faire » while his last message has no answer', () => {
    expect(situationOf(conversation('1', { state: 'idle', ...unanswered }))).toEqual({
      hand: 'yours',
      label: 'Sans réponse',
      pill: 'nv-status--awaiting-approval',
    });
    expect(situationOf(conversation('1', { state: 'idle', ...answered })).label).toBe('Rien à faire');
    expect(situationOf(conversation('1', { state: 'paused', ...unanswered })).hand).toBe('yours');
    expect(fanWaits({ lastInboundAt: null, lastOutboundAt: null })).toBe(false);
  });

  it('says who acts: a person, the agent, or nobody', () => {
    const hand = (state: ConversationSummary['state']) =>
      situationOf(conversation('1', { state, ...answered })).hand;
    expect(hand('awaiting_approval')).toBe('yours');
    expect(hand('human')).toBe('yours');
    expect(hand('error')).toBe('yours');
    expect(hand('pending')).toBe('agent');
    expect(hand('drafting')).toBe('agent');
    expect(hand('sending')).toBe('agent');
    expect(hand('idle')).toBe('quiet');
    expect(situationOf(conversation('1', { state: 'error' })).label).toBe('Pas parti');
  });

  it('tells whoever holds the hand that it is his, anyone else that a human answers (EQ-13)', () => {
    expect(situationOf(conversation('1', { state: 'human', heldBy: 'you' }), true).label).toBe(
      'Tu as la main',
    );
    expect(situationOf(conversation('1', { state: 'human', heldBy: 'you' })).label).toBe('Tu as la main');
    expect(situationOf(conversation('1', { state: 'human', heldBy: 'other' }), true).label).toBe(
      'Un humain répond',
    );
    expect(situationOf(conversation('1', { state: 'human' })).label).toBe('Un humain répond');
  });

  it('puts another person’s hand with the quiet ones for a chatter, never a handoff nobody took (EQ-13)', () => {
    const hand = (heldBy: ConversationSummary['heldBy'], selfScope: boolean) =>
      situationOf(conversation('1', { state: 'human', heldBy }), selfScope).hand;
    expect(hand('other', true)).toBe('quiet');
    expect(hand(null, true)).toBe('yours');
    expect(hand('you', true)).toBe('yours');
    // Whoever reads the whole creator finds every human hand under « À toi » (CHAT-22).
    expect(hand('other', false)).toBe('yours');
  });

  it('groups the lines in the order À toi, the agent, nothing to do, keeping their order and leaving empty ones out', () => {
    const line = (id: string, state: ConversationSummary['state']) => ({
      conversation: conversation(id, { state, ...answered }),
    });
    const groups = groupByHand([line('1', 'idle'), line('2', 'awaiting_approval'), line('3', 'human')]);
    expect(groups.map((g) => [g.hand, g.lines.map((l) => l.conversation.fanDisplayName)])).toEqual([
      ['yours', ['Fan 2', 'Fan 3']],
      ['quiet', ['Fan 1']],
    ]);
  });
});

describe('parseTrackingSearch', () => {
  it('opens the conversation of a Telegram link, and ignores anything else', () => {
    const id = '0192f3a0-0000-7000-8000-000000000001';
    expect(parseTrackingSearch({ conversation: id })).toEqual({ conversation: id });
    expect(parseTrackingSearch({ conversation: '<script>' })).toEqual({});
    expect(parseTrackingSearch({ conversation: 42 })).toEqual({});
    expect(parseTrackingSearch({})).toEqual({});
  });

  it('keeps the creator the link names, only with a conversation and only as an id', () => {
    const id = '0192f3a0-0000-7000-8000-000000000001';
    const creator = '0192f3a0-0000-7000-8000-0000000000a1';
    expect(parseTrackingSearch({ conversation: id, creatrice: creator })).toEqual({
      conversation: id,
      creatrice: creator,
    });
    expect(parseTrackingSearch({ conversation: id, creatrice: 'Anna' })).toEqual({ conversation: id });
    expect(parseTrackingSearch({ creatrice: creator })).toEqual({});
  });
});

describe('bubblesFromText', () => {
  it('makes one bubble per line, and refuses what the server would refuse', () => {
    expect(bubblesFromText('Coucou toi\n\n  Tu fais quoi ?  ')).toEqual(['Coucou toi', 'Tu fais quoi ?']);
    expect(bubblesFromText('  \n ')).toBeNull();
    expect(bubblesFromText(Array.from({ length: 11 }, (_, i) => `b${String(i)}`).join('\n'))).toBeNull();
    expect(bubblesFromText('x'.repeat(2_001))).toBeNull();
  });

  it('says why a retouched text cannot be sent', () => {
    expect(bubblesProblem('Coucou\nÇa va ?')).toBeNull();
    expect(bubblesProblem(' \n')).toBe('Écris au moins une bulle.');
    expect(bubblesProblem(Array.from({ length: 11 }, (_, i) => `b${String(i)}`).join('\n'))).toBe(
      '10 bulles au plus, une par ligne : il y en a 11.',
    );
    expect(bubblesProblem('x'.repeat(2_001))).toBe('2\u202f000 caractères au plus par bulle.');
  });
});

describe('the desire score in the list (P3-12)', () => {
  it('ends the subline with the band in a word when it says something, never « neutre »', () => {
    expect(subline(conversation('1', { desire: { score: 45, band: 'playful' } }), NOW)).toEqual({
      text: 'Pas encore écrit',
      band: '😏 joueur',
    });
    expect(subline(conversation('1', { desire: { score: 82, band: 'hot' } }), NOW).band).toBe('🔥 chaud');
    expect(subline(conversation('1', { desire: { score: 12, band: 'neutral' } }), NOW).band).toBeNull();
  });

  it('orders the hottest first, keeps the order of equal scores, and puts the unscored last', () => {
    const line = (id: string, score: number | null) => ({
      conversation: conversation(id, {
        desire: score === null ? null : { score, band: score >= 70 ? 'hot' : 'neutral' },
      }),
    });
    const lines = [line('1', null), line('2', 30), line('3', 80), line('4', 30)];
    const ids = (ordered: typeof lines) => ordered.map((l) => l.conversation.id.slice(-1));
    expect(ids(orderLines(lines, 'hot'))).toEqual(['3', '2', '4', '1']);
    expect(ids(orderLines(lines, 'recent'))).toEqual(['1', '2', '3', '4']);
  });
});
