import {
  DROP_CATEGORY_LABELS,
  scriptSegmentCodes,
  scriptSlots,
  type DropCategory,
  type ScriptSegment,
} from '@impera/contracts';

/**
 * What the code knows of a dropped media, given to the vision AI as data (ADR 0083 § 5): her category as her screen
 * names it, and for a script the step on its card, its instruction and the media's place in it. The model never asks.
 */
export interface DropMediaContext {
  readonly category: string;
  readonly step: {
    readonly number: number;
    readonly name: string;
    readonly instruction: string | null;
    /** 1 for the step's first media. */
    readonly position: number;
    readonly count: number;
  } | null;
}

const sentence = (text: string): string => (/[.!?…]$/u.test(text) ? text : `${text}.`);

/**
 * The context of one media of her drop. A script's slot names its step in the frozen version she shot: a stage by its
 * number and name (« ÉTAPE 2 », as on its card), what it sells, its mood, outfit and place, the series' hint and the
 * slot's own; a bridge by the number of the stage it leaves and its teaser. A slot the version does not have, or a drop
 * of another category, gives no step.
 */
export function dropContextOf(
  category: DropCategory,
  script: { readonly slotKey: string; readonly segments: readonly ScriptSegment[] } | null,
): DropMediaContext {
  const label = DROP_CATEGORY_LABELS[category];
  if (script === null) return { category: label, step: null };
  const slot = scriptSlots(script.segments).find((one) => one.key === script.slotKey);
  const segment = script.segments.find((one) => one.key === slot?.segmentKey);
  if (slot === undefined || segment === undefined) return { category: label, step: null };

  const stageNumbers = new Map(
    scriptSegmentCodes(script.segments)
      .filter((code) => code.code.startsWith('E'))
      .map((code) => [code.key, Number(code.code.slice(1))]),
  );
  const place = { position: slot.rank + 1, count: segment.mediaSlots.length };
  if (segment.kind === 'bridge') {
    return {
      category: label,
      step: {
        number: stageNumbers.get(segment.from) ?? 0,
        name: `Pont vers l’étape ${String(stageNumbers.get(segment.to) ?? '?')}`,
        instruction: [segment.teaser, slot.slot.hint]
          .filter((text) => text !== null)
          .map(sentence)
          .join(' '),
        ...place,
      },
    };
  }
  const variant = segment.variants.find((one) => one.letter === slot.variant);
  const lines = [
    segment.intention,
    segment.mood,
    segment.outfit === null ? null : `Tenue : ${segment.outfit}`,
    segment.place === null ? null : `Lieu : ${segment.place}`,
    variant === undefined ? null : `Série ${variant.letter} : ${variant.hint}`,
    slot.slot.hint,
  ].filter((text) => text !== null);
  return {
    category: label,
    step: {
      number: stageNumbers.get(segment.key) ?? 0,
      name: segment.name,
      instruction: lines.length === 0 ? null : lines.map(sentence).join(' '),
      ...place,
    },
  };
}
