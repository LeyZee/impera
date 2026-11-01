import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpClient, PlaygroundError } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

describe('the playground client', () => {
  it('says a refusal of the server is a refusal, not an outage (recette 28/10, G4)', async () => {
    answer(403, { error: { code: 'forbidden', message: 'Réservé au propriétaire.', details: {} } });
    const error: unknown = await createHttpClient()
      .state()
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PlaygroundError);
    expect(error).toMatchObject({ code: 'forbidden' });
  });

  it('still says a server error is a failure', async () => {
    answer(500, null);
    await expect(createHttpClient().state()).rejects.toMatchObject({ code: 'failed' });
  });
});
