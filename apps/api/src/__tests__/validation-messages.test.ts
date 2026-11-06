import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { useFrenchValidationMessages } from '../validation-messages';

function messagesOf(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

// Recette 05/11, SEC-14: the operator reads these, in sentences rather than « chaîne de caractères doit avoir <=80 ».
describe('French validation messages', () => {
  beforeAll(() => {
    useFrenchValidationMessages();
  });

  it('says what type was expected, and what came instead', () => {
    expect(messagesOf(z.object({ displayName: z.string() }), { displayName: 123 })).toEqual([
      'Un texte est attendu, pas un nombre.',
    ]);
    expect(messagesOf(z.object({ count: z.int() }), { count: 1.5 })).toEqual([
      'Un nombre entier est attendu, pas un nombre à virgule.',
    ]);
    expect(messagesOf(z.object({ on: z.boolean() }), { on: null })).toEqual([
      'Oui ou non (true ou false) est attendu, pas une valeur vide.',
    ]);
  });

  it('says a missing field is required', () => {
    expect(messagesOf(z.object({ displayName: z.string() }), {})).toEqual(['Champ requis.']);
  });

  it('gives lengths and bounds in words', () => {
    expect(messagesOf(z.string().max(80), 'x'.repeat(10_000))).toEqual(['80 caractères au plus.']);
    expect(messagesOf(z.string().min(1), '')).toEqual(['Ne peut pas être vide.']);
    expect(messagesOf(z.string().min(12), 'court')).toEqual(['12 caractères au moins.']);
    expect(messagesOf(z.number().max(200), 201)).toEqual(['200 au plus.']);
    expect(messagesOf(z.number().positive(), 0)).toEqual(['Doit être supérieur à 0.']);
    expect(
      messagesOf(
        z.array(z.string()).max(10_000),
        Array.from({ length: 10_001 }, () => 'a'),
      ),
    ).toEqual(['10\u202F000 éléments au plus.']);
  });

  it('names formats, choices and unknown fields plainly', () => {
    expect(messagesOf(z.email(), 'pas-un-email')).toEqual(['Adresse e-mail invalide.']);
    expect(messagesOf(z.enum(['day', 'night']), 'noon')).toEqual(['Valeurs possibles : day, night.']);
    expect(messagesOf(z.strictObject({}), { extra: 1 })).toEqual(['Champ inconnu : extra.']);
  });

  it('keeps the message a schema writes itself', () => {
    expect(messagesOf(z.string().max(2, { error: 'Deux lettres' }), 'abc')).toEqual(['Deux lettres']);
  });
});
