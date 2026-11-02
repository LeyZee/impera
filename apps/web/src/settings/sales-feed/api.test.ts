import { REAUTHENTICATION_ERROR_CODE, type SalesFeedStatus } from '@nirvana/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectKey, connectWebhook, linkModel, SalesFeedRefused } from './api';

import { ReauthRequired, ServicesError } from '@/settings/services/api';

const STATUS: SalesFeedStatus = {
  platform: 'reveal',
  state: 'connected',
  capabilities: ['sales'],
  verifiedAt: '2026-11-02T20:00:00.000Z',
  lastReadAt: null,
  lastErrorKind: null,
  message: 'Les ventes et les remboursements de Reveal remontent chaque minute.',
  quarantined: 0,
  webhook: null,
};

const apiError = (code: string, message: string): object => ({
  error: { code, message, details: {}, requestId: 'req-1' },
});

function answer(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(() => Promise.resolve(Response.json(body, { status })));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sales feed api', () => {
  it('registers the webhook with a bare PUT: no body, no JSON content type', async () => {
    const fetch = answer(200, STATUS);
    await expect(connectWebhook('reveal')).resolves.toEqual({ ok: true, status: STATUS });
    expect(fetch).toHaveBeenCalledWith('/v1/settings/sales-feeds/reveal/webhook', {
      credentials: 'include',
      method: 'PUT',
    });
  });

  it('gives back the platform’s refusal of a key, worded by the server', async () => {
    const fetch = answer(422, { kind: 'unauthorized', message: 'Reveal refuse cette clé.' });
    await expect(connectKey('reveal', 'rvl_test')).resolves.toEqual({
      ok: false,
      refusal: { kind: 'unauthorized', message: 'Reveal refuse cette clé.' },
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ key: 'rvl_test' }),
    });
  });

  it('asks for the password again when the sign-in is too old for the key', async () => {
    answer(403, apiError(REAUTHENTICATION_ERROR_CODE, 'Confirme ton mot de passe'));
    await expect(connectKey('reveal', 'rvl_test')).rejects.toBeInstanceOf(ReauthRequired);
  });

  it('says the server’s sentence for a refusal of its own', async () => {
    answer(409, apiError('sales_feed_model_conflict', 'Ce compte est déjà lié à un autre modèle'));
    const refused = linkModel('reveal', 'm1', '00000000-0000-4000-8000-00000000000a');
    await expect(refused).rejects.toBeInstanceOf(SalesFeedRefused);
    await expect(refused).rejects.toThrow('Ce compte est déjà lié à un autre modèle');
  });

  it('reads a 422 of ours (no HTTPS address) as the server’s sentence, not as the platform’s refusal', async () => {
    answer(422, apiError('sales_feed_webhook_url_unprocessable', 'L’adresse publique n’est pas en HTTPS'));
    await expect(connectWebhook('reveal')).rejects.toThrow('L’adresse publique n’est pas en HTTPS');
  });

  it('turns an answer the contract refuses into « le serveur ne répond pas »', async () => {
    answer(200, { feeds: 'nope' });
    await expect(connectWebhook('reveal')).rejects.toBeInstanceOf(ServicesError);
  });
});
