import { PersonaPracticeSchema, type PersonaPractice } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { practicesBlock, practicesMentioned } from '../practices';

// A fictive practice (ADR 0143 § 17): never a real creator's.
const aerial: PersonaPractice = PersonaPracticeSchema.parse({
  name: 'Danse aérienne',
  terms: ['tissu aérien', 'cerceau', 'clé de pied'],
  level: 'Elle enseigne depuis six ans.',
  how_she_talks: 'Avec fierté, comme d’un endroit où elle se sent libre.',
  vocabulary: 'La clé de pied : le tissu enroulé autour du pied pour tenir.',
  what_she_respects: 'Toujours un tapis, jamais seule.',
  anecdotes: null,
  offers: 'Des ateliers pour débutants.',
  answers: 'À un curieux : elle raconte une figure.',
  never_says: 'Aucune hauteur précise.',
});
const intimate: PersonaPractice = PersonaPracticeSchema.parse({
  name: 'Jeu de rôle',
  terms: [],
  level: null,
  how_she_talks: 'En chuchotant.',
  vocabulary: null,
  what_she_respects: null,
  anecdotes: null,
  offers: null,
  answers: null,
  never_says: null,
  sexual: true,
});

describe('practicesMentioned', () => {
  it('finds a practice by its name or one of its words, as whole words, accents and case aside', () => {
    expect(practicesMentioned([aerial, intimate], ['Tu fais de la DANSE AERIENNE ?'])).toEqual([aerial]);
    expect(practicesMentioned([aerial], ['c’est quoi une clé de pied'])).toEqual([aerial]);
    expect(practicesMentioned([aerial], ['et toi', 'tu fais du cerceau'])).toEqual([aerial]);
  });

  it('finds nothing in a word that only holds it, nor when he speaks of something else', () => {
    expect(practicesMentioned([aerial], ['cerceaux de vélo'])).toEqual([]);
    expect(practicesMentioned([aerial], ['salut ça va'])).toEqual([]);
    expect(practicesMentioned([], ['danse aérienne'])).toEqual([]);
  });
});

describe('practicesBlock', () => {
  it('gives the practice in its own block, says it is not sexual, and leaves her offers out', () => {
    const block = practicesBlock([aerial], { ageConfirmed: false });
    expect(block.startsWith('<her_practices>')).toBe(true);
    expect(block.endsWith('</her_practices>')).toBe(true);
    expect(block).toContain('Ne la sexualise jamais');
    expect(block).toContain('n’invente ni technique');
    expect(block).toContain('Jamais de mode d’emploi');
    expect(block).toContain('La clé de pied');
    expect(block).not.toContain('ateliers pour débutants');
  });

  it('reads a practice sexual for her only once his age is confirmed', () => {
    expect(practicesBlock([intimate], { ageConfirmed: false })).toBe('');
    expect(practicesBlock([intimate], { ageConfirmed: true })).toContain('pratique sexuelle');
    expect(practicesBlock([], { ageConfirmed: true })).toBe('');
  });
});

describe('PersonaPracticeSchema', () => {
  it('says « non » by default and holds a practice within its wider limit', () => {
    expect(PersonaPracticeSchema.parse({ ...aerial, sexual: undefined }).sexual).toBe(false);
    const long = 'x'.repeat(3000);
    const tooLong = { ...aerial, level: long, how_she_talks: long, vocabulary: long };
    expect(PersonaPracticeSchema.safeParse(tooLong).success).toBe(false);
  });
});
