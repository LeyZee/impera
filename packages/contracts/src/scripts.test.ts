import { describe, expect, it } from 'vitest';

import {
  MediaSlotSchema,
  ScriptQueueBodySchema,
  scriptSegmentCodes,
  ScriptSegmentsSchema,
  scriptStructureFaults,
  type ScriptSegment,
  type ScriptStage,
} from './scripts';

/** An invented stage: one photo to shoot unless told otherwise. */
function stage(key: string, extra: Partial<ScriptStage> = {}): ScriptStage {
  return {
    kind: 'stage',
    key,
    name: `Étape ${key}`,
    intention: 'Elle se dévoile un peu',
    mood: null,
    mediaSlots: [{ kind: 'image', optional: false, hint: null }],
    variants: [],
    ...extra,
  };
}

const bridge = (key: string, from: string, to: string): ScriptSegment => ({
  kind: 'bridge',
  key,
  from,
  to,
  teaser: 'La suite arrive',
});

const codes = (segments: readonly ScriptSegment[]) =>
  scriptStructureFaults(segments).map((fault) => fault.code);

describe('scriptStructureFaults', () => {
  it('accepts stages joined by bridges between neighbours', () => {
    expect(scriptStructureFaults([stage('a'), bridge('ab', 'a', 'b'), stage('b'), stage('c')])).toEqual([]);
  });

  it('asks for at least one stage', () => {
    expect(codes([])).toEqual(['no_stage']);
  });

  it('refuses a key used twice (rule 1)', () => {
    expect(codes([stage('a'), stage('a')])).toContain('duplicate_key');
  });

  it('refuses a stage without a slot (rule 4)', () => {
    const faults = scriptStructureFaults([stage('a', { mediaSlots: [] })]);
    expect(faults).toEqual([
      { code: 'stage_without_slot', key: 'a', message: 'L’étape « Étape a » n’a aucun média à tourner' },
    ]);
  });

  it('refuses two variants of the same letter (rule 5)', () => {
    const variants = [
      { letter: 'A', hint: 'Au salon' },
      { letter: 'A', hint: 'Dans la cuisine' },
    ] as const;
    expect(codes([stage('a', { variants: [...variants] })])).toEqual(['duplicate_variant']);
  });

  it('refuses a bridge to a stage that is not there (rule 3)', () => {
    expect(codes([stage('a'), bridge('ax', 'a', 'x'), stage('b')])).toEqual(['bridge_unknown_stage']);
  });

  it('keeps a bridge between the stage just before it and the one just after', () => {
    expect(codes([stage('a'), stage('b'), bridge('ac', 'a', 'c'), stage('c')])).toEqual([
      'bridge_not_adjacent',
    ]);
    expect(codes([stage('a'), bridge('ba', 'b', 'a'), stage('b')])).toEqual(['bridge_not_adjacent']);
    expect(codes([bridge('ab', 'a', 'b'), stage('a'), stage('b')])).toEqual(['bridge_not_adjacent']);
    expect(codes([stage('a'), stage('b'), bridge('ab', 'a', 'b')])).toEqual(['bridge_not_adjacent']);
  });

  it('refuses two bridges between the same stages', () => {
    expect(codes([stage('a'), bridge('ab', 'a', 'b'), bridge('ab2', 'a', 'b'), stage('b')])).toEqual([
      'duplicate_bridge',
    ]);
  });

  it('finds a bridge broken by a reorder, by its keys', () => {
    const before = [stage('a'), bridge('ab', 'a', 'b'), stage('b'), stage('c')];
    const moved = [stage('b'), bridge('ab', 'a', 'b'), stage('a'), stage('c')];
    expect(codes(before)).toEqual([]);
    expect(codes(moved)).toEqual(['bridge_not_adjacent']);
  });
});

describe('scriptSegmentCodes', () => {
  it('numbers stages by their place, bridges by the stages they join (rule 2)', () => {
    expect(scriptSegmentCodes([stage('x'), bridge('xy', 'x', 'y'), stage('y'), stage('z')])).toEqual([
      { key: 'x', position: 1, code: 'E1' },
      { key: 'xy', position: 2, code: 'P12' },
      { key: 'y', position: 3, code: 'E2' },
      { key: 'z', position: 4, code: 'E3' },
    ]);
  });

  it('gives a moved stage its new number and keeps its key', () => {
    expect(scriptSegmentCodes([stage('z'), stage('x')]).map((c) => `${c.key}:${c.code}`)).toEqual([
      'z:E1',
      'x:E2',
    ]);
  });

  it('shares the number between the variants of a stage', () => {
    const variants = [
      { letter: 'A', hint: 'Au salon' },
      { letter: 'B', hint: 'Dans la cuisine' },
    ] as const;
    expect(scriptSegmentCodes([stage('a', { variants: [...variants] }), stage('b')])).toEqual([
      { key: 'a', position: 1, code: 'E1' },
      { key: 'b', position: 2, code: 'E2' },
    ]);
  });

  it('reads P? for a bridge to an absent stage', () => {
    expect(scriptSegmentCodes([stage('a'), bridge('ax', 'a', 'x')])[1]?.code).toBe('P?');
  });
});

describe('schemas', () => {
  it('refuses the segments with the fault at its place', () => {
    const result = ScriptSegmentsSchema.safeParse([stage('a'), stage('b', { mediaSlots: [] })]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([1]);
  });

  it('refuses a video whose shortest length passes its longest', () => {
    expect(
      MediaSlotSchema.safeParse({
        kind: 'video',
        optional: false,
        hint: null,
        minSeconds: 120,
        maxSeconds: 60,
      }).success,
    ).toBe(false);
    expect(
      MediaSlotSchema.safeParse({
        kind: 'video',
        optional: false,
        hint: null,
        minSeconds: 60,
        maxSeconds: 120,
      }).success,
    ).toBe(true);
  });

  it('refuses more than three variants and an unknown letter', () => {
    const many = ['A', 'B', 'C', 'A'].map((letter) => ({ letter, hint: 'Ailleurs' }));
    expect(ScriptSegmentsSchema.safeParse([{ ...stage('a'), variants: many }]).success).toBe(false);
    expect(
      ScriptSegmentsSchema.safeParse([{ ...stage('a'), variants: [{ letter: 'D', hint: 'x' }] }]).success,
    ).toBe(false);
  });

  it('refuses a key that is not lowercase letters, digits and dashes', () => {
    expect(ScriptSegmentsSchema.safeParse([stage('Étape 1')]).success).toBe(false);
  });

  it('refuses a structure twice in a queue', () => {
    const id = '0196f3a4-0000-7000-8000-000000000001';
    expect(ScriptQueueBodySchema.safeParse({ structureIds: [id, id] }).success).toBe(false);
  });
});
