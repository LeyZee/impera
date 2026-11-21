import {
  DRAFT_CORRECTION_REASON_LABELS,
  DRAFT_CORRECTIONS_DAYS,
  type DraftCorrectionReason,
  type DraftCorrectionsView,
} from '@impera/contracts';

/*
 * Entraîner › Corrections in figures (Design, recette du 21/11): the answer in big, one colour per reason, and what a
 * retouch changed. Pure: the page gives the view, these give its words and its colours.
 */

/**
 * Each reason's colour, fixed for good so that a reason reads at a glance from one month to the next (Design, recette
 * du 21/11). The design system has four categorical series (tokens.css): they go to the reasons met most by nature, a
 * retouch and the three refusals the copilot panel offers first; every other reason takes the series' « other » ink.
 * A coloured reason never changes colour.
 */
export const REASON_COLOURS: Readonly<Record<DraftCorrectionReason, string>> = {
  edited: 'var(--nv-series-1)',
  sounds_ai: 'var(--nv-series-2)',
  too_long: 'var(--nv-series-3)',
  out_of_character: 'var(--nv-series-4)',
  too_early_sexual: 'var(--nv-series-other)',
  missed_sale: 'var(--nv-series-other)',
  forgot_fact: 'var(--nv-series-other)',
  other: 'var(--nv-series-other)',
  written: 'var(--nv-series-other)',
  none: 'var(--nv-series-other)',
};

/** What most of them were, in a few words: a retouch, a refusal and why. */
function mostly(reason: DraftCorrectionReason): string {
  if (reason === 'edited') return 'des retouches';
  if (reason === 'written') return 'des refus avec une raison écrite';
  if (reason === 'none') return 'des refus sans raison';
  return `« ${DRAFT_CORRECTION_REASON_LABELS[reason]} »`;
}

/**
 * The answer at the top of the page: how many, over how long, and what most of them were (« 5 corrections en 30
 * jours, surtout des retouches »). « surtout » only when one reason leads; « toutes » when there is only one.
 */
export function correctionsHeadline(view: {
  readonly counts: DraftCorrectionsView['counts'];
  readonly items: readonly unknown[];
}): string {
  const total = view.items.length;
  const head = `${String(total)} correction${total > 1 ? 's' : ''} en ${String(DRAFT_CORRECTIONS_DAYS)} jours`;
  const ranked = [...view.counts].sort((a, b) => b.count - a.count);
  const [first, second] = ranked;
  if (first === undefined) return head;
  if (second === undefined) return total > 1 ? `${head}, toutes ${mostly(first.reason)}` : head;
  return first.count > second.count ? `${head}, surtout ${mostly(first.reason)}` : head;
}

/** A piece of a retouched text, and whether the retouch changed it. */
export interface DiffPart {
  readonly text: string;
  readonly changed: boolean;
}

/** Words and the spaces between them, each a token, so that the text joins back as it was. */
const tokens = (text: string): string[] => text.split(/(\s+)/u).filter((token) => token !== '');

/** Past this many words on a side, the whole of each side is said changed rather than compared word by word. */
const DIFF_MAX_TOKENS = 800;

/**
 * What a retouch changed, word by word (Design 21/11: « surligne ce qui a changé, c'est l'information »): the words
 * of `before` that left, and those of `after` that came in, by the longest run of words both keep. Spaces are never
 * marked on their own. The bubbles of a side join with a line break.
 */
export function wordDiff(
  before: readonly string[],
  after: readonly string[],
): { readonly before: readonly DiffPart[]; readonly after: readonly DiffPart[] } {
  const a = tokens(before.join('\n'));
  const b = tokens(after.join('\n'));
  if (a.length > DIFF_MAX_TOKENS || b.length > DIFF_MAX_TOKENS)
    return {
      before: merge(a.map((text) => part(text, true))),
      after: merge(b.map((text) => part(text, true))),
    };
  // The longest common run, from the end, so that walking forward reads it.
  const keep: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = keep[i];
      const below = keep[i + 1];
      if (row === undefined || below === undefined) continue;
      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  const left: DiffPart[] = [];
  const right: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const word = a[i] ?? '';
    if (word === b[j]) {
      left.push(part(word, false));
      right.push(part(word, false));
      i += 1;
      j += 1;
    } else if ((keep[i + 1]?.[j] ?? 0) >= (keep[i]?.[j + 1] ?? 0)) {
      left.push(part(word, true));
      i += 1;
    } else {
      right.push(part(b[j] ?? '', true));
      j += 1;
    }
  }
  for (; i < a.length; i += 1) left.push(part(a[i] ?? '', true));
  for (; j < b.length; j += 1) right.push(part(b[j] ?? '', true));
  return { before: merge(left), after: merge(right) };
}

/** A space is never a change by itself: it takes the state of what it sits between. */
const part = (text: string, changed: boolean): DiffPart => ({ text, changed: changed && text.trim() !== '' });

/** Neighbours of the same state join; a space between two changed words joins them, so a phrase lights at once. */
function merge(parts: readonly DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  parts.forEach((current, index) => {
    const space = current.text.trim() === '';
    const changed =
      space && (out.at(-1)?.changed ?? false) && (parts[index + 1]?.changed ?? false)
        ? true
        : current.changed;
    const last = out.at(-1);
    if (last?.changed === changed) out[out.length - 1] = { text: last.text + current.text, changed };
    else out.push({ text: current.text, changed });
  });
  return out;
}
