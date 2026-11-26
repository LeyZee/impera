import { ContentDropFileIdSchema, ContentDropIdSchema, CreatorIdSchema } from '@impera/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REDO_FILE_ERRORS, redoDropFile } from './api';

/* An invented creator, drop and medium (ADR 0010). */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const DROP = ContentDropIdSchema.parse('0192f3a0-0000-7000-8000-000000000d01');
const FILE = ContentDropFileIdSchema.parse('0192f3a0-0000-7000-8000-000000000f01');
const URL = `/v1/creators/${CREATOR}/drops/${DROP}/files/${FILE}/redo`;

function answer(status: number, code?: string): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(() =>
    Promise.resolve(
      code === undefined
        ? new Response(null, { status })
        : Response.json({ error: { code, message: 'Refusé', details: {}, requestId: 'r1' } }, { status }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('« À refaire » on one medium, from the agency (trou 7 du 21/11)', () => {
  it('asks it with her sentence', async () => {
    const fetch = answer(204);
    expect(await redoDropFile(CREATOR, DROP, FILE, 'Trop sombre')).toEqual({ kind: 'ok' });
    expect(fetch).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ method: 'POST', body: '{"sentence":"Trop sombre"}' }),
    );
  });

  it('says why it was not asked', async () => {
    answer(409, 'content_drop_settled_conflict');
    expect(await redoDropFile(CREATOR, DROP, FILE, 'x')).toEqual({
      kind: 'refused',
      message: REDO_FILE_ERRORS.settled,
    });
    answer(409, 'content_drop_file_settled_conflict');
    expect(await redoDropFile(CREATOR, DROP, FILE, 'x')).toEqual({
      kind: 'refused',
      message: REDO_FILE_ERRORS.waiting,
    });
    answer(403, 'forbidden');
    expect(await redoDropFile(CREATOR, DROP, FILE, 'x')).toEqual({
      kind: 'refused',
      message: REDO_FILE_ERRORS.forbidden,
    });
    answer(500);
    expect(await redoDropFile(CREATOR, DROP, FILE, 'x')).toEqual({
      kind: 'refused',
      message: REDO_FILE_ERRORS.failed,
    });
  });
});
