import {
  ContentDropFileSchema,
  ContentDropSchema,
  ContentRequestSchema,
  ScriptDropSchema,
  type ContentDrop,
  type ContentDropFile,
  type ContentRequest,
  type ScriptDrop,
  type ScriptSegment,
} from '@impera/contracts';

/* Invented requests and drops for the tests (ADR 0010): no real creator, no real file. */

let next = 0;
const uuid = (): string => {
  next += 1;
  return `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
};

export const requestOf = (fields: Partial<ContentRequest> = {}): ContentRequest =>
  ContentRequestSchema.parse({
    id: uuid(),
    category: 'feed_shoot',
    dueOn: '2026-11-07',
    reason: 'Une séance en lingerie noire pour le feed',
    structureId: null,
    structureVersionId: null,
    origin: 'agency',
    state: 'open',
    refusalReason: null,
    dropId: null,
    createdAt: '2026-11-04T09:00:00.000Z',
    ...fields,
  });

export const fileOf = (fields: Partial<ContentDropFile> = {}): ContentDropFile =>
  ContentDropFileSchema.parse({
    id: uuid(),
    position: 0,
    kind: 'image',
    mime: 'image/jpeg',
    bytes: 4_000_000,
    state: 'kept',
    refusal: null,
    slotKey: null,
    ...fields,
  });

export const dropOf = (fields: Partial<ContentDrop> = {}): ContentDrop =>
  ContentDropSchema.parse({
    id: uuid(),
    category: 'feed_shoot',
    correctedFrom: null,
    sentence: null,
    state: 'ready',
    blockedReason: null,
    requestId: null,
    files: [fileOf()],
    createdAt: '2026-11-05T10:00:00.000Z',
    ...fields,
  });

/** An invented script (SC-02 lot b2): a stage, a bridge, a stage shot in two series. Never a structure of the agency. */
export const scriptSegments: ScriptSegment[] = [
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
      { kind: 'image', optional: false, hint: 'De face, le regard vers toi' },
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

export const scriptDropOf = (drop: Partial<ContentDrop> = {}): ScriptDrop =>
  ScriptDropSchema.parse({
    drop: dropOf({ category: 'script', state: 'filling', files: [], requestId: requestOf().id, ...drop }),
    name: 'Soirée au salon',
    segments: scriptSegments,
  });
