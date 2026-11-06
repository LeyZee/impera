import {
  ContentDropFileSchema,
  ContentDropSchema,
  ContentRequestSchema,
  type ContentDrop,
  type ContentDropFile,
  type ContentRequest,
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
