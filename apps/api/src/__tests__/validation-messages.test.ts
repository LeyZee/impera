import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { useFrenchValidationMessages } from '../validation-messages';

const messageOf = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
};

/** The messages the operator reads in `details.fields` (recette SEC-14). */
describe('French validation messages', () => {
  beforeAll(() => {
    useFrenchValidationMessages();
  });

  it('says what a field expected, or that it is missing', () => {
    expect(messageOf(z.string(), 123)).toBe('Il faut un texte.');
    expect(messageOf(z.number(), 'a')).toBe('Il faut un nombre.');
    expect(messageOf(z.boolean(), 'yes')).toBe('Il faut vrai ou faux.');
    expect(messageOf(z.array(z.string()), {})).toBe('Il faut une liste.');
    expect(messageOf(z.object({ name: z.string() }), {})).toBe('Ce champ est obligatoire.');
  });

  it('writes the bounds of a text, a number and a list in words', () => {
    expect(messageOf(z.string().max(80), 'a'.repeat(10_000))).toBe('80 caractères au plus.');
    expect(messageOf(z.string().min(12), 'short')).toBe('12 caractères au moins.');
    expect(messageOf(z.string().min(1), '')).toBe('Ce champ ne peut pas être vide.');
    expect(messageOf(z.number().max(200), 201)).toBe('200 au plus.');
    expect(messageOf(z.number().positive(), 0)).toBe('Plus de 0.');
    expect(messageOf(z.array(z.string()).max(1), ['a', 'b'])).toBe('1 élément au plus.');
  });

  it('keeps the message a schema writes itself, and the locale for the rest', () => {
    expect(messageOf(z.string().max(3, { error: 'Trois lettres au plus.' }), 'abcd')).toBe(
      'Trois lettres au plus.',
    );
    expect(messageOf(z.email(), 'not an e-mail')).toMatch(/e-mail|adresse/i);
  });
});
