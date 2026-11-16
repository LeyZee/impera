import { normaliseWords, type PersonaPractice } from '@impera/contracts';

/**
 * « Ses pratiques et savoir-faire » (ADR 0143 § A and B): code finds the practice the fan speaks of and gives the
 * models that one alone, in its own block, never with her intimacy. Pure: compose calls it.
 */

/** His messages read for a practice: this one and the few before, so that « et toi, depuis quand ? » still finds it. */
export const PRACTICE_RECENT_FAN_TEXTS = 3;

const wordsOf = (text: string): string => ` ${normaliseWords(text)} `;

/** The practices he speaks of, by their name or one of their words, read as whole words, in her order. */
export function practicesMentioned(
  practices: readonly PersonaPractice[],
  fanTexts: readonly string[],
): PersonaPractice[] {
  const read = fanTexts.map(wordsOf).join(' ');
  return practices.filter((practice) =>
    [practice.name, ...practice.terms].some((term) => {
      const words = normaliseWords(term);
      return words !== '' && read.includes(` ${words} `);
    }),
  );
}

export interface PracticesContext {
  /** His age is confirmed: a practice sexual for her is read only then, and follows the cursor (§ 6). */
  readonly ageConfirmed: boolean;
}

const FIELDS: readonly (readonly [keyof PersonaPractice, string])[] = [
  ['level', 'Son niveau, son rôle, depuis quand'],
  ['how_she_talks', 'Comment elle en parle, ce que ça représente pour elle'],
  ['vocabulary', 'Son vocabulaire'],
  ['what_she_respects', 'Ce qu’elle respecte'],
  ['anecdotes', 'Ses anecdotes'],
  ['answers', 'Quoi répondre à un curieux, un débutant, un fan qui veut essayer'],
  ['never_says', 'Ce qu’elle ne dit jamais'],
];

/**
 * The `<her_practices>` block, or '' when there is nothing to give: none named, or only practices sexual for her
 * while his age is not confirmed. What she offers around it stays out (§ 10 to 12 come with « Ses comptes »).
 */
export function practicesBlock(practices: readonly PersonaPractice[], context: PracticesContext): string {
  const given = practices.filter((practice) => !practice.sexual || context.ageConfirmed);
  if (given.length === 0) return '';
  const lines = [
    '<her_practices>',
    'Ses pratiques et savoir-faire, dont il parle. Elle s’en tient à ce qui est écrit ici : sur ce qui n’y est pas, elle ' +
      'esquive avec naturel (elle préfère montrer qu’expliquer, elle en parlera une autre fois) et n’invente ni ' +
      'technique, ni chiffre, ni anecdote. Jamais de mode d’emploi ni de conseil pour pratiquer seul. Elle ne propose ' +
      'rien autour : ni séance, ni atelier, ni rendez-vous, ni lieu, ni date, ni prix.',
  ];
  for (const practice of given) {
    lines.push('', `## ${practice.name}`);
    lines.push(
      practice.sexual
        ? 'Pour elle : une pratique sexuelle, qui suit ce que le moment permet.'
        : 'Pour elle : rien de sexuel. Ne la sexualise jamais.',
    );
    for (const [key, label] of FIELDS) {
      const value = practice[key];
      if (typeof value === 'string' && value !== '') lines.push(`${label} : ${value}`);
    }
  }
  lines.push('</her_practices>');
  return lines.join('\n');
}
