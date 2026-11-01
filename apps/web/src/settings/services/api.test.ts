import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  confirmPassword,
  connectKey,
  describeError,
  disconnect,
  fetchOverview,
  isSessionExpired,
  ReauthRequired,
  ServicesError,
  showError,
  verifyNow,
} from './api';

const status = {
  provider: 'xai',
  state: 'connected',
  source: 'dashboard',
  keyLabel: 'nirvana-prod',
  verifiedAt: '2026-10-17T20:00:00.000Z',
  isUnreadable: false,
  message: 'Grok 4.7 écrit et décide',
  facts: [{ label: 'Modèle', value: 'Grok 4.7' }],
  settings: {},
  voices: [],
};

function apiError(code: string): unknown {
  return { error: { code, message: 'x', details: {}, requestId: 'r' } };
}

function answer(statusCode: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: statusCode }))),
  );
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(
    () => {
      throw new Error('expected a failure');
    },
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Services API client', () => {
  it('reads a connected key and a refusal, never anything else', async () => {
    answer(200, status);
    expect(await connectKey('xai', 'xai-FAKE')).toEqual({ ok: true, status });
    answer(422, { kind: 'unauthorized', message: 'xAI ne reconnaît pas cette clé.' });
    expect(await connectKey('xai', 'xai-FAKE')).toEqual({
      ok: false,
      refusal: { kind: 'unauthorized', message: 'xAI ne reconnaît pas cette clé.' },
    });
  });

  it('reads an answer it does not expect as « Le serveur ne répond pas »', async () => {
    answer(200, { services: 'nope' });
    const error = await failure(fetchOverview);
    expect(error).toBeInstanceOf(ServicesError);
    expect(describeError(error)).toBe('Le serveur ne répond pas. Réessaie dans un instant.');
  });

  it('asks for the password when the sign-in is too old for a key, and only then', async () => {
    answer(403, apiError('reauthentication_forbidden'));
    await expect(connectKey('xai', 'xai-FAKE')).rejects.toBeInstanceOf(ReauthRequired);
    await expect(disconnect('xai')).rejects.toBeInstanceOf(ReauthRequired);
    answer(403, apiError('role_forbidden'));
    const other = await failure(() => disconnect('xai'));
    expect(other).toBeInstanceOf(ServicesError);
    expect(other).not.toBeInstanceOf(ReauthRequired);
  });

  it('tells each failure in its own words', async () => {
    const cases: [number | 'network', unknown, string][] = [
      [401, apiError('session_unauthenticated'), 'Ta session a expiré. Reconnecte-toi.'],
      [403, apiError('role_forbidden'), 'Seul le compte propriétaire peut gérer les clés.'],
      [403, { error: 'forbidden' }, 'Le serveur ne répond pas. Réessaie dans un instant.'],
      [429, apiError('rate_limited'), 'Trop d’essais. Attends une minute avant de réessayer.'],
      [500, apiError('internal_error'), 'Le serveur ne répond pas. Réessaie dans un instant.'],
      [503, 'Bad gateway', 'Le serveur ne répond pas. Réessaie dans un instant.'],
      ['network', null, 'Le serveur ne répond pas. Réessaie dans un instant.'],
    ];
    for (const [code, body, sentence] of cases) {
      if (code === 'network')
        vi.stubGlobal(
          'fetch',
          vi.fn(() => Promise.reject(new TypeError('offline'))),
        );
      else answer(code, body);
      for (const run of [fetchOverview, () => verifyNow('xai'), () => disconnect('xai')]) {
        expect(describeError(await failure(run))).toBe(sentence);
      }
    }
  });

  it('offers to sign in again only for an expired session', async () => {
    answer(401, apiError('session_unauthenticated'));
    expect(isSessionExpired(await failure(fetchOverview))).toBe(true);
    answer(500, apiError('internal_error'));
    expect(isSessionExpired(await failure(fetchOverview))).toBe(false);
    expect(describeError(new Error('anything'))).toBe('Le serveur ne répond pas. Réessaie dans un instant.');
  });

  it('puts what did not happen before the reason', async () => {
    answer(401, apiError('session_unauthenticated'));
    expect(showError(await failure(fetchOverview), 'La voix n’a pas été enregistrée.')).toEqual({
      message: 'La voix n’a pas été enregistrée. Ta session a expiré. Reconnecte-toi.',
      isSessionExpired: true,
    });
    expect(showError(new TypeError('x'))).toEqual({
      message: 'Le serveur ne répond pas. Réessaie dans un instant.',
      isSessionExpired: false,
    });
  });

  it('confirms the password by signing in again as the current user', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push(
          `${init?.method ?? 'GET'} ${url} ${typeof init?.body === 'string' ? init.body : ''}`.trim(),
        );
        const body =
          url === '/v1/me'
            ? {
                id: 'u1',
                email: 'owner@example.test',
                name: 'Owner',
                role: 'owner',
                creatorIds: [],
                team: null,
                teamScope: 'owner',
              }
            : { user: {} };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    expect(await confirmPassword('correct horse battery')).toBe('ok');
    expect(calls).toEqual([
      'GET /v1/me',
      'POST /v1/auth/sign-in/email {"email":"owner@example.test","password":"correct horse battery"}',
    ]);
  });

  it('says the session expired, not that the password is wrong, when there is no session', async () => {
    answer(401, apiError('session_unauthenticated'));
    expect(await confirmPassword('correct horse battery')).toBe('session_expired');
  });
});
