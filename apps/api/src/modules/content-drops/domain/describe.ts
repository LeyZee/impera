import { createHash } from 'node:crypto';

import {
  DROP_CATEGORY_LABELS,
  MEDIA_VOCABULARY_VERSION,
  scriptSegmentCodes,
  scriptSlots,
  type DropCategory,
  type DropMediaDescription,
  type HandIntensity,
  type ScriptDropSummary,
  type ScriptSegment,
  type ScriptStageAccess,
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

/** What a step's card says, as the vision and the brain read it: its number and name, and its lines. */
interface StepCard {
  readonly number: number;
  readonly name: string;
  readonly lines: readonly string[];
}

/**
 * A step's card in the frozen version she shot: a stage by its number and name (« ÉTAPE 2 », as on its card), what it
 * sells, its mood, outfit and place, the series' hint; a bridge by the number of the stage it leaves and its teaser.
 */
function stepCardOf(
  segments: readonly ScriptSegment[],
  segment: ScriptSegment,
  variant: string | null,
): StepCard {
  const stageNumbers = new Map(
    scriptSegmentCodes(segments)
      .filter((code) => code.code.startsWith('E'))
      .map((code) => [code.key, Number(code.code.slice(1))]),
  );
  if (segment.kind === 'bridge')
    return {
      number: stageNumbers.get(segment.from) ?? 0,
      name: `Pont vers l’étape ${String(stageNumbers.get(segment.to) ?? '?')}`,
      lines: [segment.teaser],
    };
  const series = segment.variants.find((one) => one.letter === variant);
  return {
    number: stageNumbers.get(segment.key) ?? 0,
    name: segment.name,
    lines: [
      segment.intention,
      segment.mood,
      segment.outfit === null ? null : `Tenue : ${segment.outfit}`,
      segment.place === null ? null : `Lieu : ${segment.place}`,
      series === undefined ? null : `Série ${series.letter} : ${series.hint}`,
    ].filter((text) => text !== null),
  };
}

const textOf = (lines: readonly string[]): string | null =>
  lines.length === 0 ? null : lines.map(sentence).join(' ');

/**
 * The context of one media of her drop: its step's card and the slot's own hint, and its place in the step. A slot the
 * version does not have, or a drop of another category, gives no step.
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
  const card = stepCardOf(script.segments, segment, slot.variant);
  return {
    category: label,
    step: {
      number: card.number,
      name: card.name,
      instruction: textOf([...card.lines, ...(slot.slot.hint === null ? [] : [slot.slot.hint])]),
      position: slot.rank + 1,
      count: segment.mediaSlots.length,
    },
  };
}

/** A slot's file of her sent script: its slot and its medium, and whatever its reader keeps of it. */
interface SlotFile {
  readonly slotKey: string;
  readonly mediaAssetId: string;
}

/** A step of her sent script, to be told (ADR 0083 § 6): one segment, one series of a stage with variants. */
export interface ScriptStepToTell<F extends SlotFile = SlotFile> {
  /** `<segment>:<series>`, as its slots begin. */
  readonly step: string;
  /** `E1A`, `P12`, as her cards say. */
  readonly code: string;
  readonly name: string;
  /** Offered or paid, as its card says (ADR 0064 § 3): a bridge is always offered. Never a price. */
  readonly access: ScriptStageAccess;
  readonly card: string | null;
  /** Its filled slots' files, in their order. */
  readonly media: readonly F[];
}

/**
 * The steps of her sent script, in its order, each with the media of its filled slots; a step with none (an optional
 * slot left empty, a bridge without media) is not told. A file whose slot the version does not have is left out.
 */
export function scriptStepsOf<F extends SlotFile>(
  segments: readonly ScriptSegment[],
  files: readonly F[],
): ScriptStepToTell<F>[] {
  const filled = new Map(files.map((file) => [file.slotKey, file]));
  const steps: ScriptStepToTell<F>[] = [];
  for (const slot of scriptSlots(segments)) {
    const file = filled.get(slot.key);
    if (file === undefined) continue;
    const key = `${slot.segmentKey}:${slot.variant ?? ''}`;
    const last = steps.at(-1);
    if (last?.step === key) {
      steps[steps.length - 1] = { ...last, media: [...last.media, file] };
      continue;
    }
    const segment = segments.find((one) => one.key === slot.segmentKey);
    if (segment === undefined) continue;
    const card = stepCardOf(segments, segment, slot.variant);
    steps.push({
      step: key,
      code: slot.code,
      name: card.name,
      access: segment.kind === 'bridge' ? 'free' : segment.access,
      card: textOf(card.lines),
      media: [file],
    });
  }
  return steps;
}

/**
 * The brain's answer in the script's order, or `null` when it does not tell each step once: a step missing, added or
 * told twice. The code holds the steps; the model only writes about them.
 */
export function orderedSummary(
  steps: readonly string[],
  summary: ScriptDropSummary,
): ScriptDropSummary | null {
  const told = new Map(summary.steps.map((one) => [one.step, one]));
  if (told.size !== summary.steps.length || told.size !== steps.length) return null;
  const ordered = steps.map((step) => told.get(step));
  if (ordered.some((one) => one === undefined)) return null;
  return { shootingContext: summary.shootingContext, steps: ordered.filter((one) => one !== undefined) };
}

/** A sum or a currency in the synthesis: prices come from the agency's grid alone (ADR 0056 § 6). */
const PRICE = /[€$£]|\b(?:euros?|eur|dollars?|usd|livres sterling)\b|\d\s*balles\b/iu;

export function mentionsPrice(summary: ScriptDropSummary): boolean {
  return [summary.shootingContext, ...summary.steps.flatMap((one) => [one.overview, one.summary])].some(
    (text) => PRICE.test(text),
  );
}

/**
 * A script's slots, their media and the description each is told with, in the order of the slot keys: the same files
 * with the same descriptions, the same hash; a slot changed or another description shown (a correction, a row
 * validated), another. The synthesis is written for one hash, and is current while the script keeps it.
 */
export function mediaHashOf(
  files: readonly { readonly slotKey: string; readonly mediaAssetId: string }[],
  descriptions: ReadonlyMap<string, { readonly descriptionId: string }>,
): string {
  const lines = files
    .map(
      (file) =>
        `${file.slotKey}=${file.mediaAssetId}=${descriptions.get(file.mediaAssetId)?.descriptionId ?? ''}`,
    )
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** A description row as the review reads it. */
export interface ReviewedRow {
  readonly id: string;
  readonly mediaAssetId: string;
  readonly reviewReasons: readonly string[];
  readonly validatedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * The row a media is told with (ADR 0030 § 3): the latest validated, by `validated_at`, else the latest written; the
 * agent reads only a validated one, the review and the synthesis this one.
 */
export function shownRow<R extends ReviewedRow>(rows: readonly R[]): R | null {
  let shown: R | null = null;
  for (const row of rows) {
    if (shown === null || shownBefore(row, shown)) shown = row;
  }
  return shown;
}

function shownBefore(a: ReviewedRow, b: ReviewedRow): boolean {
  if (a.validatedAt !== null && b.validatedAt === null) return true;
  if (a.validatedAt === null && b.validatedAt !== null) return false;
  const byValidation = (a.validatedAt?.getTime() ?? 0) - (b.validatedAt?.getTime() ?? 0);
  if (byValidation !== 0) return byValidation > 0;
  const byCreation = a.createdAt.getTime() - b.createdAt.getTime();
  return byCreation !== 0 ? byCreation > 0 : a.id > b.id;
}

export type ValidationRefusal = 'not_shown' | 'alone';

/**
 * Whether these rows can be validated together: each the one its media is shown with now (a newer row came, the
 * screen is late), and a row that waits for a human (ADR 0083 § 3 to 5) only alone, never under « Tout valider ».
 */
export function validationRefusal(
  named: readonly ReviewedRow[],
  shownOf: (mediaAssetId: string) => ReviewedRow | null,
): ValidationRefusal | null {
  if (named.some((row) => shownOf(row.mediaAssetId)?.id !== row.id)) return 'not_shown';
  if (named.length > 1 && named.some((row) => row.reviewReasons.length > 0 && row.validatedAt === null))
    return 'alone';
  return null;
}

/** The short sentence's length in the closed vocabulary (`factualDescription`). */
const FACTUAL_MAX = 800;

/** Her words cut to the short sentence's length, at a space, with an ellipsis when cut. */
function factualOf(detailed: string): string {
  const text = detailed.replace(/\s+/gu, ' ').trim();
  if (text.length <= FACTUAL_MAX) return text;
  const cut = text.slice(0, FACTUAL_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > FACTUAL_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * A description written by hand on a medium the vision AI did not describe (recette créatrice 2): her team's words
 * and the level it picked; every other label of the closed vocabulary is « not seen » (nothing told, no mood, no
 * flag), so that nothing is read in it that a human did not write. Its length is the file's, never a guess.
 */
export function handDescription(
  medium: { readonly kind: 'image' | 'video'; readonly durationMs: number | null },
  detailed: string,
  intensity: HandIntensity,
): DropMediaDescription {
  const text = detailed.trim();
  return {
    vocabularyVersion: MEDIA_VOCABULARY_VERSION,
    kind: medium.kind,
    factualDescription: factualOf(text),
    durationS: medium.durationMs === null ? null : Math.round(medium.durationMs / 1000),
    segments: [],
    intensity,
    anatomyVisible: [],
    castMode: 'not_visible',
    mood: [],
    setting: null,
    audio: null,
    textVisible: null,
    quality: 'acceptable',
    confidenceLow: false,
    notVisible: false,
    flags: [],
    detailed: text,
  };
}
