import { describe, expect, it } from 'vitest';

import { nearExamples, type CommentExample } from '../examples';

/* Invented pairs (ADR 0010): never a real comment nor a real reply of hers. */
const bank: CommentExample[] = [
  { id: 'a', comment: 'Magnifique cette photo', reply: 'Merciii 🫶🏻' },
  { id: 'b', comment: 'Tu es magnifique', reply: 'Merciii 🫶🏻' },
  { id: 'c', comment: 'Tu es célibataire ?', reply: 'Euh… question piège 😅' },
  { id: 'd', comment: 'Where are you from?', reply: 'France, croissant included 🥐' },
  { id: 'e', comment: '🔥🔥', reply: '😏' },
  { id: 'f', comment: 'Les cordes c’est pas douloureux ?', reply: 'Moins que les lundis matin 😂' },
];

describe('her real replies as examples (Charles, 26/11)', () => {
  it('picks the pairs whose comment reads closest, closest first', () => {
    expect(nearExamples('Magnifiiique la photo !', bank, 1).map((one) => one.id)).toEqual(['a']);
    expect(nearExamples('where r u from', bank, 1).map((one) => one.id)).toEqual(['d']);
    expect(nearExamples('🔥', bank, 1).map((one) => one.id)).toEqual(['e']);
  });

  it('counts once two pairs where she answered the same words', () => {
    const ids = nearExamples('Tu es magnifique sur cette photo', bank, 3).map((one) => one.id);
    expect(ids.filter((id) => id === 'a' || id === 'b')).toHaveLength(1);
    expect(ids).toHaveLength(3);
  });

  it('gives what it has when the bank is short, nothing when it is empty', () => {
    expect(nearExamples('Bonjour', bank.slice(0, 1))).toHaveLength(1);
    expect(nearExamples('Bonjour', [])).toEqual([]);
  });
});
