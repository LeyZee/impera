import { ConversationSummarySchema, type ConversationSummary } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  bubblesFromText,
  bubblesProblem,
  duration,
  lastMessageAgo,
  mergeConversations,
  orderLines,
  parseTrackingSearch,
  sharedMode,
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
    const auto = conversation('2', { mode: 'auto', lastInboundAt: '2026-10-17T20:55:00Z' });
    expect(subline(auto, NOW)).toEqual({ text: 'Il y a 5 min', band: null });
    expect(subline(conversation('3', { lastInboundAt: '2026-10-17T20:59:40Z' }), NOW).text).toBe(
      'À l’instant',
    );
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
      band: 'joueur',
    });
    expect(subline(conversation('1', { desire: { score: 82, band: 'hot' } }), NOW).band).toBe('chaud');
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
