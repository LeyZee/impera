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

export const ScriptStageSchema = z.strictObject({
  kind: z.literal('stage'),
  key: ScriptSegmentKeySchema,
  name: sentence(SCRIPT_STAGE_NAME_MAX),
  /** What it sells, in one sentence. */
  intention: sentence(SCRIPT_SENTENCE_MAX),
  /** The mood the card gives her. */
  mood: sentence(SCRIPT_SENTENCE_MAX).nullable(),
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

/** What the owner writes in the workshop. */
export const ScriptStructureBodySchema = z.strictObject({
  name: sentence(SCRIPT_STRUCTURE_NAME_MAX),
  moment: ScriptMomentSchema,
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
] as const;
export type ScriptErrorCode = (typeof SCRIPT_ERROR_CODES)[number];
