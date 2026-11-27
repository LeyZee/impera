import { describe, expect, it } from 'vitest';

import { asksProof, withProofRead } from '../proof-request';

describe('a proof he asks of her, read by code (passe 3 du 27/11, conversation 31)', () => {
  it('reads a proof word with a media, or a media asked with a precise gesture or his name', () => {
    expect(asksProof('Vas-y prouve-le, une photo avec le pouce levé')).toBe(true);
    expect(asksProof('Envoie une photo avec un papier où c’est écrit mon prénom')).toBe(true);
    expect(asksProof('Un vocal maintenant où tu dis mon prénom')).toBe(true);
    expect(asksProof('Prove it, send a pic holding three fingers')).toBe(true);
    expect(asksProof('Dimostralo con una foto')).toBe(true);
  });

  it('reads no proof in a media he tells of, a doubt without a media, or a plain ask', () => {
    expect(asksProof('J’ai pris une photo de ma main dans le plâtre hier')).toBe(false);
    expect(asksProof('T’es vraiment une vraie fille ?')).toBe(false);
    expect(asksProof('Envoie une photo de toi')).toBe(false);
  });

  it('sets the occasion the brain missed and drops a manipulation read on it, never another occasion', () => {
    const risks: readonly string[] = ['manipulation_attempt'];
    const doubt = { intent: 'asks_if_bot', risks };
    const loving: { readonly occasion: 'says_love'; readonly risks: readonly string[] } = {
      occasion: 'says_love',
      risks,
    };
    expect(withProofRead(doubt, 'Prouve-le avec un selfie')).toEqual({
      intent: 'asks_if_bot',
      risks: [],
      occasion: 'asks_proof',
    });
    expect(withProofRead(loving, 'Prouve-le avec un selfie').occasion).toBe('says_love');
    expect(withProofRead(doubt, 'T’es un bot ou quoi')).toBe(doubt);
  });
});
