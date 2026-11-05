import { z } from 'zod';

/** What a field expected, as the operator reads it (« Il faut un texte. »). */
const EXPECTED: Readonly<Record<string, string>> = {
  string: 'un texte',
  number: 'un nombre',
  int: 'un nombre entier',
  bigint: 'un nombre entier',
  boolean: 'vrai ou faux',
  array: 'une liste',
  object: 'un objet',
  date: 'une date',
};

const plural = (count: number, one: string, many: string) => `${String(count)} ${count > 1 ? many : one}`;

/** The unit of a bound: characters of a text, elements of a list, nothing for a number. */
function measure(origin: string, count: number): string {
  if (origin === 'string') return plural(count, 'caractère', 'caractères');
  if (origin === 'array' || origin === 'set') return plural(count, 'élément', 'éléments');
  return String(count);
}

/**
 * The frequent cases in full sentences (recette SEC-14): Zod's French locale writes « chaîne de caractères attendu »
 * or « doit avoir <=80 caractères ». `undefined` leaves the rest to that locale.
 */
const frequentIssues: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === 'invalid_type') {
    if (issue.input === undefined) return 'Ce champ est obligatoire.';
    const expected = EXPECTED[issue.expected];
    return expected === undefined ? undefined : `Il faut ${expected}.`;
  }
  if (issue.code === 'too_big' && typeof issue.maximum === 'number') {
    return issue.inclusive === false
      ? `Moins de ${measure(issue.origin, issue.maximum)}.`
      : `${measure(issue.origin, issue.maximum)} au plus.`;
  }
  if (issue.code === 'too_small' && typeof issue.minimum === 'number') {
    if (issue.origin === 'string' && issue.minimum === 1 && issue.inclusive !== false) {
      return 'Ce champ ne peut pas être vide.';
    }
    return issue.inclusive === false
      ? `Plus de ${measure(issue.origin, issue.minimum)}.`
      : `${measure(issue.origin, issue.minimum)} au moins.`;
  }
  return undefined;
};

/**
 * Zod's own messages in French, process-wide (api.md § Erreurs: `message` and the field errors of `details.fields`
 * are read by the operator). A message a schema writes itself (`refine`, `{ error }`) still wins over these.
 * Idempotent: the API and the worker both call it at startup.
 */
export function useFrenchValidationMessages(): void {
  z.config({ ...z.locales.fr(), customError: frequentIssues });
}
