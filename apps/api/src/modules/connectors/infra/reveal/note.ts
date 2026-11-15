import { KYC_SLOT_LABELS } from '@impera/contracts';

/**
 * The agency's block of a Reveal client note (spec § 5, reveal-connector-inventory.md): the canvas lines « Prénom »,
 * « Localisation », « Âge », « Métier », « Passions », « Envies », « Situation », each `<label> : <value>`. The note
 * is replaced whole by Reveal (`PATCH …/note`), so the adapter rewrites these lines only and keeps every other line
 * word for word. Pure: the note is never logged nor kept (ADR 0018 § 1).
 */

const LABELS: readonly string[] = Object.values(KYC_SLOT_LABELS);

/** The canvas label a line starts with (`Prénom : …`, any case, spaces around the colon), or `null`. */
function labelOf(line: string): string | null {
  const match = /^\s*([^:\n]+?)\s*:/u.exec(line);
  const name = match?.[1]?.toLocaleLowerCase('fr');
  if (name === undefined) return null;
  return LABELS.find((label) => label.toLocaleLowerCase('fr') === name) ?? null;
}

/**
 * The note once the agency's `block` is written into `current`, the note read just before: each canvas line of the
 * block replaces the line of the same label (the first one), in place; a label the note does not have yet is added
 * after its last canvas line, or at the top when it has none. Every other line stays as it was. `null` when the block
 * holds a line that is not a canvas line, or the same label twice: the adapter writes the agency's lines only.
 */
export function withAgencyBlock(current: string, block: string): string | null {
  const wanted = new Map<string, string>();
  for (const line of block.split('\n')) {
    if (line.trim() === '') continue;
    const label = labelOf(line);
    if (label === null || wanted.has(label)) return null;
    wanted.set(label, line.trim());
  }
  const lines = current === '' ? [] : current.split('\n');
  const written = new Set<string>();
  let lastCanvas = -1;
  const merged = lines.map((line, index) => {
    const label = labelOf(line);
    if (label === null) return line;
    lastCanvas = index;
    const replacement = wanted.get(label);
    if (replacement === undefined || written.has(label)) return line;
    written.add(label);
    return replacement;
  });
  const added = LABELS.flatMap((label) => {
    const line = wanted.get(label);
    return line === undefined || written.has(label) ? [] : [line];
  });
  if (added.length === 0) return merged.join('\n');
  if (lastCanvas === -1) return [...added, ...merged].join('\n');
  return [...merged.slice(0, lastCanvas + 1), ...added, ...merged.slice(lastCanvas + 1)].join('\n');
}
