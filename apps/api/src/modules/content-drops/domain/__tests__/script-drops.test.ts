import {
  ContentDropFileSchema,
  scriptSlots,
  type ContentDropFile,
  type DropFileState,
  type ScriptSegment,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { requiredSlotsMissing, slotOf } from '../script-drops';

/** Invented segments (SC-01): a photo she may not leave out, a video she may. */
const segments: ScriptSegment[] = [
  {
    kind: 'stage',
    key: 'salon',
    name: 'Salon',
    intention: 'Elle se dévoile un peu',
    access: 'free',
    mood: null,
    outfit: null,
    place: null,
    mediaSlots: [
      { kind: 'image', optional: false, hint: null },
      { kind: 'video', optional: true, hint: null, minSeconds: 5, maxSeconds: 20 },
      { kind: 'image', optional: false, hint: null },
    ],
    variants: [],
  },
];
const slots = scriptSlots(segments);

const fileIn = (slotKey: string, state: DropFileState): ContentDropFile =>
  ContentDropFileSchema.parse({
    id: crypto.randomUUID(),
    position: slotOf(slots, slotKey)?.position ?? 0,
    kind: 'image',
    mime: 'image/jpeg',
    bytes: 1000,
    state,
    refusal: state === 'refused' ? 'Cet emplacement attend au moins 5 s' : null,
    slotKey,
  });

describe('« Envoyer le script » (SC-02 lot b)', () => {
  it('names each slot she may not leave out that is empty or refused, in the script’s order', () => {
    expect(requiredSlotsMissing(slots, [])).toEqual(['salon::0', 'salon::2']);
    expect(
      requiredSlotsMissing(slots, [fileIn('salon::0', 'awaiting'), fileIn('salon::2', 'refused')]),
    ).toEqual(['salon::2']);
    // A file still going up counts, and the optional video may stay empty.
    expect(requiredSlotsMissing(slots, [fileIn('salon::0', 'kept'), fileIn('salon::2', 'awaiting')])).toEqual(
      [],
    );
  });

  it('finds a slot by its key, none for a key the script does not have', () => {
    expect(slotOf(slots, 'salon::1')?.slot.kind).toBe('video');
    expect(slotOf(slots, 'salon:A:1')).toBeUndefined();
  });
});
