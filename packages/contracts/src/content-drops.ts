import { z } from 'zod';

import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentRequestIdSchema,
  MediaAssetIdSchema,
  MediaDescriptionIdSchema,
  ScriptDropSummaryIdSchema,
} from './ids';
import { DescriptionReviewReasonSchema } from './media';
import {
  ScriptSegmentKeySchema,
  ScriptSegmentSchema,
  ScriptSlotKeySchema,
  ScriptStructureIdSchema,
  ScriptStructureVersionIdSchema,
  ShotMomentSchema,
  ScriptVariantLetterSchema,
  type MediaSlot,
} from './scripts';

/**
 * The closed list of drop categories (ADR 0055 § 1, glossary « Catégorie de dépôt »): the creator chooses it, the code
 * never guesses or changes it, and a medium goes only to its category's output.
 */
export const DROP_CATEGORIES = [
  'feed_shoot',
  'feed_video',
  'script',
  'mass_dm',
  'reveal_story',
  'instagram_story',
  'instagram_reel',
  'instagram_post',
  'telegram_post',
] as const;
export const DropCategorySchema = z.enum(DROP_CATEGORIES);
export type DropCategory = z.infer<typeof DropCategorySchema>;

/**
 * The categories an idea or a shoot suggestion may ask (ADR 0060 § 4): every drop category but `script`. A script is
 * asked with a structure of the library and its frozen version (ADR 0056), chosen by the team: an idea, written by the
 * model or corrected by the agency, never asks one, and neither does a shoot the agency suggests by hand.
 */
export const IdeaDropCategorySchema = DropCategorySchema.exclude(['script']);
export type IdeaDropCategory = z.infer<typeof IdeaDropCategorySchema>;

/**
 * The categories that leave for a public output (ADR 0055 § 1: feed, stories, Instagram, Telegram), where « jamais de
 * nu » holds. A script and a relance go to one fan, behind a payment or in a conversation.
 */
export const PUBLIC_DROP_CATEGORIES: ReadonlySet<DropCategory> = new Set([
  'feed_shoot',
  'feed_video',
  'reveal_story',
  'instagram_story',
  'instagram_reel',
  'instagram_post',
  'telegram_post',
]);

/** The categories that leave for Instagram, where the Instagram guard holds (ADR 0057 § 6). */
export const INSTAGRAM_DROP_CATEGORIES: ReadonlySet<DropCategory> = new Set([
  'instagram_story',
  'instagram_reel',
  'instagram_post',
]);

/* ------------------------------------------------------------------------------------------------------------------
 * CR-06: her drops and what the agency asks of her (ADR 0044 § 1, ADR 0055 § 1 to § 6). The format rules live here,
 * in code, so that her phone refuses a file before sending it and the server refuses it again with the same sentence.
 * ---------------------------------------------------------------------------------------------------------------- */

/** How each category reads on her screen (ADR 0055 § 1). */
export const DROP_CATEGORY_LABELS: Readonly<Record<DropCategory, string>> = {
  feed_shoot: 'Feed · Séance boudoir',
  feed_video: 'Feed · Vidéo short',
  script: 'Script',
  mass_dm: 'Relance',
  reveal_story: 'Story Reveal',
  instagram_story: 'Story Insta',
  instagram_reel: 'Reel Insta',
  instagram_post: 'Photo Insta',
  telegram_post: 'Telegram',
};

export const DROP_MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export const DropMediaKindSchema = z.enum(DROP_MEDIA_KINDS);
export type DropMediaKind = z.infer<typeof DropMediaKindSchema>;

/**
 * The file types a phone sends, each with its kind: a bounded list, nothing else goes up. A video comes in any common
 * container (ADR 0070 § 2): MOV, MP4, M4V, 3GP (ISO-BMFF), MKV, WebM (EBML), AVI (RIFF).
 */
export const DROP_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/3gpp',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
] as const;
export const DropMimeSchema = z.enum(DROP_MIME_TYPES);
export type DropMime = z.infer<typeof DropMimeSchema>;

export function kindOfMime(mime: DropMime): DropMediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'audio';
}

const MB = 1024 * 1024;

/**
 * The heaviest file of each kind (CR-06, ADR 0070 § 1): a video weighs up to 10 Gio (a few minutes of iPhone ProRes),
 * sent in 1 280 parts at most with resumption; a photo or a vocal 30 Mo.
 */
export const DROP_MAX_BYTES: Readonly<Record<DropMediaKind, number>> = {
  image: 30 * MB,
  video: 10 * 1024 * MB,
  audio: 30 * MB,
};

/**
 * What a category takes (ADR 0055 § 2): its kinds, whether a photo or a video must stand upright, the longest video
 * and vocal, and how many files one drop holds. Read from the file's metadata, never by looking at the image.
 */
export interface DropFormatRule {
  readonly kinds: readonly DropMediaKind[];
  readonly vertical: boolean;
  readonly maxVideoSeconds: number | null;
  readonly maxAudioSeconds: number | null;
  readonly maxFiles: number;
}

export const DROP_FORMAT_RULES: Readonly<Record<DropCategory, DropFormatRule>> = {
  feed_shoot: {
    kinds: ['image', 'video'],
    vertical: false,
    maxVideoSeconds: 60,
    maxAudioSeconds: null,
    maxFiles: 20,
  },
  feed_video: { kinds: ['video'], vertical: true, maxVideoSeconds: 180, maxAudioSeconds: null, maxFiles: 1 },
  script: {
    kinds: ['image', 'video', 'audio'],
    vertical: false,
    maxVideoSeconds: 600,
    maxAudioSeconds: 180,
    maxFiles: 60,
  },
  mass_dm: {
    kinds: ['image', 'video', 'audio'],
    vertical: false,
    maxVideoSeconds: 60,
    maxAudioSeconds: 60,
    maxFiles: 10,
  },
  reveal_story: {
    kinds: ['image', 'video'],
    vertical: true,
    maxVideoSeconds: 60,
    maxAudioSeconds: null,
    maxFiles: 10,
  },
  instagram_story: {
    kinds: ['image', 'video'],
    vertical: true,
    maxVideoSeconds: 60,
    maxAudioSeconds: null,
    maxFiles: 10,
  },
  instagram_reel: {
    kinds: ['video'],
    vertical: true,
    maxVideoSeconds: 90,
    maxAudioSeconds: null,
    maxFiles: 1,
  },
  instagram_post: {
    kinds: ['image'],
    vertical: false,
    maxVideoSeconds: null,
    maxAudioSeconds: null,
    maxFiles: 10,
  },
  telegram_post: {
    kinds: ['image', 'video'],
    vertical: false,
    maxVideoSeconds: 600,
    maxAudioSeconds: null,
    maxFiles: 10,
  },
};

const KIND_PLURALS: Readonly<Record<DropMediaKind, string>> = {
  image: 'des photos',
  video: 'des vidéos',
  audio: 'des vocaux',
};
const KIND_SINGULARS: Readonly<Record<DropMediaKind, string>> = {
  image: 'Une photo',
  video: 'Une vidéo',
  audio: 'Un vocal',
};

const joinedFr = (words: readonly string[]): string =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} et ${words.at(-1) ?? ''}`;

const quoted = (category: DropCategory): string => `« ${DROP_CATEGORY_LABELS[category]} »`;

/** How many files a drop of this category holds, or why not: a drop holds at least one file. */
export function dropCountRefusal(category: DropCategory, files: number): string | null {
  const { maxFiles } = DROP_FORMAT_RULES[category];
  if (files < 1) return 'Ajoute au moins un fichier';
  if (files <= maxFiles) return null;
  return maxFiles === 1
    ? `${quoted(category)} prend un seul fichier`
    : `${quoted(category)} prend au plus ${String(maxFiles)} fichiers`;
}

/** A file as her phone declares it before sending: its type and its weight. */
export interface DeclaredDropFile {
  readonly mime: DropMime;
  readonly bytes: number;
}

/** A weight as she reads it: « 30 Mo », « 10 Go ». */
const weightFr = (bytes: number): string =>
  bytes >= 1024 * MB ? `${String(bytes / (1024 * MB))} Go` : `${String(bytes / MB)} Mo`;

/** Why a declared file does not go up for this category, in her words; `null` when it may go. */
export function declaredFileRefusal(category: DropCategory, file: DeclaredDropFile): string | null {
  // An empty file (a gallery item not yet downloaded from the cloud, a cut copy) never goes: the server refuses it at
  // the declaration, and her phone would read that as a lost connection (recette MED-01).
  if (file.bytes < 1) return 'Ce fichier est vide : choisis-le à nouveau dans ta galerie';
  const kind = kindOfMime(file.mime);
  const { kinds } = DROP_FORMAT_RULES[category];
  if (!kinds.includes(kind)) {
    return `${quoted(category)} prend seulement ${joinedFr(kinds.map((k) => KIND_PLURALS[k]))}`;
  }
  if (file.bytes > DROP_MAX_BYTES[kind]) {
    return `${KIND_SINGULARS[kind]} fait au plus ${weightFr(DROP_MAX_BYTES[kind])}`;
  }
  return null;
}

/** A file as the server reads it once arrived (`ffprobe`): its kind, its size in pixels, its length. */
export interface ProbedDropFile {
  readonly kind: DropMediaKind;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
}

/** Why an arrived file does not fit its category (ADR 0055 § 2: « Un Reel doit être vertical »); `null` when it fits. */
export function probedFileRefusal(category: DropCategory, file: ProbedDropFile): string | null {
  const rule = DROP_FORMAT_RULES[category];
  if (!rule.kinds.includes(file.kind)) {
    return `${quoted(category)} prend seulement ${joinedFr(rule.kinds.map((k) => KIND_PLURALS[k]))}`;
  }
  if (rule.vertical && file.kind !== 'audio') {
    // A file whose size cannot be read is not taken for upright: nothing passes on a guess.
    if (file.width === null || file.height === null || file.height <= file.width) {
      return `${quoted(category)} : ${file.kind === 'video' ? 'la vidéo doit être verticale' : 'la photo doit être verticale'}`;
    }
  }
  const limit =
    file.kind === 'video' ? rule.maxVideoSeconds : file.kind === 'audio' ? rule.maxAudioSeconds : null;
  if (limit !== null) {
    if (file.durationMs === null) return `${quoted(category)} : impossible de lire la durée de ce fichier`;
    if (file.durationMs > limit * 1000) {
      return `${quoted(category)} : ${file.kind === 'video' ? 'une vidéo' : 'un vocal'} dure au plus ${String(limit)} secondes`;
    }
  }
  return null;
}

/**
 * The states of a drop she reads (ADR 0055 § 6): sending, Reçu, Prêt, Programmé, Publié, blocked in amber with its
 * reason, and withdrawn (it leaves her screen, its trace stays).
 */
export const DROP_STATES = [
  // A script she is still filling, slot by slot (SC-02 lot b): nothing goes to the agency until she sends it.
  'filling',
  'uploading',
  'received',
  'ready',
  'scheduled',
  'published',
  'blocked',
  'withdrawn',
] as const;
export const DropStateSchema = z.enum(DROP_STATES);
export type DropState = z.infer<typeof DropStateSchema>;

/** The states she may still withdraw a drop from herself: nothing is scheduled nor out yet. */
export const WITHDRAWABLE_DROP_STATES: ReadonlySet<DropState> = new Set([
  'filling',
  'uploading',
  'received',
  'ready',
  'blocked',
]);

/**
 * A file of a drop: waiting for its bytes, received (its raw bytes are in the storage, waiting for the cleaning), kept
 * (cleaned, in the library), refused with its sentence, or a duplicate.
 */
export const DROP_FILE_STATES = ['awaiting', 'received', 'kept', 'refused', 'duplicate'] as const;
export const DropFileStateSchema = z.enum(DROP_FILE_STATES);
export type DropFileState = z.infer<typeof DropFileStateSchema>;

export const DropSentenceSchema = z.string().trim().min(1).max(200);
export const DropRefusalSchema = z.string().min(1).max(200);

export const ContentDropFileSchema = z.strictObject({
  id: ContentDropFileIdSchema,
  position: z.number().int().min(0),
  kind: DropMediaKindSchema,
  mime: DropMimeSchema,
  bytes: z.number().int().min(1),
  state: DropFileStateSchema,
  refusal: DropRefusalSchema.nullable(),
  /** The slot of her script it fills (SC-02 lot b); `null` outside a script. */
  slotKey: ScriptSlotKeySchema.nullable(),
});
export type ContentDropFile = z.infer<typeof ContentDropFileSchema>;

/** A drop as she and the agency read it. `correctedFrom` is the category she chose when the agency corrected it. */
export const ContentDropSchema = z.strictObject({
  id: ContentDropIdSchema,
  category: DropCategorySchema,
  correctedFrom: DropCategorySchema.nullable(),
  sentence: DropSentenceSchema.nullable(),
  state: DropStateSchema,
  blockedReason: DropRefusalSchema.nullable(),
  requestId: ContentRequestIdSchema.nullable(),
  files: z.array(ContentDropFileSchema),
  /** Her sent script's number, the `S<nnn>` of its folder (SC-03); `null` for another drop or a script being filled. */
  scriptNumber: z.int().min(1).nullable(),
  /** When the team confirmed its archive copied into Reveal (SC-03 c): her originals of it go 30 days later. */
  exportedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ContentDrop = z.infer<typeof ContentDropSchema>;

export const DeclaredDropFileSchema = z.strictObject({
  id: ContentDropFileIdSchema,
  mime: DropMimeSchema,
  bytes: z.number().int().min(1).max(DROP_MAX_BYTES.video),
});

/**
 * `POST /v1/creator-space/drops` (creator) and `POST /v1/creators/:creatorId/drops` (owner, operator: the agency drops
 * for her): a drop and the files her phone is about to send. Ids are drawn by the phone: the same drop replayed
 * answers it, another content under its id 409. A file that does not fit its category is refused before anything is
 * stored (422 `content_drop_format_unprocessable`, its sentence in `details.refusals`). A script is dropped only from a
 * request for it.
 */
export const CreateContentDropBodySchema = z.strictObject({
  id: ContentDropIdSchema,
  category: DropCategorySchema,
  sentence: DropSentenceSchema.nullable().default(null),
  requestId: ContentRequestIdSchema.nullable().default(null),
  files: z.array(DeclaredDropFileSchema).min(1).max(60),
});
export type CreateContentDropBody = z.infer<typeof CreateContentDropBodySchema>;

/** `POST /v1/creator-space/content/script-drops`: her script begun from its request, empty, under her phone's id. */
export const StartScriptDropBodySchema = z.strictObject({
  id: ContentDropIdSchema,
  requestId: ContentRequestIdSchema,
});
export type StartScriptDropBody = z.infer<typeof StartScriptDropBodySchema>;

/** `PUT …/script-drops/:dropId/slots/:slotKey`: the file she chose for a slot, declared before it goes up. */
export const FillScriptSlotBodySchema = DeclaredDropFileSchema.extend({});
export type FillScriptSlotBody = z.infer<typeof FillScriptSlotBodySchema>;

export const ScriptSlotParamsSchema = z.strictObject({
  dropId: ContentDropIdSchema,
  slotKey: ScriptSlotKeySchema,
});

/** `GET …/script-drops/:dropId/cards/:segmentKey`: a card of her script, its series for a stage with variants. */
export const ScriptDropCardParamsSchema = z.strictObject({
  dropId: ContentDropIdSchema,
  segmentKey: ScriptSegmentKeySchema,
});
export const ScriptDropCardQuerySchema = z.strictObject({ variant: ScriptVariantLetterSchema.optional() });

/**
 * Her script drop as her flow reads it (ADR 0056 § 4): the drop, and the frozen version she shoots, its segments as the
 * cards show them. Never the agency's library: only the version of her request.
 */
export const ScriptDropSchema = z.strictObject({
  drop: ContentDropSchema,
  name: z.string(),
  segments: z.array(ScriptSegmentSchema),
});
export type ScriptDrop = z.infer<typeof ScriptDropSchema>;

/**
 * Why a file does not go in a slot, in her words; `null` when it goes. Its kind first (a photo in a video slot), then
 * the script category's rules (weight).
 */
export function slotFileRefusal(slot: MediaSlot, file: DeclaredDropFile): string | null {
  const kind = kindOfMime(file.mime);
  if (kind !== slot.kind) return `Cet emplacement attend ${KIND_SINGULARS[slot.kind].toLowerCase()}`;
  return declaredFileRefusal('script', file);
}

/** A slot's lengths, in seconds: a video's both ends, a vocal's longest (and at least a second). */
export interface SlotLengths {
  readonly minSeconds: number;
  readonly maxSeconds: number;
}

/** The lengths a file of this slot keeps, `null` for a photo. */
export function slotLengths(slot: MediaSlot): SlotLengths | null {
  if (slot.kind === 'video') return { minSeconds: slot.minSeconds, maxSeconds: slot.maxSeconds };
  if (slot.kind === 'audio') return { minSeconds: 1, maxSeconds: slot.maxSeconds };
  return null;
}

/**
 * Why a video or a vocal does not fit its slot's lengths, read on the cleaned file; `null` when it fits, or for a file
 * without lengths to keep (a photo, a drop outside a script).
 */
export function slotDurationRefusal(lengths: SlotLengths | null, durationMs: number | null): string | null {
  if (lengths === null || durationMs === null) return null;
  const seconds = durationMs / 1000;
  if (seconds < lengths.minSeconds) return `Cet emplacement attend au moins ${String(lengths.minSeconds)} s`;
  if (seconds > lengths.maxSeconds) return `Cet emplacement attend au plus ${String(lengths.maxSeconds)} s`;
  return null;
}

/** `details` of a 422 `content_drop_format_unprocessable`: each refused file with its sentence, or the whole drop. */
export const ContentDropRefusalsSchema = z.strictObject({
  refusals: z.array(
    z.strictObject({ fileId: ContentDropFileIdSchema.nullable(), sentence: DropRefusalSchema }),
  ),
});

/** `PATCH /v1/creators/:creatorId/drops/:id` (owner, operator): her category corrected (ADR 0055 § 1), at the journal. */
export const CorrectDropCategoryBodySchema = z.strictObject({ category: DropCategorySchema });

/**
 * Where a request comes from (ADR 0055 § 4): by hand (`agency`, its author), the stock, the scripts' cadence, or a
 * suggestion born of an idea that she accepted (`idea`, ADR 0060 § 5, VEI-01 d), the last three with no author.
 */
export const CONTENT_REQUEST_ORIGINS = ['agency', 'stock', 'cadence', 'idea'] as const;
export const ContentRequestOriginSchema = z.enum(CONTENT_REQUEST_ORIGINS);

/**
 * A request's state as stored: open, refused by her, cancelled by the agency. « Déposée » is not stored: a request with
 * a drop not withdrawn is satisfied, and withdrawing that drop opens it again.
 */
export const CONTENT_REQUEST_STATES = ['open', 'refused', 'cancelled'] as const;
export const ContentRequestStateSchema = z.enum(CONTENT_REQUEST_STATES);

export const ContentRequestReasonSchema = z.string().trim().min(1).max(160);

/** A request as read: `dropId` is the drop that satisfies it, `null` while nothing does. */
export const ContentRequestSchema = z.strictObject({
  id: ContentRequestIdSchema,
  category: DropCategorySchema,
  dueOn: z.iso.date(),
  reason: ContentRequestReasonSchema,
  structureId: ScriptStructureIdSchema.nullable(),
  /** The version asked, frozen with the request (SC-02); `null` for another category and a script asked before. */
  structureVersionId: ScriptStructureVersionIdSchema.nullable(),
  /** Jour or Nuit, fixed by the code when the script is asked (« ok alternance »); `null` for another category. */
  moment: ShotMomentSchema.nullable(),
  origin: ContentRequestOriginSchema,
  state: ContentRequestStateSchema,
  refusalReason: DropRefusalSchema.nullable(),
  dropId: ContentDropIdSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ContentRequest = z.infer<typeof ContentRequestSchema>;

/**
 * `POST /v1/creators/:creatorId/content-requests` (owner, operator): what the agency asks of her, by hand (ADR 0055
 * § 4). A script request names its structure, and only a script request does: one of the library, not archived, kept
 * for no other creator (422 `content_request_structure_unprocessable`). Its day is today or later in her time zone
 * (422 `content_request_due_unprocessable`, recette MED-10). Replayed with the same id, it answers.
 */
export const CreateContentRequestBodySchema = z
  .strictObject({
    id: ContentRequestIdSchema,
    category: DropCategorySchema,
    dueOn: z.iso.date(),
    reason: ContentRequestReasonSchema,
    structureId: ScriptStructureIdSchema.nullable().default(null),
  })
  .refine((body) => (body.category === 'script') === (body.structureId !== null), {
    message: 'Une demande de script nomme sa structure, et seule une demande de script en nomme une',
    path: ['structureId'],
  });
export type CreateContentRequestBody = z.infer<typeof CreateContentRequestBodySchema>;

/** `POST /v1/creator-space/content-requests/:id/refuse` (creator): she says no, a reason if she wants (ADR 0042). */
export const RefuseContentRequestBodySchema = z.strictObject({
  reason: DropRefusalSchema.nullable().default(null),
});

/** `GET /v1/creator-space/content` and `GET /v1/creators/:creatorId/content`: her requests and her drops, newest first. */
export const CreatorContentSchema = z.strictObject({
  requests: z.array(ContentRequestSchema),
  drops: z.array(ContentDropSchema),
});
export type CreatorContent = z.infer<typeof CreatorContentSchema>;

export const CONTENT_DROP_NOT_FOUND = 'content_drop_not_found';
export const CONTENT_DROP_ID_CONFLICT = 'content_drop_id_conflict';
export const CONTENT_DROP_FORMAT_UNPROCESSABLE = 'content_drop_format_unprocessable';
export const CONTENT_DROP_SCRIPT_UNPROCESSABLE = 'content_drop_script_unprocessable';
export const CONTENT_DROP_REQUEST_UNPROCESSABLE = 'content_drop_request_unprocessable';
export const CONTENT_DROP_SETTLED_CONFLICT = 'content_drop_settled_conflict';
export const CONTENT_DROP_FORBIDDEN = 'content_drop_forbidden';
/** The slot named is not one of her script's (SC-02 lot b). */
export const CONTENT_DROP_SLOT_NOT_FOUND = 'content_drop_slot_not_found';
/** « Envoyer le script » with a required slot still empty: `details.slotKeys`. */
export const CONTENT_DROP_SLOTS_UNPROCESSABLE = 'content_drop_slots_unprocessable';
/** A card her script does not have: a segment or a series not in its frozen version (SC-02 lot b2). */
export const CONTENT_DROP_CARD_NOT_FOUND = 'content_drop_card_not_found';
/**
 * A script's archive refused (SC-03 c, ADR 0056 § 7): not a sent script, its files not all settled yet, an original
 * already erased, a « both » structure whose moment is not fixed, or media past what a ZIP without ZIP64 holds
 * (4 Gio). `details.reason` says which.
 */
export const CONTENT_DROP_EXPORT_UNPROCESSABLE = 'content_drop_export_unprocessable';
export const SCRIPT_EXPORT_REFUSALS = [
  'not_a_script',
  'not_ready',
  'original_erased',
  'moment_unknown',
  'too_large',
] as const;
export const ScriptExportRefusalSchema = z.enum(SCRIPT_EXPORT_REFUSALS);
export type ScriptExportRefusal = z.infer<typeof ScriptExportRefusalSchema>;
/** The archive of a sent script: a ZIP, its files stored as they are. */
export const SCRIPT_EXPORT_MEDIA_TYPE = 'application/zip';
/**
 * What the media of one archive may weigh (relecture Bilan de #607): the ZIP is written without ZIP64, its sizes and
 * offsets on 4 bytes, so past 4 Gio it would come out corrupt with a 200. The cards and the headers keep 256 Mio. The
 * agency screen reads it too, so that it never offers an archive the server refuses (SC-03 c2b).
 */
export const SCRIPT_EXPORT_MAX_BYTES = 4 * 1024 ** 3 - 256 * 1024 ** 2;
export const CONTENT_REQUEST_NOT_FOUND = 'content_request_not_found';
export const CONTENT_REQUEST_ID_CONFLICT = 'content_request_id_conflict';
export const CONTENT_REQUEST_CLOSED_CONFLICT = 'content_request_closed_conflict';
export const CONTENT_REQUEST_STRUCTURE_UNPROCESSABLE = 'content_request_structure_unprocessable';
/** A request asked for a day already past in her time zone (recette MED-10): it would be late as it is born. */
export const CONTENT_REQUEST_DUE_UNPROCESSABLE = 'content_request_due_unprocessable';

/**
 * The size of each part a file goes up in (CR-06 b), the last one shorter: 8 Mio, so that a cut on a phone costs at
 * most 8 Mio, and the heaviest video, 10 Gio, takes 1 280 parts (S3 asks at least 5 Mio a part, at most 10 000).
 */
export const DROP_PART_BYTES = 8 * 1024 * 1024;

/** How long an address to send a part keeps (an hour): the phone asks again for the parts still missing. */
export const DROP_PART_URL_SECONDS = 3600;

/** A send unfinished this many hours after the drop is refused (CR-06 c): the storage drops its raw parts after a day. */
export const DROP_UPLOAD_HOURS = 24;

/**
 * An original with no planned exit is kept a year after it was kept, then erased (ADR 0055 § 7, Charles 03/11/2026);
 * the agency is told `DROP_ERASE_NOTICE_DAYS` before. A planned exit (PUB-01) will move it to the exit and 30 days.
 */
export const DROP_KEPT_DAYS = 365;
export const DROP_ERASE_NOTICE_DAYS = 7;

/** The number of parts a file of `bytes` goes up in. */
export const dropPartCount = (bytes: number): number => Math.max(1, Math.ceil(bytes / DROP_PART_BYTES));

export const DropPartNumberSchema = z.number().int().min(1).max(10_000);

/**
 * `POST /v1/creator-space/drops/:id/files/:fileId/upload` (creator) and its twin under `/v1/creators/:creatorId`
 * (owner, operator): where the phone sends the file's bytes, straight to the storage (ADR 0055 § 3). Each missing part
 * comes with its own signed address, for exactly its size; the parts already in the storage come with their `etag`,
 * so that a send cut in the middle resumes where it stopped. `sent` is true when the file is already whole: nothing is
 * left to send.
 */
export const DropFileUploadSchema = z.strictObject({
  fileId: ContentDropFileIdSchema,
  sent: z.boolean(),
  partBytes: z.number().int().min(1),
  missing: z.array(
    z.strictObject({ number: DropPartNumberSchema, bytes: z.number().int().min(1), url: z.url() }),
  ),
  stored: z.array(z.strictObject({ number: DropPartNumberSchema, etag: z.string().min(1).max(200) })),
});
export type DropFileUpload = z.infer<typeof DropFileUploadSchema>;

/**
 * `POST …/drops/:id/files/:fileId/complete`: every part sent, each with the `ETag` the storage answered. The file is
 * then received; when it is the drop's last one, the drop is too, and the cleaning takes it (CR-06 b2). Replayed once
 * the file is received, it answers the drop as it is.
 */
export const CompleteDropFileBodySchema = z.strictObject({
  parts: z
    .array(z.strictObject({ number: DropPartNumberSchema, etag: z.string().min(1).max(200) }))
    .min(1)
    .max(10_000),
});
export type CompleteDropFileBody = z.infer<typeof CompleteDropFileBodySchema>;

export const CONTENT_DROP_FILE_NOT_FOUND = 'content_drop_file_not_found';
/** The file is no longer waiting for its bytes, or its drop no longer takes any (withdrawn, received). */
export const CONTENT_DROP_FILE_SETTLED_CONFLICT = 'content_drop_file_settled_conflict';
/** The parts named are not the file's whole, or the bytes in the storage are not the size declared. */
export const CONTENT_DROP_UPLOAD_UNPROCESSABLE = 'content_drop_upload_unprocessable';
/** No storage configured, or it does not answer: the phone tries again later. */
export const CONTENT_DROP_STORAGE_UNAVAILABLE = 'content_drop_storage_unavailable';

/* ----------------------------------------------------------------------------------------------------------------
 * ADR 0083 § 6: a sent script, told step by step once each of its media is described, and its synthesis. No price:
 * the screen shows the agency's grid beside each step (ADR 0056 § 6).
 * ---------------------------------------------------------------------------------------------------------------- */

/** A step of a script as its slots name it: `<segment>:<series>`, `salon:` or `chambre:B`. */
export const ScriptStepKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}:[ABC]?$/);

export const ScriptStepSummarySchema = z.object({
  step: ScriptStepKeySchema,
  /** The general description of the step: how it unfolds, what it aims at, its mood, from its card and its media. */
  overview: z.string().min(1).max(2000),
  /** One or two sentences, for the synthesis. */
  summary: z.string().min(1).max(400),
});
export type ScriptStepSummary = z.infer<typeof ScriptStepSummarySchema>;

export const ScriptDropSummarySchema = z.object({
  /** The shoot as a whole: where, when, in what outfits, the thread from the first step to the last. */
  shootingContext: z.string().min(1).max(2000),
  /** Each step of the script, in its order, once. */
  steps: z.array(ScriptStepSummarySchema).min(1).max(60),
});
export type ScriptDropSummary = z.infer<typeof ScriptDropSummarySchema>;

/**
 * Why a script's synthesis waits for a human before any use, read by the code (ADR 0083 § 6): `price`, it names a sum
 * or a currency, still after one more try, when prices come from the agency's grid alone (ADR 0056 § 6).
 */
export const SCRIPT_SUMMARY_REVIEW_REASONS = ['price'] as const;

/**
 * Who wrote a script's synthesis (SC-04 lot c5): the brain (`content_drops.summarize_script`), or the agency, by hand,
 * from the one it shows (`POST …/summary/correct`): a new row, validated by whoever writes it.
 */
export const SCRIPT_SUMMARY_AUTHORS = ['brain', 'human'] as const;
export const ScriptSummaryAuthorSchema = z.enum(SCRIPT_SUMMARY_AUTHORS);
export type ScriptSummaryAuthor = z.infer<typeof ScriptSummaryAuthorSchema>;
export const ScriptSummaryReviewReasonSchema = z.enum(SCRIPT_SUMMARY_REVIEW_REASONS);
export type ScriptSummaryReviewReason = z.infer<typeof ScriptSummaryReviewReasonSchema>;

/**
 * `GET`/`PUT /v1/creators/:creatorId/drop-descriptions`: her switch (ADR 0083 § 9), the owner's. Turned on, what she
 * dropped while it was off is described and her sent scripts told.
 */
export const DropDescriptionsSwitchSchema = z.strictObject({ on: z.boolean() });
export type DropDescriptionsSwitch = z.infer<typeof DropDescriptionsSwitchSchema>;

/* ----------------------------------------------------------------------------------------------------------------
 * ADR 0030 § 3 (amended 08/11/2026) and ADR 0083 § 7: the agency validates a drop's descriptions and a script's
 * synthesis, row by row, as the account that validates. A correction is a new row, validated as it is written.
 * ---------------------------------------------------------------------------------------------------------------- */

const Instant = z.iso.datetime({ offset: true });

/** A description of one of her media as the agency reviews it: the latest validated, else the latest written. */
export const DropDescriptionViewSchema = z.strictObject({
  id: MediaDescriptionIdSchema,
  /** `sense`, the vision AI; `human`, a correction. */
  author: z.enum(['sense', 'human']),
  detailed: z.string().min(1).max(6000),
  reviewReasons: z.array(DescriptionReviewReasonSchema),
  /** Her own word on the media (P6-01). */
  creatorNote: z.string().nullable(),
  validatedAt: Instant.nullable(),
  createdAt: Instant,
});
export type DropDescriptionView = z.infer<typeof DropDescriptionViewSchema>;

/** A file of the drop and its description, in the drop's order; an audio note is not described (ADR 0083 § 1). */
export const DropMediaReviewSchema = z.strictObject({
  fileId: ContentDropFileIdSchema,
  slotKey: ScriptSlotKeySchema.nullable(),
  mediaAssetId: MediaAssetIdSchema,
  kind: DropMediaKindSchema,
  description: DropDescriptionViewSchema.nullable(),
  /**
   * Its reduced picture is made (SC-04 lot c4): `GET …/files/:fileId/thumbnail` gives it, kept after the original goes
   * (ADR 0030 § 4).
   */
  thumbnail: z.boolean(),
  /** Its original is still held (ADR 0044 § 2): `GET …/files/:fileId/media` plays it, in parts for a video. */
  original: z.boolean(),
});
export type DropMediaReview = z.infer<typeof DropMediaReviewSchema>;

/** A script's latest synthesis; `current` when it tells the media and descriptions the script holds now. */
export const ScriptSummaryViewSchema = z.strictObject({
  id: ScriptDropSummaryIdSchema,
  content: ScriptDropSummarySchema,
  reviewReasons: z.array(ScriptSummaryReviewReasonSchema),
  /** `human` once her team corrected it by hand (SC-04 lot c5). */
  author: ScriptSummaryAuthorSchema,
  current: z.boolean(),
  validatedAt: Instant.nullable(),
  createdAt: Instant,
});
export type ScriptSummaryView = z.infer<typeof ScriptSummaryViewSchema>;

/** A step of a sent script as its cards name it, with its files in their order (the review groups them by step). */
export const ScriptReviewStepSchema = z.strictObject({
  step: ScriptStepKeySchema,
  /** `E1`, `E2A`, as her cards say. */
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(200),
  fileIds: z.array(ContentDropFileIdSchema).min(1),
});
export type ScriptReviewStep = z.infer<typeof ScriptReviewStepSchema>;

/** `GET /v1/creators/:creatorId/drops/:id/descriptions`, and the answer of each review below. */
export const DropDescriptionsReviewSchema = z.strictObject({
  dropId: ContentDropIdSchema,
  media: z.array(DropMediaReviewSchema),
  /** A sent script's steps in its order; empty for another drop. */
  steps: z.array(ScriptReviewStepSchema),
  /** A sent script's synthesis; `null` for another drop, or before the first one is written. */
  summary: ScriptSummaryViewSchema.nullable(),
});
export type DropDescriptionsReview = z.infer<typeof DropDescriptionsReviewSchema>;

/**
 * `POST …/descriptions/validate`: these rows, validated as they are (« Tout valider » for a step). A row that waits
 * for a human (a back reference, someone else seen, a doubt, a safety flag) is validated alone, never in a batch.
 */
export const ValidateDropDescriptionsBodySchema = z.strictObject({
  descriptionIds: z.array(MediaDescriptionIdSchema).min(1).max(60),
});
export type ValidateDropDescriptionsBody = z.infer<typeof ValidateDropDescriptionsBodySchema>;

/** `POST …/descriptions/correct`: a new row from this one, its `detailed` rewritten, validated by whoever writes it. */
export const CorrectDropDescriptionBodySchema = z.strictObject({
  descriptionId: MediaDescriptionIdSchema,
  detailed: z.string().trim().min(1).max(6000),
});
export type CorrectDropDescriptionBody = z.infer<typeof CorrectDropDescriptionBodySchema>;

/** `POST …/summary/validate`: the script's current synthesis, validated as it is. */
export const ValidateScriptSummaryBodySchema = z.strictObject({ summaryId: ScriptDropSummaryIdSchema });
export type ValidateScriptSummaryBody = z.infer<typeof ValidateScriptSummaryBodySchema>;

/**
 * `POST …/summary/correct` (SC-04 lot c5): the script's current synthesis rewritten by hand, its steps the same ones in
 * the same order; a new row, validated by whoever writes it. Never a sum nor a currency: prices come from the grid.
 */
export const CorrectScriptSummaryBodySchema = z.strictObject({
  summaryId: ScriptDropSummaryIdSchema,
  shootingContext: z.string().trim().min(1).max(2000),
  steps: z
    .array(
      z.strictObject({
        step: ScriptStepKeySchema,
        overview: z.string().trim().min(1).max(2000),
        summary: z.string().trim().min(1).max(400),
      }),
    )
    .min(1)
    .max(60),
});
export type CorrectScriptSummaryBody = z.infer<typeof CorrectScriptSummaryBodySchema>;

/** A hand-written synthesis that names a sum or a currency, or other steps than the script's. */
export const SCRIPT_SUMMARY_CORRECTION_UNPROCESSABLE = 'script_summary_correction_unprocessable';

/** A row named that is not this drop's latest (a newer one came meanwhile), or a batch holding a row to see alone. */
export const DROP_DESCRIPTION_REVIEW_CONFLICT = 'drop_description_review_conflict';
