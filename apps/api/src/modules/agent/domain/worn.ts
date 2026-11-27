import { normalise } from '@impera/contracts';

import type { GuardViolation } from './guards';

/**
 * Her worn phrases (passe 2 du 26/11): what comes back in her recent messages to every fan, not only to him (« un
 * verre de vin », « Churro », « et toi ta soirée ? »). Counted by code over her last outgoing messages; one is worn
 * once it was in enough of them. Each fan reads her alone, so the same anecdote everywhere is her mould only for the
 * team, and for the fan who talks to her every night.
 */
export interface WornLimits {
  /** How many of her last outgoing messages, across her fans, are read. */
  readonly window: number;
  /** In this many of them or more, a phrase is worn. */
  readonly maxUses: number;
}

/** Safe defaults while no creator sets her own (her persona's settings do not carry them yet). */
export const DEFAULT_WORN_LIMITS: WornLimits = { window: 60, maxUses: 4 };

/** At most this many worn phrases are named to the voice. */
const WORN_NAMED_MAX = 8;

const RUN_WORDS = 3;

// Words that carry no anecdote on their own: a run made only of them is anyone's (« je sais pas », « c'est trop »).
const FILLER = new Set(
  (
    "a ai as au aux avec ca ce ces cette c est c'est de des du elle en es est et etre il ils j je j'ai la le les leur lui " +
    'ma mais me mes moi mon ne n on ou par pas plus pour qu que qui sa se ses si son sur t ta te tes toi ton tu un une ' +
    'vous y oui non bon bien trop tres tout toute tous fait faire va vais vas suis sais quoi comme alors aussi encore ' +
    'deja la ici'
  ).split(' '),
);

function words(text: string): string[] {
  return normalise(text)
    .replace(/[^\p{L}\p{N}' ]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '');
}

const carries = (word: string): boolean => word.length >= 3 && !FILLER.has(word);

/** Three words in a row with one that carries something, and the names of hers it says. */
function motifsOf(text: string, names: ReadonlySet<string>): Set<string> {
  const all = words(text);
  const motifs = new Set<string>();
  for (let i = 0; i + RUN_WORDS <= all.length; i += 1) {
    const run = all.slice(i, i + RUN_WORDS);
    if (run.some(carries)) motifs.add(run.join(' '));
  }
  for (const word of all) if (names.has(word)) motifs.add(word);
  return motifs;
}

/** A capital inside a sentence names something of hers (her cat, her town): « avec Churro sur le canapé ». */
function namesIn(messages: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const text of messages) {
    for (const match of text.matchAll(/(?<=[\p{L},] )\p{Lu}\p{Ll}{2,}/gu)) {
      const name = normalise(match[0]);
      if (carries(name)) names.add(name);
    }
  }
  return names;
}

/** The phrases worn in her recent messages, the most used first; none under the limits. */
export function wornPhrases(
  herRecent: readonly string[],
  limits: WornLimits = DEFAULT_WORN_LIMITS,
): string[] {
  const read = herRecent.slice(0, limits.window);
  const names = namesIn(read);
  const counts = new Map<string, number>();
  for (const message of read) {
    for (const motif of motifsOf(message, names)) counts.set(motif, (counts.get(motif) ?? 0) + 1);
  }
  const worn = [...counts].filter(([, count]) => count >= limits.maxUses);
  // A run inside a longer worn one says the same: the longest is kept.
  return worn
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([motif]) => motif)
    .filter((motif, index, all) => !all.slice(0, index).some((longer) => longer.includes(motif)))
    .slice(0, WORN_NAMED_MAX);
}

/** Her bubbles that say a worn phrase again: soft, her answer is written once more, then goes (like `repetition`). */
export function checkWorn(bubbles: readonly string[], worn: readonly string[]): GuardViolation[] {
  if (worn.length === 0) return [];
  const violations: GuardViolation[] = [];
  bubbles.forEach((bubble, bubbleIndex) => {
    const said = ` ${words(bubble).join(' ')} `;
    const match = worn.find((motif) => said.includes(` ${motif} `));
    if (match !== undefined) violations.push({ code: 'repetition', severity: 'soft', bubbleIndex, match });
  });
  return violations;
}
