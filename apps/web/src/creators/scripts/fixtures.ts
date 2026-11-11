import {
  DropDescriptionsReviewSchema,
  ScriptStructureSchema,
  type DescriptionReviewReason,
  type DropDescriptionsReview,
  type ScriptMoment,
  type ScriptStructure,
} from '@impera/contracts';

import { scriptSegments } from '@/screens/content/fixtures';

/* An invented structure of the library (ADR 0010): never one of the agency's. */
export const structureOf = (id: string, name: string, moment: ScriptMoment): ScriptStructure =>
  ScriptStructureSchema.parse({
    id,
    reservedCreatorId: null,
    current: {
      id: id.replace(/.$/u, 'f'),
      version: 1,
      name,
      moment,
      color: { primary: '#2a1f3d', secondary: '#f4eefa', accent: '#c084fc' },
      segments: scriptSegments,
      frozen: true,
      updatedAt: '2026-11-01T09:00:00.000Z',
    },
    createdAt: '2026-11-01T09:00:00.000Z',
  });

/* An invented review of a sent script (SC-04 lot c3): invented descriptions, never one of a real media (ADR 0010). */
export const reviewOf = (
  dropId: string,
  fileIds: readonly [string, string, string],
  fields: {
    readonly validated?: readonly boolean[];
    readonly reasons?: readonly (readonly DescriptionReviewReason[])[];
    /** `human`: written over by the agency (SC-04 lot c5), validated as it was saved. */
    readonly summary?: 'none' | 'current' | 'stale' | 'validated' | 'price' | 'human';
    /** Its reduced picture made, its original still held (SC-04 lot c4). */
    readonly thumbnails?: boolean;
    readonly original?: boolean;
    /** Its last medium a video. */
    readonly video?: boolean;
  } = {},
): DropDescriptionsReview =>
  DropDescriptionsReviewSchema.parse({
    dropId,
    media: fileIds.map((fileId, index) => ({
      fileId,
      slotKey: ['salon::0', 'chambre:A:0', 'chambre:B:0'][index],
      mediaAssetId: `0192f3a0-0000-7000-8000-00000000e00${String(index)}`,
      kind: fields.video === true && index === 2 ? 'video' : 'image',
      description: {
        id: `0192f3a0-0000-7000-8000-00000000f00${String(index)}`,
        author: 'sense',
        detailed: `Photo inventée ${String(index + 1)} : une silhouette près d’une fenêtre.`,
        reviewReasons: fields.reasons?.[index] ?? [],
        creatorNote: index === 0 ? 'Ma préférée' : null,
        validatedAt: fields.validated?.[index] === true ? '2026-11-08T20:00:00.000Z' : null,
        createdAt: '2026-11-08T19:00:00.000Z',
      },
      thumbnail: fields.thumbnails ?? false,
      original: fields.original ?? true,
    })),
    steps: [
      { step: 'salon:', code: 'E1', name: 'Le salon', fileIds: [fileIds[0]] },
      { step: 'chambre:A', code: 'E2A', name: 'La chambre', fileIds: [fileIds[1]] },
      { step: 'chambre:B', code: 'E2B', name: 'La chambre', fileIds: [fileIds[2]] },
    ],
    summary:
      fields.summary === undefined || fields.summary === 'none'
        ? null
        : {
            id: '0192f3a0-0000-7000-8000-00000000c001',
            content: {
              shootingContext: 'Un soir inventé, du salon à la chambre.',
              steps: ['salon:', 'chambre:A', 'chambre:B'].map((step, index) => ({
                step,
                overview: `L’étape ${String(index + 1)}, inventée.`,
                summary: `Résumé inventé ${String(index + 1)}.`,
              })),
            },
            reviewReasons: fields.summary === 'price' ? ['price'] : [],
            author: fields.summary === 'human' ? 'human' : 'brain',
            current: fields.summary !== 'stale',
            validatedAt:
              fields.summary === 'validated' || fields.summary === 'human'
                ? '2026-11-08T20:30:00.000Z'
                : null,
            createdAt: '2026-11-08T19:30:00.000Z',
          },
  });
