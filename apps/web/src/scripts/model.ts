import {
  SCRIPT_COLOR_PRESETS,
  SCRIPT_SEGMENTS_MAX,
  SCRIPT_VARIANT_LETTERS,
  ScriptStructureBodySchema,
  scriptCardInk,
  scriptSegmentCodes,
  type MediaSlot,
  type ScriptBridge,
  type ScriptColor,
  type ScriptSegment,
  type ScriptStage,
  type ScriptStructureBody,
} from '@impera/contracts';

/**
 * The workshop's draft of a structure (SC-01 lot c), and the pure edits of its stack: what the screen changes, the
 * contract checks. The same rules as the server's (`ScriptStructureBodySchema`, `scriptStructureFaults`), so that the
 * screen refuses what the server would, at the same place.
 */

export type Draft = ScriptStructureBody;

/** A new structure: one stage to start from, in the « Rouge » colour. */
export function emptyDraft(): Draft {
  return {
    name: 'Nouvelle structure',
    moment: 'night',
    color: SCRIPT_COLOR_PRESETS[0].color,
    reservedCreatorId: null,
    segments: [newStage([])],
  };
}

/** A key not yet taken: `etape-1`, `etape-2`…, stable once given (rule 1 of ADR 0056 § 1). */
function freeKey(prefix: string, taken: readonly string[]): string {
  for (let n = 1; ; n += 1) {
    const key = `${prefix}-${String(n)}`;
    if (!taken.includes(key)) return key;
  }
}

const keysOf = (segments: readonly ScriptSegment[]): string[] => segments.map((segment) => segment.key);

/** A stage as OnlyScript started one: three photos and a video of 1 to 2 minutes, paid. */
export function newStage(taken: readonly string[]): ScriptStage {
  return {
    kind: 'stage',
    key: freeKey('etape', taken),
    name: 'Nouvelle étape',
    intention: 'Ce que l’étape fait comprendre au fan',
    access: 'paid',
    mood: null,
    outfit: null,
    place: null,
    mediaSlots: [photo(), photo(), photo(), video()],
    variants: [],
  };
}

export const photo = (): MediaSlot => ({ kind: 'image', optional: false, hint: null });
export const video = (): MediaSlot => ({
  kind: 'video',
  optional: false,
  hint: null,
  minSeconds: 60,
  maxSeconds: 120,
});
export const voice = (): MediaSlot => ({ kind: 'audio', optional: false, hint: null, maxSeconds: 30 });

const full = (segments: readonly ScriptSegment[]): boolean => segments.length >= SCRIPT_SEGMENTS_MAX;

/** A stage added after `index` (at the end with `null`). */
export function addStage(segments: readonly ScriptSegment[], index: number | null): ScriptSegment[] {
  if (full(segments)) return [...segments];
  const at = index === null ? segments.length : index + 1;
  return [...segments.slice(0, at), newStage(keysOf(segments)), ...segments.slice(at)];
}

/**
 * Whether a bridge fits right after `index`: between two stages next to each other (rule 3 of ADR 0056 § 1 reads a
 * bridge by its two keys, the screen only offers it where it reads).
 */
export function canBridgeAfter(segments: readonly ScriptSegment[], index: number): boolean {
  const before = segments[index];
  const after = segments[index + 1];
  return !full(segments) && before?.kind === 'stage' && after?.kind === 'stage';
}

/** A bridge between the stage at `index` and the next one, with its teaser photo. */
export function addBridgeAfter(segments: readonly ScriptSegment[], index: number): ScriptSegment[] {
  const before = segments[index];
  const after = segments[index + 1];
  if (!canBridgeAfter(segments, index) || before === undefined || after === undefined) return [...segments];
  const bridge: ScriptBridge = {
    kind: 'bridge',
    key: freeKey('pont', keysOf(segments)),
    from: before.key,
    to: after.key,
    teaser: 'Faire comprendre au fan ce qui vient ensuite',
    mediaSlots: [{ kind: 'image', optional: false, hint: 'Photo teasing' }],
  };
  return [...segments.slice(0, index + 1), bridge, ...segments.slice(index + 1)];
}

/**
 * Bridges that no longer sit between the two stages they name are dropped, after a stage moved or left: a bridge
 * belongs to its two neighbours.
 */
function keepBridges(segments: readonly ScriptSegment[]): ScriptSegment[] {
  return segments.filter((segment, index) => {
    if (segment.kind !== 'bridge') return true;
    return segments[index - 1]?.key === segment.from && segments[index + 1]?.key === segment.to;
  });
}

/** The segment at `index` moved by one place up (-1) or down (+1); a stage takes no bridge along. */
export function move(segments: readonly ScriptSegment[], index: number, delta: -1 | 1): ScriptSegment[] {
  const target = index + delta;
  const moving = segments[index];
  if (moving === undefined || target < 0 || target >= segments.length) return [...segments];
  const without = segments.filter((_, at) => at !== index);
  const moved = [...without.slice(0, target), moving, ...without.slice(target)];
  return keepBridges(moved);
}

/** The segment at `index` removed, with the bridges that named it. The last stage stays. */
export function remove(segments: readonly ScriptSegment[], index: number): ScriptSegment[] {
  const gone = segments[index];
  if (gone === undefined) return [...segments];
  if (gone.kind === 'stage' && segments.filter((segment) => segment.kind === 'stage').length === 1) {
    return [...segments];
  }
  return keepBridges(segments.filter((_, at) => at !== index));
}

/** The segment at `index` replaced. */
export function replace(
  segments: readonly ScriptSegment[],
  index: number,
  next: ScriptSegment,
): ScriptSegment[] {
  return segments.map((segment, at) => (at === index ? next : segment));
}

/** The next series letter of a stage, or `null` when it has the three. */
export function nextLetter(stage: ScriptStage): (typeof SCRIPT_VARIANT_LETTERS)[number] | null {
  return SCRIPT_VARIANT_LETTERS.find((letter) => !stage.variants.some((v) => v.letter === letter)) ?? null;
}

/** « ÉTAPE 2 », « PONT 2 & 3 »: what the card will title the segment. */
export function segmentTitles(segments: readonly ScriptSegment[]): Map<string, string> {
  const codes = new Map(scriptSegmentCodes(segments).map((code) => [code.key, code.code.slice(1)]));
  return new Map(
    segments.map((segment) => [
      segment.key,
      segment.kind === 'stage'
        ? `Étape ${codes.get(segment.key) ?? '?'}`
        : `Pont ${codes.get(segment.from) ?? '?'} & ${codes.get(segment.to) ?? '?'}`,
    ]),
  );
}

/** What the server would refuse, by place: `name`, `color`, a segment's key, or `''` for the whole structure. */
export function issuesOf(draft: Draft): Map<string, string[]> {
  const parsed = ScriptStructureBodySchema.safeParse(draft);
  const issues = new Map<string, string[]>();
  if (parsed.success) return issues;
  for (const issue of parsed.error.issues) {
    const [field, index] = issue.path;
    const place =
      field === 'segments' && typeof index === 'number'
        ? (draft.segments[index]?.key ?? '')
        : typeof field === 'string'
          ? field
          : '';
    issues.set(place, [...(issues.get(place) ?? []), messageOf(issue.message, issue.code)]);
  }
  return issues;
}

/** Zod's English for an empty or too long text, said in French; the contract's own messages are French already. */
function messageOf(message: string, code: string): string {
  if (code === 'too_small') return 'Un champ est vide';
  if (code === 'too_big') return 'Un texte est trop long';
  if (code === 'custom') return message;
  return 'Une valeur n’est pas acceptée';
}

/** The ink a colour's cards are written in, or `null`: no ink reads on it, the colour is refused. */
export const inkOf = (color: ScriptColor): string | null => scriptCardInk(color);

/** A flat colour from one tone: the three tones the same, as OnlyScript's single colours. */
export const flat = (tone: string): ScriptColor => ({ primary: tone, secondary: tone, accent: tone });

/** The preset a colour is, if any. */
export const presetOf = (color: ScriptColor): string | null =>
  SCRIPT_COLOR_PRESETS.find(
    (preset) =>
      preset.color.primary === color.primary &&
      preset.color.secondary === color.secondary &&
      preset.color.accent === color.accent,
  )?.key ?? null;

/** « 3 photos, 1 vidéo » for the stack's rows. */
export function slotsSummary(slots: readonly MediaSlot[]): string {
  const count = (kind: MediaSlot['kind']): number => slots.filter((slot) => slot.kind === kind).length;
  const part = (n: number, one: string, many: string): string[] =>
    n === 0 ? [] : [`${String(n)} ${n > 1 ? many : one}`];
  const parts = [
    ...part(count('image'), 'photo', 'photos'),
    ...part(count('video'), 'vidéo', 'vidéos'),
    ...part(count('audio'), 'vocal', 'vocaux'),
  ];
  return parts.length === 0 ? 'Rien à tourner' : parts.join(', ');
}

/** The stack in one line, above it: « 4 étapes · 1 pont · 12 photos, 4 vidéos ». */
export function stackSummary(segments: readonly ScriptSegment[]): string {
  const stages = segments.filter((segment) => segment.kind === 'stage').length;
  const bridges = segments.length - stages;
  const parts = [`${String(stages)} étape${stages > 1 ? 's' : ''}`];
  if (bridges > 0) parts.push(`${String(bridges)} pont${bridges > 1 ? 's' : ''}`);
  const slots = segments.flatMap((segment) => segment.mediaSlots);
  if (slots.length > 0) parts.push(slotsSummary(slots));
  return parts.join(' · ');
}
