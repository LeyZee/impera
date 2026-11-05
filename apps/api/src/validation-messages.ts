import { z } from 'zod';

/**
 * Zod's own messages in French, process-wide (api.md § Erreurs: `message` and the field errors of `details.fields`
 * are read by the operator). The frequent cases are said in plain sentences (« 80 caractères au plus », « Un texte est
 * attendu, pas un nombre ») rather than Zod's « chaîne de caractères doit avoir <=80 caractères » (recette 05/11,
 * SEC-14); the rare ones keep Zod's French locale. A message a schema writes itself (`refine`, `{ error }`) still wins
 * over these. Idempotent: the API and the worker both call it at startup.
 */
export function useFrenchValidationMessages(): void {
  z.config({ ...z.locales.fr(), customError: frenchIssueMessage });
}

const number = new Intl.NumberFormat('fr-FR');

/** What a field should have been, as an operator reads it. */
const EXPECTED: Readonly<Record<string, string>> = {
  string: 'Un texte est attendu',
  number: 'Un nombre est attendu',
  int: 'Un nombre entier est attendu',
  boolean: 'Oui ou non (true ou false) est attendu',
  array: 'Une liste est attendue',
  object: 'Un objet est attendu',
  date: 'Une date est attendue',
};

/** What the field held instead. */
function receivedOf(input: unknown): string {
  if (input === null) return 'une valeur vide';
  if (Array.isArray(input)) return 'une liste';
  if (typeof input === 'string') return 'un texte';
  if (typeof input === 'number') return Number.isInteger(input) ? 'un nombre' : 'un nombre à virgule';
  if (typeof input === 'boolean') return 'oui ou non';
  if (typeof input === 'object') return 'un objet';
  return 'autre chose';
}

const FORMATS: Readonly<Record<string, string>> = {
  email: 'Adresse e-mail invalide.',
  url: 'Adresse web invalide.',
  uuid: 'Identifiant invalide.',
  guid: 'Identifiant invalide.',
  datetime: 'Date et heure invalides (format ISO attendu).',
  date: 'Date invalide (format AAAA-MM-JJ attendu).',
  time: 'Heure invalide (format HH:MM attendu).',
  regex: 'Format invalide.',
};

const UNITS: Readonly<Record<string, readonly [string, string]>> = {
  string: ['caractère', 'caractères'],
  array: ['élément', 'éléments'],
  set: ['élément', 'éléments'],
  file: ['octet', 'octets'],
};

function counted(value: number, origin: string): string {
  const unit = UNITS[origin];
  if (unit === undefined) return number.format(value);
  return `${number.format(value)} ${Math.abs(value) >= 2 ? unit[1] : unit[0]}`;
}

/**
 * The plain sentence of a frequent issue, or `undefined` to let Zod's French locale speak (exported for its tests).
 */
export const frenchIssueMessage: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined) return 'Champ requis.';
      const expected = EXPECTED[issue.expected];
      return expected === undefined ? undefined : `${expected}, pas ${receivedOf(issue.input)}.`;
    }
    case 'too_big': {
      if (typeof issue.maximum !== 'number') return undefined;
      const origin = issue.origin;
      if (UNITS[origin] !== undefined) {
        const most = issue.inclusive === false ? issue.maximum - 1 : issue.maximum;
        return `${counted(most, origin)} au plus.`;
      }
      if (origin !== 'number' && origin !== 'int') return undefined;
      return issue.inclusive === false
        ? `Doit être inférieur à ${number.format(issue.maximum)}.`
        : `${number.format(issue.maximum)} au plus.`;
    }
    case 'too_small': {
      if (typeof issue.minimum !== 'number') return undefined;
      const origin = issue.origin;
      if (UNITS[origin] !== undefined) {
        const least = issue.inclusive === false ? issue.minimum + 1 : issue.minimum;
        if (least === 1) return origin === 'string' ? 'Ne peut pas être vide.' : 'Au moins un élément.';
        return `${counted(least, origin)} au moins.`;
      }
      if (origin !== 'number' && origin !== 'int') return undefined;
      return issue.inclusive === false
        ? `Doit être supérieur à ${number.format(issue.minimum)}.`
        : `${number.format(issue.minimum)} au moins.`;
    }
    case 'invalid_format':
      return FORMATS[issue.format];
    case 'invalid_value':
      return issue.values.length === 1
        ? `Seule valeur possible : ${String(issue.values[0])}.`
        : `Valeurs possibles : ${issue.values.map(String).join(', ')}.`;
    case 'unrecognized_keys':
      return issue.keys.length === 1
        ? `Champ inconnu : ${issue.keys.join('')}.`
        : `Champs inconnus : ${issue.keys.join(', ')}.`;
    case 'custom':
    case 'invalid_element':
    case 'invalid_key':
    case 'invalid_union':
    case 'not_multiple_of':
      return undefined;
  }
};
