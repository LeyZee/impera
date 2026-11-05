import { z } from 'zod';

import { CreatorIdSchema } from './ids';

/**
 * Script structures (ADR 0056 § 1, SC-01): the agency's library of scripts to shoot. A structure is an ordered list of
 * segments, a stage (`stage`: what it sells, the media to shoot, up to three variants) or a bridge (`bridge`: a teaser
 * between the two stages next to it). A version is what a creator is asked to shoot: once asked, it never changes and
 * a change writes the next version. The rules a structure obeys live here, so that the server and the screen say the
 * same thing: `scriptStructureFaults`.
 */

export const ScriptStructureIdSchema = z.uuid().brand<'ScriptStructureId'>();
export type ScriptStructureId = z.infer<typeof ScriptStructureIdSchema>;

export const ScriptStructureVersionIdSchema = z.uuid().brand<'ScriptStructureVersionId'>();
export type ScriptStructureVersionId = z.infer<typeof ScriptStructureVersionIdSchema>;

/** Jour, Nuit, or both: the request decides which a « both » structure is shot as (ADR 0056 § 5). */
export const SCRIPT_MOMENTS = ['day', 'night', 'both'] as const;
export const ScriptMomentSchema = z.enum(SCRIPT_MOMENTS);
export type ScriptMoment = z.infer<typeof ScriptMomentSchema>;

export const MEDIA_SLOT_KINDS = ['image', 'video', 'audio'] as const;
export const MediaSlotKindSchema = z.enum(MEDIA_SLOT_KINDS);
export type MediaSlotKind = z.infer<typeof MediaSlotKindSchema>;

export const SCRIPT_VARIANT_LETTERS = ['A', 'B', 'C'] as const;
export const ScriptVariantLetterSchema = z.enum(SCRIPT_VARIANT_LETTERS);
export type ScriptVariantLetter = z.infer<typeof ScriptVariantLetterSchema>;

export const SCRIPT_STRUCTURE_NAME_MAX = 60;
export const SCRIPT_STAGE_NAME_MAX = 40;
/** The intention, the mood, a bridge's teaser: one sentence each. */
export const SCRIPT_SENTENCE_MAX = 160;
/** What to shoot in one slot (« de dos, en lingerie »). */
export const MEDIA_SLOT_HINT_MAX = 120;
export const SCRIPT_SEGMENTS_MAX = 24;
export const MEDIA_SLOTS_MAX = 12;
/** A video slot lasts 30 minutes at most. */
export const VIDEO_SLOT_SECONDS_MAX = 1800;
/** An audio slot (a voice note) lasts 5 minutes at most. */
export const AUDIO_SLOT_SECONDS_MAX = 300;
/** The structures waiting to be asked of one creator. */
export const SCRIPT_QUEUE_MAX = 20;

/**
 * A segment's key: chosen once, never changed (rule 1). Renaming a stage changes its name, not its key; a bridge names
 * its stages by their keys (rule 3).
 */
export const ScriptSegmentKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
export type ScriptSegmentKey = z.infer<typeof ScriptSegmentKeySchema>;

const sentence = (max: number) => z.string().trim().min(1).max(max);
const hint = sentence(MEDIA_SLOT_HINT_MAX).nullable();

/** One frame to fill on the card: a photo, a video between two lengths, or a voice note. */
export const MediaSlotSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('image'), optional: z.boolean(), hint }),
  z
    .strictObject({
      kind: z.literal('video'),
      optional: z.boolean(),
      hint,
      minSeconds: z.number().int().min(1).max(VIDEO_SLOT_SECONDS_MAX),
      maxSeconds: z.number().int().min(1).max(VIDEO_SLOT_SECONDS_MAX),
    })
    .refine((slot) => slot.minSeconds <= slot.maxSeconds, {
      message: 'La durée minimale dépasse la durée maximale',
      path: ['minSeconds'],
    }),
  z.strictObject({
    kind: z.literal('audio'),
    optional: z.boolean(),
    hint,
    maxSeconds: z.number().int().min(1).max(AUDIO_SLOT_SECONDS_MAX),
  }),
]);
export type MediaSlot = z.infer<typeof MediaSlotSchema>;

/** Another take of the same stage, with the same media slots: its own letter, and what differs in one sentence. */
export const ScriptVariantSchema = z.strictObject({
  letter: ScriptVariantLetterSchema,
  hint: sentence(SCRIPT_SENTENCE_MAX),
});
export type ScriptVariant = z.infer<typeof ScriptVariantSchema>;

/**
 * Offered or paid: what the card says, « (GRATUIT) » or « (PAYANT) » (ADR 0064 § 3). Never a price, and never read by
 * the agent: it does not sell by it (Agent's review of SC-01 b). A stage written before ADR 0064 is « paid ».
 */
export const SCRIPT_STAGE_ACCESS = ['free', 'paid'] as const;
export const ScriptStageAccessSchema = z.enum(SCRIPT_STAGE_ACCESS);
export type ScriptStageAccess = z.infer<typeof ScriptStageAccessSchema>;

/** A bridge's media: a teaser photo, most of the time (ADR 0064 § 3). */
export const BRIDGE_MEDIA_SLOTS_MAX = 3;

export const ScriptStageSchema = z.strictObject({
  kind: z.literal('stage'),
  key: ScriptSegmentKeySchema,
  name: sentence(SCRIPT_STAGE_NAME_MAX),
  /** What it sells, in one sentence. */
  intention: sentence(SCRIPT_SENTENCE_MAX),
  access: ScriptStageAccessSchema,
  /** The mood the card gives her. */
  mood: sentence(SCRIPT_SENTENCE_MAX).nullable(),
  /**
   * What she wears and where she shoots (« Lingerie noire », « Salon »): the shooting order groups the stages by them
   * (SC-07), the selling order stays the structure's. `null` when the agency leaves it to her; a stage written before
   * them has none.
   */
  outfit: sentence(SCRIPT_STAGE_NAME_MAX).nullable().default(null),
  place: sentence(SCRIPT_STAGE_NAME_MAX).nullable().default(null),
  mediaSlots: z.array(MediaSlotSchema).max(MEDIA_SLOTS_MAX),
  variants: z.array(ScriptVariantSchema).max(SCRIPT_VARIANT_LETTERS.length),
});
export type ScriptStage = z.infer<typeof ScriptStageSchema>;

export const ScriptBridgeSchema = z.strictObject({
  kind: z.literal('bridge'),
  key: ScriptSegmentKeySchema,
  /** The stage just before it and the one just after, by their keys. */
  from: ScriptSegmentKeySchema,
  to: ScriptSegmentKeySchema,
  teaser: sentence(SCRIPT_SENTENCE_MAX),
  /** Always offered: its card says « (GRATUIT) ». */
  mediaSlots: z.array(MediaSlotSchema).max(BRIDGE_MEDIA_SLOTS_MAX),
});
export type ScriptBridge = z.infer<typeof ScriptBridgeSchema>;

export const ScriptSegmentSchema = z.discriminatedUnion('kind', [ScriptStageSchema, ScriptBridgeSchema]);
export type ScriptSegment = z.infer<typeof ScriptSegmentSchema>;

export const SCRIPT_STRUCTURE_FAULT_CODES = [
  'no_stage',
  'duplicate_key',
  'stage_without_slot',
  'duplicate_variant',
  'bridge_unknown_stage',
  'bridge_not_adjacent',
  'duplicate_bridge',
] as const;
export const ScriptStructureFaultCodeSchema = z.enum(SCRIPT_STRUCTURE_FAULT_CODES);
export type ScriptStructureFaultCode = z.infer<typeof ScriptStructureFaultCodeSchema>;

export interface ScriptStructureFault {
  readonly code: ScriptStructureFaultCode;
  /** The segment at fault, `null` for the whole structure. */
  readonly key: string | null;
  /** French, for the screen. */
  readonly message: string;
}

/**
 * What keeps a list of segments from being a structure (ADR 0056 § 1): at least one stage; keys unique (rule 1); a
 * stage has a slot (rule 4) and unique variant letters (rule 5); a bridge names stages that exist (rule 3), and they
 * are the stage just before it and the one just after, one bridge between two stages at most. Empty: it is one.
 */
export function scriptStructureFaults(segments: readonly ScriptSegment[]): ScriptStructureFault[] {
  const faults: ScriptStructureFault[] = [];
  const stages = new Map<string, ScriptStage>();
  for (const segment of segments) if (segment.kind === 'stage') stages.set(segment.key, segment);
  if (stages.size === 0)
    faults.push({ code: 'no_stage', key: null, message: 'Une structure a au moins une étape' });

  const seen = new Set<string>();
  for (const segment of segments) {
    if (seen.has(segment.key))
      faults.push({ code: 'duplicate_key', key: segment.key, message: `Clé en double : ${segment.key}` });
    seen.add(segment.key);
  }

  const bridged = new Set<string>();
  segments.forEach((segment, index) => {
    if (segment.kind === 'stage') {
      if (segment.mediaSlots.length === 0)
        faults.push({
          code: 'stage_without_slot',
          key: segment.key,
          message: `L’étape « ${segment.name} » n’a aucun média à tourner`,
        });
      const letters = segment.variants.map((variant) => variant.letter);
      if (new Set(letters).size !== letters.length)
        faults.push({
          code: 'duplicate_variant',
          key: segment.key,
          message: `L’étape « ${segment.name} » a deux variantes de la même lettre`,
        });
      return;
    }
    if (!stages.has(segment.from) || !stages.has(segment.to)) {
      faults.push({
        code: 'bridge_unknown_stage',
        key: segment.key,
        message: 'Un pont relie une étape qui n’existe pas',
      });
      return;
    }
    const before = segments.slice(0, index).findLast((other) => other.kind === 'stage');
    const after = segments.slice(index + 1).find((other) => other.kind === 'stage');
    if (before?.key !== segment.from || after?.key !== segment.to) {
      faults.push({
        code: 'bridge_not_adjacent',
        key: segment.key,
        message: 'Un pont relie l’étape juste avant lui à celle juste après',
      });
      return;
    }
    const pair = `${segment.from}>${segment.to}`;
    if (bridged.has(pair))
      faults.push({
        code: 'duplicate_bridge',
        key: segment.key,
        message: 'Deux ponts relient les mêmes étapes',
      });
    bridged.add(pair);
  });
  return faults;
}

/** Each segment's place and code (rule 2): `E<n>` for the n-th stage, its variants sharing it; `P<n><m>` for a bridge. */
export interface ScriptSegmentCode {
  readonly key: string;
  /** 1 for the first segment. */
  readonly position: number;
  readonly code: string;
}

/**
 * Derived at each save from the order, never stored: a stage moved takes its new number, its key stays. A bridge reads
 * the numbers of the stages it names; one naming an absent stage reads `P?`, which `scriptStructureFaults` refuses.
 */
export function scriptSegmentCodes(segments: readonly ScriptSegment[]): ScriptSegmentCode[] {
  const numbers = new Map<string, number>();
  for (const segment of segments) if (segment.kind === 'stage') numbers.set(segment.key, numbers.size + 1);
  return segments.map((segment, index) => {
    if (segment.kind === 'stage')
      return { key: segment.key, position: index + 1, code: `E${String(numbers.get(segment.key))}` };
    const from = numbers.get(segment.from);
    const to = numbers.get(segment.to);
    return {
      key: segment.key,
      position: index + 1,
      code: from === undefined || to === undefined ? 'P?' : `P${String(from)}${String(to)}`,
    };
  });
}

/** The segments, refused with the faults' messages at their place. */
export const ScriptSegmentsSchema = z
  .array(ScriptSegmentSchema)
  .min(1)
  .max(SCRIPT_SEGMENTS_MAX)
  .superRefine((segments, ctx) => {
    for (const fault of scriptStructureFaults(segments)) {
      const index = fault.key === null ? -1 : segments.findIndex((segment) => segment.key === fault.key);
      ctx.addIssue({
        code: 'custom',
        message: fault.message,
        path: index === -1 ? [] : [index],
        params: { fault: fault.code },
      });
    }
  });

const HEX_COLOR = /^#[0-9a-f]{6}$/u;
const hex = z.string().regex(HEX_COLOR, { message: 'Une couleur s’écrit #rrggbb, en minuscules' });

/**
 * A script's colour (ADR 0064 § 1): three tones of a diagonal gradient, close tones for a flat one. It is how a
 * script is found at a glance, in a folder, in the vault, on the chatters' screen.
 */
export const ScriptColorSchema = z.strictObject({ primary: hex, secondary: hex, accent: hex });
export type ScriptColor = z.infer<typeof ScriptColorSchema>;

/** The two inks a card is written in: the code picks the one that reads best on the script's colour. */
export const SCRIPT_CARD_INKS = { light: '#ffffff', dark: '#14080e' } as const;
/** WCAG AA for text: below it, on any of the three tones, the colour is refused. */
export const SCRIPT_CARD_MIN_CONTRAST = 4.5;

function luminance(color: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [first, second] = [luminance(a), luminance(b)];
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const mix = (a: string, b: string, share: number): string => {
  const channel = (offset: number): string =>
    Math.round(
      Number.parseInt(a.slice(offset, offset + 2), 16) * (1 - share) +
        Number.parseInt(b.slice(offset, offset + 2), 16) * share,
    )
      .toString(16)
      .padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
};

/**
 * The colours the card's text may sit on: its three tones and the blends between them, as the gradient draws them
 * (in sRGB). A blend can be darker than both its ends: a dark ink is checked on it too (Extension's review of SC-01 b).
 */
function gradientSamples(color: ScriptColor): string[] {
  const shares = [0, 0.25, 0.5, 0.75];
  return [
    ...shares.map((share) => mix(color.primary, color.secondary, share)),
    ...shares.map((share) => mix(color.secondary, color.accent, share)),
    color.accent,
  ];
}

/**
 * The ink of a script's cards: light or dark, whichever has the better contrast on its worst point of the gradient.
 * `null` when neither reaches `SCRIPT_CARD_MIN_CONTRAST` everywhere, the text being drawn in the ink at full opacity: the colour is refused (ADR 0064 § 1).
 */
export function scriptCardInk(color: ScriptColor): string | null {
  const tones = gradientSamples(color);
  const worst = (ink: string): number => Math.min(...tones.map((tone) => contrastRatio(ink, tone)));
  const [ink, score] = [SCRIPT_CARD_INKS.light, SCRIPT_CARD_INKS.dark]
    .map((candidate) => [candidate, worst(candidate)] as const)
    .reduce((best, next) => (next[1] > best[1] ? next : best));
  return score >= SCRIPT_CARD_MIN_CONTRAST ? ink : null;
}

/** A colour whose cards can be read: refused otherwise, with the reason. */
export const ReadableScriptColorSchema = ScriptColorSchema.refine((color) => scriptCardInk(color) !== null, {
  message: 'Le texte du carton ne se lirait pas sur ces tons : choisis des tons plus sombres ou plus clairs',
});

/**
 * Named colours for the workshop, after OnlyScript's (ADR 0064 § 1): flat ones and gradients, each readable (a test
 * holds it). The owner may also pick his own.
 */
export const SCRIPT_COLOR_PRESETS = [
  { key: 'rouge', name: 'Rouge', color: { primary: '#b0213a', secondary: '#c8283f', accent: '#d8324b' } },
  {
    key: 'framboise',
    name: 'Framboise',
    color: { primary: '#9d174d', secondary: '#be185d', accent: '#db2777' },
  },
  { key: 'berry', name: 'Berry', color: { primary: '#5c1029', secondary: '#911e42', accent: '#b03a78' } },
  { key: 'or-rose', name: 'Or rose', color: { primary: '#f7cac9', secondary: '#e0bfb8', accent: '#f3d9d2' } },
  {
    key: 'sunset',
    name: 'Coucher de soleil',
    color: { primary: '#ff7e5f', secondary: '#feb47b', accent: '#ffcc70' },
  },
  { key: 'miami', name: 'Miami', color: { primary: '#ff6ad5', secondary: '#c774e8', accent: '#94d0ff' } },
  { key: 'violet', name: 'Violet', color: { primary: '#3b0764', secondary: '#581c87', accent: '#7e22ce' } },
  { key: 'ocean', name: 'Océan', color: { primary: '#003f63', secondary: '#005f88', accent: '#0077a8' } },
  { key: 'foret', name: 'Forêt', color: { primary: '#0a3d25', secondary: '#0a5f38', accent: '#3f6b4e' } },
  { key: 'desert', name: 'Désert', color: { primary: '#f0c987', secondary: '#e6d5ac', accent: '#f3e5ab' } },
  { key: 'luxe', name: 'Noir et or', color: { primary: '#0f0f0f', secondary: '#1a1a1a', accent: '#3a2f12' } },
  { key: 'pastel', name: 'Pastel', color: { primary: '#ffcad4', secondary: '#c7ceea', accent: '#b5ead7' } },
  { key: 'cerise', name: 'Cerise', color: { primary: '#7a0f24', secondary: '#a3122f', accent: '#c2185b' } },
  {
    key: 'bordeaux',
    name: 'Bordeaux',
    color: { primary: '#3d0a14', secondary: '#5e1224', accent: '#7d1d33' },
  },
  { key: 'corail', name: 'Corail', color: { primary: '#ff8a80', secondary: '#ff9e7a', accent: '#ffb199' } },
  { key: 'peche', name: 'Pêche', color: { primary: '#ffd1b3', secondary: '#ffc2a8', accent: '#ffe0cc' } },
  {
    key: 'champagne',
    name: 'Champagne',
    color: { primary: '#f5e6c8', secondary: '#ead7b0', accent: '#fbf1dc' },
  },
  { key: 'lavande', name: 'Lavande', color: { primary: '#d9ccf5', secondary: '#c9b8ef', accent: '#e8defa' } },
  { key: 'prune', name: 'Prune', color: { primary: '#2e0f3a', secondary: '#4a1a5c', accent: '#6b2a7e' } },
  {
    key: 'nuit',
    name: 'Nuit étoilée',
    color: { primary: '#0b1026', secondary: '#1b2350', accent: '#3a2f7a' },
  },
  { key: 'lagon', name: 'Lagon', color: { primary: '#a8edea', secondary: '#bfe9ff', accent: '#d4fcf0' } },
  { key: 'menthe', name: 'Menthe', color: { primary: '#c8f7dc', secondary: '#b2f0d0', accent: '#e0fbe9' } },
  {
    key: 'emeraude',
    name: 'Émeraude',
    color: { primary: '#04392b', secondary: '#065f46', accent: '#0f766e' },
  },
  {
    key: 'rose-noir',
    name: 'Noir et rose',
    color: { primary: '#120a0f', secondary: '#2a0f1f', accent: '#6b1640' },
  },
] as const satisfies readonly { key: string; name: string; color: ScriptColor }[];

/** What the owner writes in the workshop. */
export const ScriptStructureBodySchema = z.strictObject({
  name: sentence(SCRIPT_STRUCTURE_NAME_MAX),
  moment: ScriptMomentSchema,
  color: ReadableScriptColorSchema,
  /** Kept for one creator: asked of her alone. `null`: any creator. */
  reservedCreatorId: CreatorIdSchema.nullable(),
  segments: ScriptSegmentsSchema,
});
export type ScriptStructureBody = z.infer<typeof ScriptStructureBodySchema>;

/** A new structure, under the client's id: the same body sent again gives what is stored. */
export const CreateScriptStructureBodySchema = ScriptStructureBodySchema.extend({
  id: ScriptStructureIdSchema,
});
export type CreateScriptStructureBody = z.infer<typeof CreateScriptStructureBodySchema>;

/** A change, written over the version the owner read: another one written since is a conflict. */
export const SaveScriptStructureBodySchema = ScriptStructureBodySchema.extend({
  basedOnVersion: z.number().int().min(1),
});
export type SaveScriptStructureBody = z.infer<typeof SaveScriptStructureBodySchema>;

export const ScriptStructureVersionSchema = z.object({
  id: ScriptStructureVersionIdSchema,
  version: z.number().int().min(1),
  name: z.string(),
  moment: ScriptMomentSchema,
  color: ScriptColorSchema,
  segments: z.array(ScriptSegmentSchema),
  /** Asked of a creator, or being shot: it never changes again (rule 6). */
  frozen: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type ScriptStructureVersion = z.infer<typeof ScriptStructureVersionSchema>;

/** A structure of the library, with its latest version. */
export const ScriptStructureSchema = z.object({
  id: ScriptStructureIdSchema,
  reservedCreatorId: CreatorIdSchema.nullable(),
  current: ScriptStructureVersionSchema,
  createdAt: z.iso.datetime(),
});
export type ScriptStructure = z.infer<typeof ScriptStructureSchema>;

export const ScriptStructureListSchema = z.object({ structures: z.array(ScriptStructureSchema) });
export type ScriptStructureList = z.infer<typeof ScriptStructureListSchema>;

/** A stage that touches what she never does, never shows, or is disgusted by: the structure cannot be asked of her. */
export const ScriptDisgustBlockSchema = z.object({
  key: ScriptSegmentKeySchema,
  /** The stage's name, or a bridge's teaser: what the screen shows of the segment. */
  stageName: z.string(),
  /** Her persona's entry, as written there. */
  term: z.string(),
});
export type ScriptDisgustBlock = z.infer<typeof ScriptDisgustBlockSchema>;

/** The structures to ask of one creator next, in order (ADR 0056 § 2). */
export const ScriptQueueBodySchema = z.strictObject({
  structureIds: z
    .array(ScriptStructureIdSchema)
    .max(SCRIPT_QUEUE_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Structure en double dans la file' }),
});
export type ScriptQueueBody = z.infer<typeof ScriptQueueBodySchema>;

export const ScriptQueueEntrySchema = z.object({
  structureId: ScriptStructureIdSchema,
  name: z.string(),
  moment: ScriptMomentSchema,
  version: z.number().int().min(1),
  /** Read again at each view: a persona changed since it was queued can block it. */
  blocks: z.array(ScriptDisgustBlockSchema),
});
export type ScriptQueueEntry = z.infer<typeof ScriptQueueEntrySchema>;

export const ScriptQueueSchema = z.object({
  creatorId: CreatorIdSchema,
  /** `false` without an active persona: her disgusts could not be read, the screen says so in amber. */
  personaChecked: z.boolean(),
  entries: z.array(ScriptQueueEntrySchema),
});
export type ScriptQueue = z.infer<typeof ScriptQueueSchema>;

/** `details` of `script_queue_disgust_unprocessable`: by structure, the stages that touch her limits. */
export const ScriptQueueRefusalsSchema = z.object({
  refusals: z.array(
    z.object({ structureId: ScriptStructureIdSchema, blocks: z.array(ScriptDisgustBlockSchema) }),
  ),
});
export type ScriptQueueRefusals = z.infer<typeof ScriptQueueRefusalsSchema>;

/** `details` of `script_queue_structure_unprocessable`: unknown, archived or reserved for another creator. */
export const ScriptQueueUnprocessableSchema = z.object({ structureIds: z.array(ScriptStructureIdSchema) });

/**
 * The cadence of her scripts (ADR 0056 § 2, SC-02): a script every `days` days, the agency's setting for each creator,
 * never hers. Each request is made `SCRIPT_REQUEST_LEAD_DAYS` before its due day (fewer when the cadence is shorter).
 */
export const SCRIPT_CADENCE_DEFAULT_DAYS = 14;
export const SCRIPT_CADENCE_MIN_DAYS = 1;
export const SCRIPT_CADENCE_MAX_DAYS = 90;
export const SCRIPT_REQUEST_LEAD_DAYS = 7;
export const ScriptCadenceDaysSchema = z
  .number()
  .int()
  .min(SCRIPT_CADENCE_MIN_DAYS)
  .max(SCRIPT_CADENCE_MAX_DAYS);

/**
 * What the cadence did the last time it looked at her (SC-02), for the agency's screen: `asked` (a request made with
 * the next structure of her queue), `reused` (her queue was empty: the last structure asked again, amber), `queue_empty`
 * (nothing ever asked and nothing queued, amber), `no_persona` (no active persona: no request, amber), `blocked` (the
 * structures of her queue touch her limits: each skipped, amber).
 */
export const SCRIPT_CADENCE_OUTCOMES = ['asked', 'reused', 'queue_empty', 'no_persona', 'blocked'] as const;
export const ScriptCadenceOutcomeSchema = z.enum(SCRIPT_CADENCE_OUTCOMES);
export type ScriptCadenceOutcome = z.infer<typeof ScriptCadenceOutcomeSchema>;

/** A structure the cadence skipped: its name, and the stages that touch her limits. */
export const ScriptCadenceSkipSchema = z.strictObject({
  structureId: ScriptStructureIdSchema,
  name: z.string(),
  blocks: z.array(ScriptDisgustBlockSchema),
});
export type ScriptCadenceSkip = z.infer<typeof ScriptCadenceSkipSchema>;

/** `GET` and `PUT /v1/creators/:creatorId/script-cadence`: her cadence, and what it last did. */
export const ScriptCadenceSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  days: ScriptCadenceDaysSchema,
  /** The due day of her last script asked by the cadence; `null` before the first. */
  lastDueOn: z.iso.date().nullable(),
  /** `null` until the cadence first looked at her. */
  outcome: ScriptCadenceOutcomeSchema.nullable(),
  skipped: z.array(ScriptCadenceSkipSchema),
  checkedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type ScriptCadence = z.infer<typeof ScriptCadenceSchema>;

export const SetScriptCadenceBodySchema = z.strictObject({ days: ScriptCadenceDaysSchema });
export type SetScriptCadenceBody = z.infer<typeof SetScriptCadenceBodySchema>;

/** `day` (`YYYY-MM-DD`) moved by `by` days. */
const shiftDay = (day: string, by: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

/**
 * The due day of her next script, when it is time to ask it; `null` when it is not yet. The first is due `lead` days
 * from today; each next one `days` after the last, asked `lead` days before (`SCRIPT_REQUEST_LEAD_DAYS`, at most the
 * cadence). A cadence left idle (no persona for a month) starts again from today: never a request already late. Days
 * are hers (`YYYY-MM-DD` in her zone), never instants.
 */
export function nextScriptDue(lastDueOn: string | null, days: number, today: string): string | null {
  const lead = Math.min(SCRIPT_REQUEST_LEAD_DAYS, days);
  if (lastDueOn === null) return shiftDay(today, lead);
  const due = shiftDay(lastDueOn, days);
  if (shiftDay(due, -lead) > today) return null;
  return due < today ? shiftDay(today, lead) : due;
}

/** Codes of the `scripts` module's `DomainError`s. */
export const SCRIPT_ERROR_CODES = [
  'script_structure_not_found',
  /** The id is taken by another structure, or an archived one. */
  'script_structure_conflict',
  /** Another version was written since `basedOnVersion`. */
  'script_structure_stale_conflict',
  /** Reserved for another creator, or unknown: never written. */
  'script_structure_creator_invalid',
  'script_queue_creator_not_found',
  /** Unknown, archived or reserved for another creator: `details.structureIds`. */
  'script_queue_structure_unprocessable',
  /** A stage touches her disgusts: `details.blocks` by structure. */
  'script_queue_disgust_unprocessable',
  'script_cadence_creator_not_found',
  /** The structure has no such segment, or the stage no such variant. */
  'script_card_not_found',
] as const;
export type ScriptErrorCode = (typeof SCRIPT_ERROR_CODES)[number];

/** The sizes a card is drawn in (ADR 0056 § 3): in the app (SVG), in the folder and as a thumbnail (PNG). */
export const SCRIPT_CARD_FORMATS = ['card', 'folder', 'thumbnail'] as const;
export const ScriptCardFormatSchema = z.enum(SCRIPT_CARD_FORMATS);
export type ScriptCardFormat = z.infer<typeof ScriptCardFormatSchema>;

export const ScriptCardParamsSchema = z.strictObject({
  structureId: ScriptStructureIdSchema,
  segmentKey: ScriptSegmentKeySchema,
});

export const ScriptCardQuerySchema = z.strictObject({
  format: ScriptCardFormatSchema.default('card'),
  /** One of the stage's variants: its series card. */
  variant: ScriptVariantLetterSchema.optional(),
});
export type ScriptCardQuery = z.infer<typeof ScriptCardQuerySchema>;

/**
 * A card drawn from a draft, before it is saved: the workshop's live preview (SC-01 lot c). The segments are read one
 * by one, not against the structure rules, so that a draft still being written can be previewed; the colour is any
 * colour, a refused one being drawn in the dark ink. Always an SVG.
 */
export const ScriptCardPreviewBodySchema = z.strictObject({
  name: sentence(SCRIPT_STRUCTURE_NAME_MAX),
  moment: ScriptMomentSchema,
  color: ScriptColorSchema,
  segments: z.array(ScriptSegmentSchema).min(1).max(SCRIPT_SEGMENTS_MAX),
  segmentKey: ScriptSegmentKeySchema,
  variant: ScriptVariantLetterSchema.optional(),
  format: z.enum(['card', 'thumbnail']).default('card'),
});
export type ScriptCardPreviewBody = z.infer<typeof ScriptCardPreviewBodySchema>;
