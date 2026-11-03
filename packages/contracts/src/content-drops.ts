import { z } from 'zod';

import { ContentDropFileIdSchema, ContentDropIdSchema, ContentRequestIdSchema } from './ids';
import { ScriptStructureIdSchema } from './scripts';

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

/** The file types a phone sends, each with its kind: a bounded list, nothing else goes up. */
export const DROP_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
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

/** The heaviest file of each kind (CR-06, proposition de Bilan du 02/11): a 4G phone sends 500 Mo with resumption. */
export const DROP_MAX_BYTES: Readonly<Record<DropMediaKind, number>> = {
  image: 30 * MB,
  video: 500 * MB,
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

/** Why a declared file does not go up for this category, in her words; `null` when it may go. */
export function declaredFileRefusal(category: DropCategory, file: DeclaredDropFile): string | null {
  const kind = kindOfMime(file.mime);
  const { kinds } = DROP_FORMAT_RULES[category];
  if (!kinds.includes(kind)) {
    return `${quoted(category)} prend seulement ${joinedFr(kinds.map((k) => KIND_PLURALS[k]))}`;
  }
  if (file.bytes > DROP_MAX_BYTES[kind]) {
    return `${KIND_SINGULARS[kind]} fait au plus ${String(DROP_MAX_BYTES[kind] / MB)} Mo`;
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
  'uploading',
  'received',
  'ready',
  'blocked',
]);

/** A file of a drop: waiting for its bytes, kept (cleaned, in the library), refused with its sentence, or a duplicate. */
export const DROP_FILE_STATES = ['awaiting', 'kept', 'refused', 'duplicate'] as const;
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

/** `details` of a 422 `content_drop_format_unprocessable`: each refused file with its sentence, or the whole drop. */
export const ContentDropRefusalsSchema = z.strictObject({
  refusals: z.array(
    z.strictObject({ fileId: ContentDropFileIdSchema.nullable(), sentence: DropRefusalSchema }),
  ),
});

/** `PATCH /v1/creators/:creatorId/drops/:id` (owner, operator): her category corrected (ADR 0055 § 1), at the journal. */
export const CorrectDropCategoryBodySchema = z.strictObject({ category: DropCategorySchema });

export const CONTENT_REQUEST_ORIGINS = ['agency', 'stock', 'cadence'] as const;
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
 * for no other creator (422 `content_request_structure_unprocessable`). Replayed with the same id, it answers.
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
export const CONTENT_REQUEST_NOT_FOUND = 'content_request_not_found';
export const CONTENT_REQUEST_ID_CONFLICT = 'content_request_id_conflict';
export const CONTENT_REQUEST_CLOSED_CONFLICT = 'content_request_closed_conflict';
export const CONTENT_REQUEST_STRUCTURE_UNPROCESSABLE = 'content_request_structure_unprocessable';
