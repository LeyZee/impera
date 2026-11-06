import { describe, expect, it } from 'vitest';

import { slotDurationRefusal, slotFileRefusal, slotLengths } from './content-drops';
import { scriptSlots, ScriptSlotKeySchema, type ScriptSegment } from './scripts';

const MB = 1024 * 1024;

/** Invented segments: never a real structure of the agency (SC-01). */
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
    ],
    variants: [],
  },
  {
    kind: 'bridge',
    key: 'pont',
    from: 'salon',
    to: 'chambre',
    teaser: 'La suite est dans la chambre',
    mediaSlots: [{ kind: 'image', optional: false, hint: null }],
  },
  {
    kind: 'stage',
    key: 'chambre',
    name: 'Chambre',
    intention: 'Elle se dévoile plus',
    access: 'paid',
    mood: null,
    outfit: null,
    place: null,
    mediaSlots: [{ kind: 'audio', optional: false, hint: null, maxSeconds: 30 }],
    variants: [
      { letter: 'A', hint: 'Lumière tamisée' },
      { letter: 'B', hint: 'Plein jour' },
    ],
  },
];

describe('the slots of a script (SC-02 lot b)', () => {
  it('reads each segment in order, each series of a stage whole, each slot at its place', () => {
    const slots = scriptSlots(segments);
    expect(slots.map((slot) => [slot.key, slot.code, slot.position])).toEqual([
      ['salon::0', 'E1', 0],
      ['salon::1', 'E1', 1],
      ['pont::0', 'P12', 2],
      ['chambre:A:0', 'E2A', 3],
      ['chambre:B:0', 'E2B', 4],
    ]);
    for (const slot of slots) expect(ScriptSlotKeySchema.safeParse(slot.key).success).toBe(true);
  });

  it('refuses a file of another kind, then the script’s weights', () => {
    const [photo, clip] = scriptSlots(segments);
    if (photo === undefined || clip === undefined) throw new Error('no slots');
    expect(slotFileRefusal(photo.slot, { mime: 'video/mp4', bytes: 10 * MB })).toBe(
      'Cet emplacement attend une photo',
    );
    expect(slotFileRefusal(clip.slot, { mime: 'image/jpeg', bytes: MB })).toBe(
      'Cet emplacement attend une vidéo',
    );
    expect(slotFileRefusal(photo.slot, { mime: 'image/jpeg', bytes: MB })).toBeNull();
    expect(slotFileRefusal(photo.slot, { mime: 'image/jpeg', bytes: 31 * MB })).not.toBeNull();
  });

  it('keeps a video’s two ends and a vocal’s longest, read on the cleaned file', () => {
    const slots = scriptSlots(segments);
    expect(slots.map((slot) => slotLengths(slot.slot))).toEqual([
      null,
      { minSeconds: 5, maxSeconds: 20 },
      null,
      { minSeconds: 1, maxSeconds: 30 },
      { minSeconds: 1, maxSeconds: 30 },
    ]);
    const lengths = { minSeconds: 5, maxSeconds: 20 };
    expect(slotDurationRefusal(lengths, 4_900)).toBe('Cet emplacement attend au moins 5 s');
    expect(slotDurationRefusal(lengths, 20_400)).toBe('Cet emplacement attend au plus 20 s');
    expect(slotDurationRefusal(lengths, 12_000)).toBeNull();
    expect(slotDurationRefusal(null, 90_000)).toBeNull();
    expect(slotDurationRefusal(lengths, null)).toBeNull();
  });
});
