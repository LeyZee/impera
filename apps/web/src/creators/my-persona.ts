/*
 * Moi › Persona as she reads it (recette visuelle 16/11, CRE-03): pure rules, so that the screen only lays them out.
 */

/** One part of a long answer: its rubric, as a title in sentence case, and what it says. */
export interface Rubric {
  /** `null` for what comes before the first rubric. */
  readonly title: string | null;
  readonly text: string;
}

/** A rubric written in capitals at the start of a line or of a sentence: « IDENTITÉ : », « VOIX ET STYLE : ». */
const RUBRIC = /(?<=^|\n|[.!?…]\s+)(\p{Lu}[\p{Lu}' ]*\p{Lu})\s?:\s*/gu;

/** « VOIX ET STYLE » → « Voix et style ». */
const sentenceCase = (title: string): string => {
  const lower = title.trim().toLocaleLowerCase('fr');
  return lower.charAt(0).toLocaleUpperCase('fr') + lower.slice(1);
};

/**
 * A long answer cut on its rubrics in capitals (« IDENTITÉ : … PERSONNALITÉ : … »), each its own title; `null` when it
 * has fewer than two, and is then read as written. Nothing is rewritten: the words after a rubric stay hers.
 */
export function rubricsOf(text: string): Rubric[] | null {
  const found = [...text.matchAll(RUBRIC)];
  if (found.length < 2) return null;
  const parts: Rubric[] = [];
  const before = text.slice(0, found[0]?.index ?? 0).trim();
  if (before !== '') parts.push({ title: null, text: before });
  found.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = found[index + 1]?.index ?? text.length;
    const said = text.slice(start, end).trim();
    if (said !== '') parts.push({ title: sentenceCase(match[1] ?? ''), text: said });
  });
  return parts;
}

/**
 * A question of her sheet as she reads it: the sheet is the agency's questionnaire, written « vous » to her; her space
 * says « tu » everywhere (recette visuelle 16/11, CRE-03). The agency's screens keep the sheet's words.
 */
const HER_LABELS: Readonly<Record<string, string>> = {
  turn_ons: 'Ce qui t’attire',
  turn_offs: 'Ce qui te repousse chez un homme',
};

export const herLabel = (key: string, label: string): string => HER_LABELS[key] ?? label;
