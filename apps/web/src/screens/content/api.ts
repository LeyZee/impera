import {
  ApiErrorSchema,
  ContentDropRefusalsSchema,
  ContentDropSchema,
  CreatorContentSchema,
  DropFileUploadSchema,
  type CompleteDropFileBody,
  type ContentDrop,
  type ContentDropFileId,
  type ContentDropId,
  type ContentRequestId,
  type CreateContentDropBody,
  type CreatorContent,
  type DropFileUpload,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { UploadStopped } from './upload';

/*
 * Her content's doors (CR-06, `/v1/creator-space`), parsed with the `strict` contracts. The server holds the truth:
 * what this phone keeps is only the progress of the sends it runs (`sends.ts`).
 */

const BASE = '/v1/creator-space';
const JSON_HEADERS = { 'content-type': 'application/json' };
export const CONTENT_KEY = ['creator-space', 'content'] as const;

/** A drop on its way changes by itself (received, cleaned, converted): read more often while one is. */
export const isMoving = (content: CreatorContent | undefined): boolean =>
  content?.drops.some((drop) => drop.state === 'uploading' || drop.state === 'received') ?? false;

/** `GET /v1/creator-space/content`: her open requests and her drops. */
export function useContent(): UseQueryResult<CreatorContent> {
  return useQuery({
    queryKey: CONTENT_KEY,
    queryFn: async () => {
      const response = await fetch(`${BASE}/content`, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET ${BASE}/content: ${String(response.status)}`);
      return CreatorContentSchema.parse(await response.json());
    },
    refetchInterval: (query) => (isMoving(query.state.data) ? 5_000 : 60_000),
    retry: 1,
  });
}

/** A write the server refused: its sentences when it gave some (a file that does not fit), its message otherwise. */
export class Refused extends Error {
  constructor(
    readonly status: number,
    readonly sentences: readonly { readonly fileId: string | null; readonly sentence: string }[],
  ) {
    super(sentences[0]?.sentence ?? `refused: ${String(status)}`);
  }
}

async function refusedBy(response: Response): Promise<Refused> {
  const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (!body.success) return new Refused(response.status, []);
  const refusals = ContentDropRefusalsSchema.safeParse(body.data.error.details);
  return new Refused(response.status, refusals.success ? refusals.data.refusals : []);
}

async function post(path: string, body: unknown): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await refusedBy(response);
  return response;
}

/** `POST /drops`: the drop and its files declared. Replayed with the same id, it answers the same drop. */
export async function createDrop(body: CreateContentDropBody): Promise<ContentDrop> {
  return ContentDropSchema.parse(await (await post('/drops', body)).json());
}

/** `DELETE /drops/:id`: she withdraws it, while nothing is scheduled nor out. */
export async function withdrawDrop(id: ContentDropId): Promise<void> {
  const response = await fetch(`${BASE}/drops/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!response.ok) throw await refusedBy(response);
}

/** `POST /content-requests/:id/refuse`: she will not shoot it, with her reason if she gives one. */
export async function refuseRequest(id: ContentRequestId, reason: string | null): Promise<void> {
  await post(`/content-requests/${id}/refuse`, { reason });
}

/** A 4xx stops a send for good (withdrawn, refused, settled); anything else is the network, tried again. */
async function stopping<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refused && error.status >= 400 && error.status < 500) {
      throw new UploadStopped(error.message);
    }
    throw error;
  }
}

/** `POST /drops/:id/files/:fileId/upload`: the parts already stored and those to send, each with its address. */
export const uploadPlan = (dropId: ContentDropId, fileId: ContentDropFileId): Promise<DropFileUpload> =>
  stopping(async () =>
    DropFileUploadSchema.parse(await (await post(`/drops/${dropId}/files/${fileId}/upload`, {})).json()),
  );

/** `POST /drops/:id/files/:fileId/complete`: every part sent, each with its `ETag`. */
export const completeFile = (
  dropId: ContentDropId,
  fileId: ContentDropFileId,
  body: CompleteDropFileBody,
): Promise<ContentDrop> =>
  stopping(async () =>
    ContentDropSchema.parse(await (await post(`/drops/${dropId}/files/${fileId}/complete`, body)).json()),
  );
