import type { ChatterPersonaSheet } from '@impera/contracts';

/** At most this many lines: what a chatter must not miss before his first message, not her whole sheet. */
export const HER_LINES_MAX = 3;
const LINE_MAX = 90;

const firstLine = (text: string): string => {
  const line = (text.split(/\n|(?<=[.!?])\s/u)[0] ?? '').trim();
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1).trimEnd()}…` : line;
};

/**
 * « Elle, en trois lignes » (accueil du chatteur, Charles 21/11): her limits first, never do then never show then her
 * off-limits, then how she writes. Each line is the first sentence of an answer; empty answers are skipped.
 */
export function herLinesOf(sheet: {
  readonly limits: Pick<ChatterPersonaSheet['limits'], 'never_do' | 'never_show' | 'off_limits'>;
  readonly writing: Pick<ChatterPersonaSheet['writing'], 'conversation_description'>;
}): string[] {
  const { limits, writing } = sheet;
  const candidates: readonly (string | null)[] = [
    ...limits.never_do.map((entry) => `Jamais : ${entry}`),
    ...limits.never_show.map((entry) => `Ne montre jamais : ${entry}`),
    limits.off_limits,
    writing.conversation_description,
  ];
  return candidates
    .filter((line): line is string => line !== null && line.trim() !== '')
    .map(firstLine)
    .slice(0, HER_LINES_MAX);
}
